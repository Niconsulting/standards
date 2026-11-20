'use strict';
// Spielstände: Browser-Speicher, Export, Import

const Save = {
  PREFIX: 'wuestenfeste.save.',
  SLOTS: [
    { id: 'auto', name: 'Automatisch' },
    { id: 'quick', name: 'Schnellspeicher' },
    { id: '1', name: 'Platz 1' },
    { id: '2', name: 'Platz 2' },
    { id: '3', name: 'Platz 3' },
  ],

  serialize() {
    const s = G.s;
    const n = World.n;
    let tiles = '', trees = '';
    for (let i = 0; i < n * n; i++) { tiles += World.tiles[i]; trees += World.trees[i]; }
    const UF = ['id', 'type', 'owner', 'x', 'y', 'hp', 'face', 'task', 'job', 'phase', 'timer', 'carry', 'order', 'tower', 'attacker', 'dest', 'after', 'treeI', 'storeId'];
    return {
      game: 'wuestenfeste', v: SAVE_VERSION, savedAt: Date.now(),
      s: {
        seed: s.seed, time: s.time, difficulty: s.difficulty, peace: s.peace, nextId: s.nextId, over: s.over,
        players: JSON.parse(JSON.stringify(s.players)), ai: JSON.parse(JSON.stringify(s.ai)),
      },
      n, tiles, trees,
      b: s.buildings.map(b => [b.id, b.type, b.owner, b.x, b.y, Math.round(b.hp), b.worker, b.garrison.slice(), b.recruits || 0]),
      u: s.units.filter(u => !u.dead).map(u => {
        const o = {};
        for (const k of UF) if (u[k] !== undefined && u[k] !== null && u[k] !== '') o[k] = u[k];
        o.x = Math.round(u.x * 100) / 100; o.y = Math.round(u.y * 100) / 100; o.hp = Math.round(u.hp * 10) / 10;
        return o;
      }),
      cam: { x: R.cam.x, y: R.cam.y, z: R.cam.z, yaw: R.cam.yaw, v: 3 },
    };
  },

  apply(d) {
    if (!d || d.game !== 'wuestenfeste' || !d.s || !d.tiles) throw new Error('Das ist kein Spielstand von Wüstenfeste.');
    if (d.v > SAVE_VERSION) throw new Error('Dieser Spielstand stammt aus einer neueren Version.');
    const n = d.n || MAP_N;
    World.n = n;
    World.seed = d.s.seed;
    World.tiles = new Uint8Array(n * n);
    World.trees = new Uint8Array(n * n);
    World.occ = new Int32Array(n * n);
    for (let i = 0; i < n * n; i++) { World.tiles[i] = +d.tiles[i] || 0; World.trees[i] = +d.trees[i] || 0; }
    Path.init(n);
    G.bmap.clear(); G.umap.clear(); G.reserved.clear();
    G.proj = []; G.fx = []; G.msgCool = {};
    G.s = Object.assign({ version: SAVE_VERSION, buildings: [], units: [] }, d.s);
    G.s.buildings = []; G.s.units = [];
    for (const p of G.s.players) { p.econT = p.econT || ECON_TICK; p.migT = p.migT || 3; p.jobT = 0; }
    const trees = World.trees.slice();
    for (const [id, type, owner, x, y, hp, worker, garrison, recruits] of d.b) {
      if (!BUILDINGS[type]) continue;
      const b = G.addBuilding(type, owner, x, y, id);
      b.hp = hp; b.worker = worker || 0; b.garrison = garrison || []; b.recruits = recruits || 0;
    }
    World.trees = trees; // addBuilding entfernt Bäume nur bei echtem Neubau
    for (const b of G.s.buildings) for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) World.trees[World.idx(xx, yy)] = 0;
    for (const o of d.u) {
      if (!UNITS[o.type]) continue;
      const u = G.addUnit(o.type, o.owner, o.x, o.y, o.id);
      Object.assign(u, o);
      u.path = null; u.pi = 0;
      if (!u.order || !u.order.t) u.order = { t: 'idle', gx: u.x, gy: u.y };
      if (u.treeI == null) u.treeI = -1;
      if (u.treeI >= 0) G.reserved.set(u.treeI, u.id);
      u.cd = 0; u.scan = Math.random() * 0.5;
    }
    // Zuordnungen bereinigen
    for (const b of G.s.buildings) {
      if (b.worker && !G.umap.has(b.worker)) b.worker = 0;
      b.garrison = b.garrison.filter(id => { const u = G.umap.get(id); return u && u.tower === b.id; });
    }
    for (const u of G.s.units) {
      if (u.tower && !G.bmap.has(u.tower)) u.tower = 0;
      if (u.job && !G.bmap.has(u.job)) G.releaseWorker(u);
    }
    if (!G.s.ai) AI.init();
    R.buildTerrain();
    if (d.cam && d.cam.v === 3) { R.cam.x = d.cam.x; R.cam.y = d.cam.y; R.cam.z = d.cam.z || 1; R.cam.yaw = d.cam.yaw || Math.PI / 4; }
    else { const k = G.bmap.get(G.s.players[0].keep); if (k) R.centerOn(k.x + 1.5, k.y + 1.5); }
  },

  // ---------- Browser-Speicher ----------
  write(slot) {
    try {
      const data = this.serialize();
      localStorage.setItem(this.PREFIX + slot, JSON.stringify(data));
      return true;
    } catch (e) {
      G.msg('Speichern fehlgeschlagen: Der Browser erlaubt keinen Speicher.', 'bad');
      return false;
    }
  },
  read(slot) {
    try {
      const raw = localStorage.getItem(this.PREFIX + slot);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  remove(slot) { try { localStorage.removeItem(this.PREFIX + slot); } catch (e) { /* egal */ } },
  meta(slot) {
    const d = this.read(slot);
    if (!d || !d.s) return null;
    const m = Math.floor(d.s.time / MONTH_SECONDS);
    return {
      when: new Date(d.savedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }),
      date: MONTHS[m % 12] + ' ' + (1190 + Math.floor(m / 12)),
      diff: (DIFFICULTY[d.s.difficulty] || {}).name || '',
      over: d.s.over, savedAt: d.savedAt,
    };
  },
  latest() {
    let best = null;
    for (const s of this.SLOTS) { const m = this.meta(s.id); if (m && !m.over && (!best || m.savedAt > best.m.savedAt)) best = { id: s.id, m }; }
    return best;
  },
  fileName() {
    const d = new Date();
    const p = x => String(x).padStart(2, '0');
    return 'wuestenfeste-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.json';
  },
};
