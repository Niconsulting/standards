'use strict';
// Spielzustand und Simulation

const G = {
  s: null,            // speicherbarer Zustand
  bmap: new Map(),    // id -> Gebäude
  umap: new Map(),    // id -> Einheit
  proj: [],           // Geschosse (nicht gespeichert)
  fx: [],             // Effekte (nicht gespeichert)
  reserved: new Map(),// Baum-Index -> Einheit-ID
  onMsg: null,
  onEnd: null,
  msgCool: {},

  msg(text, kind, key, cool) {
    if (key) {
      const now = this.s ? this.s.time : 0;
      if (this.msgCool[key] && now - this.msgCool[key] < (cool || 30)) return;
      this.msgCool[key] = now;
    }
    if (this.onMsg) this.onMsg(text, kind || 'info');
  },

  // ---------- Neues Spiel ----------
  newGame(opts) {
    const seed = opts.seed || ((Math.random() * 1e9) | 0);
    World.generate(seed);
    Path.init(World.n);
    this.bmap.clear(); this.umap.clear(); this.reserved.clear();
    this.proj = []; this.fx = []; this.msgCool = {};
    const d = opts.difficulty || 'normal';
    this.s = {
      version: SAVE_VERSION, seed, time: 0, difficulty: d,
      peace: (opts.peace != null ? opts.peace : 8) * 60,
      nextId: 1, over: null,
      players: [0, 1].map(id => ({
        id, ai: id === 1,
        res: id === 0 ? { holz: 100, stein: 50, eisen: 0, weizen: 0, mehl: 0, nahrung: 60, brot: 0, gold: 1000 }
                      : { holz: 120, stein: 80, eisen: 0, weizen: 0, mehl: 0, nahrung: 100, brot: 0, gold: 800 },
        tax: 3, ration: 2, popularity: 70, trend: 0, factors: {},
        econT: ECON_TICK, migT: 3, keep: 0, fire: null, effRation: 2,
      })),
      buildings: [], units: [],
      ai: null, mission: opts.mission || null, stats: { kills: 0, lost: 0 },
    };
    for (const owner of [0, 1]) this.setupBase(owner);
    AI.init();
    if (opts.mission && typeof Campaign !== 'undefined') Campaign.setup(this.s);
    return this.s;
  },

  setupBase(owner) {
    const p = this.s.players[owner];
    const kp = World.keepPos(owner);
    const m = (dx, dy) => owner === 0 ? { x: kp.x + dx, y: kp.y + dy } : { x: kp.x + dy, y: kp.y + dx };
    const k = this.addBuilding('keep', owner, kp.x, kp.y);
    p.keep = k.id;
    let q = m(4, 0); this.addBuilding('stockpile', owner, q.x, q.y);
    q = m(0, -3); this.addBuilding('granary', owner, q.x, q.y);
    p.fire = m(4, 4);
    for (let i = 0; i < 8; i++) {
      const u = this.addUnit('peasant', owner, p.fire.x + 0.5 + (Math.random() - 0.5) * 3, p.fire.y + 0.5 + (Math.random() - 0.5) * 3);
      u.task = 'idle';
    }
  },

  // ---------- Gebäude ----------
  canPlace(type, owner, x, y) {
    const D = BUILDINGS[type];
    const p = this.s.players[owner];
    for (let yy = y; yy < y + D.h; yy++) for (let xx = x; xx < x + D.w; xx++) {
      if (!World.inb(xx, yy)) return 'Außerhalb der Karte';
      const t = World.tile(xx, yy);
      if (t === T.WATER) return 'Nicht auf Wasser';
      if (World.occ[World.idx(xx, yy)]) return 'Hier steht schon etwas';
      if (D.terrain) { if (!D.terrain.includes(t)) return D.terrain[0] === T.ROCK ? 'Nur auf Fels' : D.terrain[0] === T.IRON ? 'Nur auf Erzboden' : 'Nur auf Oasenboden'; }
      else if (!D.anyTerrain && (t === T.ROCK || t === T.IRON)) return 'Nicht auf Fels oder Erz';
    }
    // nicht direkt beim Feind bauen
    const ek = this.bmap.get(this.s.players[1 - owner].keep);
    if (ek && U.dist(x + D.w / 2, y + D.h / 2, ek.x + 1.5, ek.y + 1.5) < 13) return 'Zu nah an der feindlichen Burg';
    const fire = p.fire;
    if (fire && x <= fire.x && fire.x < x + D.w && y <= fire.y && fire.y < y + D.h) return 'Nicht auf das Lagerfeuer';
    return null;
  },

  canAfford(owner, cost, mult) {
    const r = this.s.players[owner].res;
    mult = mult || 1;
    for (const k in cost) if ((r[k] || 0) < cost[k] * mult) return false;
    return true;
  },
  pay(owner, cost, mult) {
    const r = this.s.players[owner].res;
    mult = mult || 1;
    for (const k in cost) r[k] -= cost[k] * mult;
  },
  missing(owner, cost, mult) {
    const r = this.s.players[owner].res;
    mult = mult || 1;
    const out = [];
    for (const k in cost) if ((r[k] || 0) < cost[k] * mult) out.push(RES_NAME[k]);
    return out;
  },

  tryBuild(type, owner, x, y, quiet) {
    const err = this.canPlace(type, owner, x, y);
    if (err) { if (!quiet) this.msg(err, 'warn', 'place', 1); return null; }
    const D = BUILDINGS[type];
    if (!this.canAfford(owner, D.cost)) {
      if (!quiet) this.msg('Nicht genug ' + this.missing(owner, D.cost).join(' und '), 'warn', 'afford', 1.5);
      return null;
    }
    this.pay(owner, D.cost);
    return this.addBuilding(type, owner, x, y);
  },

  addBuilding(type, owner, x, y, id) {
    const D = BUILDINGS[type];
    const b = { id: id || this.s.nextId++, type, owner, x, y, w: D.w, h: D.h, hp: D.hp, maxHp: D.hp, worker: 0, garrison: [], level: 1 };
    for (let yy = y; yy < y + D.h; yy++) for (let xx = x; xx < x + D.w; xx++) {
      const i = World.idx(xx, yy);
      World.occ[i] = b.id;
      if (World.trees[i]) { World.trees[i] = 0; this.reserved.delete(i); }
    }
    this.s.buildings.push(b);
    this.bmap.set(b.id, b);
    if (!id) {
      // Einheiten von der Fläche schieben
      for (const u of this.s.units) {
        if (u.tower) continue;
        const tx = u.x | 0, ty = u.y | 0;
        if (tx >= x && tx < x + D.w && ty >= y && ty < y + D.h) this.pushOut(u);
      }
      this.fx.push({ k: 'dust', x: x + D.w / 2, y: y + D.h / 2, t: 0, dur: 0.6, r: Math.max(D.w, D.h) });
    }
    return b;
  },

  pushOut(u) {
    const sx = u.x | 0, sy = u.y | 0;
    for (let r = 1; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = World.cost(sx + dx, sy + dy, { owner: u.owner });
        if (c >= 0 && c < 5) { u.x = sx + dx + 0.5; u.y = sy + dy + 0.5; u.path = null; return; }
      }
    }
  },

  removeBuilding(b, destroyed) {
    if (!this.bmap.has(b.id)) return;
    for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) {
      const i = World.idx(xx, yy);
      if (World.occ[i] === b.id) World.occ[i] = 0;
    }
    this.bmap.delete(b.id);
    b.dead = true;
    this.s.buildings = this.s.buildings.filter(o => o !== b);
    // Besatzung absetzen
    for (const uid of b.garrison) {
      const u = this.umap.get(uid);
      if (!u) continue;
      u.tower = 0;
      if (destroyed) { u.hp -= 25; if (u.hp <= 0) { this.killUnit(u); continue; } }
      this.pushOut(u);
      u.order = { t: 'idle', gx: u.x, gy: u.y };
    }
    b.garrison = [];
    if (b.worker) {
      const w = this.umap.get(b.worker);
      if (w) this.releaseWorker(w);
    }
    this.fx.push({ k: destroyed ? 'rubble' : 'dust', x: b.x + b.w / 2, y: b.y + b.h / 2, t: 0, dur: destroyed ? 2.5 : 0.8, r: Math.max(b.w, b.h) });
    if (UI.selB === b.id) UI.selB = 0;
    if (b.type === 'keep') {
      const loser = b.owner;
      this.s.over = loser === 0 ? 'lose' : 'win';
      if (this.onEnd) this.onEnd(this.s.over);
    } else if (destroyed && b.owner === 0) {
      this.msg(BUILDINGS[b.type].name + ' wurde zerstört', 'bad', 'destroyed-' + b.type, 6);
    }
  },

  demolish(b) {
    if (!b || b.type === 'keep') return;
    const D = BUILDINGS[b.type];
    const r = this.s.players[b.owner].res;
    for (const k of ['holz', 'stein']) if (D.cost[k]) r[k] += Math.floor(D.cost[k] / 2);
    this.removeBuilding(b, false);
  },

  housing(owner) {
    let h = 0;
    for (const b of this.s.buildings) if (b.owner === owner && BUILDINGS[b.type].housing) h += BUILDINGS[b.type].housing + 4 * ((b.level || 1) - 1);
    return h;
  },

  upgrade(b) {
    const D = BUILDINGS[b.type];
    if (!D.upgrade || (b.level || 1) >= 3) return false;
    const cost = upgradeCost(b);
    if (!this.canAfford(b.owner, cost)) { if (b.owner === 0) this.msg('Nicht genug ' + this.missing(b.owner, cost).join(' und '), 'warn', 'afford', 1.5); return false; }
    this.pay(b.owner, cost);
    b.level = (b.level || 1) + 1;
    const nm = Math.round(D.hp * (1 + 0.5 * (b.level - 1)));
    b.hp += nm - b.maxHp; b.maxHp = nm;
    this.fx.push({ k: 'dust', x: b.x + b.w / 2, y: b.y + b.h / 2, t: 0, dur: 0.6, r: b.w });
    if (b.owner === 0) this.msg(D.name + ' auf Stufe ' + b.level + ' ausgebaut.', 'good');
    return true;
  },

  trade(owner, res, buy) {
    const r = this.s.players[owner].res, price = MARKET[res];
    if (buy) {
      if (r.gold < price) { this.msg('Nicht genug Gold.', 'warn', 'afford', 1); return; }
      r.gold -= price; r[res] = (r[res] || 0) + 5;
    } else {
      if ((r[res] || 0) < 5) { this.msg('Du hast keine 5 ' + RES_NAME[res] + '.', 'warn', 'afford', 1); return; }
      r[res] -= 5; r.gold += Math.floor(price / 2);
    }
  },
  count(owner, type) {
    let n = 0;
    for (const b of this.s.buildings) if (b.owner === owner && b.type === type) n++;
    return n;
  },
  peasants(owner) {
    let all = 0, idle = 0;
    for (const u of this.s.units) if (u.owner === owner && u.type === 'peasant' && !u.dead) { all++; if (!u.job) idle++; }
    return { all, idle };
  },

  // ---------- Einheiten ----------
  addUnit(type, owner, x, y, id) {
    const D = UNITS[type];
    const u = {
      id: id || this.s.nextId++, type, owner, x, y, hp: D.hp, maxHp: D.hp,
      dest: null, path: null, pi: 0, face: 1, anim: Math.random() * 10,
      cd: 0, scan: Math.random() * 0.5, engage: 0, tower: 0,
      order: { t: 'idle', gx: x, gy: y },
      task: 'idle', job: 0, phase: '', timer: 0, carry: null, treeI: -1,
    };
    this.s.units.push(u);
    this.umap.set(u.id, u);
    return u;
  },

  killUnit(u) {
    if (u.dead) return;
    u.dead = true;
    this.fx.push({ k: 'death', x: u.x, y: u.y, t: 0, dur: 1.6, owner: u.owner, type: u.type, z: u.z || 0 });
    this.removeUnit(u);
  },

  removeUnit(u) {
    u.dead = true;
    this.umap.delete(u.id);
    if (u.type === 'peasant') this.releaseWorker(u);
    if (u.tower) {
      const t = this.bmap.get(u.tower);
      if (t) t.garrison = t.garrison.filter(i => i !== u.id);
    }
    UI.unselect(u.id);
  },

  releaseWorker(u) {
    if (u.job) {
      const b = this.bmap.get(u.job);
      if (b && b.worker === u.id) b.worker = 0;
    }
    if (u.treeI >= 0 && this.reserved.get(u.treeI) === u.id) this.reserved.delete(u.treeI);
    u.job = 0; u.task = 'idle'; u.phase = ''; u.carry = null; u.treeI = -1; u.dest = null; u.path = null;
  },

  // ---------- Bewegung ----------
  setDest(u, d) { u.dest = d; u.path = null; u.pi = 0; u.fails = 0; },

  goalOf(d) {
    if (d.bid) {
      const b = this.bmap.get(d.bid);
      if (!b) return null;
      const r = d.r || 0;
      if (r > 0) return { fn: (x, y) => U.rectDist(x + 0.5, y + 0.5, b.x, b.y, b.w, b.h) <= r, hx: b.x + b.w / 2, hy: b.y + b.h / 2 };
      return {
        fn: (x, y) => x >= b.x - 1 && x <= b.x + b.w && y >= b.y - 1 && y <= b.y + b.h && !(x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h),
        hx: b.x + b.w / 2, hy: b.y + b.h / 2,
      };
    }
    const tx = d.x | 0, ty = d.y | 0;
    return { fn: (x, y) => x === tx && y === ty, hx: tx, hy: ty };
  },

  // 'moving' | 'arrived' | 'fail' | 'blocked'
  navigate(u, dt) {
    if (!u.dest) return 'arrived';
    const o = { owner: u.owner, breach: !!u.dest.breach, partial: !!u.dest.partial };
    if (!u.path) {
      const gl = this.goalOf(u.dest);
      if (!gl) { u.dest = null; return 'fail'; }
      if (gl.fn(u.x | 0, u.y | 0)) { u.dest = null; return 'arrived'; }
      u.path = Path.find(u.x | 0, u.y | 0, gl.fn, gl.hx, gl.hy, o, u.dest.max || 6000);
      u.pi = 0;
      if (!u.path) { u.dest = null; return 'fail'; }
      if (u.path.partial && !u.dest.partial) { u.path = null; u.dest = null; return 'fail'; }
    }
    if (u.pi >= u.path.length) {
      const wasPartial = u.path.partial;
      u.path = null; u.dest = null;
      return wasPartial && !(u.dest && u.dest.partial) ? 'arrived' : 'arrived';
    }
    const wp = u.path[u.pi];
    const tx = wp[0], ty = wp[1];
    if ((u.x | 0) !== tx || (u.y | 0) !== ty) {
      const c = World.cost(tx, ty, o);
      if (c < 0) {
        u.path = null;
        u.fails = (u.fails || 0) + 1;
        if (u.fails > 6) { u.dest = null; return 'fail'; }
        return 'moving';
      }
      if (c > 5) {
        u.blockBid = World.occ[World.idx(tx, ty)];
        return 'blocked';
      }
    }
    const cx = tx + 0.5, cy = ty + 0.5;
    const dx = cx - u.x, dy = cy - u.y;
    const dd = Math.sqrt(dx * dx + dy * dy);
    const sp = UNITS[u.type].speed * 1.2 * dt * (World.trees[World.idx(u.x | 0, u.y | 0)] ? 0.85 : 1);
    if (dd > 0.001) {
      const sdx = (dx - dy); // Bildschirmrichtung
      if (Math.abs(sdx) > 0.01) u.face = sdx > 0 ? 1 : -1;
    }
    u.moving = true;
    if (sp >= dd) { u.x = cx; u.y = cy; u.pi++; }
    else { u.x += dx / dd * sp; u.y += dy / dd * sp; }
    return 'moving';
  },

  // ---------- Hauptschleife ----------
  step(dt) {
    const s = this.s;
    if (!s || s.over) return;
    s.time += dt;
    for (const p of s.players) this.updatePlayer(p, dt);
    AI.update(dt);
    const units = s.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead) continue;
      u.moving = false;
      u.anim += dt;
      if (u.hitT > 0) u.hitT -= dt;
      if (u.type === 'peasant') this.updatePeasant(u, dt);
      else this.updateSoldier(u, dt);
    }
    this.separate();
    this.updateBallistas(dt);
    this.updateTraps(dt);
    this.updateProjectiles(dt);
    if (s.mission && typeof Campaign !== 'undefined') Campaign.update(dt);
    for (const f of this.fx) f.t += dt;
    this.fx = this.fx.filter(f => f.t < f.dur);
    if (units.some(u => u.dead)) s.units = units.filter(u => !u.dead);
  },

  separate() {
    const units = this.s.units;
    const buckets = new Map();
    for (const u of units) {
      if (u.dead || u.tower || u.type === 'peasant') continue;
      const k = (u.x | 0) + (u.y | 0) * 1000;
      let arr = buckets.get(k);
      if (!arr) buckets.set(k, arr = []);
      arr.push(u);
    }
    for (const u of units) {
      if (u.dead || u.tower || u.type === 'peasant') continue;
      const bx = u.x | 0, by = u.y | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const arr = buckets.get(bx + dx + (by + dy) * 1000);
        if (!arr) continue;
        for (const v of arr) {
          if (v === u || v.id < u.id) continue;
          let ex = u.x - v.x, ey = u.y - v.y;
          const d2 = ex * ex + ey * ey;
          const min = 0.42;
          if (d2 < min * min) {
            let d = Math.sqrt(d2);
            if (d < 0.001) { ex = Math.random() - 0.5; ey = Math.random() - 0.5; d = Math.sqrt(ex * ex + ey * ey); }
            const push = (min - d) * 0.25;
            const px = ex / d * push, py = ey / d * push;
            this.nudge(u, px, py);
            this.nudge(v, -px, -py);
          }
        }
      }
    }
  },
  nudge(u, px, py) {
    const nx = u.x + px, ny = u.y + py;
    const c = World.cost(nx | 0, ny | 0, { owner: u.owner });
    if (c >= 0 && c < 5) { u.x = nx; u.y = ny; }
  },

  // ---------- Spieler / Wirtschaft ----------
  updatePlayer(p, dt) {
    p.econT -= dt;
    if (p.econT <= 0) { p.econT += ECON_TICK; this.econTick(p); }
    p.migT -= dt;
    if (p.migT <= 0) this.migrate(p);
    p.jobT = (p.jobT || 0) - dt;
    if (p.jobT <= 0) { p.jobT = 1; this.assignJobs(p); }
  },

  econTick(p) {
    const pop = this.peasants(p.id).all;
    const r = p.res;
    if (p.ai) {
      const D = DIFFICULTY[this.s.difficulty];
      r.gold += D.gold + pop * 0.4;
      r.holz += D.mat; r.stein += D.mat; r.eisen += D.iron;
      return;
    }
    // Nahrung (Äpfel und Brot)
    const total = FOODS.reduce((a, k) => a + (r[k] || 0), 0);
    let eff = p.ration;
    while (eff > 0 && pop * RATIONS[eff].eat * FOOD_PER_PEASANT > total + 0.001) eff--;
    let need = pop * RATIONS[eff].eat * FOOD_PER_PEASANT;
    const kinds = FOODS.filter(k => (r[k] || 0) > 0.5).length;
    for (const k of FOODS) {
      if (need <= 0) break;
      const share = total > 0 ? need * (r[k] || 0) / total : 0;
      const take = Math.min(r[k] || 0, share);
      r[k] -= take;
    }
    const left = need - (total - FOODS.reduce((a, k) => a + (r[k] || 0), 0));
    if (left > 0.001) for (const k of FOODS) { const t2 = Math.min(r[k] || 0, left); r[k] -= t2; }
    if (eff < p.ration && pop > 0) this.msg('Die Nahrung reicht nicht – Rationen gekürzt!', 'bad', 'food', 30);
    else if (pop > 0 && total < pop * RATIONS[p.ration].eat * FOOD_PER_PEASANT * 4) this.msg('Die Vorräte werden knapp. Baue Apfelhaine oder Weizenfelder.', 'warn', 'foodlow', 60);
    p.effRation = eff;
    // Steuern
    let tax = p.tax;
    const gold = pop * TAXES[tax].gold;
    if (gold < 0 && r.gold + gold < 0) { tax = 3; this.msg('Kein Gold mehr für Spenden.', 'warn', 'bribe', 60); }
    r.gold += pop * TAXES[tax].gold;
    // Beliebtheit
    const ch = this.s.buildings.filter(b => b.owner === p.id && b.type === 'chapel').map(b => 1 + (b.level || 1)).sort((a, b) => b - a).slice(0, 2);
    const f = {
      nahrung: RATIONS[eff].pop,
      vielfalt: eff > 0 && kinds >= 2 ? 1 : 0,
      steuern: TAXES[tax].pop,
      kapelle: ch.reduce((a, b) => a + b, 0),
    };
    f.gesamt = f.nahrung + f.vielfalt + f.steuern + f.kapelle;
    p.factors = f;
    p.trend = f.gesamt;
    p.popularity = U.clamp(p.popularity + f.gesamt * 0.5, 0, 100);
  },

  migrate(p) {
    const pc = this.peasants(p.id);
    const housing = this.housing(p.id);
    const pop = p.ai ? 70 : p.popularity;
    if (pop >= 50 && pc.all < housing) {
      p.migT = pop >= 75 ? 2.5 : 4;
      const e = this.edgeSpawn(p.id);
      const u = this.addUnit('peasant', p.id, e.x + 0.5, e.y + 0.5);
      u.task = 'idle';
    } else if (pop < 50 && pc.all > 0) {
      p.migT = pop < 25 ? 2 : 4;
      let v = this.s.units.find(u => u.owner === p.id && u.type === 'peasant' && !u.job && !u.dead);
      if (!v) v = this.s.units.find(u => u.owner === p.id && u.type === 'peasant' && !u.dead);
      if (v) {
        this.fx.push({ k: 'leave', x: v.x, y: v.y, t: 0, dur: 1 });
        this.removeUnit(v);
        if (!p.ai) this.msg('Bauern verlassen deine Burg – die Beliebtheit ist zu niedrig!', 'bad', 'leave', 40);
      }
    } else p.migT = 2;
  },

  edgeSpawn(owner) {
    const n = World.n;
    const kp = World.keepPos(owner);
    let x = owner === 0 ? 1 : kp.x + 6, y = owner === 0 ? kp.y + 6 : 1;
    for (let i = 0; i < 20; i++) {
      if (World.free(x, y, owner)) return { x, y };
      if (owner === 0) y = Math.max(0, y - 1); else x = Math.max(0, x - 1);
    }
    const f = this.s.players[owner].fire;
    return { x: f.x, y: f.y };
  },

  assignJobs(p) {
    let idle = null;
    for (const b of this.s.buildings) {
      if (b.owner !== p.id || !BUILDINGS[b.type].worker) continue;
      if (b.worker && this.umap.has(b.worker)) continue;
      b.worker = 0;
      if (!idle) idle = this.s.units.filter(u => u.owner === p.id && u.type === 'peasant' && !u.job && !u.dead);
      if (!idle.length) return;
      let best = 0, bd = 1e9;
      for (let i = 0; i < idle.length; i++) {
        const d = U.dist(idle[i].x, idle[i].y, b.x, b.y);
        if (d < bd) { bd = d; best = i; }
      }
      const u = idle.splice(best, 1)[0];
      b.worker = u.id;
      u.job = b.id; u.task = 'toWork'; u.phase = '';
      this.setDest(u, { bid: b.id });
    }
  },

  // ---------- Bauern ----------
  updatePeasant(u, dt) {
    const p = this.s.players[u.owner];
    if (u.job && !this.bmap.has(u.job)) this.releaseWorker(u);
    if (u.task === 'idle') {
      u.timer -= dt;
      if (u.dest) { const r = this.navigate(u, dt); if (r === 'fail') u.timer = 2; return; }
      if (u.timer > 0) return;
      const f = p.fire;
      const a = Math.random() * Math.PI * 2, rr = 1 + Math.random() * 2.5;
      const tx = Math.floor(f.x + 0.5 + Math.cos(a) * rr), ty = Math.floor(f.y + 0.5 + Math.sin(a) * rr);
      if (World.free(tx, ty, u.owner)) this.setDest(u, { x: tx, y: ty, max: 2500 });
      u.timer = 2 + Math.random() * 5;
      return;
    }
    const b = this.bmap.get(u.job);
    if (!b) { this.releaseWorker(u); return; }
    if (u.task === 'toWork') {
      const r = this.navigate(u, dt);
      if (r === 'arrived') { u.task = 'work'; u.phase = 'start'; }
      else if (r === 'fail') this.waitRetry(u, b, 'toWork');
      return;
    }
    if (u.task === 'wait') {
      u.timer -= dt;
      if (u.timer <= 0) { u.task = u.after; if (u.task === 'toWork') this.setDest(u, { bid: b.id }); }
      return;
    }
    this.workerLogic(u, b, dt);
  },

  waitRetry(u, b, after) {
    u.task = 'wait'; u.after = after; u.timer = 3;
    if (u.owner === 0) this.msg('Ein Arbeiter findet keinen Weg zur ' + BUILDINGS[b.type].name + '. Fehlt ein Tor?', 'warn', 'noway', 45);
  },

  workerLogic(u, b, dt) {
    if (b.type === 'ballista') { u.working = false; u.operating = b.id; return; }
    const pr = PROD[b.type];
    if (!pr) return;
    switch (u.phase) {
      case 'start':
        if (b.type === 'woodcutter') u.phase = 'findTree';
        else if (pr.input) u.phase = 'findInput';
        else { u.phase = 'produce'; u.timer = pr.time / lvlMul(b); }
        break;
      case 'findInput': {
        let best = null, bd = 1e9;
        for (const s2 of this.s.buildings) {
          if (s2.owner !== u.owner || s2.type !== 'stockpile') continue;
          const d = U.dist(u.x, u.y, s2.x + 1, s2.y + 1);
          if (d < bd) { bd = d; best = s2; }
        }
        if (!best) { u.phase = 'noStore'; u.timer = 4; break; }
        this.setDest(u, { bid: best.id });
        u.phase = 'toInput';
        break;
      }
      case 'toInput': {
        const r = this.navigate(u, dt);
        if (r === 'arrived') {
          const res = this.s.players[u.owner].res;
          if ((res[pr.input.res] || 0) >= pr.input.amt) {
            res[pr.input.res] -= pr.input.amt;
            u.carry = { res: pr.input.res, amt: pr.input.amt };
            this.setDest(u, { bid: b.id }); u.phase = 'toHome';
          } else {
            u.phase = 'waitInput'; u.timer = 4;
            if (u.owner === 0) this.msg(BUILDINGS[b.type].name + ': Es fehlt ' + RES_NAME[pr.input.res] + ' im Lager.', 'warn', 'input' + b.type, 45);
          }
        } else if (r === 'fail') { u.phase = 'waitInput'; u.timer = 3; }
        break;
      }
      case 'waitInput':
        u.timer -= dt;
        if (u.timer <= 0) u.phase = 'toInput', this.setDest(u, { bid: (this.s.buildings.find(s2 => s2.owner === u.owner && s2.type === 'stockpile') || b).id });
        break;
      case 'findTree': {
        const ti = this.findTree(b, u);
        if (ti < 0) {
          u.phase = 'noTree'; u.timer = 6;
          if (u.owner === 0) this.msg('Ein Holzfäller findet keine Bäume mehr in der Nähe.', 'warn', 'notree', 60);
          break;
        }
        u.treeI = ti; this.reserved.set(ti, u.id);
        this.setDest(u, { x: ti % World.n, y: (ti / World.n) | 0 });
        u.phase = 'toTree';
        break;
      }
      case 'noTree':
        u.timer -= dt;
        if (u.timer <= 0) u.phase = 'findTree';
        break;
      case 'toTree': {
        const r = this.navigate(u, dt);
        if (!World.trees[u.treeI]) { this.reserved.delete(u.treeI); u.treeI = -1; u.phase = 'findTree'; break; }
        if (r === 'fail') {
          (u.badTrees = u.badTrees || []).push(u.treeI);
          this.reserved.delete(u.treeI); u.treeI = -1; u.phase = 'findTree';
        } else if (r === 'arrived') { u.phase = 'chop'; u.timer = pr.time / lvlMul(b); }
        break;
      }
      case 'chop':
        u.timer -= dt; u.working = true;
        if (u.timer <= 0) {
          u.working = false;
          const i = u.treeI;
          const amt = Math.min(pr.amt, World.trees[i]);
          World.trees[i] -= amt;
          if (!World.trees[i]) this.fx.push({ k: 'fall', x: (i % World.n) + 0.5, y: ((i / World.n) | 0) + 0.5, t: 0, dur: 1 });
          this.reserved.delete(i); u.treeI = -1;
          u.carry = { res: 'holz', amt: amt || pr.amt };
          u.phase = 'findStore';
        }
        break;
      case 'produce':
        u.timer -= dt; u.working = true;
        if (u.timer <= 0) { u.working = false; u.carry = { res: pr.res, amt: pr.amt }; u.phase = 'findStore'; }
        break;
      case 'findStore': {
        let best = null, bd = 1e9;
        for (const s of this.s.buildings) {
          if (s.owner !== u.owner || s.type !== pr.store) continue;
          const d = U.dist(u.x, u.y, s.x + s.w / 2, s.y + s.h / 2);
          if (d < bd) { bd = d; best = s; }
        }
        if (!best) {
          u.phase = 'noStore'; u.timer = 4;
          if (u.owner === 0) this.msg('Es fehlt ein ' + BUILDINGS[pr.store].name + '!', 'warn', 'nostore' + pr.store, 40);
          break;
        }
        u.storeId = best.id;
        this.setDest(u, { bid: best.id });
        u.phase = 'toStore';
        break;
      }
      case 'noStore':
        u.timer -= dt;
        if (u.timer <= 0) u.phase = 'findStore';
        break;
      case 'toStore': {
        const r = this.navigate(u, dt);
        if (r === 'arrived') {
          if (u.carry) this.s.players[u.owner].res[u.carry.res] += u.carry.amt;
          u.carry = null;
          if (b.type === 'woodcutter') u.phase = 'findTree';
          else if (pr.input) u.phase = 'findInput';
          else { this.setDest(u, { bid: b.id }); u.phase = 'toHome'; }
        } else if (r === 'fail') { u.phase = 'noStore'; u.timer = 3; }
        break;
      }
      case 'toHome': {
        const r = this.navigate(u, dt);
        if (r === 'arrived') { u.carry = null; u.phase = 'produce'; u.timer = pr.time / lvlMul(b); }
        else if (r === 'fail') this.waitRetry(u, b, 'toWork');
        break;
      }
      default: u.phase = 'start';
    }
  },

  findTree(b, u) {
    const n = World.n;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    let best = -1, bd = 1e9;
    const R = 18;
    for (let y = Math.max(0, (cy - R) | 0); y < Math.min(n, cy + R); y++) {
      for (let x = Math.max(0, (cx - R) | 0); x < Math.min(n, cx + R); x++) {
        const i = y * n + x;
        if (!World.trees[i] || World.occ[i]) continue;
        const rv = this.reserved.get(i);
        if (rv && rv !== u.id && this.umap.has(rv)) continue;
        if (u.badTrees && u.badTrees.includes(i)) continue;
        const d = U.dist(x + 0.5, y + 0.5, cx, cy);
        if (d < bd && d <= R) { bd = d; best = i; }
      }
    }
    return best;
  },

  // ---------- Rekrutierung ----------
  recruit(owner, type, quiet) {
    const D = UNITS[type];
    const bar = this.s.buildings.find(b => b.owner === owner && b.type === 'barracks');
    if (!bar) { if (!quiet) this.msg('Du brauchst zuerst eine Kaserne.', 'warn'); return null; }
    let peas = this.s.units.find(u => u.owner === owner && u.type === 'peasant' && !u.job && !u.dead);
    if (!peas) { if (!quiet) this.msg('Kein freier Bauer am Lagerfeuer.', 'warn', 'nopeas', 2); return null; }
    if (!this.canAfford(owner, D.cost)) { if (!quiet) this.msg('Nicht genug ' + this.missing(owner, D.cost).join(' und '), 'warn', 'afford', 1.5); return null; }
    this.pay(owner, D.cost);
    this.removeUnit(peas);
    // Platz vor der Kaserne
    const ex = owner === 0 ? bar.x + 1 : bar.x + bar.w, ey = owner === 0 ? bar.y + bar.h : bar.y + 1;
    const u = this.addUnit(type, owner, ex + 0.5, ey + 0.5);
    if (!World.free(ex, ey, owner)) this.pushOut(u);
    const spot = this.freeSpots(u.x | 0, u.y | 0, owner, 1 + (bar.recruits = (bar.recruits || 0) + 1) % 16).pop();
    if (spot) { u.order = { t: 'move' }; this.setDest(u, { x: spot[0], y: spot[1], partial: true }); }
    return u;
  },

  freeSpots(x, y, owner, k) {
    // Breitensuche nach freien Feldern
    const n = World.n, out = [], seen = new Set([y * n + x]);
    const q = [[x, y]];
    while (q.length && out.length < k) {
      const [cx, cy] = q.shift();
      if (World.free(cx, cy, owner)) out.push([cx, cy]);
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (!World.inb(nx, ny)) continue;
        const i = ny * n + nx;
        if (seen.has(i)) continue;
        seen.add(i);
        if (World.cost(nx, ny, { owner }) >= 0 && World.cost(nx, ny, { owner }) < 5) q.push([nx, ny]);
      }
      if (seen.size > 600) break;
    }
    return out;
  },

  // ---------- Befehle ----------
  leaveTower(u) {
    if (!u.tower) return;
    const t = this.bmap.get(u.tower);
    u.tower = 0; u.z = 0;
    if (t) {
      t.garrison = t.garrison.filter(i => i !== u.id);
      u.x = t.x + t.w / 2; u.y = t.y + t.h / 2;
      this.pushOut(u);
    }
  },

  cmdMove(units, tx, ty, formation) {
    const n = units.length;
    let cx = 0, cy = 0;
    for (const u of units) { cx += u.x; cy += u.y; }
    cx /= n || 1; cy /= n || 1;
    let dx = tx + 0.5 - cx, dy = ty + 0.5 - cy;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const px = -dy, py = dx; // quer zur Laufrichtung
    const offs = [];
    const f = formation || 'block';
    if (f === 'line') for (let i = 0; i < n; i++) { const k = i - (n - 1) / 2; offs.push([px * k, py * k]); }
    else {
      const sp = f === 'loose' ? 1.8 : 1;
      const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
      for (let i = 0; i < n; i++) {
        const c = i % cols - (cols - 1) / 2, r = Math.floor(i / cols);
        offs.push([(px * c - dx * r) * sp, (py * c - dy * r) * sp]);
      }
    }
    // Fernkämpfer nach hinten, Nahkämpfer nach vorn
    const sorted = units.slice().sort((a, b) => (UNITS[a.type].ranged ? 1 : 0) - (UNITS[b.type].ranged ? 1 : 0));
    const used = new Set();
    sorted.forEach((u, i) => {
      this.leaveTower(u);
      u.engage = 0; u.blockBid = 0;
      u.order = { t: 'move' };
      let gx = Math.round(tx + offs[i][0]), gy = Math.round(ty + offs[i][1]);
      gx = U.clamp(gx, 0, World.n - 1); gy = U.clamp(gy, 0, World.n - 1);
      let spot = [gx, gy];
      if (!World.free(gx, gy, u.owner) || used.has(gx + ',' + gy)) {
        const alt = this.freeSpots(gx, gy, u.owner, 12).find(q => !used.has(q[0] + ',' + q[1]));
        if (alt) spot = alt;
      }
      used.add(spot[0] + ',' + spot[1]);
      this.setDest(u, { x: spot[0], y: spot[1], partial: true });
    });
  },
  setStance(units, st) { for (const u of units) { u.stance = st; u.engage = 0; } },
  cmdAttackUnit(units, t) {
    for (const u of units) {
      if (u.tower && !UNITS[u.type].ranged) continue;
      if (!u.tower) u.engage = 0;
      u.blockBid = 0;
      u.order = { t: 'attack', id: t.id };
      u.dest = null; u.path = null;
    }
  },
  cmdSiege(units, b) {
    for (const u of units) {
      if (u.tower && !UNITS[u.type].ranged) this.leaveTower(u);
      u.engage = 0; u.blockBid = 0;
      u.order = { t: 'siege', id: b.id };
      u.dest = null; u.path = null;
    }
  },
  cmdGarrison(units, t) {
    for (const u of units) {
      if (u.tower === t.id) continue;
      if (UNITS[u.type].siege || UNITS[u.type].healer) continue;
      this.leaveTower(u);
      u.engage = 0;
      u.order = { t: 'garrison', id: t.id };
      this.setDest(u, { bid: t.id });
    }
  },
  enterTower(u, t) {
    if (t.garrison.length >= (BUILDINGS[t.type].garrison || 4)) return false;
    t.garrison.push(u.id);
    u.tower = t.id; u.dest = null; u.path = null; u.engage = 0;
    u.order = { t: 'idle', gx: t.x + 1, gy: t.y + 1 };
    this.placeOnTower(u, t);
    return true;
  },
  placeOnTower(u, t) {
    const k = Math.max(0, t.garrison.indexOf(u.id));
    if (t.type === 'bigtower') {
      const a = k / 8 * Math.PI * 2 + 0.4;
      u.x = t.x + 1.5 + Math.cos(a) * 0.95; u.y = t.y + 1.5 + Math.sin(a) * 0.95;
    } else {
      const off = [[0.55, 0.55], [1.45, 0.55], [0.55, 1.45], [1.45, 1.45]][k % 4];
      u.x = t.x + off[0]; u.y = t.y + off[1];
    }
    u.z = 56;
  },

  // ---------- Soldaten ----------
  findEnemyUnit(u, r, reachableOnly, soldiersOnly) {
    let best = null, bs = 1e9;
    for (const t of this.s.units) {
      if (t.dead || t.owner === u.owner) continue;
      if (reachableOnly && t.tower) continue;
      if (soldiersOnly && t.type === 'peasant') continue;
      const d = U.dist(u.x, u.y, t.x, t.y);
      if (d > r) continue;
      const sc = d + (t.type === 'peasant' ? 4 : 0);
      if (sc < bs) { bs = sc; best = t; }
    }
    return best;
  },

  updateSoldier(u, dt) {
    const D = UNITS[u.type];
    u.cd -= dt; u.scan -= dt;
    if (u.atkT > 0) u.atkT -= dt;
    if (D.healer) return this.updateMonk(u, D, dt);
    if (D.siege) return this.updateSiege(u, D, dt);
    if (u.tower) {
      const tw = this.bmap.get(u.tower);
      if (!tw) { u.tower = 0; u.z = 0; this.pushOut(u); return; }
      this.placeOnTower(u, tw);
      if (!D.ranged) return;
      const R = D.range + (BUILDINGS[tw.type].rangeBonus || 3) + ((tw.level || 1) - 1);
      let t = this.umap.get(u.engage);
      if (u.order.t === 'attack') { const ot = this.umap.get(u.order.id); if (ot && !ot.dead) t = ot; else u.order = { t: 'idle' }; }
      if ((!t || t.dead || U.dist(u.x, u.y, t.x, t.y) > R) && u.scan <= 0) {
        u.scan = 0.4;
        t = this.findEnemyUnit(u, R, false);
        u.engage = t ? t.id : 0;
      }
      if (t && !t.dead && U.dist(u.x, u.y, t.x, t.y) <= R && u.cd <= 0) this.attackUnit(u, t, D);
      return;
    }
    // Ziel aus Selbstverteidigung prüfen
    const ST = STANCES[u.stance || 'defensive'];
    if (u.engage) {
      const t = this.umap.get(u.engage);
      const leash = u.stance === 'hold' ? (D.ranged ? D.range + 0.5 : 1.6) : D.ranged ? 5 * ST.aggro + 1 : ST.leash;
      const far = u.stance === 'hold' ? U.dist(u.x, u.y, t ? t.x : 0, t ? t.y : 0) > leash : U.dist(u.lx, u.ly, u.x, u.y) > leash;
      if (!t || t.dead || (!D.ranged && t.tower) || far) {
        u.engage = 0; u.dest = null; u.path = null;
      }
    }
    const o = u.order;
    if (!u.engage && u.scan <= 0 && o.t !== 'move' && o.t !== 'garrison' && o.t !== 'attack') {
      u.scan = 0.4 + Math.random() * 0.3;
      const sieging = o.t === 'siege';
      let r = D.ranged ? D.range + 0.5 : (sieging ? (u.blockBid ? 2.2 : 4) : D.aggro * ST.aggro);
      if (u.stance === 'hold') r = D.ranged ? D.range + 0.3 : 1.5;
      const t = this.findEnemyUnit(u, r, !D.ranged, sieging);
      if (t) { u.engage = t.id; u.lx = u.x; u.ly = u.y; u.dest = null; u.path = null; }
    }
    if (u.engage) {
      const t = this.umap.get(u.engage);
      if (this.fight(u, t, D, dt) === 'fail') { u.engage = 0; u.scan = 2.5; }
      return;
    }
    switch (o.t) {
      case 'idle': {
        if (o.gx == null) { o.gx = u.x; o.gy = u.y; }
        if (u.stance === 'hold') { o.gx = u.x; o.gy = u.y; }
        if (u.dest) {
          const r = this.navigate(u, dt);
          if (r !== 'moving') { u.dest = null; if (r !== 'arrived') { o.gx = u.x; o.gy = u.y; } }
        } else if (U.dist(u.x, u.y, o.gx, o.gy) > 1.2) {
          this.setDest(u, { x: o.gx | 0, y: o.gy | 0, partial: true, max: 3000 });
        }
        break;
      }
      case 'move': {
        const r = this.navigate(u, dt);
        if (r !== 'moving') u.order = { t: 'idle', gx: u.x, gy: u.y };
        break;
      }
      case 'attack': {
        const t = this.umap.get(o.id);
        if (!t || t.dead) { u.order = { t: 'idle', gx: u.x, gy: u.y }; break; }
        if (!D.ranged && t.tower) {
          const tw = this.bmap.get(t.tower);
          if (tw) { u.order = { t: 'siege', id: tw.id }; u.dest = null; }
          else u.order = { t: 'idle', gx: u.x, gy: u.y };
          break;
        }
        if (this.fight(u, t, D, dt) === 'fail') u.order = { t: 'idle', gx: u.x, gy: u.y };
        break;
      }
      case 'siege': {
        const b = this.bmap.get(o.id);
        if (!b || b.owner === u.owner) { u.blockBid = 0; u.order = { t: 'idle', gx: u.x, gy: u.y }; break; }
        this.siege(u, b, D, dt);
        break;
      }
      case 'garrison': {
        const t = this.bmap.get(o.id);
        if (!t || t.owner !== u.owner) { u.order = { t: 'idle', gx: u.x, gy: u.y }; break; }
        if (!u.dest) this.setDest(u, { bid: t.id });
        const r = this.navigate(u, dt);
        if (r === 'arrived') {
          if (!this.enterTower(u, t)) { u.order = { t: 'idle', gx: u.x, gy: u.y }; if (u.owner === 0) this.msg('Der Turm ist voll (4 Soldaten).', 'warn', 'full', 3); }
        } else if (r === 'fail') u.order = { t: 'idle', gx: u.x, gy: u.y };
        break;
      }
    }
  },

  fight(u, t, D, dt) {
    if (!t || t.dead) return 'fail';
    const d = U.dist(u.x, u.y, t.x, t.y);
    const reach = D.ranged ? D.range : D.range + 0.15;
    if (u.stance === 'hold' && d > reach && u.order.t !== 'attack') return 'fail';
    if (d <= reach) {
      u.dest = null; u.path = null;
      const sdx = (t.x - t.y) - (u.x - u.y);
      if (Math.abs(sdx) > 0.01) u.face = sdx > 0 ? 1 : -1;
      u.faceX = t.x; u.faceY = t.y;
      if (u.cd <= 0) this.attackUnit(u, t, D);
      return 'ok';
    }
    u.chaseT = (u.chaseT || 0) - dt;
    const tx = t.x | 0, ty = t.y | 0;
    if (!u.dest || (u.chaseT <= 0 && (u.dest.x !== tx || u.dest.y !== ty))) {
      u.chaseT = 0.9;
      this.setDest(u, { x: tx, y: ty, partial: true, max: 1800 });
    }
    const r = this.navigate(u, dt);
    if (r === 'fail' || r === 'blocked') return 'fail';
    if (r === 'arrived' && U.dist(u.x, u.y, t.x, t.y) > reach + 1.5) return 'fail';
    return 'ok';
  },

  siege(u, b, D, dt) {
    if (u.blockBid) {
      const bb = this.bmap.get(u.blockBid);
      if (!bb || bb.owner === u.owner) { u.blockBid = 0; }
      else {
        const dd = U.rectDist(u.x, u.y, bb.x, bb.y, bb.w, bb.h);
        if (dd <= (D.ranged ? D.range : 1.3)) { this.hitBuilding(u, bb, D); return; }
        u.blockBid = 0; u.path = null;
      }
    }
    const reach = D.ranged ? D.range - 0.3 : 1.1;
    const d = U.rectDist(u.x, u.y, b.x, b.y, b.w, b.h);
    if (d <= reach) { u.dest = null; u.path = null; this.hitBuilding(u, b, D); return; }
    if (!u.dest) this.setDest(u, { bid: b.id, breach: true, r: D.ranged ? D.range - 1 : 0, max: 8000 });
    const r = this.navigate(u, dt);
    if (r === 'fail') {
      u.siegeFails = (u.siegeFails || 0) + 1;
      if (u.siegeFails > 3) { u.order = { t: 'idle', gx: u.x, gy: u.y }; u.siegeFails = 0; }
    }
  },

  hitBuilding(u, b, D) {
    const sdx = (b.x + b.w / 2 - b.y - b.h / 2) - (u.x - u.y);
    if (Math.abs(sdx) > 0.01) u.face = sdx > 0 ? 1 : -1;
    u.faceX = b.x + b.w / 2; u.faceY = b.y + b.h / 2;
    if (u.cd > 0) return;
    u.cd = D.cd * (0.9 + Math.random() * 0.2);
    u.atkT = 0.35;
    if (D.ranged) this.shoot(u, null, b, D.bdmg);
    else this.damageBuilding(b, D.bdmg * (0.8 + Math.random() * 0.4), u.owner);
  },

  attackUnit(u, t, D) {
    u.cd = D.cd * (0.9 + Math.random() * 0.2);
    u.atkT = 0.35;
    let dmg = D.dmg * (0.85 + Math.random() * 0.3);
    if (D.bonus && D.bonus[t.type]) dmg *= D.bonus[t.type];
    if (D.ranged) this.shoot(u, t, null, dmg);
    else this.damageUnit(t, dmg, false, u);
  },

  // Mönch: folgt der Gruppe, heilt
  updateMonk(u, D, dt) {
    const o = u.order;
    if (o.t === 'move') { const r = this.navigate(u, dt); if (r !== 'moving') u.order = { t: 'idle', gx: u.x, gy: u.y }; }
    if (u.cd > 0) return;
    let best = null, bd = 1e9;
    for (const t of this.s.units) {
      if (t.dead || t.owner !== u.owner || t.type === 'peasant' || t === u || t.hp >= t.maxHp || UNITS[t.type].siege) continue;
      const d = U.dist(u.x, u.y, t.x, t.y);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) { u.cd = 0.5; return; }
    if (bd <= D.range) {
      u.dest = null; u.path = null;
      best.hp = Math.min(best.maxHp, best.hp + D.heal);
      u.cd = D.cd; u.atkT = 0.35; u.faceX = best.x; u.faceY = best.y;
      this.fx.push({ k: 'heal', x: best.x, y: best.y, t: 0, dur: 0.3 });
    } else if (o.t === 'idle' && bd < 10) {
      if (!u.dest) this.setDest(u, { x: best.x | 0, y: best.y | 0, partial: true, max: 1500 });
      this.navigate(u, dt);
    } else u.cd = 0.5;
  },

  // Rammbock und Katapult: greifen nur Gebäude an (Katapult auch Truppen per Befehl)
  updateSiege(u, D, dt) {
    const o = u.order;
    if (o.t === 'move') { const r = this.navigate(u, dt); if (r !== 'moving') u.order = { t: 'idle', gx: u.x, gy: u.y }; return; }
    if (o.t === 'siege') {
      const b = this.bmap.get(o.id);
      if (!b || b.owner === u.owner) { u.order = { t: 'idle', gx: u.x, gy: u.y }; u.blockBid = 0; return; }
      if (D.ranged) {
        const d = U.rectDist(u.x, u.y, b.x, b.y, b.w, b.h);
        if (d <= D.range - 0.3 && d >= (D.minRange || 0)) { u.dest = null; u.path = null; this.hitBuilding(u, b, D); return; }
        if (!u.dest) this.setDest(u, { bid: b.id, r: D.range - 1, breach: false, partial: true, max: 6000 });
        if (this.navigate(u, dt) === 'fail') u.order = { t: 'idle', gx: u.x, gy: u.y };
        return;
      }
      this.siege(u, b, D, dt);
      return;
    }
    if (o.t === 'attack' && D.ranged) {
      const t = this.umap.get(o.id);
      if (!t || t.dead) { u.order = { t: 'idle', gx: u.x, gy: u.y }; return; }
      const d = U.dist(u.x, u.y, t.x, t.y);
      if (d <= D.range && d >= (D.minRange || 0)) { u.dest = null; if (u.cd <= 0) { u.cd = D.cd; u.atkT = 0.35; u.faceX = t.x; u.faceY = t.y; this.shoot(u, t, null, D.dmg); } return; }
      if (!u.dest) this.setDest(u, { x: t.x | 0, y: t.y | 0, partial: true });
      this.navigate(u, dt);
      return;
    }
    if (o.t === 'attack') { u.order = { t: 'idle', gx: u.x, gy: u.y }; return; }
    // untätig: Katapult beschießt Gebäude in Reichweite
    if (D.ranged && u.scan <= 0) {
      u.scan = 1;
      let best = null, bd = 1e9;
      for (const b of this.s.buildings) {
        if (b.owner === u.owner || BUILDINGS[b.type].walk) continue;
        const d = U.rectDist(u.x, u.y, b.x, b.y, b.w, b.h);
        if (d <= D.range - 0.3 && d >= (D.minRange || 0) && d < bd) { bd = d; best = b; }
      }
      if (best && u.stance !== 'hold') u.order = { t: 'siege', id: best.id };
      else if (best) this.hitBuilding(u, best, D);
    }
  },

  // Ballistentürme schießen, wenn ein Arbeiter sie bedient
  updateBallistas(dt) {
    for (const b of this.s.buildings) {
      if (b.type !== 'ballista') continue;
      const w = this.umap.get(b.worker);
      if (!w || w.task !== 'work') continue;
      b.cd = (b.cd || 0) - dt;
      if (b.cd > 0) continue;
      const cx = b.x + 1, cy = b.y + 1, R = BUILDINGS.ballista.range + ((b.level || 1) - 1);
      let best = null, bs = 1e9;
      for (const t of this.s.units) {
        if (t.dead || t.owner === b.owner || t.type === 'peasant') continue;
        const d = U.dist(cx, cy, t.x, t.y);
        if (d > R) continue;
        const sc = d - (UNITS[t.type].siege ? 8 : 0);
        if (sc < bs) { bs = sc; best = t; }
      }
      b.target = best ? best.id : 0;
      if (!best) { b.cd = 0.5; continue; }
      b.cd = 4 / lvlMul(b);
      const dmg = 40 * (UNITS[best.type].siege ? 3 : 1);
      this.proj.push({ x0: cx, y0: cy, h0: 1.8, tx: best.x, ty: best.y, h1: 0.4, tid: best.id, bid: 0, dmg, pierce: true, t: 0, dur: 0.2 + U.dist(cx, cy, best.x, best.y) / 22, owner: b.owner, src: 0, kind: 'bolt' });
    }
  },

  // Fallen und Pech
  updateTraps(dt) {
    const n = World.n;
    for (const u of this.s.units) {
      if (u.dead || u.tower) continue;
      const i = World.idx(U.clamp(u.x | 0, 0, n - 1), U.clamp(u.y | 0, 0, n - 1));
      const b = this.bmap.get(World.occ[i]);
      if (!b || b.owner === u.owner) continue;
      if (b.type === 'trap') {
        this.damageUnit(u, 90, false, null);
        this.fx.push({ k: 'dust', x: b.x + 0.5, y: b.y + 0.5, t: 0, dur: 0.6, r: 1 });
        if (b.owner === 0) this.msg('Eine Fallgrube hat zugeschnappt!', 'good', 'trap', 8);
        this.removeBuilding(b, false);
      } else if (b.type === 'pitch' && !b.burn) {
        const guard = this.s.units.some(v => v.owner === b.owner && !v.dead && v.type !== 'peasant' && U.dist(v.x, v.y, b.x, b.y) < 10);
        if (guard) this.ignite(b);
      }
    }
    for (const b of this.s.buildings.slice()) {
      if (b.type !== 'pitch' || !b.burn) continue;
      b.burn -= dt;
      for (const u of this.s.units) {
        if (u.dead || u.owner === b.owner || u.tower) continue;
        if ((u.x | 0) === b.x && (u.y | 0) === b.y) this.damageUnit(u, 32 * dt, false, null);
      }
      if (b.burn <= 0) this.removeBuilding(b, false);
    }
  },
  ignite(b0) {
    const q = [b0], seen = new Set([b0.id]);
    while (q.length) {
      const b = q.shift();
      b.burn = 4;
      for (let d = 0; d < 8; d++) {
        const nb = this.bmap.get(World.occ[World.idx(U.clamp(b.x + DX[d], 0, World.n - 1), U.clamp(b.y + DY[d], 0, World.n - 1))]);
        if (nb && nb.type === 'pitch' && nb.owner === b0.owner && !seen.has(nb.id)) { seen.add(nb.id); q.push(nb); }
      }
    }
    if (b0.owner === 0) this.msg('Der Pechgraben brennt!', 'good', 'pitch', 6);
  },

  shoot(u, t, b, dmg) {
    const D = UNITS[u.type];
    const tx = t ? t.x : b.x + b.w / 2, ty = t ? t.y : b.y + b.h / 2;
    const d = U.dist(u.x, u.y, tx, ty);
    const tw = u.tower ? this.bmap.get(u.tower) : null;
    const h0 = tw ? (typeof TOWER_TOP !== 'undefined' ? TOWER_TOP[tw.type] || 2 : 2) + 0.6 : 0.6;
    const ht = t && t.tower ? 2.3 : t ? 0.45 : 0.8;
    this.proj.push({ x0: u.x, y0: u.y, z0: (u.z || 0) + 14, h0, tx, ty, tz: t ? (t.z || 0) + 10 : 20, h1: ht,
      tid: t ? t.id : 0, bid: b ? b.id : 0, dmg, t: 0, dur: (D.siege ? 0.8 : 0.25) + d / (D.siege ? 9 : 14), owner: u.owner, src: u.id,
      pierce: !!D.pierce, splash: D.splash || 0, kind: D.siege ? 'stone' : 'arrow', bdmg: D.siege ? D.bdmg : 0 });
  },

  updateProjectiles(dt) {
    for (const p of this.proj) {
      p.t += dt;
      if (p.tid) { const t = this.umap.get(p.tid); if (t) { p.tx = t.x; p.ty = t.y; p.tz = (t.z || 0) + 10; } }
      if (p.t >= p.dur) {
        p.done = true;
        if (p.splash) {
          for (const t of this.s.units) if (!t.dead && t.owner !== p.owner && U.dist(t.x, t.y, p.tx, p.ty) <= p.splash) this.damageUnit(t, UNITS.catapult.dmg, true, null);
          if (p.bid) { const b = this.bmap.get(p.bid); if (b) this.damageBuilding(b, p.bdmg || p.dmg, p.owner); }
          this.fx.push({ k: 'dust', x: p.tx, y: p.ty, t: 0, dur: 0.6, r: 1 });
        } else if (p.tid) { const t = this.umap.get(p.tid); if (t && !t.dead) this.damageUnit(t, p.dmg, true, this.umap.get(p.src), p.pierce); }
        else if (p.bid) { const b = this.bmap.get(p.bid); if (b) this.damageBuilding(b, p.dmg, p.owner); }
      }
    }
    this.proj = this.proj.filter(p => !p.done);
  },

  damageUnit(t, dmg, ranged, src, pierce) {
    const A = UNITS[t.type].armor;
    if (A && !pierce) dmg *= ranged ? A[0] : A[1];
    if (t.tower && ranged) dmg *= 0.6;
    t.hp -= dmg;
    t.hitT = 0.18;
    if (t.owner === 0 && t.type !== 'peasant') this.msg('Deine Truppen werden angegriffen!', 'bad', 'underattack', 25);
    // Gegenwehr: getroffene Einheit ohne Ziel reagiert
    if (src && !src.dead && t.type !== 'peasant' && !t.engage && t.order && t.order.t === 'idle') {
      const D = UNITS[t.type];
      if (D.ranged || !src.tower) { t.engage = src.id; t.lx = t.x; t.ly = t.y; }
    }
    if (t.hp <= 0) {
      if (this.s.stats) { if (t.owner === 0 && t.type !== 'peasant') this.s.stats.lost++; else if (t.owner !== 0 && t.type !== 'peasant') this.s.stats.kills++; }
      this.killUnit(t);
    }
  },

  damageBuilding(b, dmg, owner) {
    b.hp -= dmg;
    b.hitT = 0.15;
    if (b.owner === 0) this.msg('Deine Burg wird angegriffen!', 'bad', 'bldattack', 25);
    if (b.hp <= 0) this.removeBuilding(b, true);
  },

  dateText() {
    const m = Math.floor(this.s.time / MONTH_SECONDS);
    return MONTHS[m % 12] + ' ' + (1190 + Math.floor(m / 12));
  },
};
