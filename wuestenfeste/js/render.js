'use strict';
// 3D-Darstellung mit three.js: Gelände, Modelle (Low-Poly, Vertexfarben), Licht, Schatten, Kamera, Effekte

const TCOL = {
  [T.SAND]: [[220, 182, 118], [186, 140, 84]],
  [T.GRASS]: [[122, 156, 70], [80, 116, 46]],
  [T.ROCK]: [[158, 150, 136], [110, 104, 94]],
  [T.IRON]: [[170, 98, 64], [118, 64, 42]],
  [T.WATER]: [[86, 168, 180], [30, 92, 128]],
};
const TOWER_TOP = { tower: 2.05, bigtower: 2.75, ballista: 1.35 };
const BUILD_H = { keep: 3.4, tower: 2.5, bigtower: 3.3, ballista: 1.9, wall: 1.1, gate: 1.4, palisade: 1.0, barracks: 1.6, chapel: 2.4, granary: 1.6, house: 1.5, mill: 2.6, market: 1.2 };

const COL = {
  stone: 0xc9bea6, stoneD: 0xa89b83, stoneL: 0xd9d0bb, wood: 0x9a6a3c, woodD: 0x6e4a28, woodL: 0xb8875a,
  plaster: 0xe8dcbc, thatch: 0xc89a52, tile: 0xb4553a, dark: 0x2a1c12, iron: 0x7d848e, steel: 0xc8ced6,
  skin: 0xe2b48c, leaf: 0x4f7f2c, leafD: 0x3a6424, sand: 0xd8b878, gold: 0xe0b654, rope: 0xcdb27a,
};

function linCol(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }

