'use strict';
// Karte: Erzeugung, Belegung, Begehbarkeit, Wegfindung

const World = {
  n: MAP_N,
  tiles: null,   // Uint8Array Geländeart
  trees: null,   // Uint8Array Holzvorrat pro Feld (0 = kein Baum)
  occ: null,     // Int32Array Gebäude-ID pro Feld
  seed: 1,

  idx(x, y) { return y * this.n + x; },
  inb(x, y) { return x >= 0 && y >= 0 && x < this.n && y < this.n; },
  tile(x, y) { return this.tiles[y * this.n + x]; },

  // Startpositionen (linke obere Ecke des Burgfrieds)
  keepPos(owner) {
    const n = this.n;
    return owner === 0 ? { x: 9, y: n - 13 } : { x: n - 13, y: 9 };
  },

  generate(seed) {
    const n = this.n;
    this.seed = seed;
    const tiles = new Uint8Array(n * n);
    const trees = new Uint8Array(n * n);
    const rnd = U.rng(seed);
    const nz1 = U.noise(seed * 7 + 1), nz2 = U.noise(seed * 13 + 5), nz3 = U.noise(seed * 3 + 11);
    const kp = this.keepPos(0);
    const cx = kp.x + 1, cy = kp.y + 1;

    // Hälfte mit x <= y erzeugen, danach an der Diagonale spiegeln
    for (let y = 0; y < n; y++) {
      for (let x = 0; x <= y; x++) {
        let t = T.SAND;
        const g = U.fbm(nz1, x / 9, y / 9, 3);
        const r = U.fbm(nz2, x / 5, y / 5, 2);
        // Zentrale Oase
        const dc = U.dist(x, y, n / 2, n / 2);
        const oasis = g + Math.max(0, 0.28 - dc / 40);
        if (oasis > 0.66) t = T.GRASS;
        if (oasis > 0.8 && dc < 9) t = T.WATER;
        if (t === T.SAND && r > 0.8) t = T.ROCK;
        tiles[y * n + x] = t;
      }
    }
    const blob = (bx, by, rad, type, onlySand) => {
      for (let y = Math.floor(by - rad - 1); y <= by + rad + 1; y++) {
        for (let x = Math.floor(bx - rad - 1); x <= bx + rad + 1; x++) {
          if (!this.inb(x, y) || x > y) continue;
          const d = U.dist(x + 0.5, y + 0.5, bx, by) + (nz3(x / 2, y / 2) - 0.5) * 1.6;
          if (d <= rad) {
            if (onlySand && tiles[y * n + x] !== T.SAND) continue;
            tiles[y * n + x] = type;
          }
        }
      }
    };
    // Basisfläche frei räumen
    for (let y = 0; y < n; y++) for (let x = 0; x <= y; x++) {
      const d = U.dist(x + 0.5, y + 0.5, cx + 0.5, cy + 0.5);
      if (d < 10) tiles[y * n + x] = T.SAND;
    }
    // Garantierte Rohstoffe nahe der Burg
    blob(cx + 5, cy - 13, 2.8, T.ROCK);
    blob(cx + 14, cy + 5, 2.4, T.IRON);
    blob(cx - 6, cy - 14, 3.6, T.GRASS);
    blob(cx + 13, cy - 4, 3.2, T.GRASS);
    blob(cx + 22, cy - 2, 2.2, T.ROCK);
    // Diagonale selbst bleibt aus der oberen Hälfte, x > y wird gespiegelt
    for (let y = 0; y < n; y++) for (let x = y + 1; x < n; x++) tiles[y * n + x] = tiles[x * n + y];

    // Bäume
    for (let y = 0; y < n; y++) {
      for (let x = 0; x <= y; x++) {
        const i = y * n + x, t = tiles[i];
        if (t === T.WATER || t === T.ROCK || t === T.IRON) continue;
        const d = U.dist(x + 0.5, y + 0.5, cx + 0.5, cy + 0.5);
        if (d < 8) continue;
        let p = t === T.GRASS ? 0.28 : 0.015;
        // Palmenhain nahe der Burg
        const df = U.dist(x, y, cx + 8, cy - 7);
        if (df < 4.5) p = 0.55;
        const df2 = U.dist(x, y, cx - 2, cy - 11);
        if (df2 < 3) p = 0.5;
        if (rnd() < p) trees[i] = 8;
      }
    }
    for (let y = 0; y < n; y++) for (let x = y + 1; x < n; x++) trees[y * n + x] = trees[x * n + y];
    // Obstgärten brauchen freie Gras-Flächen: dichte Bäume auf Gras in Burgnähe ausdünnen
    this.tiles = tiles;
    this.trees = trees;
    this.occ = new Int32Array(n * n);
  },

  // Kosten zum Betreten eines Feldes; -1 = unpassierbar
  // o: { owner, breach }  breach = Soldaten dürfen feindliche Bauten einreißen
  cost(x, y, o) {
    if (x < 0 || y < 0 || x >= this.n || y >= this.n) return -1;
    const i = y * this.n + x;
    if (this.tiles[i] === T.WATER) return -1;
    const bid = this.occ[i];
    if (bid) {
      const b = G.bmap.get(bid);
      if (!b) return 1;
      if (b.owner === o.owner) return b.type === 'gate' ? 1 : -1;
      if (o.breach) return b.type === 'wall' ? 9 : b.type === 'gate' ? 14 : 22;
      return -1;
    }
    return this.trees[i] ? 1.3 : 1;
  },

  free(x, y, owner) { return this.cost(x, y, { owner }) >= 0 && this.cost(x, y, { owner }) < 5; },
};

