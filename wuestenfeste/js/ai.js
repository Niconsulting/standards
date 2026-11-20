'use strict';
// Computergegner: baut Wirtschaft und Burg, bildet Truppen aus, greift in Wellen an

const AI = {
  R: 7,
  OWNER: 1,
  PLAN: [
    ['woodcutter', 2, 'trees'], ['house', 1], ['quarry', 1, 'rock'], ['house', 2], ['barracks', 1],
    ['ring', 'gate'], ['mine', 1, 'iron'], ['house', 3], ['woodcutter', 3, 'trees'], ['ring', 'tower'],
    ['orchard', 1, 'grass'], ['house', 4], ['quarry', 2, 'rock'], ['ring', 'wall'], ['house', 6],
    ['mine', 2, 'iron'], ['stockpile', 2],
  ],
  MIX: { archer: 0.24, crossbow: 0.1, spear: 0.16, pike: 0.1, sword: 0.16, knight: 0.1, assassin: 0.04, monk: 0.04, ram: 0.04, catapult: 0.02 },

  init() {
    G.s.ai = { thinkT: 3, waves: 0, nextAttack: G.s.peace, buildT: 2, recruitT: 20 };
  },

  center() {
    const k = G.bmap.get(G.s.players[this.OWNER].keep);
    if (!k) return null;
    return { x: k.x + 1, y: k.y + 1 };
  },

  inBand(x, y, c) {
    const d = Math.max(Math.abs(x - c.x), Math.abs(y - c.y));
    return d >= this.R - 1 && d <= this.R + 1;
  },

  ringTiles(c, Rr) {
    const R = Rr || this.R, out = { gate: [], tower: [], wall: [] };
    const towerSet = new Set();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const tx = sx > 0 ? c.x + R - 1 : c.x - R, ty = sy > 0 ? c.y + R - 1 : c.y - R;
      out.tower.push([tx, ty]);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) towerSet.add((tx + dx) + ',' + (ty + dy));
    }
    out.gate.push([c.x - R, c.y], [c.x, c.y + R], [c.x + R, c.y], [c.x, c.y - R]);
    const gateSet = new Set(out.gate.map(g => g[0] + ',' + g[1]));
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== R) continue;
      const k = (c.x + dx) + ',' + (c.y + dy);
      if (towerSet.has(k) || gateSet.has(k)) continue;
      out.wall.push([c.x + dx, c.y + dy]);
    }
    // Mauern sortiert: zuerst Seite zum Spieler
    out.wall.sort((a, b) => ((a[0] - c.x) - (a[1] - c.y)) - ((b[0] - c.x) - (b[1] - c.y)));
    return out;
  },

  update(dt) {
    const s = G.s, a = s.ai;
    if (!a || s.over) return;
    a.thinkT -= dt;
    if (a.thinkT > 0) return;
    a.thinkT = 1;
    const c = this.center();
    if (!c) return;
    const D = DIFFICULTY[s.difficulty];
    a.buildT = (a.buildT || 0) - 1;
    if (a.buildT <= 0) { a.buildT = D.build; this.build(c); }
    this.army(c);
    this.attack(c);
  },

  build(c) {
    const p = G.s.players[this.OWNER];
    let budget = 1;
    for (const item of this.PLAN) {
      if (budget <= 0) return;
      if (item[0] === 'ring') {
        const kind = item[1];
        // Während einer Belagerung wird nicht an der Mauer gebaut
        if (this.underSiege(c)) continue;
        const list = this.ringTiles(c)[kind];
        let todo = 0;
        for (const [x, y] of list) {
          const bid = World.occ[World.idx(x, y)];
          if (bid) continue;
          if (World.tile(x, y) === T.WATER) continue;
          todo++;
          if (!G.canAfford(this.OWNER, BUILDINGS[kind].cost)) return;
          if (G.canPlace(kind, this.OWNER, x, y)) continue;
          // Einheiten, die im Weg stehen, verschieben sich selbst
          G.tryBuild(kind, this.OWNER, x, y, true);
          budget--;
          if (budget <= 0) return;
        }
        continue;
      }
      const [type, want, near] = item;
      if (G.count(this.OWNER, type) >= want) continue;
      const D = BUILDINGS[type];
      if (!G.canAfford(this.OWNER, D.cost)) return;
      const spot = this.findSpot(type, near, c);
      if (!spot) continue;
      G.tryBuild(type, this.OWNER, spot[0], spot[1], true);
      budget--;
    }
    // Plan erfüllt: zusätzliche Hütten bei Bedarf
    if (G.peasants(this.OWNER).all >= G.housing(this.OWNER) - 2 && G.count(this.OWNER, 'house') < 7) {
      if (G.canAfford(this.OWNER, BUILDINGS.house.cost)) {
        const spot = this.findSpot('house', null, c);
        if (spot) G.tryBuild('house', this.OWNER, spot[0], spot[1], true);
      }
    }
  },

  underSiege(c) {
    return G.s.units.some(u => u.owner !== this.OWNER && !u.dead && u.type !== 'peasant' && U.dist(u.x, u.y, c.x, c.y) < this.R + 5);
  },

  okSpot(type, x, y, c) {
    const D = BUILDINGS[type];
    if (G.canPlace(type, this.OWNER, x, y)) return false;
    // Ringzone und Abstand zu anderen Gebäuden
    for (let yy = y - 1; yy <= y + D.h; yy++) for (let xx = x - 1; xx <= x + D.w; xx++) {
      if (this.inBand(xx, yy, c)) return false;
      if (!World.inb(xx, yy)) continue;
      if (World.occ[World.idx(xx, yy)]) return false;
    }
    const f = G.s.players[this.OWNER].fire;
    if (U.dist(x + D.w / 2, y + D.h / 2, f.x + 0.5, f.y + 0.5) < 2) return false;
    return true;
  },

  findSpot(type, near, c) {
    const n = World.n;
    let anchor = c;
    if (near === 'trees') {
      let best = null, bd = 1e9;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (!World.trees[y * n + x]) continue;
        const d = U.dist(x, y, c.x, c.y);
        if (d < 5) continue;
        // Bäume in der Umgebung zählen
        let cnt = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (World.inb(x + dx, y + dy) && World.trees[(y + dy) * n + x + dx]) cnt++;
        const sc = d - cnt * 0.8;
        if (sc < bd) { bd = sc; best = { x, y }; }
      }
      if (best) anchor = best;
    }
    const terrain = near === 'rock' ? T.ROCK : near === 'iron' ? T.IRON : near === 'grass' ? T.GRASS : -1;
    const cands = [];
    const R = terrain >= 0 ? 26 : near === 'trees' ? 6 : 12;
    for (let y = Math.max(0, anchor.y - R); y < Math.min(n, anchor.y + R); y++) {
      for (let x = Math.max(0, anchor.x - R); x < Math.min(n, anchor.x + R); x++) {
        if (terrain >= 0 && World.tile(x, y) !== terrain) continue;
        const d = U.dist(x, y, anchor.x, anchor.y);
        if (terrain < 0 && near !== 'trees' && d < 3) continue;
        cands.push([x, y, d + U.hash(x, y, 77) * 1.5]);
      }
    }
    cands.sort((a, b) => a[2] - b[2]);
    for (const [x, y] of cands) if (this.okSpot(type, x, y, c)) return [x, y];
    return null;
  },

  soldiers() { return G.s.units.filter(u => u.owner === this.OWNER && u.type !== 'peasant' && !u.dead); },

  army(c) {
    const s = G.s, a = s.ai;
    const D = DIFFICULTY[s.difficulty];
    const sol = this.soldiers();
    // Rekrutieren
    const bar = s.buildings.find(b => b.owner === this.OWNER && b.type === 'barracks');
    a.recruitT = (a.recruitT || 0) - 1;
    if (bar && sol.length < D.armyCap && a.recruitT <= 0) {
      const cnt = {};
      for (const t of SOLDIER_TYPES) cnt[t] = 0;
      for (const u of sol) cnt[u.type]++;
      const total = sol.length + 1;
      const order = SOLDIER_TYPES.filter(t => this.MIX[t] && !(s.difficulty === 'leicht' && UNITS[t].siege)).sort((x, y) => (cnt[x] / total - this.MIX[x]) - (cnt[y] / total - this.MIX[y]));
      const planDone = G.count(this.OWNER, 'house') >= 4;
      for (const t of order) {
        const cost = UNITS[t].cost;
        // Holz für Bauten zurückhalten
        if (!planDone && cost.holz && s.players[this.OWNER].res.holz < 30) continue;
        if (G.canAfford(this.OWNER, cost)) {
          const u = G.recruit(this.OWNER, t, true);
          if (u) {
            a.recruitT = D.recruit;
            const rally = this.rally(c);
            u.order = { t: 'move' };
            G.setDest(u, { x: rally[0] + ((Math.random() * 4) | 0) - 2, y: rally[1] + ((Math.random() * 4) | 0) - 2, partial: true });
          }
          break;
        }
      }
    }
    // Türme besetzen
    const towers = s.buildings.filter(b => b.owner === this.OWNER && b.type === 'tower');
    for (const t of towers) {
      const pending = sol.filter(u => u.order.t === 'garrison' && u.order.id === t.id).length;
      if (t.garrison.length + pending >= 4) continue;
      const free = sol.find(u => (u.type === 'archer' || u.type === 'crossbow') && !u.tower && !u.attacker && u.order.t === 'idle' && !u.engage);
      if (free) G.cmdGarrison([free], t);
    }
    // Verteidigung: Eindringlinge nahe der Burg
    const intruders = s.units.filter(u => u.owner !== this.OWNER && !u.dead && u.type !== 'peasant' && U.dist(u.x, u.y, c.x, c.y) < this.R + 7);
    if (intruders.length) {
      for (const u of sol) {
        if (u.tower || u.attacker || u.engage || u.order.t !== 'idle') continue;
        let best = null, bd = 1e9;
        for (const t of intruders) { const d = U.dist(u.x, u.y, t.x, t.y); if (d < bd) { bd = d; best = t; } }
        if (best && (UNITS[u.type].ranged || !best.tower)) G.cmdAttackUnit([u], best);
      }
    }
    // Angreifer ohne Ziel: nächstes Gebäude des Spielers
    for (const u of sol) {
      if (!u.attacker || u.tower) continue;
      if (u.order.t === 'idle' && !u.engage) {
        const tgt = this.pickTarget(u);
        if (tgt) G.cmdSiege([u], tgt);
      }
    }
  },

  rally(c) {
    return [c.x - this.R + 3, c.y + this.R - 3];
  },

  pickTarget(u) {
    if (u.type === 'ram') {
      let best = null, bd = 1e9;
      for (const b of G.s.buildings) { if (b.owner !== 0 || !(b.type === 'gate' || b.type === 'wall')) continue; const d = U.dist(u.x, u.y, b.x, b.y) - (b.type === 'gate' ? 5 : 0); if (d < bd) { bd = d; best = b; } }
      if (best) return best;
    }
    const keep = G.bmap.get(G.s.players[0].keep);
    if (keep && U.dist(u.x, u.y, keep.x + 1.5, keep.y + 1.5) < 30) return keep;
    let best = keep, bd = 1e9;
    for (const b of G.s.buildings) {
      if (b.owner !== 0) continue;
      const d = U.dist(u.x, u.y, b.x, b.y) + (b.type === 'wall' ? 6 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  },

  attack(c) {
    const s = G.s, a = s.ai;
    if (a.passive || s.time < a.nextAttack) return;
    const D = DIFFICULTY[s.difficulty];
    const field = this.soldiers().filter(u => !u.tower && !u.attacker);
    const want = Math.min(D.armyCap - 4, D.wave + a.waves * D.waveStep);
    const late = s.time > a.nextAttack + 150;
    if (field.length < want && !(late && field.length >= Math.ceil(want / 2))) return;
    // Zwei Verteidiger bleiben zu Hause
    const go = field.slice(0, Math.min(want, Math.max(1, field.length - 2)));
    const keep = G.bmap.get(s.players[0].keep);
    if (!keep || !go.length) return;
    for (const u of go) u.attacker = true;
    G.cmdSiege(go, keep);
    a.waves++;
    a.nextAttack = s.time + (a.waveInterval || D.interval);
    G.msg('Der Wüstenfürst greift an! ' + go.length + ' Soldaten rücken aus.', 'bad');
  },
};