// ---------- Modellbau: Teile zu einer Geometrie mit Vertexfarben verschmelzen ----------
class MB {
  constructor() { this.p = []; }
  add(geo, col, jit) { this.p.push({ geo, col: linCol(col), jit: jit == null ? 0.07 : jit }); return this; }
  box(x, y, z, w, h, d, col, jit, ry) { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); return this.add(g, col, jit); }
  // von der unteren Ecke aus
  boxB(x0, y0, z0, w, h, d, col, jit) { return this.box(x0 + w / 2, y0 + h / 2, z0 + d / 2, w, h, d, col, jit); }
  cyl(x, y0, z, rt, rb, h, seg, col, jit) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y0 + h / 2, z); return this.add(g, col, jit); }
  cylX(x, y, z, r, len, seg, col) { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return this.add(g, col); }
  cylZ(x, y, z, r, len, seg, col) { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateX(Math.PI / 2); g.translate(x, y, z); return this.add(g, col); }
  cone(x, y0, z, r, h, seg, col, ry) { const g = new THREE.ConeGeometry(r, h, seg); if (ry) g.rotateY(ry); g.translate(x, y0 + h / 2, z); return this.add(g, col); }
  // Pyramidendach über Rechteck
  pyr(x0, z0, w, d, y0, h, col) {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, h, 4);
    g.rotateY(Math.PI / 4); g.scale(w, 1, d); g.translate(x0 + w / 2, y0 + h / 2, z0 + d / 2);
    return this.add(g, col, 0.05);
  }
  // Satteldach, First entlang x
  gable(x0, z0, w, d, y0, h, col, endCol) {
    const x1 = x0 + w, z1 = z0 + d, zm = z0 + d / 2, y1 = y0 + h;
    const v = [
      x0, y0, z1, x1, y0, z1, x1, y1, zm, x0, y0, z1, x1, y1, zm, x0, y1, zm, // vorne
      x1, y0, z0, x0, y0, z0, x0, y1, zm, x1, y0, z0, x0, y1, zm, x1, y1, zm, // hinten
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    this.add(g, col, 0.04);
    const e = [x1, y0, z1, x1, y0, z0, x1, y1, zm, x0, y0, z0, x0, y0, z1, x0, y1, zm];
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(e, 3));
    g2.computeVertexNormals();
    return this.add(g2, endCol || col, 0.03);
  }
  ico(x, y, z, r, col, sx, sy, sz, det) { const g = new THREE.IcosahedronGeometry(r, det || 0); g.scale(sx || 1, sy || 1, sz || 1); g.translate(x, y, z); return this.add(g, col, 0.12); }
  merlons(x0, z0, w, d, y, col, s, step) {
    s = s || 0.16; step = step || 0.32;
    const pts = [];
    for (let t = 0; t <= w - s + 0.001; t += step) { pts.push([x0 + t, z0]); pts.push([x0 + t, z0 + d - s]); }
    for (let t = step; t <= d - s - step + 0.001; t += step) { pts.push([x0, z0 + t]); pts.push([x0 + w - s, z0 + t]); }
    for (const [mx, mz] of pts) this.boxB(mx, y, mz, s, s * 1.1, s, col, 0.1);
    return this;
  }
  ringMerlons(x, z, r, y, col, n) {
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; this.box(x + Math.cos(a) * r, y + 0.09, z + Math.sin(a) * r, 0.17, 0.18, 0.17, col, 0.1, -a); }
    return this;
  }
  build() {
    let n = 0;
    const geos = this.p.map(p => (p.geo.index ? p.geo.toNonIndexed() : p.geo));
    for (const g of geos) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    geos.forEach((g, i) => {
      const P = this.p[i], cnt = g.attributes.position.count;
      if (!g.attributes.normal) g.computeVertexNormals();
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      for (let v = 0; v < cnt; v++) {
        const j = 1 + (U.hash((v / 3) | 0, i, 7) - 0.5) * P.jit * 2;
        col[(o + v) * 3] = P.col.r * j; col[(o + v) * 3 + 1] = P.col.g * j; col[(o + v) * 3 + 2] = P.col.b * j;
      }
      o += cnt;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

// ---------- Gebäudemodelle (Ursprung = Ecke der Grundfläche, x nach rechts, z nach vorn) ----------
const MODELS = {
  keep(m, c) {
    m.boxB(0.1, 0, 0.1, 2.8, 0.22, 2.8, COL.stoneD);
    m.boxB(0.35, 0.22, 0.35, 2.3, 2.15, 2.3, COL.stone);
    m.merlons(0.35, 0.35, 2.3, 2.3, 2.37, COL.stone);
    m.boxB(0.5, 2.37, 0.5, 2.0, 0.04, 2.0, COL.stoneD);
    m.boxB(0.95, 2.37, 0.95, 1.1, 0.6, 1.1, COL.stoneL);
    m.merlons(0.95, 0.95, 1.1, 1.1, 2.97, COL.stoneL, 0.14, 0.27);
    for (const [x, z] of [[0.45, 0.45], [2.55, 0.45], [0.45, 2.55], [2.55, 2.55]]) {
      m.cyl(x, 0.22, z, 0.36, 0.4, 2.55, 10, COL.stoneD);
      m.cone(x, 2.77, z, 0.44, 0.75, 10, c);
    }
    // Steinlagen andeuten
    for (let y = 0.6; y < 2.3; y += 0.42) { m.boxB(0.33, y, 2.64, 2.34, 0.035, 0.02, COL.stoneD, 0.02); m.boxB(2.64, y, 0.33, 0.02, 0.035, 2.34, COL.stoneD, 0.02); }
    m.boxB(1.15, 0.22, 2.64, 0.7, 0.75, 0.04, COL.woodD);
    m.cylZ(1.5, 0.97, 2.66, 0.35, 0.05, 12, COL.woodD);
    m.boxB(1.08, 0.22, 2.66, 0.84, 0.9, 0.02, COL.stoneL);
    for (const x of [0.75, 2.05]) for (const y of [1.25, 1.85]) m.boxB(x, y, 2.645, 0.16, 0.28, 0.03, COL.dark);
    for (const z of [0.75, 1.45, 2.05]) for (const y of [1.25, 1.85]) m.boxB(2.645, y, z, 0.03, 0.28, 0.16, COL.dark);
    m.boxB(0.62, 1.0, 2.66, 0.28, 1.0, 0.02, c); m.boxB(2.1, 1.0, 2.66, 0.28, 1.0, 0.02, c);
    m.cone(0.76, 0.86, 2.67, 0.14, 0.14, 3, c, Math.PI); m.cone(2.24, 0.86, 2.67, 0.14, 0.14, 3, c, Math.PI);
    m.boxB(1.48, 2.97, 1.48, 0.04, 1.0, 0.04, COL.woodD);
  },
  stockpile(m, c, lv, v) {
    m.boxB(0.08, 0, 0.08, 1.84, 0.07, 1.84, COL.woodL);
    for (let t = 0.2; t < 1.9; t += 0.25) m.boxB(0.08, 0.07, t, 1.84, 0.01, 0.03, COL.woodD, 0.02);
    const L = (v || '000').split('').map(Number);
    for (let i = 0; i < L[0]; i++) for (let k = 0; k < 3 - (i % 2); k++) m.cylX(0.6, 0.15 + i * 0.13, 0.3 + k * 0.15 + (i % 2) * 0.07, 0.07, 0.9, 7, COL.wood);
    for (let i = 0; i < L[1]; i++) m.boxB(1.15 + (i % 2) * 0.05, 0.07 + i * 0.16, 0.25, 0.55, 0.15, 0.55, COL.stoneL);
    for (let i = 0; i < L[2]; i++) m.boxB(0.3, 0.07 + i * 0.08, 1.2, 0.5, 0.07, 0.25, COL.iron);
    m.boxB(1.2, 0.07, 1.25, 0.45, 0.4, 0.45, COL.wood);
    m.boxB(1.2, 0.47, 1.25, 0.45, 0.03, 0.45, COL.woodD);
  },
  granary(m, c) {
    m.boxB(0.2, 0, 0.2, 1.6, 0.18, 1.6, COL.stoneD);
    m.boxB(0.28, 0.18, 0.28, 1.44, 0.85, 1.44, COL.wood);
    for (let t = 0.32; t < 1.7; t += 0.16) m.boxB(t, 0.18, 1.72, 0.02, 0.85, 0.02, COL.woodD, 0.02);
    m.gable(0.18, 0.18, 1.64, 1.64, 1.03, 0.62, COL.thatch, COL.wood);
    m.boxB(0.8, 0.18, 1.72, 0.4, 0.55, 0.03, COL.dark);
    for (const [x, z] of [[1.55, 1.82], [1.75, 1.62], [0.4, 1.85]]) m.ico(x, 0.17, z, 0.13, 0xdcc590, 1, 1.2, 1);
  },
  woodcutter(m, c) {
    m.boxB(0.2, 0, 0.2, 1.1, 0.7, 1.0, COL.wood);
    for (let t = 0.25; t < 1.3; t += 0.14) m.boxB(t, 0, 1.2, 0.02, 0.7, 0.02, COL.woodD, 0.02);
    m.pyr(0.1, 0.1, 1.3, 1.2, 0.7, 0.55, 0x8a6038);
    m.boxB(0.35, 0.8, 0.35, 0.16, 0.5, 0.16, COL.stoneD);
    m.boxB(0.55, 0, 1.21, 0.3, 0.45, 0.02, COL.dark);
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3 - i; k++) m.cylX(1.5, 0.07 + i * 0.12, 1.3 + k * 0.13 + i * 0.065, 0.065, 0.7, 7, COL.wood);
    m.cyl(0.55, 0, 1.6, 0.15, 0.17, 0.18, 9, COL.woodL);
    m.boxB(0.6, 0.18, 1.58, 0.03, 0.3, 0.03, COL.woodD); m.boxB(0.58, 0.4, 1.56, 0.1, 0.08, 0.04, COL.steel);
  },
  quarry(m, c) {
    m.boxB(0.12, 0, 0.12, 2.76, 0.03, 2.76, 0x7f7769);
    m.boxB(0.5, 0.03, 0.5, 1.7, 0.02, 1.7, 0x625c52);
    m.boxB(0.85, 0.05, 0.85, 1.0, 0.02, 1.0, 0x4e4943);
    for (const [x, z, h] of [[2.2, 0.35, 0.3], [2.2, 1.0, 0.3], [2.2, 1.0, 0.3], [1.3, 2.3, 0.25], [0.3, 2.3, 0.2]]) m.boxB(x, 0, z, 0.5, h, 0.5, COL.stoneL);
    m.boxB(2.22, 0.3, 1.02, 0.46, 0.25, 0.46, COL.stoneL);
    m.boxB(0.35, 0, 2.35, 0.08, 1.6, 0.08, COL.woodD); m.boxB(0.6, 0, 2.35, 0.08, 1.6, 0.08, COL.woodD);
    m.box(0.95, 1.6, 1.95, 1.4, 0.07, 0.07, COL.wood, 0.05, Math.PI / 4);
    m.boxB(1.4, 0.4, 1.4, 0.01, 1.1, 0.01, COL.rope);
    m.boxB(1.28, 0.2, 1.28, 0.25, 0.22, 0.25, COL.stoneL);
  },
  mine(m, c) {
    m.ico(0.9, 0.2, 0.8, 0.8, 0x8a5a40, 1.1, 0.7, 1.0, 1);
    m.boxB(0.1, 0, 0.1, 1.8, 0.03, 1.8, 0x6f4532);
    m.boxB(0.5, 0, 1.15, 0.08, 0.8, 0.08, COL.woodD); m.boxB(1.1, 0, 1.15, 0.08, 0.8, 0.08, COL.woodD);
    m.boxB(0.45, 0.8, 1.13, 0.78, 0.1, 0.12, COL.wood);
    m.boxB(0.58, 0, 1.12, 0.52, 0.78, 0.04, COL.dark);
    m.boxB(1.35, 0.12, 1.3, 0.45, 0.25, 0.3, 0x5c4a3a);
    for (let k = 0; k < 4; k++) m.ico(1.45 + (k % 2) * 0.2, 0.42, 1.38 + (k >> 1) * 0.13, 0.09, k % 2 ? 0x8a4e34 : 0xa8603c);
    for (const x of [1.42, 1.72]) for (const z of [1.3, 1.6]) m.cylZ(x, 0.08, z, 0.08, 0.04, 8, COL.woodD);
  },
  orchard(m, c) {
    m.boxB(0.06, 0, 0.06, 2.88, 0.03, 2.88, 0x5c7a32);
    for (let t = 0.35; t < 2.8; t += 0.32) m.boxB(0.08, 0.03, t, 2.84, 0.012, 0.06, 0x4a6326, 0.03);
    const post = (x, z) => m.boxB(x, 0, z, 0.05, 0.28, 0.05, COL.wood);
    for (let t = 0.05; t < 2.95; t += 0.47) { post(t, 0.05); post(t, 2.9); post(0.05, t); post(2.9, t); }
    m.boxB(0.05, 0.2, 0.06, 2.9, 0.03, 0.03, COL.wood); m.boxB(0.05, 0.2, 2.91, 2.9, 0.03, 0.03, COL.wood);
    m.boxB(0.06, 0.2, 0.05, 0.03, 0.03, 2.9, COL.wood); m.boxB(2.91, 0.2, 0.05, 0.03, 0.03, 2.9, COL.wood);
    for (const x of [0.7, 1.5, 2.3]) for (const z of [0.7, 1.5, 2.3]) {
      m.cyl(x, 0, z, 0.05, 0.07, 0.45, 6, COL.woodD);
      m.ico(x, 0.7, z, 0.36, U.hash(x * 9, z * 9, 3) > 0.5 ? COL.leaf : 0x5a8a32, 1, 0.9, 1, 1);
      for (let k = 0; k < 5; k++) { const a = k * 1.3 + x; m.ico(x + Math.cos(a) * 0.3, 0.62 + (k % 3) * 0.1, z + Math.sin(a) * 0.3, 0.05, 0xd63b2c); }
    }
  },
  house(m, c, lv) {
    const big = lv >= 2;
    m.boxB(0.25, 0, 0.25, 1.5, big ? 1.0 : 0.72, 1.5, COL.plaster);
    const top = big ? 1.0 : 0.72;
    for (const y of [0.02, top / 2, top - 0.05]) { m.boxB(0.24, y, 1.74, 1.52, 0.05, 0.03, COL.woodD, 0.02); m.boxB(1.74, y, 0.24, 0.03, 0.05, 1.52, COL.woodD, 0.02); }
    for (const t of [0.25, 0.95, 1.7]) { m.boxB(t, 0, 1.74, 0.05, top, 0.03, COL.woodD, 0.02); m.boxB(1.74, 0, t, 0.03, top, 0.05, COL.woodD, 0.02); }
    m.pyr(0.12, 0.12, 1.76, 1.76, top, 0.75, lv >= 3 ? COL.tile : COL.thatch);
    m.boxB(1.25, top + 0.1, 0.5, 0.2, 0.7, 0.2, COL.stoneD);
    m.boxB(0.8, 0, 1.76, 0.32, 0.5, 0.03, COL.woodD);
    m.boxB(1.76, 0.3, 0.75, 0.03, 0.22, 0.25, COL.dark);
    if (big) m.boxB(0.45, top * 0.55, 1.76, 0.22, 0.2, 0.03, COL.dark);
    if (lv >= 3) { m.boxB(0.2, 0, 1.85, 0.5, 0.25, 0.1, 0x8b5a2b); m.ico(0.45, 0.33, 1.9, 0.12, 0xd0573a); }
  },
  chapel(m, c) {
    m.boxB(0.25, 0, 0.2, 1.45, 1.15, 1.6, 0xefe8d6);
    m.gable(0.17, 0.12, 1.61, 1.76, 1.15, 0.6, COL.tile, 0xefe8d6);
    m.boxB(1.2, 0, 1.2, 0.55, 1.9, 0.55, 0xe6dfcb);
    m.pyr(1.15, 1.15, 0.65, 0.65, 1.9, 0.75, COL.tile);
    m.boxB(1.37, 1.45, 1.74, 0.2, 0.25, 0.03, COL.dark);
    m.boxB(0.6, 0, 1.81, 0.36, 0.6, 0.03, COL.woodD);
    m.cylZ(0.98, 0.9, 1.81, 0.12, 0.03, 10, 0x7fb0d8);
    m.boxB(1.46, 2.65, 1.46, 0.03, 0.3, 0.03, COL.gold); m.boxB(1.4, 2.82, 1.46, 0.15, 0.03, 0.03, COL.gold);
  },
  barracks(m, c) {
    m.boxB(0.15, 0, 0.15, 2.7, 0.2, 2.1, COL.stoneD);
    m.boxB(0.22, 0.2, 0.22, 2.56, 1.15, 1.96, COL.stoneD);
    m.merlons(0.22, 0.22, 2.56, 1.96, 1.35, COL.stoneD);
    m.boxB(1.2, 0.2, 2.17, 0.6, 0.75, 0.04, COL.woodD);
    for (const x of [0.45, 2.15]) { m.boxB(x, 0.55, 2.19, 0.4, 0.75, 0.02, c); m.cone(x + 0.2, 0.42, 2.2, 0.2, 0.14, 3, c, Math.PI); }
    m.boxB(2.0, 0, 2.55, 0.8, 0.06, 0.06, COL.woodD);
    for (let k = 0; k < 5; k++) m.box(2.1 + k * 0.15, 0.32, 2.58, 0.02, 0.62, 0.02, COL.steel, 0, 0);
    m.cyl(0.55, 0, 2.6, 0.03, 0.03, 0.55, 5, COL.woodD); m.boxB(0.4, 0.38, 2.58, 0.3, 0.04, 0.04, COL.woodD);
    m.ico(0.55, 0.38, 2.6, 0.12, 0xd9b77a, 1, 1.4, 1); m.ico(0.55, 0.6, 2.6, 0.08, 0xc9a66b);
  },
  tower(m, c, lv) {
    const h = 1.85 + (lv - 1) * 0.15;
    m.boxB(0.08, 0, 0.08, 1.84, 0.2, 1.84, COL.stoneD);
    m.boxB(0.18, 0.2, 0.18, 1.64, h - 0.2, 1.64, COL.stone);
    m.boxB(0.1, h, 0.1, 1.8, 0.08, 1.8, COL.stoneD);
    m.merlons(0.1, 0.1, 1.8, 1.8, h + 0.08, COL.stone);
    for (const y of [0.8, 1.35]) { m.boxB(0.85, y, 1.81, 0.1, 0.25, 0.03, COL.dark); m.boxB(1.81, y, 0.85, 0.03, 0.25, 0.1, COL.dark); }
    m.boxB(0.3, 0.9, 1.82, 0.25, 0.6, 0.02, c);
    m.boxB(0.98, h + 0.08, 0.98, 0.04, 0.9, 0.04, COL.woodD);
  },
  bigtower(m, c, lv) {
    const h = 2.5 + (lv - 1) * 0.15;
    m.cyl(1.5, 0, 1.5, 1.38, 1.45, 0.25, 12, COL.stoneD);
    m.cyl(1.5, 0.25, 1.5, 1.22, 1.3, h - 0.25, 12, COL.stone);
    m.cyl(1.5, h, 1.5, 1.38, 1.38, 0.1, 12, COL.stoneD);
    m.ringMerlons(1.5, 1.5, 1.28, h + 0.1, COL.stone, 18);
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * 0.5; m.box(1.5 + Math.cos(a) * 1.29, 1.3, 1.5 + Math.sin(a) * 1.29, 0.12, 0.35, 0.04, COL.dark, 0, -a + Math.PI / 2); }
    for (let y = 0.7; y < h; y += 0.55) m.cyl(1.5, y, 1.5, 1.305, 1.305, 0.03, 12, COL.stoneD, 0.02);
    m.boxB(1.48, h + 0.1, 1.48, 0.05, 1.0, 0.05, COL.woodD);
  },
  ballista(m, c, lv) {
    m.boxB(0.12, 0, 0.12, 1.76, 1.2, 1.76, COL.stone);
    m.boxB(0.05, 1.2, 0.05, 1.9, 0.08, 1.9, COL.stoneD);
    m.merlons(0.05, 0.05, 1.9, 1.9, 1.28, COL.stone, 0.14, 0.4);
    for (let y = 0.35; y < 1.2; y += 0.4) { m.boxB(0.11, y, 1.87, 1.78, 0.03, 0.02, COL.stoneD, 0.02); m.boxB(1.87, y, 0.11, 0.02, 0.03, 1.78, COL.stoneD, 0.02); }
    m.boxB(0.8, 0, 1.88, 0.4, 0.55, 0.03, COL.woodD);
    m.boxB(0.4, 1.0, 1.89, 0.22, 0.25, 0.02, c);
  },
  wall() { /* über wallGeo mit Nachbarmaske */ },
  gate(m, c) {
    m.boxB(0, 0, 0, 0.32, 1.25, 1, COL.stoneD); m.boxB(0.68, 0, 0, 0.32, 1.25, 1, COL.stoneD);
    m.boxB(0.32, 0.75, 0, 0.36, 0.5, 1, COL.stoneD);
    m.boxB(0.32, 0, 0.1, 0.36, 0.75, 0.8, COL.woodD);
    for (let k = 0; k < 4; k++) m.boxB(0.34 + k * 0.1, 0.05, 0.92, 0.02, 0.68, 0.02, COL.iron, 0.02);
    m.merlons(0, 0, 1, 1, 1.25, COL.stoneD, 0.15, 0.28);
    m.boxB(0.38, 0.85, 1.0, 0.24, 0.3, 0.02, c);
  },
  palisade() { /* über wallGeo */ },
  moat(m) {
    m.boxB(0, 0.005, 0, 1, 0.01, 1, 0x2f6f8a, 0.03);
    m.boxB(0, 0.012, 0, 1, 0.006, 0.08, 0x7d6a48); m.boxB(0, 0.012, 0.92, 1, 0.006, 0.08, 0x7d6a48);
  },
  pitch(m) {
    m.boxB(0.02, 0, 0.02, 0.96, 0.015, 0.96, 0x1d1712, 0.05);
    for (let k = 0; k < 3; k++) m.ico(0.2 + k * 0.3, 0.02, 0.3 + (k % 2) * 0.4, 0.06, 0x3a2e24, 1, 0.2, 1);
  },
  trap(m) {
    m.boxB(0.15, 0, 0.15, 0.7, 0.015, 0.7, 0xb59866, 0.05);
    for (let k = 0; k < 5; k++) m.boxB(0.18 + k * 0.13, 0.012, 0.15, 0.03, 0.006, 0.7, 0x8a6a42, 0.02);
  },
  farm(m, c) {
    m.boxB(0.06, 0, 0.06, 2.88, 0.03, 2.88, 0x8a6a3a);
    for (let t = 0.2; t < 2.0; t += 0.22) for (let k = 0; k < 10; k++) m.cone(0.25 + k * 0.26, 0.03, t + 0.1, 0.07, 0.3, 4, U.hash(k, t * 10, 2) > 0.5 ? 0xe2bf55 : 0xd2a944);
    m.boxB(1.8, 0, 2.15, 1.0, 0.55, 0.7, COL.wood);
    m.gable(1.75, 2.1, 1.1, 0.8, 0.55, 0.35, COL.thatch, COL.wood);
    m.boxB(2.15, 0, 2.86, 0.25, 0.35, 0.02, COL.dark);
  },
  mill(m, c) {
    m.cyl(1, 0, 1, 0.55, 0.7, 1.8, 8, COL.plaster);
    m.cone(1, 1.8, 1, 0.68, 0.6, 8, COL.thatch);
    m.boxB(0.9, 0, 1.6, 0.25, 0.45, 0.1, COL.woodD);
    m.boxB(0.75, 0.9, 1.62, 0.15, 0.18, 0.05, COL.dark);
    for (const [x, z] of [[0.3, 1.6], [1.6, 1.6]]) m.ico(x, 0.15, z, 0.14, 0xdcc590, 1, 1.2, 1);
  },
  bakery(m, c) {
    m.boxB(0.25, 0, 0.3, 1.5, 0.8, 1.35, COL.plaster);
    m.gable(0.15, 0.2, 1.7, 1.55, 0.8, 0.55, COL.tile, COL.plaster);
    m.boxB(1.3, 0.7, 0.45, 0.25, 0.9, 0.25, COL.stoneD);
    m.boxB(0.7, 0, 1.66, 0.35, 0.5, 0.03, COL.woodD);
    m.cyl(0.4, 0, 1.85, 0.2, 0.25, 0.3, 8, COL.stoneD);
    m.boxB(0.33, 0.06, 2.04, 0.14, 0.12, 0.03, 0xff8a2a, 0);
  },
  market(m, c) {
    m.boxB(0.08, 0, 0.08, 2.84, 0.04, 2.84, 0xc9a97a);
    const st = [[0.3, 0.3, 0xc23a2b], [1.7, 0.3, 0x2f63c9], [0.3, 1.7, 0xd6a54a], [1.7, 1.7, 0x4f8a3c]];
    for (const [x, z, col] of st) {
      for (const [px, pz] of [[0, 0], [0.95, 0], [0, 0.95], [0.95, 0.95]]) m.boxB(x + px, 0, z + pz, 0.05, 0.8, 0.05, COL.woodD);
      m.boxB(x, 0.3, z + 0.6, 1.0, 0.25, 0.4, COL.wood);
      m.gable(x - 0.05, z - 0.05, 1.1, 1.1, 0.8, 0.25, col, col);
      for (let k = 0; k < 4; k++) m.ico(x + 0.15 + k * 0.22, 0.6, z + 0.8, 0.07, [0xd63b2c, 0xe2bf55, 0x8a5a3a, 0x7d848e][k]);
    }
    m.cyl(1.5, 0, 1.5, 0.25, 0.3, 0.35, 10, COL.stoneD);
    m.cyl(1.5, 0.35, 1.5, 0.22, 0.22, 0.02, 10, 0x4e9cc0);
  },
};

// Mauer/Palisade mit Verbindungsarmen zu Nachbarn
function wallGeo(mask, kind) {
  const m = new MB();
  const pal = kind === 'palisade';
  const H = pal ? 0.85 : 1.0, T = pal ? 0.28 : 0.5, col = pal ? COL.wood : COL.stone;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  if (pal) {
    const stake = (x, z) => { m.cyl(x, 0, z, 0.06, 0.07, H, 6, U.hash(x * 50, z * 50, 1) > 0.5 ? COL.wood : COL.woodL); m.cone(x, H, z, 0.07, 0.14, 6, COL.woodL); };
    stake(0.5, 0.5);
    dirs.forEach(([dx, dz], i) => {
      if (!(mask & (1 << i))) return;
      const len = dx && dz ? 0.71 : 0.5;
      for (let t = 0.15; t < len; t += 0.15) stake(0.5 + dx * t / len * (dx && dz ? 0.5 : 0.5) * (len / 0.5) * 1, 0.5 + dz * t / len * 0.5 * (len / 0.5));
    });
    m.boxB(0.44, 0.45, 0.44, 0.12, 0.06, 0.12, COL.woodD);
    return m.build();
  }
  m.boxB(0.5 - T / 2 - 0.04, 0, 0.5 - T / 2 - 0.04, T + 0.08, H + 0.12, T + 0.08, COL.stoneD);
  m.merlons(0.5 - T / 2 - 0.04, 0.5 - T / 2 - 0.04, T + 0.08, T + 0.08, H + 0.12, COL.stoneD, 0.14, 0.44);
  dirs.forEach(([dx, dz], i) => {
    if (!(mask & (1 << i))) return;
    const diag = dx && dz;
    const len = diag ? 0.72 : 0.5;
    const g = new THREE.BoxGeometry(len, H, T);
    const ang = Math.atan2(dz, dx);
    g.translate(len / 2, H / 2, 0);
    g.rotateY(-ang);
    g.translate(0.5, 0, 0.5);
    m.add(g, col, 0.06);
    for (let t = 0.12; t < len - 0.05; t += 0.22) {
      for (const side of [-1, 1]) {
        const mg = new THREE.BoxGeometry(0.13, 0.14, 0.1);
        mg.translate(t + 0.06, H + 0.07, side * (T / 2 - 0.05));
        mg.rotateY(-ang); mg.translate(0.5, 0, 0.5);
        m.add(mg, col, 0.1);
      }
    }
    const lg = new THREE.BoxGeometry(len, 0.03, T + 0.02);
    lg.translate(len / 2, H * 0.5, 0); lg.rotateY(-ang); lg.translate(0.5, 0, 0.5);
    m.add(lg, COL.stoneD, 0.02);
  });
  return m.build();
}

// ---------- Einheitenmodelle ----------
function unitParts(type, c) {
  const body = new MB(), extra = {};
  const tunic = type === 'peasant' ? 0x9c7f52 : type === 'sword' || type === 'pike' ? 0xa7aeb7 : type === 'monk' ? 0x6b4a2e : type === 'assassin' ? 0x2a2a30 : c;
  const L = 0.2;
  if (type === 'knight') {
    body.boxB(-0.1, 0.24, -0.3, 0.2, 0.2, 0.6, 0x7a5232);
    body.box(0, 0.48, 0.32, 0.12, 0.25, 0.16, 0x7a5232, 0.07, 0);
    body.box(0, 0.55, 0.42, 0.1, 0.1, 0.18, 0x6a4628);
    body.boxB(-0.11, 0.3, -0.2, 0.22, 0.13, 0.38, c);
    body.boxB(-0.08, 0.44, -0.08, 0.16, 0.22, 0.12, COL.steel);
    body.ico(0, 0.72, -0.02, 0.07, COL.steel);
    body.cone(0, 0.78, -0.02, 0.03, 0.1, 4, c);
    body.box(0.12, 0.6, 0.2, 0.025, 0.025, 0.7, COL.woodD, 0, 0);
    body.cone(0.12, 0.6, 0.56, 0.03, 0.12, 4, COL.steel);
    extra.legs = 4; extra.legH = 0.26;
    return { body: body.build(), extra };
  }
  if (type === 'ram' || type === 'catapult') {
    if (type === 'ram') {
      body.boxB(-0.25, 0.12, -0.45, 0.5, 0.35, 0.9, COL.wood);
      body.gable(-0.3, -0.5, 0.6, 1.0, 0.47, 0.25, 0x7a5a3a);
      body.cylZ(0, 0.28, 0.1, 0.09, 1.1, 8, COL.woodD);
      body.cone(0, 0.19, 0.65, 0.11, 0.12, 8, COL.iron);
      for (const x of [-0.3, 0.3]) for (const z of [-0.3, 0.3]) body.cylX(x, 0.12, z, 0.12, 0.06, 10, COL.woodD);
      body.boxB(-0.26, 0.4, -0.2, 0.52, 0.08, 0.02, c);
    } else {
      body.boxB(-0.3, 0.1, -0.4, 0.6, 0.1, 0.8, COL.wood);
      for (const x of [-0.25, 0.25]) { body.boxB(x - 0.04, 0.2, -0.05, 0.08, 0.45, 0.08, COL.woodD); }
      body.boxB(-0.3, 0.6, -0.05, 0.6, 0.06, 0.08, COL.woodD);
      for (const x of [-0.32, 0.32]) for (const z of [-0.3, 0.3]) body.cylX(x, 0.1, z, 0.1, 0.05, 10, COL.woodD);
      body.boxB(-0.29, 0.2, -0.38, 0.58, 0.04, 0.02, c);
      extra.arm = true;
    }
    return { body: body.build(), extra };
  }
  // Mensch
  body.boxB(-0.09, L, -0.055, 0.18, 0.2, 0.11, tunic);
  if (type === 'monk' || type === 'assassin') body.cone(0, 0.05, 0, 0.12, 0.2, 6, tunic);
  body.boxB(-0.095, L + 0.04, -0.06, 0.19, 0.025, 0.12, type === 'peasant' ? 0x6e4a28 : 0x3a2a1a);
  if (type === 'sword' || type === 'pike') body.boxB(-0.06, L + 0.05, 0.055, 0.12, 0.13, 0.01, c);
  body.ico(0, L + 0.27, 0, 0.068, COL.skin);
  // Arme
  body.boxB(-0.13, L + 0.05, -0.03, 0.04, 0.14, 0.06, tunic); body.boxB(0.09, L + 0.05, -0.03, 0.04, 0.14, 0.06, tunic);
  const hy = L + 0.27;
  switch (type) {
    case 'peasant': body.cyl(0, hy + 0.045, 0, 0.05, 0.1, 0.03, 8, 0xb89a62); body.cone(0, hy + 0.06, 0, 0.05, 0.05, 8, 0xb89a62); break;
    case 'archer':
      body.cone(0, hy + 0.02, 0, 0.08, 0.12, 6, 0x3c5a2a);
      body.box(0.16, L + 0.12, 0.05, 0.02, 0.36, 0.02, COL.woodD, 0, 0);
      body.box(0.15, L + 0.29, 0.07, 0.02, 0.08, 0.06, COL.woodD); body.box(0.15, L - 0.05, 0.07, 0.02, 0.08, 0.06, COL.woodD);
      body.boxB(-0.08, L + 0.08, -0.1, 0.05, 0.18, 0.05, 0x7a5230);
      break;
    case 'crossbow':
      body.ico(0, hy + 0.03, 0, 0.075, COL.iron, 1, 0.7, 1);
      body.boxB(0.07, L + 0.1, 0.02, 0.04, 0.04, 0.24, COL.woodD);
      body.box(0.09, L + 0.12, 0.22, 0.2, 0.02, 0.02, COL.iron, 0, 0);
      break;
    case 'spear':
      body.ico(0, hy + 0.03, 0, 0.075, COL.steel, 1, 0.7, 1);
      body.box(0.13, L + 0.16, 0.05, 0.022, 0.75, 0.022, COL.woodD, 0, 0);
      body.cone(0.13, L + 0.52, 0.05, 0.03, 0.1, 4, COL.steel);
      body.cylZ(-0.13, L + 0.12, 0.02, 0.1, 0.03, 10, c);
      break;
    case 'pike':
      body.ico(0, hy + 0.03, 0, 0.078, COL.steel, 1, 0.7, 1);
      body.box(0.13, L + 0.35, 0.05, 0.022, 1.2, 0.022, COL.woodD, 0, 0);
      body.cone(0.13, L + 0.95, 0.05, 0.03, 0.12, 4, COL.steel);
      break;
    case 'sword':
      body.ico(0, hy + 0.02, 0, 0.078, COL.steel, 1, 0.85, 1); body.boxB(-0.012, hy - 0.05, 0.055, 0.024, 0.08, 0.02, 0x333333);
      body.boxB(0.12, L + 0.05, 0.03, 0.025, 0.3, 0.02, COL.steel); body.boxB(0.09, L + 0.05, 0.02, 0.08, 0.02, 0.04, 0x8a6a30);
      body.boxB(-0.17, L + 0.0, -0.08, 0.03, 0.2, 0.16, c);
      break;
    case 'monk':
      body.cone(0, hy - 0.02, 0, 0.09, 0.14, 6, 0x5a3c24);
      body.box(0.13, L + 0.2, 0.04, 0.022, 0.6, 0.022, COL.woodL, 0, 0);
      body.ico(0.13, L + 0.52, 0.04, 0.04, COL.gold);
      break;
    case 'assassin':
      body.cone(0, hy - 0.01, 0, 0.085, 0.16, 6, 0x1e1e24);
      body.boxB(0.11, L + 0.06, 0.04, 0.02, 0.18, 0.02, COL.steel);
      body.boxB(-0.13, L + 0.06, 0.04, 0.02, 0.18, 0.02, COL.steel);
      body.boxB(-0.06, L + 0.15, 0.055, 0.12, 0.03, 0.01, 0x8a1a1a);
      break;
  }
  extra.legs = 2; extra.legH = L;
  return { body: body.build(), extra, legCol: type === 'sword' || type === 'pike' ? 0x5c6068 : type === 'peasant' ? 0x5a4630 : type === 'assassin' ? 0x1e1e24 : 0x4a3424 };
}

// ---------- Bäume ----------
function treeGeo(kind, v) {
  const m = new MB();
  if (kind === 'palm') {
    const lean = (U.hash(v, 1, 5) - 0.5) * 0.5;
    const seg = 6;
    for (let i = 0; i < seg; i++) {
      const f0 = i / seg, f1 = (i + 1) / seg;
      const g = new THREE.CylinderGeometry(0.06 - f1 * 0.02, 0.07 - f0 * 0.02, 1.6 / seg, 6);
      const x = lean * f0 * f0 * 0.6, y = 1.6 * f0 + 0.8 / seg;
      g.rotateZ(-lean * f0 * 0.6);
      g.translate(x, y, 0);
      m.add(g, i % 2 ? 0x7a5832 : 0x8c6a40, 0.05);
    }
    const tx = lean * 0.6, ty = 1.62;
    const n = 7;
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2 + v;
      const fl = new THREE.BufferGeometry();
      const L = 0.75 + U.hash(k, v, 2) * 0.25;
      const pts = [];
      // gebogenes Blatt als zwei Dreiecksstreifen
      const segs = 4;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs, t1 = (s + 1) / segs;
        const p0 = [t0 * L, -t0 * t0 * 0.55 + t0 * 0.18], p1 = [t1 * L, -t1 * t1 * 0.55 + t1 * 0.18];
        const w0 = 0.16 * (1 - t0 * 0.8), w1 = 0.16 * (1 - t1 * 0.8);
        pts.push(p0[0], p0[1], -w0, p1[0], p1[1], -w1, p1[0], p1[1], w1, p0[0], p0[1], -w0, p1[0], p1[1], w1, p0[0], p0[1], w0);
      }
      fl.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      fl.rotateY(-a); fl.translate(tx, ty, 0);
      fl.computeVertexNormals();
      m.add(fl, k % 2 ? 0x4e8a2e : 0x63a03a, 0.1);
    }
    m.ico(tx, ty - 0.03, 0, 0.09, 0x5e3f1e);
  } else if (kind === 'leaf') {
    m.cyl(0, 0, 0, 0.07, 0.1, 0.6, 6, COL.woodD);
    const base = [0x4c7a2c, 0x567f2e, 0x3f6c2a][v % 3];
    m.ico(0, 0.85, 0, 0.42, base, 1, 0.9, 1, 1);
    m.ico(0.22, 0.75, 0.12, 0.28, U.hash(v, 2, 3) > 0.5 ? 0x5f8f35 : base, 1, 1, 1, 0);
    m.ico(-0.2, 0.8, -0.1, 0.27, 0x467528, 1, 1, 1, 0);
  } else {
    // trockener Busch
    for (let k = 0; k < 5; k++) m.ico(Math.cos(k * 1.3) * 0.12, 0.08, Math.sin(k * 1.3) * 0.12, 0.12, 0x8a7a4a, 1, 0.7, 1);
  }
  return m.build();
}