// ---------- A*-Wegfindung ----------
const Path = {
  init(n) {
    const N = n * n;
    this.n = n;
    this.g = new Float32Array(N);
    this.came = new Int32Array(N);
    this.open = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.stamp = 0;
  },
  // goal(x,y) -> bool, (hx,hy) Ziel für Heuristik
  find(sx, sy, goal, hx, hy, o, maxNodes) {
    const n = this.n;
    maxNodes = maxNodes || 5000;
    sx = U.clamp(sx | 0, 0, n - 1); sy = U.clamp(sy | 0, 0, n - 1);
    const st = ++this.stamp;
    const heap = new Heap();
    const s0 = sy * n + sx;
    const H = (x, y) => { const dx = Math.abs(x - hx), dy = Math.abs(y - hy); return (dx + dy) + (1.414 - 2) * Math.min(dx, dy); };
    this.g[s0] = 0; this.came[s0] = -1; this.open[s0] = st;
    heap.push(s0, H(sx, sy));
    let expanded = 0, best = s0, bestH = H(sx, sy);
    while (heap.size) {
      const id = heap.pop();
      if (this.closed[id] === st) continue;
      this.closed[id] = st;
      const x = id % n, y = (id / n) | 0;
      if (goal(x, y)) return this.build(id);
      const h = H(x, y);
      if (h < bestH) { bestH = h; best = id; }
      if (++expanded > maxNodes) break;
      const g0 = this.g[id];
      for (let d = 0; d < 8; d++) {
        const dx = DX[d], dy = DY[d];
        const nx = x + dx, ny = y + dy;
        const c = World.cost(nx, ny, o);
        if (c < 0) continue;
        if (dx && dy) {
          // keine Ecken schneiden
          const c1 = World.cost(x + dx, y, o), c2 = World.cost(x, y + dy, o);
          if (c1 < 0 || c2 < 0 || c1 > 2 || c2 > 2 || c > 2) continue;
        }
        const ni = ny * n + nx;
        if (this.closed[ni] === st) continue;
        const ng = g0 + c * (dx && dy ? 1.414 : 1);
        if (this.open[ni] !== st || ng < this.g[ni]) {
          this.open[ni] = st; this.g[ni] = ng; this.came[ni] = id;
          heap.push(ni, ng + H(nx, ny) * 1.05);
        }
      }
    }
    if (o.partial && best !== s0) { const p = this.build(best); p.partial = true; return p; }
    return null;
  },
  build(id) {
    const n = this.n, out = [];
    while (id >= 0 && this.came[id] !== -1) { out.push(id % n, (id / n) | 0); id = this.came[id]; }
    // umdrehen (Paare)
    const p = [];
    for (let i = out.length - 2; i >= 0; i -= 2) p.push([out[i], out[i + 1]]);
    return p;
  },
};
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