// ---------- Textur-Helfer ----------
function softTex(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

const R = {
  W: 0, H: 0, dpr: 1, ready: false,
  cam: { x: 12, y: 50, z: 1, yaw: Math.PI / 4 },
  pitch: 0.92, fov: 34,
  hover: null, ghost: null, selRect: null, t: 0,
  views: new Map(), bviews: new Map(),

  init(cv) {
    this.cv = cv;
    this.ov = document.getElementById('ov');
    this.og = this.ov.getContext('2d');
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.mobile = mobile;
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xd9bd8c);
    this.scene.fog = new THREE.Fog(0xd9bd8c, 40, 120);
    this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.5, 400);
    const hemi = new THREE.HemisphereLight(0xc4dcff, 0xa8824e, 0.5);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe2b8, 1.45);
    sun.castShadow = true;
    const sm = mobile ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    this.sun = sun;
    this.scene.add(sun); this.scene.add(sun.target);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.86, metalness: 0.02 });
    this.matDS = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    this.ghostMatOk = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.6, emissive: 0x2a8a2a, emissiveIntensity: 0.4, depthWrite: false });
    this.ghostMatNo = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.45, emissive: 0xaa2a1a, emissiveIntensity: 0.6, depthWrite: false });
    this.geoCache = new Map();
    this.raycaster = new THREE.Raycaster();
    this.puff = softTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
  },

  resize() {
    this.W = this.cv.clientWidth || window.innerWidth; this.H = this.cv.clientHeight || window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.mobile ? 2 : 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.W, this.H, false);
    this.camera.aspect = this.W / Math.max(1, this.H);
    this.camera.updateProjectionMatrix();
    this.ov.width = Math.round(this.W * this.dpr); this.ov.height = Math.round(this.H * this.dpr);
  },

  // ======================================================================
  // Kamera
  // ======================================================================
  dist() { return 30 / this.cam.z; },
  updateCamera() {
    const c = this.cam, d = this.dist();
    const tx = c.x, tz = c.y;
    const ch = Math.cos(this.pitch) * d;
    this.camera.position.set(tx + Math.sin(c.yaw) * ch, Math.sin(this.pitch) * d, tz + Math.cos(c.yaw) * ch);
    this.camera.lookAt(tx, 0, tz);
    this.camera.updateMatrixWorld();
    // Sonne folgt dem Blickpunkt
    const s = Math.max(14, d * 0.9);
    this.sun.position.set(tx - 22, 34, tz - 9);
    this.sun.target.position.set(tx, 0, tz);
    const sc = this.sun.shadow.camera;
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.near = 1; sc.far = 120;
    sc.updateProjectionMatrix();
    this.scene.fog.near = d * 1.1; this.scene.fog.far = d * 3.2;
  },
  centerOn(x, y) { this.cam.x = x; this.cam.y = y; this.clampCam(); },
  clampCam() {
    const n = World.n;
    this.cam.x = U.clamp(this.cam.x, -2, n + 2); this.cam.y = U.clamp(this.cam.y, -2, n + 2);
    this.cam.z = U.clamp(this.cam.z, 0.45, 2.6);
  },
  ray(sx, sy) {
    const v = new THREE.Vector2(sx / this.W * 2 - 1, -(sy / this.H) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    return this.raycaster.ray;
  },
  screenToTile(sx, sy) {
    this.updateCamera();
    const r = this.ray(sx, sy);
    let t = -r.origin.y / (r.direction.y || -1e-6);
    if (!(t > 0)) t = 400;
    t = Math.min(t, 400);
    return [r.origin.x + r.direction.x * t, r.origin.z + r.direction.z * t];
  },
  tileToScreen(x, y, h) {
    const v = new THREE.Vector3(x, h || 0, y).project(this.camera);
    return [(v.x + 1) / 2 * this.W, (1 - v.y) / 2 * this.H];
  },
  pxPerTile() {
    const a = this.tileToScreen(this.cam.x, this.cam.y), b = this.tileToScreen(this.cam.x + 0.7071, this.cam.y - 0.7071);
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  },
  panBy(dx, dy) {
    const a = this.screenToTile(this.W / 2, this.H / 2), b = this.screenToTile(this.W / 2 - dx, this.H / 2 - dy);
    this.cam.x += b[0] - a[0]; this.cam.y += b[1] - a[1];
    this.clampCam();
  },
  zoomAt(mx, my, f) {
    const a = this.screenToTile(mx, my);
    this.cam.z = U.clamp(this.cam.z * f, 0.45, 2.6);
    const b = this.screenToTile(mx, my);
    this.cam.x += a[0] - b[0]; this.cam.y += a[1] - b[1];
    this.clampCam();
  },
  pinchStart(cx, cy) { return { z0: this.cam.z, p0: this.screenToTile(cx, cy), yaw0: this.cam.yaw }; },
  pinchMove(st, cx, cy, ratio, rot) {
    this.cam.z = U.clamp(st.z0 * ratio, 0.45, 2.6);
    if (rot != null) this.cam.yaw = st.yaw0 + rot;
    this.updateCamera();
    const b = this.screenToTile(cx, cy);
    this.cam.x += st.p0[0] - b[0]; this.cam.y += st.p0[1] - b[1];
    this.clampCam();
  },
  rotate(dir) {
    const target = Math.round((this.cam.yaw - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4 + dir * Math.PI / 2;
    this.rotAnim = { from: this.cam.yaw, to: target, t: 0 };
  },

  // ======================================================================
  // Szene aufbauen (neues Spiel / Laden)
  // ======================================================================
  buildTerrain() {
    const n = World.n;
    // alte Szene leeren
    for (const o of [this.world]) if (o) { this.scene.remove(o); o.traverse(x => { if (x.geometry && !x.userData.shared) x.geometry.dispose(); }); }
    this.views.clear(); this.bviews.clear();
    const world = new THREE.Group();
    this.world = world;
    this.scene.add(world);
    this.wallMasks = new Map();
    // Gelände
    const res = this.mobile ? 16 : 24;
    const tex = new THREE.CanvasTexture(this.terrainCanvas(res));
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const seg = n * 2;
    const geo = new THREE.PlaneGeometry(n, n, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(n / 2, 0, n / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const tmat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
    const terr = new THREE.Mesh(geo, tmat);
    terr.receiveShadow = true;
    world.add(terr);
    // Boden außerhalb der Karte
    const og = new THREE.PlaneGeometry(600, 600); og.rotateX(-Math.PI / 2); og.translate(n / 2, -0.05, n / 2);
    const outer = new THREE.Mesh(og, new THREE.MeshStandardMaterial({ color: linCol(0xc79e64), roughness: 1 }));
    outer.receiveShadow = true;
    world.add(outer);
    this.buildWater(world);
    this.buildDecor(world);
    this.buildTrees(world);
    // dynamische Ebenen
    this.dyn = new THREE.Group(); world.add(this.dyn);
    this.fxGroup = new THREE.Group(); world.add(this.fxGroup);
    this.particles = [];
    this.rings = []; this.arrows = []; this.ghostObjs = [];
    this.selFrame = this.makeSelFrame(); world.add(this.selFrame);
    this.buildMiniTerrain();
    this.ready = true;
    this.treeSig = -1;
  },

  heightAt(x, z) {
    const n = World.n;
    if (x < 0 || z < 0 || x > n || z > n) return 0;
    const nz = this.hnoise || (this.hnoise = U.noise(World.seed + 911));
    let h = (U.fbm(nz, x / 5, z / 5, 2) - 0.5) * 0.22;
    // Wasser absenken
    const d = this.waterDepthAt(x, z);
    if (d > 0) h = -Math.min(0.55, d * 0.35);
    // flach bei Gebäuden: leicht dämpfen
    return h;
  },
  waterDepthAt(x, z) {
    if (!this.depth) this.computeDepth();
    const n = World.n;
    const fx = x - 0.5, fz = z - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fz), u = fx - i0, v = fz - j0;
    const D = (i, j) => this.depth[U.clamp(j, 0, n - 1) * n + U.clamp(i, 0, n - 1)];
    return D(i0, j0) * (1 - u) * (1 - v) + D(i0 + 1, j0) * u * (1 - v) + D(i0, j0 + 1) * (1 - u) * v + D(i0 + 1, j0 + 1) * u * v;
  },
  computeDepth() {
    const n = World.n, depth = new Float32Array(n * n), q = [];
    for (let i = 0; i < n * n; i++) { if (World.tiles[i] !== T.WATER) { depth[i] = 0; q.push(i); } else depth[i] = 99; }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % n, y = (i / n) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (!World.inb(nx, ny)) continue;
        const ni = ny * n + nx;
        if (depth[ni] > depth[i] + 1) { depth[ni] = depth[i] + 1; q.push(ni); }
      }
    }
    this.depth = depth;
  },

  terrainCanvas(res) {
    const n = World.n, seed = World.seed;
    this.depth = null; this.hnoise = null; this.computeDepth();
    const S = n * res;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const img = g.createImageData(S, S), px = img.data;
    const F = 4, fw = n * F + 3;
    const nzC = U.noise(seed + 303), nzD = U.noise(seed + 404), nzE = U.noise(seed + 505), nzA = U.noise(seed + 101);
    const pqx = new Float32Array(fw * fw), pqy = new Float32Array(fw * fw), det = new Float32Array(fw * fw), hg = new Float32Array(fw * fw);
    for (let j = 0; j < fw; j++) for (let i = 0; i < fw; i++) {
      const x = i / F, y = j / F, k = j * fw + i;
      pqx[k] = (U.fbm(nzC, x / 1.6, y / 1.6, 2) - 0.5) * 0.9;
      pqy[k] = (U.fbm(nzD, x / 1.6 + 40, y / 1.6, 2) - 0.5) * 0.9;
      det[k] = U.fbm(nzE, x * 0.9, y * 0.9, 3);
      hg[k] = U.fbm(nzA, x / 2.2, y / 2.2, 2);
    }
    const samp = (arr, x, y) => {
      x = U.clamp(x * F, 0, fw - 2.001); y = U.clamp(y * F, 0, fw - 2.001);
      const i = x | 0, j = y | 0, u = x - i, v = y - j, k = j * fw + i;
      return arr[k] * (1 - u) * (1 - v) + arr[k + 1] * u * (1 - v) + arr[k + fw] * (1 - u) * v + arr[k + fw + 1] * u * v;
    };
    const tiles = World.tiles, depth = this.depth;
    const tt = (x, y) => tiles[U.clamp(y, 0, n - 1) * n + U.clamp(x, 0, n - 1)];
    const dep = (x, y) => depth[U.clamp(y, 0, n - 1) * n + U.clamp(x, 0, n - 1)];
    const acc = [0, 0, 0, 0, 0];
    for (let py = 0; py < S; py++) {
      const ty = (py + 0.5) / res;
      for (let pxx = 0; pxx < S; pxx++) {
        const tx = (pxx + 0.5) / res;
        const ux = tx + samp(pqx, tx, ty) - 0.5, uy = ty + samp(pqy, tx, ty) - 0.5;
        const i0 = Math.floor(ux), j0 = Math.floor(uy);
        let fu = ux - i0, fv = uy - j0;
        fu = fu * fu * (3 - 2 * fu); fv = fv * fv * (3 - 2 * fv);
        acc[0] = acc[1] = acc[2] = acc[3] = acc[4] = 0;
        acc[tt(i0, j0)] += (1 - fu) * (1 - fv);
        acc[tt(i0 + 1, j0)] += fu * (1 - fv);
        acc[tt(i0, j0 + 1)] += (1 - fu) * fv;
        acc[tt(i0 + 1, j0 + 1)] += fu * fv;
        const d = samp(det, tx, ty);
        const g1 = U.hash(pxx, py, 9) - 0.5;
        let r = 0, gg = 0, bb = 0;
        for (let k = 0; k < 5; k++) {
          const w = acc[k];
          if (w <= 0) continue;
          const c0 = TCOL[k][0], c1 = TCOL[k][1];
          let m = d;
          if (k === T.ROCK || k === T.IRON) m = U.clamp(d * 0.6 + (U.hash(pxx >> 1, py >> 1, 3) - 0.5) * 0.7 + 0.2, 0, 1);
          else if (k === T.GRASS) m = U.clamp(d * 1.3 - 0.15 + g1 * 0.4, 0, 1);
          else if (k === T.WATER) {
            const dd = dep(i0, j0) * (1 - fu) * (1 - fv) + dep(i0 + 1, j0) * fu * (1 - fv) + dep(i0, j0 + 1) * (1 - fu) * fv + dep(i0 + 1, j0 + 1) * fu * fv;
            m = U.clamp(dd / 3, 0, 1);
          } else {
            // Sandrippel
            const rip = Math.sin((tx * 3.1 + ty * 1.7) * 3 + samp(hg, tx, ty) * 9) * 0.5 + 0.5;
            m = U.clamp(d * 0.9 + rip * 0.18 - 0.05, 0, 1);
          }
          r += w * (c0[0] + (c1[0] - c0[0]) * m);
          gg += w * (c0[1] + (c1[1] - c0[1]) * m);
          bb += w * (c0[2] + (c1[2] - c0[2]) * m);
        }
        const ww = acc[T.WATER];
        if (ww > 0.25 && ww < 0.62) { const f = 1 - Math.abs(ww - 0.43) / 0.19; r += 40 * f; gg += 36 * f; bb += 24 * f; }
        let L = 1;
        if (ww > 0.02 && ww <= 0.25) L = 1 - ww * 0.7;
        // Rand der Karte
        const e = Math.min(tx, ty, n - tx, n - ty);
        if (e < 1.5) L *= 0.82 + 0.18 * (e / 1.5);
        const gr = g1 * 10;
        const o = (py * S + pxx) * 4;
        px[o] = U.clamp(r * L + gr, 0, 255); px[o + 1] = U.clamp(gg * L + gr, 0, 255); px[o + 2] = U.clamp(bb * L + gr * 0.8, 0, 255); px[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // feine Details
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = World.tile(x, y);
      const r = k => U.hash(x * 17 + k, y * 31 + k * 7, seed + k);
      if (t === T.SAND && r(1) < 0.2) { g.fillStyle = 'rgba(120,90,55,0.35)'; g.beginPath(); g.arc((x + r(2)) * res, (y + r(3)) * res, res * 0.06, 0, 7); g.fill(); }
      if (t === T.GRASS) for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? 'rgba(60,95,32,0.5)' : 'rgba(160,190,90,0.4)'; g.fillRect((x + r(k + 4)) * res, (y + r(k + 8)) * res, res * 0.08, res * 0.08); }
    }
    return c;
  },

  buildWater(world) {
    const n = World.n;
    let x0 = n, y0 = n, x1 = 0, y1 = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (World.tile(x, y) === T.WATER) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
    if (x1 <= x0) return;
    // Wellen-Normalmap
    const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S);
    const H = (x, y) => Math.sin(x / S * Math.PI * 6) * 0.5 + Math.sin((x + y) / S * Math.PI * 4) * 0.4 + Math.sin(y / S * Math.PI * 8 + Math.sin(x / S * Math.PI * 2) * 2) * 0.3;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = H(x + 1, y) - H(x - 1, y), dy = H(x, y + 1) - H(x, y - 1);
      const o = (y * S + x) * 4;
      img.data[o] = 128 + dx * 90; img.data[o + 1] = 128 + dy * 90; img.data[o + 2] = 255; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const nm = new THREE.CanvasTexture(c);
    nm.wrapS = nm.wrapT = THREE.RepeatWrapping;
    nm.repeat.set((x1 - x0) / 3, (y1 - y0) / 3);
    this.waterNormal = nm;
    const geo = new THREE.PlaneGeometry(x1 - x0 + 1, y1 - y0 + 1);
    geo.rotateX(-Math.PI / 2); geo.translate((x0 + x1) / 2, -0.07, (y0 + y1) / 2);
    const mat = new THREE.MeshStandardMaterial({ color: linCol(0x3f93b4), roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.78, normalMap: nm, normalScale: new THREE.Vector2(0.35, 0.35) });
    const w = new THREE.Mesh(geo, mat);
    w.receiveShadow = true;
    world.add(w);
  },

  buildDecor(world) {
    const n = World.n, seed = World.seed;
    const rocks = [], grass = [], shrubs = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = World.tile(x, y);
      const r = k => U.hash(x * 13 + k, y * 29 + k * 3, seed + 50 + k);
      if (t === T.ROCK || t === T.IRON) for (let k = 0; k < 3; k++) rocks.push([x + 0.15 + r(k) * 0.7, y + 0.15 + r(k + 5) * 0.7, 0.08 + r(k + 9) * 0.16, t, r(k + 13)]);
      else if (t === T.GRASS) for (let k = 0; k < 5; k++) grass.push([x + r(k), y + r(k + 6), 0.6 + r(k + 11) * 0.6]);
      else if (t === T.SAND) { if (r(1) < 0.04) shrubs.push([x + r(2), y + r(3)]); if (r(4) < 0.08) rocks.push([x + r(5), y + r(6), 0.04 + r(7) * 0.05, T.SAND, r(8)]); }
    }
    const dummy = new THREE.Object3D();
    const addInst = (geo, list, place) => {
      const im = new THREE.InstancedMesh(geo, this.mat, Math.max(1, list.length));
      list.forEach((it, i) => { place(it, dummy); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
      im.count = list.length;
      im.castShadow = true; im.receiveShadow = true;
      world.add(im);
    };
    const rockGeo = new MB().ico(0, 0, 0, 1, 0x9d968a, 1, 0.6, 1).build();
    const ironGeo = new MB().ico(0, 0, 0, 1, 0x8a4f34, 1, 0.6, 1).build();
    const sandGeo = new MB().ico(0, 0, 0, 1, 0xa08a66, 1, 0.6, 1).build();
    const place = (it, d) => { d.position.set(it[0], this.heightAt(it[0], it[1]) + it[2] * 0.15, it[1]); d.scale.set(it[2] * (1 + it[4]), it[2], it[2] * (1.4 - it[4] * 0.5)); d.rotation.set(0, it[4] * 6, 0); };
    addInst(rockGeo, rocks.filter(r => r[3] === T.ROCK), place);
    addInst(ironGeo, rocks.filter(r => r[3] === T.IRON), place);
    addInst(sandGeo, rocks.filter(r => r[3] === T.SAND), place);
    const gm = new MB();
    for (let k = 0; k < 5; k++) { const a = k * 1.25; const g = new THREE.ConeGeometry(0.025, 0.22, 3); g.rotateZ(Math.cos(a) * 0.35); g.rotateX(Math.sin(a) * 0.35); g.translate(Math.cos(a) * 0.04, 0.1, Math.sin(a) * 0.04); gm.add(g, k % 2 ? 0x6f9a38 : 0x8ab44a, 0.15); }
    addInst(gm.build(), grass, (it, d) => { d.position.set(it[0], this.heightAt(it[0], it[1]), it[1]); d.scale.setScalar(it[2]); d.rotation.set(0, it[2] * 9, 0); });
    addInst(treeGeo('bush', 0), shrubs, (it, d) => { d.position.set(it[0], this.heightAt(it[0], it[1]), it[1]); d.scale.setScalar(1); d.rotation.set(0, it[0] * 3, 0); });
  },

  buildTrees(world) {
    const n = World.n;
    this.treeKinds = [];
    const kinds = [['palm', 0], ['palm', 1], ['palm', 2], ['leaf', 0], ['leaf', 1]];
    const lists = kinds.map(() => []);
    this.treeSlot = new Int32Array(n * n).fill(-1);
    this.treeKindOf = new Int8Array(n * n).fill(-1);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (!World.trees[i]) continue;
      const h = U.hash(x, y, 3);
      const k = World.tile(x, y) === T.GRASS && h < 0.45 ? 3 + ((h * 97) | 0) % 2 : ((h * 97) | 0) % 3;
      this.treeKindOf[i] = k;
      this.treeSlot[i] = lists[k].length;
      lists[k].push(i);
    }
    this.treeMeshes = kinds.map(([kind, v], k) => {
      const im = new THREE.InstancedMesh(treeGeo(kind, v), this.matDS, Math.max(1, lists[k].length));
      im.castShadow = true; im.receiveShadow = true;
      im.count = lists[k].length;
      world.add(im);
      return im;
    });
    this.treeLists = lists;
    this.treeWood = new Uint8Array(n * n);
    this.syncTrees(true);
  },
  syncTrees(force) {
    const n = World.n, dummy = new THREE.Object3D();
    const dirty = new Set();
    for (let i = 0; i < n * n; i++) {
      const k = this.treeKindOf[i];
      if (k < 0) continue;
      const w = World.trees[i];
      if (!force && w === this.treeWood[i]) continue;
      this.treeWood[i] = w;
      const x = i % n, y = (i / n) | 0;
      const h = U.hash(x, y, 3), h2 = U.hash(y, x, 4);
      const px = x + 0.5 + (h - 0.5) * 0.3, pz = y + 0.5 + (h2 - 0.5) * 0.3;
      dummy.position.set(px, this.heightAt(px, pz), pz);
      const s = w ? 0.85 + Math.min(8, w) / 8 * 0.35 : 0.0001;
      dummy.scale.set(s, s * (0.9 + h * 0.25), s);
      dummy.rotation.set(0, h * 6.28, 0);
      dummy.updateMatrix();
      this.treeMeshes[k].setMatrixAt(this.treeSlot[i], dummy.matrix);
      dirty.add(k);
    }
    for (const k of dirty) this.treeMeshes[k].instanceMatrix.needsUpdate = true;
  },

  makeSelFrame() {
    const g = new THREE.RingGeometry(0.98, 1.0, 4, 1);
    g.rotateZ(Math.PI / 4); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, depthWrite: false }));
    m.renderOrder = 5;
    m.visible = false;
    return m;
  },

  // ======================================================================
  // Gebäude
  // ======================================================================
  geoFor(type, owner, level, variant) {
    const key = type + ':' + owner + ':' + (level || 1) + ':' + (variant || '');
    let g = this.geoCache.get(key);
    if (g) return g;
    if (type === 'wall' || type === 'palisade') g = wallGeo(+variant || 0, type);
    else {
      const m = new MB();
      (MODELS[type] || MODELS.house)(m, PLAYER_COLORS[owner], level || 1, variant);
      g = m.build();
    }
    this.geoCache.set(key, g);
    return g;
  },
  wallMask(b) {
    let mask = 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    dirs.forEach(([dx, dy], i) => {
      const x = b.x + dx, y = b.y + dy;
      if (!World.inb(x, y)) return;
      const o = G.bmap.get(World.occ[World.idx(x, y)]);
      if (!o || o.owner !== b.owner) return;
      const ok = o.type === b.type || (b.type === 'wall' && (o.type === 'gate' || o.type === 'tower' || o.type === 'bigtower'));
      if (!ok) return;
      if (dx && dy) {
        // Diagonale nur, wenn keine gerade Verbindung den Winkel schon schließt
        const a = G.bmap.get(World.occ[World.idx(b.x + dx, b.y)]), c = G.bmap.get(World.occ[World.idx(b.x, b.y + dy)]);
        if ((a && a.type === b.type) || (c && c.type === b.type)) return;
      }
      mask |= 1 << i;
    });
    return mask;
  },
  variantOf(b) {
    if (b.type === 'stockpile') {
      const r = G.s.players[b.owner].res;
      const lv = k => Math.min(4, Math.ceil((r[k] || 0) / 40));
      return lv('holz') + '' + lv('stein') + lv('eisen');
    }
    if (b.type === 'wall' || b.type === 'palisade') return String(this.wallMask(b));
    return '';
  },
  makeBuildingView(b) {
    const v = { group: new THREE.Group(), key: '' };
    v.group.position.set(b.x, 0, b.y);
    v.mesh = new THREE.Mesh(this.geoFor(b.type, b.owner, b.level, ''), this.mat);
    v.mesh.castShadow = true; v.mesh.receiveShadow = true;
    v.mesh.userData.bid = b.id;
    v.group.add(v.mesh);
    // Fahne
    const fp = { keep: [1.5, 3.95, 1.5, 1.2], tower: [1, 2.95, 1, 0.9], bigtower: [1.5, 3.45, 1.5, 1], barracks: [2.6, 1.35, 0.4, 0.8], ballista: [0.25, 1.4, 0.25, 0.7] }[b.type];
    if (fp) {
      const pole = new THREE.Mesh(this.poleGeo || (this.poleGeo = new MB().boxB(-0.02, 0, -0.02, 0.04, 0.9, 0.04, COL.woodD).build()), this.mat);
      pole.position.set(fp[0], b.type === 'barracks' || b.type === 'ballista' ? fp[1] : fp[1] - 0.9, fp[2]);
      if (b.type === 'barracks' || b.type === 'ballista') v.group.add(pole);
      const fg = new THREE.PlaneGeometry(0.6, 0.38, 6, 1);
      fg.translate(0.3, 0, 0);
      const flag = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: linCol(PLAYER_COLORS[b.owner]), side: THREE.DoubleSide, roughness: 0.8 }));
      flag.position.set(fp[0], fp[1] - 0.2 + (b.type === 'barracks' || b.type === 'ballista' ? 0.85 : 0), fp[2]);
      flag.scale.setScalar(fp[3]);
      flag.castShadow = true;
      v.flag = flag; v.flagBase = fg.attributes.position.array.slice();
      v.group.add(flag);
    }
    if (b.type === 'mill') {
      const sm = new MB();
      for (let k = 0; k < 4; k++) { const g = new THREE.BoxGeometry(0.12, 0.85, 0.02); g.translate(0, 0.5, 0); g.rotateZ(k * Math.PI / 2); sm.add(g, COL.plaster, 0.05); const g2 = new THREE.BoxGeometry(0.03, 0.9, 0.03); g2.translate(0, 0.45, 0); g2.rotateZ(k * Math.PI / 2); sm.add(g2, COL.woodD, 0); }
      v.sails = new THREE.Mesh(sm.build(), this.mat);
      v.sails.position.set(1, 1.55, 1.75);
      v.sails.castShadow = true;
      v.group.add(v.sails);
    }
    if (b.type === 'ballista') {
      const bm = new MB();
      bm.boxB(-0.08, 0, -0.35, 0.16, 0.1, 0.7, COL.woodD);
      bm.box(0, 0.14, 0.25, 0.8, 0.05, 0.06, COL.wood, 0, 0);
      bm.cyl(0, -0.25, 0, 0.06, 0.08, 0.25, 6, COL.woodD);
      bm.boxB(-0.03, 0.1, -0.3, 0.06, 0.04, 0.6, COL.iron);
      v.top = new THREE.Mesh(bm.build(), this.mat);
      v.top.position.set(1, 1.55, 1);
      v.top.castShadow = true;
      v.group.add(v.top);
    }
    this.dyn.add(v.group);
    return v;
  },

  syncBuildings(dt) {
    const seen = new Set();
    for (const b of G.s.buildings) {
      seen.add(b.id);
      let v = this.bviews.get(b.id);
      if (!v) { v = this.makeBuildingView(b); this.bviews.set(b.id, v); this.wallsDirty = true; }
      const variant = this.variantOf(b);
      const key = (b.level || 1) + ':' + variant;
      if (v.key !== key) { v.mesh.geometry = this.geoFor(b.type, b.owner, b.level, variant); v.key = key; }
      if (b.type === 'trap') v.group.visible = b.owner === 0;
      if (b.burn > 0 && Math.random() < dt * 30) this.emit(b.x + Math.random(), 0.1, b.y + Math.random(), Math.random() < 0.3 ? 'smoke' : 'fire');
      // Treffer: kurz wackeln
      if (b.hitT > 0) { b.hitT -= dt; v.mesh.position.x = Math.sin(this.t * 60) * 0.02; } else v.mesh.position.x = 0;
      if (v.flag) {
        const a = v.flag.geometry.attributes.position, base = v.flagBase;
        for (let i = 0; i < a.count; i++) {
          const x = base[i * 3];
          a.setZ(i, Math.sin(this.t * 5 - x * 7 + b.id) * 0.06 * x);
        }
        a.needsUpdate = true;
      }
      if (v.sails) v.sails.rotation.z -= dt * 1.2;
      if (v.top) {
        const t = G.umap.get(b.target);
        if (t) v.top.rotation.y = Math.atan2(t.x - (b.x + 1), t.y - (b.y + 1));
      }
      // Rauch, Feuer, Schornstein
      if (b.hp < b.maxHp * 0.5 && Math.random() < dt * 6) this.emit(b.x + b.w / 2 + (Math.random() - 0.5) * b.w * 0.6, (BUILD_H[b.type] || 1) * 0.7, b.y + b.h / 2 + (Math.random() - 0.5) * b.h * 0.6, 'smoke');
      if (b.hp < b.maxHp * 0.3 && Math.random() < dt * 8) this.emit(b.x + b.w / 2 + (Math.random() - 0.5) * b.w * 0.6, (BUILD_H[b.type] || 1) * 0.5, b.y + b.h / 2 + (Math.random() - 0.5) * b.h * 0.6, 'fire');
      if ((b.type === 'house' || b.type === 'woodcutter' || b.type === 'bakery') && Math.random() < dt * 1.2) {
        const cp = b.type === 'house' ? [1.35, b.level >= 2 ? 1.85 : 1.55, 0.6] : b.type === 'bakery' ? [1.42, 1.65, 0.57] : [0.43, 1.35, 0.43];
        this.emit(b.x + cp[0], cp[1], b.y + cp[2], 'chimney');
      }
    }
    for (const [id, v] of this.bviews) if (!seen.has(id)) { this.dyn.remove(v.group); this.bviews.delete(id); this.wallsDirty = true; }
  },

  // ======================================================================
  // Einheiten
  // ======================================================================
  unitGeo(type, owner) {
    const key = 'u:' + type + ':' + owner;
    let g = this.geoCache.get(key);
    if (!g) { g = unitParts(type, PLAYER_COLORS[owner]); this.geoCache.set(key, g); }
    return g;
  },
  legGeo(col, h) {
    const key = 'leg:' + col + ':' + h;
    let g = this.geoCache.get(key);
    if (!g) { const m = new MB(); m.boxB(-0.035, -h, -0.035, 0.07, h, 0.07, col); g = m.build(); this.geoCache.set(key, g); }
    return g;
  },
  makeUnitView(u) {
    const p = this.unitGeo(u.type, u.owner);
    const v = { group: new THREE.Group(), legs: [], px: u.x, py: u.y, yaw: 0 };
    v.body = new THREE.Mesh(p.body, this.mat);
    v.body.castShadow = true;
    v.group.add(v.body);
    if (p.extra.legs === 2) {
      const lg = this.legGeo(p.legCol, p.extra.legH);
      for (const s of [-1, 1]) { const l = new THREE.Mesh(lg, this.mat); l.position.set(s * 0.045, p.extra.legH, 0); l.castShadow = true; v.group.add(l); v.legs.push(l); }
    } else if (p.extra.legs === 4) {
      const lg = this.legGeo(0x5e3e22, p.extra.legH);
      for (const [x, z] of [[-0.07, -0.22], [0.07, -0.22], [-0.07, 0.22], [0.07, 0.22]]) { const l = new THREE.Mesh(lg, this.mat); l.position.set(x, p.extra.legH, z); l.castShadow = true; v.group.add(l); v.legs.push(l); }
    }
    if (p.extra.arm) {
      const am = new MB(); am.boxB(-0.03, 0, -0.03, 0.06, 0.06, 0.65, COL.woodD); am.cyl(0, 0.03, 0.62, 0.07, 0.05, 0.06, 8, COL.woodD);
      v.arm = new THREE.Mesh(am.build(), this.mat); v.arm.position.set(0, 0.63, 0); v.arm.castShadow = true; v.group.add(v.arm);
    }
    // getragene Ware
    v.carry = new THREE.Mesh(this.carryGeo || (this.carryGeo = new MB().boxB(-0.07, 0, -0.05, 0.14, 0.09, 0.1, 0xffffff, 0).build()), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.8 }));
    v.carry.position.set(0, 0.56, 0); v.carry.visible = false; v.carry.castShadow = true;
    v.group.add(v.carry);
    v.group.scale.setScalar(u.type === 'ram' || u.type === 'catapult' ? 1.1 : 1.35);
    this.dyn.add(v.group);
    return v;
  },
  unitY(u) {
    if (u.tower) { const t = G.bmap.get(u.tower); if (t) return TOWER_TOP[t.type] || 2; }
    return Math.max(0, this.heightAt(u.x, u.y));
  },
  syncUnits(dt) {
    const seen = new Set();
    for (const u of G.s.units) {
      if (u.dead) continue;
      seen.add(u.id);
      let v = this.views.get(u.id);
      if (!v) { v = this.makeUnitView(u); this.views.set(u.id, v); }
      const y = this.unitY(u);
      v.group.position.set(u.x, y, u.y);
      const dx = u.x - v.px, dz = u.y - v.py;
      if (dx * dx + dz * dz > 1e-6) v.yaw = Math.atan2(dx, dz);
      if (u.faceX != null) { v.yaw = Math.atan2(u.faceX - u.x, u.faceY - u.y); u.faceX = null; }
      v.px = u.x; v.py = u.y;
      let dy = v.yaw - v.group.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      v.group.rotation.y += dy * Math.min(1, dt * 12);
      const walk = u.moving ? Math.sin(u.anim * 11) : 0;
      v.legs.forEach((l, i) => { l.rotation.x = walk * 0.6 * (i % 2 ? 1 : -1) * (v.legs.length === 4 && i > 1 ? -1 : 1); });
      const atk = u.atkT > 0 ? u.atkT / 0.35 : 0;
      v.body.rotation.x = atk * 0.25 + (u.working ? Math.abs(Math.sin(u.anim * 6)) * 0.25 : 0);
      v.body.position.y = u.moving ? Math.abs(walk) * 0.02 : 0;
      if (v.arm) v.arm.rotation.x = -atk * 1.4;
      if (u.carry) {
        v.carry.visible = true;
        const cc = { holz: 0x8a5d33, stein: 0xb5ae9f, eisen: 0x6b7280, nahrung: 0xc7342a, weizen: 0xe2bf55, mehl: 0xf2ecdc, brot: 0xc98a45 }[u.carry.res] || 0xffffff;
        v.carry.material.color.set(linCol(cc));
      } else v.carry.visible = false;
      if (u.hitT > 0 && Math.random() < 0.3) this.emit(u.x, y + 0.4, u.y, 'hit');
    }
    for (const [id, v] of this.views) if (!seen.has(id)) { this.dyn.remove(v.group); this.views.delete(id); }
  },

  // ======================================================================
  // Partikel, Pfeile, Ringe
  // ======================================================================
  emit(x, y, z, kind) {
    if (this.particles.length > 260) return;
    const col = { smoke: 0x4a4440, chimney: 0xe8e2d8, fire: 0xff8a2a, dust: 0xd8bf8a, hit: 0xb02a1a, spark: 0xffd25a, heal: 0x9fe07a }[kind];
    const add = kind === 'fire' || kind === 'spark' || kind === 'heal';
    const mat = new THREE.SpriteMaterial({ map: this.puff, color: col, transparent: true, depthWrite: false, opacity: 0.8, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, fog: true });
    const s = new THREE.Sprite(mat);
    s.position.set(x, y, z);
    const p = { s, kind, t: 0, life: kind === 'smoke' ? 2.4 : kind === 'chimney' ? 3 : kind === 'fire' ? 0.7 : kind === 'dust' ? 1.1 : kind === 'heal' ? 1 : 0.5,
      vx: (Math.random() - 0.5) * 0.2, vy: kind === 'hit' ? 0.4 : kind === 'dust' ? 0.3 : 0.5, vz: (Math.random() - 0.5) * 0.2,
      s0: kind === 'smoke' ? 0.35 : kind === 'chimney' ? 0.12 : kind === 'fire' ? 0.35 : kind === 'dust' ? 0.5 : 0.15, s1: kind === 'smoke' ? 1.4 : kind === 'chimney' ? 0.6 : kind === 'dust' ? 1.1 : 0.2 };
    if (kind === 'chimney') { p.vx = 0.12; p.vz = -0.05; p.vy = 0.35; }
    s.scale.setScalar(p.s0);
    this.fxGroup.add(s);
    this.particles.push(p);
  },
  updateParticles(dt) {
    const keep = [];
    for (const p of this.particles) {
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { this.fxGroup.remove(p.s); p.s.material.dispose(); continue; }
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.s.scale.setScalar(p.s0 + (p.s1 - p.s0) * k);
      p.s.material.opacity = (p.kind === 'chimney' ? 0.45 : p.kind === 'smoke' ? 0.6 : 0.9) * (1 - k);
      keep.push(p);
    }
    this.particles = keep;
  },
  arrowMesh(kind) {
    if (!this.arrowGeo) {
      const m = new MB(); m.boxB(-0.012, -0.012, -0.22, 0.024, 0.024, 0.44, COL.woodD); m.cone(0, 0.2, 0, 0.03, 0.08, 4, COL.steel);
      const g = m.build(); g.rotateX(Math.PI / 2); this.arrowGeo = g;
      const m2 = new MB(); m2.ico(0, 0, 0, 0.12, COL.stoneD); this.stoneGeo = m2.build();
    }
    const msh = new THREE.Mesh(kind === 'stone' ? this.stoneGeo : this.arrowGeo, this.mat);
    msh.castShadow = true;
    return msh;
  },
  syncProjectiles() {
    while (this.arrows.length < G.proj.length) { const a = this.arrowMesh(); this.fxGroup.add(a); this.arrows.push(a); }
    this.arrows.forEach((a, i) => {
      const pr = G.proj[i];
      if (!pr) { a.visible = false; return; }
      a.visible = true;
      const kind = pr.kind === 'stone' ? 'stone' : 'arrow';
      if (a.userData.kind !== kind) { a.geometry = kind === 'stone' ? (this.stoneGeo || this.arrowGeo) : this.arrowGeo; a.userData.kind = kind; }
      const pos = k => {
        const d = U.dist(pr.x0, pr.y0, pr.tx, pr.ty);
        const h0 = pr.h0 != null ? pr.h0 : 0.6, h1 = pr.h1 != null ? pr.h1 : 0.4;
        return new THREE.Vector3(pr.x0 + (pr.tx - pr.x0) * k, h0 + (h1 - h0) * k + Math.sin(Math.PI * k) * d * (kind === 'stone' ? 0.35 : 0.14), pr.y0 + (pr.ty - pr.y0) * k);
      };
      const k = pr.t / pr.dur;
      const p0 = pos(k), p1 = pos(Math.min(1, k + 0.03));
      a.position.copy(p0);
      a.lookAt(p1.x + (p1.x - p0.x) * 0.01, p1.y + (p1.y - p0.y) * 0.01, p1.z + (p1.z - p0.z) * 0.01);
    });
  },
  ring(i, x, z, y, r, col, op) {
    if (!this.rings[i]) {
      const g = new THREE.RingGeometry(0.8, 1, 28); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
      m.renderOrder = 4;
      this.fxGroup.add(m); this.rings[i] = m;
    }
    const m = this.rings[i];
    m.visible = true; m.position.set(x, y + 0.03, z); m.scale.setScalar(r);
    m.material.color.set(col); m.material.opacity = op;
  },
  syncRings() {
    let i = 0;
    for (const id of UI.sel) {
      const u = G.umap.get(id);
      if (!u) continue;
      this.ring(i++, u.x, u.y, this.unitY(u), u.type === 'knight' || u.type === 'ram' || u.type === 'catapult' ? 0.45 : 0.3, 0xffe9a0, 0.95);
    }
    for (const f of G.fx) {
      if (f.k === 'mark') { const k = f.t / f.dur; this.ring(i++, f.x, f.y, 0, (f.r || 0.5) * (1.3 - k * 0.6), f.c, 1 - k); }
      else if (!f.done) {
        f.done = true;
        if (f.k === 'dust' || f.k === 'leave' || f.k === 'fall') for (let k = 0; k < (f.r || 1) * 4; k++) this.emit(f.x + (Math.random() - 0.5) * (f.r || 1), 0.15, f.y + (Math.random() - 0.5) * (f.r || 1), 'dust');
        if (f.k === 'rubble') for (let k = 0; k < 14; k++) this.emit(f.x + (Math.random() - 0.5) * f.r, 0.4, f.y + (Math.random() - 0.5) * f.r, k % 3 ? 'smoke' : 'dust');
        if (f.k === 'death') for (let k = 0; k < 4; k++) this.emit(f.x, 0.25, f.y, 'hit');
        if (f.k === 'heal') this.emit(f.x, 0.6, f.y, 'heal');
      }
    }
    // Reichweite gewählter Fernkämpfer auf Türmen: nichts
    for (; i < this.rings.length; i++) this.rings[i].visible = false;
    const sb = G.bmap.get(UI.selB);
    if (sb) {
      this.selFrame.visible = true;
      this.selFrame.position.set(sb.x + sb.w / 2, 0.04, sb.y + sb.h / 2);
      this.selFrame.scale.set(sb.w / 2 * 1.414 + 0.05, 1, sb.h / 2 * 1.414 + 0.05);
      this.selFrame.material.color.set(sb.owner === 0 ? 0xffe9a0 : 0xff7a5a);
      this.selFrame.material.opacity = 0.6 + Math.sin(this.t * 5) * 0.3;
    } else this.selFrame.visible = false;
  },

  // ======================================================================
  // Vorschau beim Bauen
  // ======================================================================
  syncGhost() {
    for (const o of this.ghostObjs) this.fxGroup.remove(o);
    this.ghostObjs = [];
    const gh = this.ghost;
    if (!gh) return;
    const tilePlane = (x, y, ok) => {
      const g = this.tileGeo || (this.tileGeo = (() => { const p = new THREE.PlaneGeometry(0.96, 0.96); p.rotateX(-Math.PI / 2); return p; })());
      const m = new THREE.Mesh(g, ok ? (this.okTile || (this.okTile = new THREE.MeshBasicMaterial({ color: 0x6fe06f, transparent: true, opacity: 0.4, depthWrite: false }))) : (this.noTile || (this.noTile = new THREE.MeshBasicMaterial({ color: 0xe0503a, transparent: true, opacity: 0.45, depthWrite: false }))));
      m.position.set(x + 0.5, Math.max(0, this.heightAt(x + 0.5, y + 0.5)) + 0.04, y + 0.5);
      m.renderOrder = 3;
      this.fxGroup.add(m); this.ghostObjs.push(m);
    };
    const model = (type, x, y, ok, variant) => {
      const m = new THREE.Mesh(this.geoFor(type, 0, 1, variant || ''), ok ? this.ghostMatOk : this.ghostMatNo);
      m.position.set(x, 0, y);
      m.renderOrder = 6;
      this.fxGroup.add(m); this.ghostObjs.push(m);
    };
    if (gh.line) {
      const set = new Set(gh.line.filter(t => t.ok).map(t => t.x + ',' + t.y));
      for (const t of gh.line) {
        tilePlane(t.x, t.y, t.ok);
        if (!t.ok) continue;
        if (t.type && t.type !== 'wall') { model(t.type, t.x, t.y, true, ''); continue; }
        let mask = 0;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy], i) => { if (set.has((t.x + dx) + ',' + (t.y + dy))) mask |= 1 << i; });
        [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dx, dy], i) => { if (set.has((t.x + dx) + ',' + (t.y + dy)) && !set.has((t.x + dx) + ',' + t.y) && !set.has(t.x + ',' + (t.y + dy))) mask |= 1 << (i + 4); });
        model(t.type || gh.type, t.x, t.y, true, gh.type === 'wall' || gh.type === 'palisade' ? String(mask) : '');
      }
      return;
    }
    const D = BUILDINGS[gh.type];
    for (let yy = gh.y; yy < gh.y + D.h; yy++) for (let xx = gh.x; xx < gh.x + D.w; xx++) tilePlane(xx, yy, gh.ok);
    model(gh.type, gh.x, gh.y, gh.ok, gh.type === 'wall' || gh.type === 'palisade' ? '15' : '');
    const range = D.range || (gh.type === 'woodcutter' ? 18 : 0);
    if (range) {
      const g = new THREE.RingGeometry(range - 0.08, range, 64); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfff0b4, transparent: true, opacity: 0.55, depthWrite: false }));
      m.position.set(gh.x + D.w / 2, 0.05, gh.y + D.h / 2);
      this.fxGroup.add(m); this.ghostObjs.push(m);
    }
  },

  // ======================================================================
  // Bild
  // ======================================================================
  frame(dt) {
    this.t += dt;
    const g = this.og;
    if (!G.s || !this.ready) {
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.ov.width, this.ov.height);
      this.renderer.setClearColor(0x1b140e); this.renderer.clear();
      return;
    }
    if (this.rotAnim) {
      const a = this.rotAnim; a.t = Math.min(1, a.t + dt * 2.5);
      const e = a.t * a.t * (3 - 2 * a.t);
      this.cam.yaw = a.from + (a.to - a.from) * e;
      if (a.t >= 1) this.rotAnim = null;
    }
    this.updateCamera();
    this.syncBuildings(dt);
    this.syncUnits(dt);
    this.syncProjectiles();
    this.syncRings();
    this.ghostSig = JSON.stringify(this.ghost);
    if (this.ghostSig !== this.lastGhostSig) { this.lastGhostSig = this.ghostSig; this.syncGhost(); }
    this.treeT = (this.treeT || 0) - dt;
    if (this.treeT <= 0) { this.treeT = 0.5; this.syncTrees(false); }
    if (this.waterNormal) { this.waterNormal.offset.x = this.t * 0.02; this.waterNormal.offset.y = this.t * 0.013; }
    // Lagerfeuer
    for (const p of G.s.players) if (p.fire && Math.random() < dt * 14) this.emit(p.fire.x + 0.5 + (Math.random() - 0.5) * 0.2, 0.1, p.fire.y + 0.5 + (Math.random() - 0.5) * 0.2, Math.random() < 0.2 ? 'spark' : 'fire');
    this.ensureFirePits();
    this.updateParticles(dt);
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay();
  },

  ensureFirePits() {
    if (this.firePits) return;
    this.firePits = true;
    const m = new MB();
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; m.ico(Math.cos(a) * 0.25, 0.03, Math.sin(a) * 0.25, 0.06, 0x8a7f70, 1, 0.7, 1); }
    m.box(0, 0.05, 0, 0.4, 0.05, 0.05, COL.woodD, 0, 0.5); m.box(0, 0.05, 0, 0.4, 0.05, 0.05, COL.woodD, 0, -0.6);
    const geo = m.build();
    for (const p of G.s.players) if (p.fire) { const ms = new THREE.Mesh(geo, this.mat); ms.position.set(p.fire.x + 0.5, 0, p.fire.y + 0.5); ms.receiveShadow = true; this.world.add(ms); }
  },

  drawOverlay() {
    const g = this.og, dpr = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.ov.width, this.ov.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bar = (x, y, w, f) => {
      f = U.clamp(f, 0, 1);
      g.fillStyle = 'rgba(15,8,4,0.75)'; g.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
      g.fillStyle = f > 0.5 ? '#79d457' : f > 0.25 ? '#e8b63e' : '#e04a32';
      g.fillRect(x - w / 2, y, w * f, 3);
    };
    const ppt = this.pxPerTile();
    for (const b of G.s.buildings) {
      if (b.hp >= b.maxHp && UI.selB !== b.id) continue;
      const [sx, sy] = this.tileToScreen(b.x + b.w / 2, b.y + b.h / 2, (BUILD_H[b.type] || 1.2) + 0.4);
      if (sx < -50 || sy < -50 || sx > this.W + 50 || sy > this.H + 50) continue;
      bar(sx, sy, Math.max(24, ppt * b.w * 0.6), b.hp / b.maxHp);
      if (b.level > 1) { g.fillStyle = '#f0c977'; g.font = '700 11px sans-serif'; g.textAlign = 'center'; g.fillText('★'.repeat(b.level - 1), sx, sy - 4); }
    }
    for (const u of G.s.units) {
      if (u.dead || (u.hp >= u.maxHp && !UI.sel.has(u.id))) continue;
      const [sx, sy] = this.tileToScreen(u.x, u.y, this.unitY(u) + (u.type === 'knight' ? 1.25 : 1.0));
      if (sx < -20 || sy < -20 || sx > this.W + 20 || sy > this.H + 20) continue;
      bar(sx, sy, Math.max(14, ppt * 0.45), u.hp / u.maxHp);
    }
    if (this.selRect) {
      const r = this.selRect;
      g.strokeStyle = 'rgba(255,236,180,0.95)'; g.lineWidth = 1.2;
      g.fillStyle = 'rgba(255,236,180,0.1)';
      const x = Math.min(r.x0, r.x1), y = Math.min(r.y0, r.y1), w = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0);
      g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
    }
  },

  // ======================================================================
  // Auswahl per Bildschirmpunkt
  // ======================================================================
  pickBuilding(sx, sy) {
    const meshes = [];
    for (const v of this.bviews.values()) meshes.push(v.mesh);
    this.ray(sx, sy);
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const h of hits) { const b = G.bmap.get(h.object.userData.bid); if (b) return b; }
    const [fx, fy] = this.screenToTile(sx, sy);
    const x = Math.floor(fx), y = Math.floor(fy);
    if (!World.inb(x, y)) return null;
    return G.bmap.get(World.occ[World.idx(x, y)]) || null;
  },
  unitScreen(u) { return this.tileToScreen(u.x, u.y, this.unitY(u) + 0.35); },

  // ======================================================================
  // Minikarte (Draufsicht, mit Kameradrehung)
  // ======================================================================
  buildMiniTerrain() {
    const n = World.n;
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d'), img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const col = TCOL[World.tile(x, y)][0], i = (y * n + x) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.miniTerrain = c;
  },
  miniXf(mc) {
    const n = World.n, S = Math.min(mc.width, mc.height * 2) * 0.98;
    const s = S / n / 1.4142;
    const a = -this.cam.yaw + Math.PI / 4 - Math.PI / 4; // Kartennorden wie Kamera
    const ca = Math.cos(this.cam.yaw - Math.PI / 4), sa = Math.sin(this.cam.yaw - Math.PI / 4);
    void a;
    // wie isometrisch: Bildschirm-x ~ (x - y), y ~ (x + y)/2, zusätzlich um Kameradrehung
    return {
      s, f: (x, y) => {
        let px = x - n / 2, py = y - n / 2;
        const rx = px * ca - py * sa, ry = px * sa + py * ca;
        return [mc.width / 2 + (rx - ry) * s, mc.height / 2 + (rx + ry) * s / 2];
      },
      inv: (mx, my) => {
        const u = (mx - mc.width / 2) / s, v = (my - mc.height / 2) * 2 / s;
        const rx = (u + v) / 2, ry = (v - u) / 2;
        const px = rx * ca + ry * sa, py = -rx * sa + ry * ca;
        return [px + n / 2, py + n / 2];
      },
    };
  },
  drawMini(mc) {
    if (!G.s || !this.miniTerrain || !mc.offsetParent) return;
    const g = mc.getContext('2d');
    const { s, f } = this.miniXf(mc);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, mc.width, mc.height);
    const o = f(0, 0), ex = f(1, 0), ey = f(0, 1);
    g.setTransform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.miniTerrain, 0, 0);
    const n = World.n;
    g.fillStyle = 'rgba(50,85,30,0.8)';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (World.trees[y * n + x]) g.fillRect(x, y, 1, 1);
    for (const b of G.s.buildings) { g.fillStyle = b.owner === 0 ? '#6f9bff' : '#ff6a52'; g.fillRect(b.x, b.y, b.w, b.h); }
    for (const u of G.s.units) { if (u.type === 'peasant') continue; g.fillStyle = u.owner === 0 ? '#d6e3ff' : '#ffc2b6'; g.fillRect(u.x - 0.7, u.y - 0.7, 1.4, 1.4); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const corners = [[0, 0], [this.W, 0], [this.W, this.H], [0, this.H]].map(([sx, sy]) => { const t = this.screenToTile(sx, sy); return f(U.clamp(t[0], -20, n + 20), U.clamp(t[1], -20, n + 20)); });
    g.strokeStyle = 'rgba(255,245,215,0.95)'; g.lineWidth = 1.2;
    g.beginPath(); corners.forEach((c, i) => i ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1])); g.closePath(); g.stroke();
    void s;
  },
  miniToTile(mc, mx, my) { return this.miniXf(mc).inv(mx, my); },

  // ======================================================================
  // Symbolbilder (eigener kleiner Renderer)
  // ======================================================================
  icon(type, size, kind) {
    size = size || 96;
    if (!this.iconR) {
      try {
        const c = document.createElement('canvas');
        this.iconR = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
        this.iconR.outputEncoding = THREE.sRGBEncoding;
        this.iconR.toneMapping = THREE.ACESFilmicToneMapping;
        this.iconR.setSize(size, size, false);
        this.iconScene = new THREE.Scene();
        this.iconScene.add(new THREE.HemisphereLight(0xdfeaff, 0xc9a46c, 1.0));
        const s = new THREE.DirectionalLight(0xffeedd, 1.4); s.position.set(-3, 6, 4); this.iconScene.add(s);
        this.iconCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
      } catch (e) { return ''; }
    }
    if (!this.mat) this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.86 });
    if (!this.geoCache) this.geoCache = new Map();
    const scene = this.iconScene;
    const obj = new THREE.Group();
    let w = 1, h = 1, H = 1;
    if (kind === 'unit') {
      const p = unitParts(type, PLAYER_COLORS[0]);
      obj.add(new THREE.Mesh(p.body, this.mat));
      if (p.extra.legs === 2) for (const s of [-1, 1]) { const l = new THREE.Mesh(this.legGeo(p.legCol, p.extra.legH), this.mat); l.position.set(s * 0.045, p.extra.legH, 0); obj.add(l); }
      if (p.extra.legs === 4) for (const [x, z] of [[-0.07, -0.22], [0.07, -0.22], [-0.07, 0.22], [0.07, 0.22]]) { const l = new THREE.Mesh(this.legGeo(0x5e3e22, p.extra.legH), this.mat); l.position.set(x, p.extra.legH, z); obj.add(l); }
      obj.rotation.y = 0.5;
      obj.position.set(0, 0, 0);
      w = h = 0; H = 0;
    } else {
      const D = BUILDINGS[type];
      const m = new THREE.Mesh(this.geoFor(type, 0, 1, type === 'wall' || type === 'palisade' ? '3' : type === 'stockpile' ? '221' : ''), this.mat);
      m.position.set(-D.w / 2, 0, -D.h / 2);
      obj.add(m);
      w = D.w; h = D.h; H = BUILD_H[type] || 1.2;
    }
    scene.add(obj);
    const isU = kind === 'unit';
    const ext = isU ? ({ knight: 0.62, ram: 0.7, catapult: 0.7, pike: 0.72 }[type] || 0.46) : Math.max(w, h) * 0.6 + H * 0.26;
    const cam = this.iconCam;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext; cam.updateProjectionMatrix();
    cam.position.set(6, 6 * 0.95, 6); cam.lookAt(0, isU ? ({ pike: 0.45, knight: 0.42 }[type] || 0.3) : H * 0.36, 0);
    this.iconR.setClearColor(0x000000, 0);
    this.iconR.render(scene, cam);
    const url = this.iconR.domElement.toDataURL();
    scene.remove(obj);
    return url;
  },
};
