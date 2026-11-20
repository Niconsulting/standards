'use strict';
// Isometrische Darstellung (Canvas 2D): Gelände pro Pixel, Schatten, zwischengespeicherte Gebäude-Sprites

const HW = TW / 2, HH = TH / 2;
function P(x, y) { return [(x - y) * HW, (x + y) * HH]; }

const TERRAIN_COL = {
  [T.SAND]: '#d8b878', [T.GRASS]: '#7d9a48', [T.ROCK]: '#8f887b', [T.IRON]: '#9b5d3e', [T.WATER]: '#3d7d9c',
};
// Grundfarben für die Pixel-Geländeberechnung [hell, dunkel]
const TCOL = {
  [T.SAND]: [[232, 199, 140], [204, 162, 103]],
  [T.GRASS]: [[132, 160, 76], [86, 118, 50]],
  [T.ROCK]: [[160, 152, 138], [112, 106, 96]],
  [T.IRON]: [[168, 98, 64], [118, 64, 42]],
  [T.WATER]: [[78, 160, 176], [30, 88, 124]],
};
const SPR_S = 2;           // Auflösung der Sprites
const BUILD_H = { keep: 118, stockpile: 22, granary: 48, woodcutter: 34, quarry: 46, mine: 34, orchard: 26, house: 44, chapel: 70, barracks: 46, wall: 34, gate: 44, tower: 66 };
const SHADOW_H = { keep: 100, stockpile: 6, granary: 40, woodcutter: 26, quarry: 14, mine: 22, orchard: 18, house: 32, chapel: 52, barracks: 36, wall: 30, gate: 38, tower: 60 };

const R = {
  cv: null, ctx: null, W: 0, H: 0, dpr: 1,
  cam: { x: 0, y: 0, z: 1 },
  terrain: null, shadow: null, ox: 0,
  hover: null, ghost: null, selRect: null,
  t: 0, cache: new Map(), shadowSig: '', shadowT: 0,

  init(cv) {
    this.cv = cv;
    this.ctx = cv.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
    this.cloud = this.makeCloud();
  },
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = this.cv.clientWidth; this.H = this.cv.clientHeight;
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.vignette = null;
  },

  centerOn(x, y) { const p = P(x, y); this.cam.x = p[0]; this.cam.y = p[1]; this.clampCam(); },
  clampCam() {
    const n = World.n;
    this.cam.x = U.clamp(this.cam.x, -n * HW, n * HW);
    this.cam.y = U.clamp(this.cam.y, 0, n * TH);
  },
  screenToWorld(sx, sy) { return [(sx - this.W / 2) / this.cam.z + this.cam.x, (sy - this.H / 2) / this.cam.z + this.cam.y]; },
  screenToTile(sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const a = wx / HW, b = wy / HH;
    return [(a + b) / 2, (b - a) / 2];
  },
  tileToScreen(x, y, z) {
    const p = P(x, y);
    return [(p[0] - this.cam.x) * this.cam.z + this.W / 2, (p[1] - (z || 0) - this.cam.y) * this.cam.z + this.H / 2];
  },

  // ======================================================================
  // Gelände: pro Pixel berechnet (weiche Übergänge, Dünen, Licht)
  // ======================================================================
  buildTerrain() {
    const n = World.n, seed = World.seed;
    this.cache.clear();
    this.ox = n * HW;
    const fullW = n * TW, fullH = n * TH + 8;
    const RS = 0.5;
    const lw = Math.ceil(fullW * RS), lh = Math.ceil(fullH * RS);
    // Felder in grober Auflösung vorberechnen
    const F = 4, fw = n * F + 3;
    const nzA = U.noise(seed + 101), nzB = U.noise(seed + 202), nzC = U.noise(seed + 303), nzD = U.noise(seed + 404), nzE = U.noise(seed + 505);
    const hgt = new Float32Array(fw * fw), pqx = new Float32Array(fw * fw), pqy = new Float32Array(fw * fw), det = new Float32Array(fw * fw);
    for (let j = 0; j < fw; j++) for (let i = 0; i < fw; i++) {
      const x = i / F, y = j / F, k = j * fw + i;
      hgt[k] = U.fbm(nzA, x / 5, y / 5, 3) * 1.0 + U.fbm(nzB, x / 1.8, y / 1.8, 2) * 0.25;
      pqx[k] = (U.fbm(nzC, x / 1.6, y / 1.6, 2) - 0.5) * 0.9;
      pqy[k] = (U.fbm(nzD, x / 1.6 + 40, y / 1.6, 2) - 0.5) * 0.9;
      det[k] = U.fbm(nzE, x * 0.9, y * 0.9, 3);
    }
    const samp = (arr, x, y) => {
      x = U.clamp(x * F, 0, fw - 2.001); y = U.clamp(y * F, 0, fw - 2.001);
      const i = x | 0, j = y | 0, u = x - i, v = y - j, k = j * fw + i;
      return arr[k] * (1 - u) * (1 - v) + arr[k + 1] * u * (1 - v) + arr[k + fw] * (1 - u) * v + arr[k + fw + 1] * u * v;
    };
    // Wassertiefe: Abstand zum Ufer (Breitensuche)
    const depth = new Float32Array(n * n);
    {
      const q = [];
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
    }
    const img = new ImageData(lw, lh);
    const px = img.data;
    const tiles = World.tiles;
    const tt = (x, y) => tiles[U.clamp(y, 0, n - 1) * n + U.clamp(x, 0, n - 1)];
    const dep = (x, y) => depth[U.clamp(y, 0, n - 1) * n + U.clamp(x, 0, n - 1)];
    const acc = [0, 0, 0, 0, 0];
    for (let py = 0; py < lh; py++) {
      const wy = py / RS;
      for (let pxx = 0; pxx < lw; pxx++) {
        const wx = pxx / RS - this.ox;
        const a = wx / HW, b = wy / HH;
        const tx = (a + b) / 2, ty = (b - a) / 2;
        if (tx < -0.02 || ty < -0.02 || tx > n + 0.02 || ty > n + 0.02) continue;
        // Koordinaten verwirbeln für natürliche Ränder
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
        const g1 = U.hash(pxx, py, 9) - 0.5; // Körnung
        let r = 0, gg = 0, bb = 0;
        for (let k = 0; k < 5; k++) {
          const w = acc[k];
          if (w <= 0) continue;
          const c0 = TCOL[k][0], c1 = TCOL[k][1];
          let m = d;
          if (k === T.ROCK || k === T.IRON) m = U.clamp(d * 0.6 + (U.hash(pxx >> 1, py >> 1, 3) - 0.5) * 0.6 + 0.2, 0, 1);
          else if (k === T.GRASS) m = U.clamp(d * 1.3 - 0.15 + g1 * 0.3, 0, 1);
          else if (k === T.WATER) {
            const dd = dep(i0, j0) * (1 - fu) * (1 - fv) + dep(i0 + 1, j0) * fu * (1 - fv) + dep(i0, j0 + 1) * (1 - fu) * fv + dep(i0 + 1, j0 + 1) * fu * fv;
            m = U.clamp(dd / 3.2, 0, 1);
          }
          r += w * (c0[0] + (c1[0] - c0[0]) * m);
          gg += w * (c0[1] + (c1[1] - c0[1]) * m);
          bb += w * (c0[2] + (c1[2] - c0[2]) * m);
        }
        // Licht aus Dünenhöhe (Licht von links oben)
        const ww = acc[T.WATER];
        const e = 0.12;
        const dhx = samp(hgt, tx + e, ty) - samp(hgt, tx - e, ty);
        const dhy = samp(hgt, tx, ty + e) - samp(hgt, tx, ty - e);
        const sandish = acc[T.SAND] + acc[T.IRON] * 0.6 + acc[T.ROCK] * 0.8 + acc[T.GRASS] * 0.4;
        let L = 1 + (-dhx * 2.6 - dhy * 1.2) * sandish;
        // Ufer: heller Saum
        if (ww > 0.25 && ww < 0.62) { const f = 1 - Math.abs(ww - 0.43) / 0.19; r += 50 * f; gg += 45 * f; bb += 30 * f; }
        // Ufer an Land leicht feucht/dunkel
        if (ww > 0.02 && ww <= 0.25) L *= 1 - ww * 0.6;
        const gr = g1 * 9;
        const o = (py * lw + pxx) * 4;
        px[o] = U.clamp(r * L + gr, 0, 255);
        px[o + 1] = U.clamp(gg * L + gr, 0, 255);
        px[o + 2] = U.clamp(bb * L + gr * 0.8, 0, 255);
        px[o + 3] = 255;
      }
    }
    const low = document.createElement('canvas');
    low.width = lw; low.height = lh;
    low.getContext('2d').putImageData(img, 0, 0);
    const c = document.createElement('canvas');
    c.width = fullW; c.height = fullH;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(low, 0, 0, fullW, fullH);
    g.translate(this.ox, 0);
    this.drawTerrainDetails(g);
    // Kartenrand abdunkeln
    g.globalCompositeOperation = 'source-atop';
    const edge = (x0, y0, x1, y1) => {
      const a = P(x0, y0), b = P(x1, y1);
      const gr2 = g.createLinearGradient(a[0], a[1], b[0], b[1]);
      gr2.addColorStop(0, 'rgba(40,25,12,0.55)'); gr2.addColorStop(1, 'rgba(40,25,12,0)');
      return gr2;
    };
    for (const [x0, y0, x1, y1] of [[0, n / 2, 1.5, n / 2], [n, n / 2, n - 1.5, n / 2], [n / 2, 0, n / 2, 1.5], [n / 2, n, n / 2, n - 1.5]]) {
      g.fillStyle = edge(x0, y0, x1, y1);
      g.fillRect(-this.ox, 0, fullW, fullH);
    }
    g.globalCompositeOperation = 'source-over';
    this.terrain = c;
    this.depth = depth;
    this.buildMiniTerrain();
    this.shadowSig = '';
  },

  drawTerrainDetails(g) {
    const n = World.n, seed = World.seed;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = World.tile(x, y);
      const r = k => U.hash(x * 17 + k, y * 31 + k * 7, seed + k);
      if (t === T.SAND) {
        if (r(1) < 0.5) {
          const p = P(x + 0.2 + r(2) * 0.6, y + 0.2 + r(3) * 0.6);
          const L = 6 + r(4) * 8;
          g.strokeStyle = 'rgba(140,100,55,0.28)'; g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(p[0] - L, p[1] + 1); g.quadraticCurveTo(p[0], p[1] - 3, p[0] + L, p[1] + 1); g.stroke();
          g.strokeStyle = 'rgba(255,240,205,0.35)'; g.lineWidth = 1;
          g.beginPath(); g.moveTo(p[0] - L, p[1]); g.quadraticCurveTo(p[0], p[1] - 4, p[0] + L, p[1]); g.stroke();
        }
        if (r(5) < 0.14) this.pebble(g, x + r(6), y + r(7), 1.5 + r(8) * 2, '#9c8462');
        if (r(9) < 0.03) this.dryBush(g, x + 0.5, y + 0.5, r(10));
      } else if (t === T.GRASS) {
        for (let j = 0; j < 6; j++) {
          const p = P(x + r(j + 1), y + r(j + 9));
          const h = 3 + r(j + 20) * 4;
          g.strokeStyle = j % 2 ? 'rgba(60,95,32,0.85)' : 'rgba(150,180,80,0.7)'; g.lineWidth = 1;
          g.beginPath(); g.moveTo(p[0] - 2, p[1]); g.lineTo(p[0] - 2.5, p[1] - h); g.moveTo(p[0], p[1]); g.lineTo(p[0] + 0.5, p[1] - h - 1); g.moveTo(p[0] + 2, p[1]); g.lineTo(p[0] + 3, p[1] - h * 0.8); g.stroke();
        }
        if (r(30) < 0.08) {
          const p = P(x + r(31), y + r(32));
          g.fillStyle = ['#e8d45a', '#f3f0e6', '#d9604a'][(r(33) * 3) | 0];
          for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(p[0] + k * 3 - 3, p[1] - 4 - (k % 2) * 2, 1.2, 0, 7); g.fill(); }
        }
      } else if (t === T.ROCK || t === T.IRON) {
        const cnt = 2 + ((r(0) * 3) | 0);
        for (let j = 0; j < cnt; j++) {
          const s = 3 + r(j + 3) * 7;
          this.boulder(g, x + 0.15 + r(j + 1) * 0.7, y + 0.15 + r(j + 5) * 0.7, s, t === T.ROCK ? '#a59d8e' : '#8a4f34', r(j + 11));
        }
        if (t === T.IRON && r(40) < 0.5) {
          const p = P(x + r(41), y + r(42));
          g.fillStyle = 'rgba(255,170,110,0.7)'; g.fillRect(p[0], p[1] - 2, 1.5, 1.5);
        }
      }
    }
  },
  pebble(g, x, y, s, col) {
    const p = P(x, y);
    g.fillStyle = 'rgba(60,40,20,0.25)';
    g.beginPath(); g.ellipse(p[0] + 1, p[1] + 1, s * 1.2, s * 0.6, 0, 0, 7); g.fill();
    g.fillStyle = col;
    g.beginPath(); g.ellipse(p[0], p[1], s, s * 0.6, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,245,220,0.35)';
    g.beginPath(); g.ellipse(p[0] - s * 0.3, p[1] - s * 0.2, s * 0.45, s * 0.25, 0, 0, 7); g.fill();
  },
  boulder(g, x, y, s, col, h) {
    const p = P(x, y);
    g.fillStyle = 'rgba(40,30,20,0.3)';
    g.beginPath(); g.ellipse(p[0] + s * 0.5, p[1] + 1, s * 1.3, s * 0.5, 0, 0, 7); g.fill();
    const pts = [[-s, 0], [-s * 0.7, -s * 0.7], [-s * 0.1, -s * (0.9 + h * 0.3)], [s * 0.6, -s * 0.6], [s, 0], [s * 0.3, s * 0.35], [-s * 0.5, s * 0.3]];
    g.fillStyle = U.shade(col, -0.15);
    g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(p[0] + q[0], p[1] + q[1]) : g.moveTo(p[0] + q[0], p[1] + q[1])); g.closePath(); g.fill();
    g.fillStyle = U.shade(col, 0.12);
    g.beginPath(); g.moveTo(p[0] - s, p[1]); g.lineTo(p[0] - s * 0.7, p[1] - s * 0.7); g.lineTo(p[0] - s * 0.1, p[1] - s * (0.9 + h * 0.3)); g.lineTo(p[0] + s * 0.1, p[1] - s * 0.1); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(40,30,20,0.35)'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(p[0] - s * 0.1, p[1] - s * (0.9 + h * 0.3)); g.lineTo(p[0] + s * 0.1, p[1] - s * 0.1); g.lineTo(p[0] + s * 0.3, p[1] + s * 0.35); g.stroke();
  },
  dryBush(g, x, y, h) {
    const p = P(x, y);
    g.strokeStyle = '#7a6440'; g.lineWidth = 1;
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI / 2 + (k - 3) * 0.35 + h;
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + Math.cos(a) * 7, p[1] + Math.sin(a) * 6); g.stroke();
    }
  },

  // ======================================================================
  // Schattenebene (halbe Auflösung, weich), neu bei Änderungen
  // ======================================================================
  updateShadows() {
    let sum = 0;
    for (const b of G.s.buildings) sum += b.id * 7 + b.x;
    let trees = 0;
    for (let i = 0; i < World.trees.length; i++) if (World.trees[i]) trees += i;
    const sig = G.s.buildings.length + ':' + sum + ':' + trees;
    if (sig === this.shadowSig) return;
    this.shadowSig = sig;
    const n = World.n;
    const W = n * HW, H = n * HH + 4;
    if (!this.shadow) { this.shadow = document.createElement('canvas'); }
    if (this.shadow.width !== W) { this.shadow.width = W; this.shadow.height = H; }
    const g = this.shadow.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    const OFF = W + 200;
    g.setTransform(0.5, 0, 0, 0.5, this.ox * 0.5 - OFF, 0);
    g.shadowColor = 'rgba(0,0,0,1)';
    g.shadowBlur = 5;
    g.shadowOffsetX = OFF;
    g.fillStyle = '#000';
    g.beginPath();
    for (const b of G.s.buildings) this.shadowHull(g, b.x, b.y, b.w, b.h, SHADOW_H[b.type] || 20, b.type);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!World.trees[y * n + x]) continue;
      const p = P(x + 0.5, y + 0.5);
      const s = 0.8 + Math.min(8, World.trees[y * n + x]) / 8 * 0.3;
      g.moveTo(p[0] + 34 * s, p[1] + 8 * s);
      g.ellipse(p[0] + 20 * s, p[1] + 6 * s, 15 * s, 6 * s, 0.25, 0, Math.PI * 2);
    }
    g.fill();
  },
  shadowHull(g, x, y, w, d, h, type) {
    const ins = type === 'wall' || type === 'gate' ? 0 : 0.12;
    const f = [P(x + ins, y + ins), P(x + w - ins, y + ins), P(x + w - ins, y + d - ins), P(x + ins, y + d - ins)];
    const sx = h * 0.85, sy = h * 0.32;
    const pts = f.concat(f.map(q => [q[0] + sx, q[1] + sy]));
    const hull = this.hull(pts);
    hull.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]));
    g.closePath();
  },
  hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop();
    return lo.concat(up);
  },

  makeCloud() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    const rnd = U.rng(7);
    for (let i = 0; i < 9; i++) {
      const x = 120 + rnd() * 270, y = 80 + rnd() * 100, r = 50 + rnd() * 60;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(20,12,4,0.5)'); gr.addColorStop(1, 'rgba(20,12,4,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    return c;
  },
  makeVignette() {
    const c = document.createElement('canvas');
    c.width = this.cv.width; c.height = this.cv.height;
    const g = c.getContext('2d');
    const w = c.width, h = c.height;
    const gr = g.createRadialGradient(w / 2, h * 0.48, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(25,12,0,0.5)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const g2 = g.createLinearGradient(0, 0, 0, h);
    g2.addColorStop(0, 'rgba(255,200,120,0.08)'); g2.addColorStop(0.5, 'rgba(255,200,120,0)');
    g.fillStyle = g2; g.fillRect(0, 0, w, h);
    return c;
  },

  // ======================================================================
  // Bild
  // ======================================================================
  frame(dt) {
    this.t += dt;
    const g = this.ctx, z = this.cam.z, dpr = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1b140e';
    g.fillRect(0, 0, this.cv.width, this.cv.height);
    if (!G.s || !this.terrain) return;
    this.shadowT -= dt;
    if (this.shadowT <= 0) { this.shadowT = 0.4; this.updateShadows(); }
    const ox = dpr * (this.W / 2 - this.cam.x * z), oy = dpr * (this.H / 2 - this.cam.y * z);
    g.setTransform(dpr * z, 0, 0, dpr * z, ox, oy);
    const [wx0, wy0] = this.screenToWorld(0, 0), [wx1, wy1] = this.screenToWorld(this.W, this.H);
    this.view = { x0: wx0 - 90, y0: wy0 - 40, x1: wx1 + 90, y1: wy1 + 140 };
    g.imageSmoothingEnabled = true;
    const sx = U.clamp(wx0 + this.ox, 0, this.terrain.width), sy = U.clamp(wy0, 0, this.terrain.height);
    const ex = U.clamp(wx1 + this.ox, 0, this.terrain.width), ey = U.clamp(wy1, 0, this.terrain.height);
    if (ex > sx && ey > sy) {
      g.drawImage(this.terrain, sx, sy, ex - sx, ey - sy, sx - this.ox, sy, ex - sx, ey - sy);
      if (this.shadow) {
        g.globalAlpha = 0.4;
        g.drawImage(this.shadow, sx / 2, sy / 2, (ex - sx) / 2, (ey - sy) / 2, sx - this.ox, sy, ex - sx, ey - sy);
        g.globalAlpha = 1;
      }
    }
    this.drawWater(g);
    this.drawOverlays(g);
    this.drawObjects(g);
    this.drawProjectiles(g);
    this.drawGhost(g);
    this.drawClouds(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (!this.vignette) this.vignette = this.makeVignette();
    g.drawImage(this.vignette, 0, 0);
    if (this.selRect) {
      const r = this.selRect;
      g.strokeStyle = 'rgba(255,236,180,0.95)'; g.lineWidth = dpr * 1.2;
      g.fillStyle = 'rgba(255,236,180,0.1)';
      const x = Math.min(r.x0, r.x1) * dpr, y = Math.min(r.y0, r.y1) * dpr, w = Math.abs(r.x1 - r.x0) * dpr, h = Math.abs(r.y1 - r.y0) * dpr;
      g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
    }
  },

  visible(wx, wy) { const v = this.view; return wx > v.x0 && wx < v.x1 && wy > v.y0 && wy < v.y1; },

  drawClouds(g) {
    const n = World.n, span = n * TW + 1400;
    for (let i = 0; i < 4; i++) {
      const h = U.hash(i, 3, World.seed);
      const x = ((this.t * (9 + h * 6) + h * span) % span) - n * HW - 700;
      const y = (0.15 + 0.7 * U.hash(i, 9, World.seed)) * n * TH;
      if (!this.visible(x, y) && !this.visible(x + 1000, y) && !this.visible(x - 1000, y)) continue;
      g.globalAlpha = 0.1;
      g.drawImage(this.cloud, x - 500, y - 250, 1000, 500);
    }
    g.globalAlpha = 1;
  },

  drawWater(g) {
    const n = World.n, t = this.t;
    g.lineWidth = 1.2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (World.tile(x, y) !== T.WATER) continue;
      const p = P(x + 0.5, y + 0.5);
      if (!this.visible(p[0], p[1])) continue;
      const h = U.hash(x, y, 5);
      const ph = h * 6 + t * 0.9;
      const a = Math.max(0, Math.sin(ph));
      g.strokeStyle = 'rgba(220,245,255,' + (0.45 * a) + ')';
      const o = Math.cos(ph) * 5;
      g.beginPath(); g.moveTo(p[0] - 9 + o, p[1] - 3); g.quadraticCurveTo(p[0] - 4 + o, p[1] - 5, p[0] + 1 + o, p[1] - 3); g.stroke();
      if (h > 0.7) {
        const s = Math.max(0, Math.sin(t * 3 + h * 40));
        g.fillStyle = 'rgba(255,255,240,' + (s * s * 0.8) + ')';
        g.fillRect(p[0] + 6, p[1] + 2, 1.6, 1.6);
      }
    }
  },

  drawOverlays(g) {
    const sb = G.bmap.get(UI.selB);
    if (sb) {
      g.strokeStyle = sb.owner === 0 ? 'rgba(255,236,170,0.95)' : 'rgba(255,120,100,0.95)';
      g.lineWidth = 2 / this.cam.z;
      g.setLineDash([8 / this.cam.z, 5 / this.cam.z]);
      g.lineDashOffset = -this.t * 20;
      this.rectPath(g, sb.x - 0.08, sb.y - 0.08, sb.w + 0.16, sb.h + 0.16); g.stroke();
      g.setLineDash([]);
    }
    for (const id of UI.sel) {
      const u = G.umap.get(id);
      if (!u) continue;
      const p = P(u.x, u.y);
      const y = p[1] - (u.z || 0);
      g.fillStyle = 'rgba(255,230,150,0.18)';
      g.beginPath(); g.ellipse(p[0], y, 12, 6, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,236,170,0.95)'; g.lineWidth = 1.6;
      g.beginPath(); g.ellipse(p[0], y, 12, 6, 0, 0, 7); g.stroke();
    }
    if (this.hover && UI.mode === 'select' && !UI.touch) {
      g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1;
      this.diamond(g, this.hover.x, this.hover.y); g.stroke();
    }
  },

  drawObjects(g) {
    const list = [];
    const n = World.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (!World.trees[i]) continue;
      const p = P(x + 0.5, y + 0.5);
      if (!this.visible(p[0], p[1])) continue;
      list.push({ d: x + y + 1, k: 0, x, y, i });
    }
    for (const b of G.s.buildings) {
      const p = P(b.x + b.w / 2, b.y + b.h / 2);
      if (!this.visible(p[0], p[1] - 60)) continue;
      list.push({ d: b.x + b.y + (b.w + b.h) / 2, k: 1, b });
    }
    for (const u of G.s.units) {
      if (u.dead) continue;
      const p = P(u.x, u.y);
      if (!this.visible(p[0], p[1])) continue;
      let d = u.x + u.y;
      if (u.tower) { const t = G.bmap.get(u.tower); if (t) d = t.x + t.y + (t.w + t.h) / 2 + 0.05 + (u.x + u.y) * 0.001; }
      list.push({ d, k: 2, u });
    }
    for (const p of G.s.players) if (p.fire) list.push({ d: p.fire.x + p.fire.y + 1, k: 3, f: p.fire });
    for (const f of G.fx) list.push({ d: f.x + f.y + (f.k === 'rubble' ? 0 : 0.5), k: 4, f });
    list.sort((a, b) => a.d - b.d);
    for (const o of list) {
      if (o.k === 0) this.drawTree(g, o.x, o.y, World.trees[o.i], World.tile(o.x, o.y));
      else if (o.k === 1) this.drawBuilding(g, o.b, 1);
      else if (o.k === 2) this.drawUnit(g, o.u);
      else if (o.k === 3) this.drawFire(g, o.f);
      else this.drawFx(g, o.f);
    }
    for (const o of list) {
      if (o.k === 1) {
        const b = o.b;
        if (b.hp < b.maxHp || UI.selB === b.id) {
          const p = P(b.x + b.w / 2, b.y + b.h / 2);
          this.bar(g, p[0], p[1] - (BUILD_H[b.type] || 30) - 10, 36, b.hp / b.maxHp);
        }
      } else if (o.k === 2) {
        const u = o.u;
        if (u.hp < u.maxHp || UI.sel.has(u.id)) {
          const p = P(u.x, u.y);
          this.bar(g, p[0], p[1] - (u.z || 0) - (u.type === 'knight' ? 40 : 33), 18, u.hp / u.maxHp);
        }
      }
    }
  },

  bar(g, x, y, w, f) {
    f = U.clamp(f, 0, 1);
    g.fillStyle = 'rgba(15,8,4,0.75)'; g.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
    g.fillStyle = f > 0.5 ? '#79d457' : f > 0.25 ? '#e8b63e' : '#e04a32';
    g.fillRect(x - w / 2, y, w * f, 3);
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(x - w / 2, y, w * f, 1);
  },

  // ======================================================================
  // Grundformen
  // ======================================================================
  diamond(g, x, y, s) {
    s = s || 1;
    const cx = x + 0.5, cy = y + 0.5, h = s / 2;
    const a = P(cx - h, cy - h), b = P(cx + h, cy - h), c = P(cx + h, cy + h), d = P(cx - h, cy + h);
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath();
  },
  rectPath(g, x, y, w, h) {
    const a = P(x, y), b = P(x + w, y), c = P(x + w, y + h), d = P(x, y + h);
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath();
  },
  path(g, pts) { g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); },
  poly(g, pts, fill) { this.path(g, pts); g.fillStyle = fill; g.fill(); },
  vgrad(g, y0, y1, c0, c1) { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, c0); gr.addColorStop(1, c1); return gr; },

  // Quader mit Verlauf und optionaler Textur ('stone' | 'wood' | 'plaster')
  box(g, x, y, w, d, z0, h, col, tex, topCol) {
    const A = P(x, y), B = P(x + w, y), C = P(x + w, y + d), D = P(x, y + d);
    const lo = z0, hi = z0 + h;
    const L = [[D[0], D[1] - lo], [C[0], C[1] - lo], [C[0], C[1] - hi], [D[0], D[1] - hi]];
    const Rr = [[C[0], C[1] - lo], [B[0], B[1] - lo], [B[0], B[1] - hi], [C[0], C[1] - hi]];
    this.path(g, L); g.fillStyle = this.vgrad(g, D[1] - hi, D[1] - lo, U.shade(col, 0.04), U.shade(col, -0.2)); g.fill();
    if (tex) this.texture(g, D, C, lo, hi, w, tex, 0);
    this.path(g, Rr); g.fillStyle = this.vgrad(g, B[1] - hi, C[1] - lo, U.shade(col, -0.26), U.shade(col, -0.44)); g.fill();
    if (tex) this.texture(g, C, B, lo, hi, d, tex, 1);
    this.poly(g, [[A[0], A[1] - hi], [B[0], B[1] - hi], [C[0], C[1] - hi], [D[0], D[1] - hi]], topCol || U.shade(col, 0.14));
    // Kanten
    g.lineWidth = 0.8;
    g.strokeStyle = 'rgba(255,248,230,0.28)';
    g.beginPath(); g.moveTo(D[0], D[1] - hi); g.lineTo(C[0], C[1] - hi); g.lineTo(B[0], B[1] - hi); g.stroke();
    g.strokeStyle = 'rgba(30,18,8,0.35)';
    g.beginPath(); g.moveTo(C[0], C[1] - lo); g.lineTo(C[0], C[1] - hi); g.stroke();
  },
  texture(g, P0, P1, lo, hi, len, tex, side) {
    g.save();
    this.path(g, [[P0[0], P0[1] - lo], [P1[0], P1[1] - lo], [P1[0], P1[1] - hi], [P0[0], P0[1] - hi]]);
    g.clip();
    const lerp = t => [P0[0] + (P1[0] - P0[0]) * t, P0[1] + (P1[1] - P0[1]) * t];
    if (tex === 'stone') {
      const rh = 6.5;
      let row = 0;
      for (let z = lo; z < hi; z += rh, row++) {
        g.strokeStyle = 'rgba(70,52,34,0.28)'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(P0[0], P0[1] - z); g.lineTo(P1[0], P1[1] - z); g.stroke();
        const seg = 0.34;
        for (let t = (row % 2) * seg / 2; t < len; t += seg) {
          const q = lerp(t / len);
          g.beginPath(); g.moveTo(q[0], q[1] - z); g.lineTo(q[0], q[1] - z - rh); g.stroke();
        }
        g.strokeStyle = 'rgba(255,245,220,0.09)';
        g.beginPath(); g.moveTo(P0[0], P0[1] - z - 1); g.lineTo(P1[0], P1[1] - z - 1); g.stroke();
      }
      // leichte Fleckung
      for (let k = 0; k < len * 6; k++) {
        const h1 = U.hash(k, side, len * 13 + hi), h2 = U.hash(side, k, lo + 3);
        const q = lerp(h1);
        g.fillStyle = h2 > 0.5 ? 'rgba(255,245,225,0.08)' : 'rgba(40,28,16,0.08)';
        g.fillRect(q[0] - 3, q[1] - lo - h2 * (hi - lo) - 2, 6, 3);
      }
    } else if (tex === 'wood') {
      g.strokeStyle = 'rgba(45,26,12,0.35)'; g.lineWidth = 0.8;
      for (let t = 0.12; t < len; t += 0.14) {
        const q = lerp(t / len);
        g.beginPath(); g.moveTo(q[0], q[1] - lo); g.lineTo(q[0], q[1] - hi); g.stroke();
      }
      g.strokeStyle = 'rgba(255,230,190,0.08)';
      for (let t = 0.14; t < len; t += 0.14) {
        const q = lerp(t / len);
        g.beginPath(); g.moveTo(q[0], q[1] - lo); g.lineTo(q[0], q[1] - hi); g.stroke();
      }
    } else if (tex === 'plaster') {
      g.fillStyle = this.vgrad(g, P0[1] - lo - 8, P0[1] - lo, 'rgba(120,90,55,0)', 'rgba(120,90,55,0.35)');
      g.fillRect(Math.min(P0[0], P1[0]) - 2, Math.min(P0[1], P1[1]) - hi, Math.abs(P1[0] - P0[0]) + 4, hi - lo + Math.abs(P1[1] - P0[1]) + 2);
    }
    g.restore();
  },
  merlons(g, x, y, w, d, z, col, step) {
    step = step || 0.34;
    const s = 0.17, h = 6.5;
    const pts = [];
    for (let t = 0; t <= w - s + 0.001; t += step) { pts.push([x + t, y]); pts.push([x + t, y + d - s]); }
    for (let t = step; t <= d - s - step + 0.001; t += step) { pts.push([x, y + t]); pts.push([x + w - s, y + t]); }
    pts.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    // Wehrgang
    this.poly(g, [P(x + s, y + s), P(x + w - s, y + s), P(x + w - s, y + d - s), P(x + s, y + d - s)].map(q => [q[0], q[1] - z]), U.shade(col, -0.18));
    for (const [mx, my] of pts) this.box(g, mx, my, s, s, z, h, col);
  },
  pyramid(g, x, y, w, d, z, rh, col, lines) {
    const A = P(x, y), B = P(x + w, y), C = P(x + w, y + d), D = P(x, y + d);
    const M = P(x + w / 2, y + d / 2);
    const ap = [M[0], M[1] - z - rh];
    const up = q => [q[0], q[1] - z];
    const faces = [[up(A), up(B), U.shade(col, 0.16)], [up(A), up(D), U.shade(col, 0.06)], [up(D), up(C), U.shade(col, -0.06)], [up(C), up(B), U.shade(col, -0.32)]];
    for (const [e1, e2, c] of faces) {
      this.poly(g, [e1, e2, ap], c);
      if (lines !== false) {
        g.strokeStyle = 'rgba(40,24,10,0.22)'; g.lineWidth = 0.8;
        for (let k = 1; k < 5; k++) {
          const f = k / 5;
          g.beginPath();
          g.moveTo(e1[0] + (ap[0] - e1[0]) * f, e1[1] + (ap[1] - e1[1]) * f);
          g.lineTo(e2[0] + (ap[0] - e2[0]) * f, e2[1] + (ap[1] - e2[1]) * f);
          g.stroke();
        }
      }
    }
    g.strokeStyle = 'rgba(30,18,8,0.4)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(up(D)[0], up(D)[1]); g.lineTo(up(C)[0], up(C)[1]); g.lineTo(up(B)[0], up(B)[1]); g.stroke();
  },
  gable(g, x, y, w, d, z, rh, col, wallCol) {
    const A = P(x, y), B = P(x + w, y), C = P(x + w, y + d), D = P(x, y + d);
    const R1 = P(x, y + d / 2), R2 = P(x + w, y + d / 2);
    const up = (q, e) => [q[0], q[1] - z - (e || 0)];
    this.poly(g, [up(A), up(B), up(R2, rh), up(R1, rh)], U.shade(col, 0.12));
    const front = [up(D), up(C), up(R2, rh), up(R1, rh)];
    this.path(g, front);
    g.fillStyle = this.vgrad(g, up(R1, rh)[1], up(D)[1], U.shade(col, 0.02), U.shade(col, -0.14)); g.fill();
    // Ziegelreihen
    g.strokeStyle = 'rgba(40,20,8,0.28)'; g.lineWidth = 0.8;
    for (let k = 1; k < 5; k++) {
      const f = k / 5;
      const a = [up(D)[0] + (up(R1, rh)[0] - up(D)[0]) * f, up(D)[1] + (up(R1, rh)[1] - up(D)[1]) * f];
      const b = [up(C)[0] + (up(R2, rh)[0] - up(C)[0]) * f, up(C)[1] + (up(R2, rh)[1] - up(C)[1]) * f];
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
    for (let t = 0.15; t < w; t += 0.2) {
      const a = P(x + t, y + d), b = P(x + t, y + d / 2);
      g.beginPath(); g.moveTo(a[0], a[1] - z); g.lineTo(b[0], b[1] - z - rh); g.stroke();
    }
    this.poly(g, [up(C), up(B), up(R2, rh)], U.shade(wallCol || col, -0.3));
    g.strokeStyle = 'rgba(255,240,210,0.25)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(up(R1, rh)[0], up(R1, rh)[1]); g.lineTo(up(R2, rh)[0], up(R2, rh)[1]); g.stroke();
  },
  flag(g, x, y, z, color, size) {
    size = size || 1;
    const p = P(x, y);
    const top = p[1] - z - 28 * size;
    g.strokeStyle = '#3b2b1b'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(p[0], p[1] - z); g.lineTo(p[0], top - 2); g.stroke();
    g.fillStyle = '#d6a54a'; g.beginPath(); g.arc(p[0], top - 2, 1.6, 0, 7); g.fill();
    const t = this.t * 4 + x * 3;
    const wv = k => Math.sin(t - k * 2.2) * 2.4 * k;
    const L = 17 * size, Hh = 11 * size;
    g.beginPath();
    g.moveTo(p[0], top);
    for (let k = 0.25; k <= 1.001; k += 0.25) g.lineTo(p[0] + L * k, top + wv(k));
    for (let k = 1; k >= 0; k -= 0.25) g.lineTo(p[0] + L * k, top + Hh + wv(k) - (k === 1 ? 2 : 0));
    g.closePath();
    const gr = g.createLinearGradient(p[0], top, p[0] + L, top);
    gr.addColorStop(0, U.shade(color, -0.15)); gr.addColorStop(0.5, U.shade(color, 0.12)); gr.addColorStop(1, U.shade(color, -0.1));
    g.fillStyle = gr; g.fill();
    g.fillStyle = 'rgba(255,230,160,0.85)';
    g.beginPath(); g.arc(p[0] + L * 0.45, top + Hh / 2 + wv(0.45), 2.2 * size, 0, 7); g.fill();
  },
  // Fenster auf linker (face 0, entlang x) oder rechter (face 1, entlang y) Fassade
  window(g, x, y, z, face, warm) {
    const a = P(x, y), b = face ? P(x, y + 0.16) : P(x + 0.16, y);
    const h = 9;
    g.fillStyle = 'rgba(60,45,30,0.6)';
    this.path(g, [[a[0] - 1, a[1] - z + 1], [b[0] + 1, b[1] - z + 1], [b[0] + 1, b[1] - z - h], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - z - h - 4], [a[0] - 1, a[1] - z - h]]); g.fill();
    g.fillStyle = warm ? 'rgba(255,190,90,0.85)' : '#24180f';
    this.path(g, [[a[0], a[1] - z], [b[0], b[1] - z], [b[0], b[1] - z - h + 1], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - z - h - 2.5], [a[0], a[1] - z - h + 1]]); g.fill();
  },
  door(g, x, y, w, h, face) {
    const a = P(x, y), b = face ? P(x, y + w) : P(x + w, y);
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    g.fillStyle = 'rgba(70,55,40,0.7)';
    g.beginPath(); g.moveTo(a[0] - 1.5, a[1] + 0.5); g.lineTo(b[0] + 1.5, b[1] + 0.5); g.lineTo(b[0] + 1.5, b[1] - h * 0.75);
    g.quadraticCurveTo(m[0], m[1] - h * 1.25, a[0] - 1.5, a[1] - h * 0.75); g.closePath(); g.fill();
    g.fillStyle = '#5a3a20';
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(b[0], b[1] - h * 0.75);
    g.quadraticCurveTo(m[0], m[1] - h * 1.15, a[0], a[1] - h * 0.75); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(25,14,6,0.55)'; g.lineWidth = 0.8;
    for (let k = 1; k < 4; k++) {
      const q = [a[0] + (b[0] - a[0]) * k / 4, a[1] + (b[1] - a[1]) * k / 4];
      g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0], q[1] - h * 0.85); g.stroke();
    }
    g.fillStyle = '#c9a050'; g.fillRect(m[0] + 1, m[1] - h * 0.4, 1.4, 1.4);
  },
  ao(g, x, y, w, d) {
    // weiche Bodenverdunkelung unter einem Gebäude
    g.save();
    g.shadowColor = 'rgba(30,18,6,0.55)'; g.shadowBlur = 7 * SPR_S;
    g.fillStyle = 'rgba(30,18,6,0.35)';
    this.rectPath(g, x, y, w, d); g.fill();
    g.restore();
  },

  // ======================================================================
  // Bäume (Sprites)
  // ======================================================================
  treeSprite(kind, v) {
    const key = 'tree:' + kind + v;
    let s = this.cache.get(key);
    if (s) return s;
    const bx = -40, by = -70, bw = 80, bh = 80;
    const c = document.createElement('canvas');
    c.width = bw * SPR_S; c.height = bh * SPR_S;
    const g = c.getContext('2d');
    g.scale(SPR_S, SPR_S); g.translate(-bx, -by);
    const h = U.hash(v, kind === 'palm' ? 1 : 2, 77);
    if (kind === 'leaf') {
      g.strokeStyle = '#5a3c22'; g.lineWidth = 3.2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -16); g.moveTo(0, -11); g.lineTo(-5, -18); g.moveTo(0, -13); g.lineTo(5, -20); g.stroke();
      const base = ['#4c7a2c', '#567f2e', '#3f6c2a'][v % 3];
      const blobs = [[-7, -22, 9], [7, -24, 9], [0, -30, 10], [-3, -20, 8], [4, -18, 7]];
      for (const [bx2, by2, r] of blobs) {
        const gr = g.createRadialGradient(bx2 - r * 0.4, by2 - r * 0.5, 1, bx2, by2, r);
        gr.addColorStop(0, U.shade(base, 0.25)); gr.addColorStop(0.7, base); gr.addColorStop(1, U.shade(base, -0.3));
        g.fillStyle = gr; g.beginPath(); g.arc(bx2, by2, r, 0, 7); g.fill();
      }
      g.fillStyle = 'rgba(255,255,200,0.15)';
      for (let k = 0; k < 8; k++) { g.beginPath(); g.arc(-8 + U.hash(k, v, 1) * 14, -34 + U.hash(v, k, 2) * 14, 1.5, 0, 7); g.fill(); }
    } else {
      const lean = (h - 0.5) * 14;
      const tx = lean, ty = -40;
      g.lineCap = 'round';
      // Stamm mit Ringen
      g.strokeStyle = '#6b4a28'; g.lineWidth = 4.2;
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(lean * 0.15, -22, tx, ty); g.stroke();
      g.strokeStyle = '#8c6a40'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(-1, 0); g.quadraticCurveTo(lean * 0.15 - 1, -22, tx - 1, ty); g.stroke();
      g.strokeStyle = 'rgba(40,24,10,0.6)'; g.lineWidth = 1;
      for (let k = 1; k < 8; k++) {
        const f = k / 8, x = lean * 0.15 * 2 * f * (1 - f) + tx * f * f, y = -40 * f;
        g.beginPath(); g.moveTo(x - 2, y); g.lineTo(x + 2, y - 1); g.stroke();
      }
      // Wedel
      const fr = 8;
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < fr; k++) {
          const a = k / fr * Math.PI * 2 + h * 3;
          const back = Math.sin(a) < 0;
          if ((pass === 0) !== back) continue;
          const len = 17 + U.hash(k, v, 4) * 6;
          const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.45 + 9;
          const mx = (tx + ex) / 2, my = ty - 7 + Math.sin(a) * 3;
          const col = back ? '#3f6a26' : k % 2 ? '#5b8c33' : '#6b9c3a';
          g.strokeStyle = col; g.lineWidth = 2;
          g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
          // Fiedern
          g.lineWidth = 1.4;
          for (let j = 1; j < 6; j++) {
            const f = j / 6;
            const qx = (1 - f) * (1 - f) * tx + 2 * (1 - f) * f * mx + f * f * ex;
            const qy = (1 - f) * (1 - f) * ty + 2 * (1 - f) * f * my + f * f * ey;
            g.beginPath(); g.moveTo(qx, qy); g.lineTo(qx + Math.cos(a + 1.3) * 5 * (1 - f * 0.5), qy + 3.5 * (1 - f * 0.4)); g.moveTo(qx, qy); g.lineTo(qx + Math.cos(a - 1.3) * 5 * (1 - f * 0.5), qy + 3.5 * (1 - f * 0.4)); g.stroke();
          }
        }
      }
      g.fillStyle = '#5e3f1e';
      for (const [dx, dy] of [[-2, 1], [2, 1], [0, 3]]) { g.beginPath(); g.arc(tx + dx, ty + dy, 2.2, 0, 7); g.fill(); }
    }
    s = { c, bx, by, bw, bh };
    this.cache.set(key, s);
    return s;
  },

  drawTree(g, x, y, wood, terr) {
    const h = U.hash(x, y, 3);
    const p = P(x + 0.5 + (h - 0.5) * 0.3, y + 0.5 + (U.hash(y, x, 4) - 0.5) * 0.3);
    const sc = 0.78 + Math.min(wood, 8) / 8 * 0.32;
    const kind = terr === T.GRASS && h < 0.45 ? 'leaf' : 'palm';
    const s = this.treeSprite(kind, (h * 97 | 0) % (kind === 'palm' ? 5 : 3));
    const sway = kind === 'palm' ? Math.sin(this.t * 1.1 + h * 20) * 0.025 : 0;
    if (sway) { g.save(); g.translate(p[0], p[1]); g.transform(1, 0, sway, 1, 0, 0); g.drawImage(s.c, s.bx * sc, s.by * sc, s.bw * sc, s.bh * sc); g.restore(); }
    else g.drawImage(s.c, p[0] + s.bx * sc, p[1] + s.by * sc, s.bw * sc, s.bh * sc);
  },

  // ======================================================================
  // Gebäude
  // ======================================================================
  buildingSprite(type, owner, variant) {
    const key = 'b:' + type + ':' + owner + ':' + (variant || '');
    let s = this.cache.get(key);
    if (s) return s;
    const D = BUILDINGS[type];
    const bx = -D.h * HW - 6, by = -((BUILD_H[type] || 40) + 30), bw = (D.w + D.h) * HW + 12, bh = (BUILD_H[type] || 40) + 30 + (D.w + D.h) * HH + 6;
    const c = document.createElement('canvas');
    c.width = Math.ceil(bw * SPR_S); c.height = Math.ceil(bh * SPR_S);
    const g = c.getContext('2d');
    g.scale(SPR_S, SPR_S); g.translate(-bx, -by);
    this.drawStatic(g, type, owner, D.w, D.h, variant);
    s = { c, bx, by, bw, bh };
    this.cache.set(key, s);
    return s;
  },

  drawBuilding(g, b, alpha) {
    let variant = '';
    if (b.type === 'stockpile') {
      const r = G.s ? G.s.players[b.owner].res : { holz: 80, stein: 80, eisen: 40 };
      const lv = k => Math.min(4, Math.ceil((r[k] || 0) / 40));
      variant = lv('holz') + '' + lv('stein') + lv('eisen');
    }
    const s = this.buildingSprite(b.type, b.owner, variant);
    const o = P(b.x, b.y);
    if (alpha < 1) g.globalAlpha = alpha;
    g.drawImage(s.c, o[0] + s.bx, o[1] + s.by, s.bw, s.bh);
    this.drawDynamic(g, b, alpha);
    g.globalAlpha = 1;
  },

  drawDynamic(g, b, alpha) {
    const col = PLAYER_COLORS[b.owner];
    const { x, y, w, h } = b;
    if (b.type === 'keep') this.flag(g, x + 2.45, y + 2.45, 112, col, 1.25);
    else if (b.type === 'barracks') this.flag(g, x + 2.55, y + 0.45, 44, col, 1);
    else if (b.type === 'tower') this.flag(g, x + 1.7, y + 1.7, 64, col, 0.8);
    else if (b.type === 'house' || b.type === 'woodcutter') {
      // Rauch aus dem Schornstein
      const cp = b.type === 'house' ? P(x + 1.35, y + 0.75) : P(x + 0.5, y + 0.45);
      const ch = b.type === 'house' ? 44 : 34;
      for (let k = 0; k < 3; k++) {
        const ph = (this.t * 0.35 + k / 3 + b.id * 0.13) % 1;
        g.fillStyle = 'rgba(235,228,215,' + (0.32 * (1 - ph)) + ')';
        g.beginPath(); g.arc(cp[0] + ph * 10 + Math.sin(ph * 5 + k) * 2, cp[1] - ch - ph * 22, 2.5 + ph * 5, 0, 7); g.fill();
      }
    }
    if (alpha < 1) return;
    if (b.hp < b.maxHp * 0.5) {
      const p = P(x + w / 2, y + h / 2);
      const hh = SHADOW_H[b.type] || 30;
      for (let k = 0; k < 4; k++) {
        const ph = (this.t * 0.55 + k / 4) % 1;
        g.fillStyle = 'rgba(55,48,42,' + (0.5 * (1 - ph)) + ')';
        g.beginPath(); g.arc(p[0] + Math.sin(ph * 6 + k) * 6, p[1] - hh - ph * 36, 4 + ph * 10, 0, 7); g.fill();
      }
      if (b.hp < b.maxHp * 0.25) {
        const f = Math.sin(this.t * 14) * 1.5;
        g.fillStyle = 'rgba(255,140,40,0.85)';
        g.beginPath(); g.moveTo(p[0] - 5, p[1] - hh + 4); g.quadraticCurveTo(p[0] - 2, p[1] - hh - 8 - f, p[0], p[1] - hh - 14 - f); g.quadraticCurveTo(p[0] + 3, p[1] - hh - 6, p[0] + 5, p[1] - hh + 4); g.closePath(); g.fill();
      }
    }
    if (b.hitT > 0) {
      b.hitT -= 0.016;
      g.fillStyle = 'rgba(255,230,180,0.22)';
      this.rectPath(g, x, y, w, h); g.fill();
    }
  },

  drawStatic(g, type, owner, w, h, variant) {
    const col = PLAYER_COLORS[owner];
    const x = 0, y = 0;
    const stone = '#c3b79f', stoneD = '#a99c84', wood = '#9c6d40', woodD = '#7a5230', plaster = '#e3d4b0', thatch = '#c39a55', tile = '#b0583a';
    if (type !== 'wall' && type !== 'gate') this.ao(g, x + 0.08, y + 0.08, w - 0.16, h - 0.16);
    switch (type) {
      case 'keep': {
        this.box(g, x + 0.12, y + 0.12, 2.76, 2.76, 0, 8, stoneD, 'stone');
        this.box(g, x + 0.22, y + 0.22, 2.56, 2.56, 8, 70, stone, 'stone');
        this.merlons(g, x + 0.22, y + 0.22, 2.56, 2.56, 78, stone, 0.4);
        // Eckturm
        this.box(g, x + 1.85, y + 1.85, 1.05, 1.05, 0, 96, stoneD, 'stone');
        this.merlons(g, x + 1.85, y + 1.85, 1.05, 1.05, 96, stoneD, 0.4);
        this.door(g, x + 0.75, y + 2.78, 0.7, 24, 0);
        for (const k of [0.45, 1.35]) this.window(g, x + k, y + 2.78, 46, 0, true);
        for (const k of [0.5, 1.2]) this.window(g, x + 2.78, y + k, 52, 1);
        this.window(g, x + 2.12, y + 2.9, 76, 0, true);
        this.window(g, x + 2.9, y + 2.2, 76, 1);
        // Wandbehang
        const a = P(x + 0.3, y + 2.78), c2 = P(x + 0.62, y + 2.78);
        const gr = g.createLinearGradient(0, a[1] - 70, 0, a[1] - 34);
        gr.addColorStop(0, U.shade(col, 0.1)); gr.addColorStop(1, U.shade(col, -0.25));
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(a[0], a[1] - 70); g.lineTo(c2[0], c2[1] - 70); g.lineTo(c2[0], c2[1] - 36); g.lineTo((a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2 - 42); g.lineTo(a[0], a[1] - 36); g.closePath(); g.fill();
        g.fillStyle = '#e0b654'; g.beginPath(); g.arc((a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2 - 58, 2.5, 0, 7); g.fill();
        break;
      }
      case 'stockpile': {
        g.fillStyle = '#a98a5c'; this.rectPath(g, x + 0.08, y + 0.08, w - 0.16, h - 0.16); g.fill();
        g.strokeStyle = 'rgba(70,48,25,0.6)'; g.lineWidth = 0.8;
        for (let t = 0.25; t < 1.9; t += 0.22) { const a = P(x + t, y + 0.1), b2 = P(x + t, y + 1.9); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b2[0], b2[1]); g.stroke(); }
        const lh = +variant[0] || 0, ls = +variant[1] || 0, le = +variant[2] || 0;
        for (let i = 0; i < lh; i++) this.logs(g, x + 0.2, y + 0.25 + i * 0.16, 0.85, i * 3.5);
        for (let i = 0; i < ls; i++) this.box(g, x + 1.08 + (i % 2) * 0.05, y + 0.25, 0.62, 0.62, i * 6, 6, '#b2aa98', 'stone');
        for (let i = 0; i < le; i++) this.box(g, x + 0.3, y + 1.12, 0.5, 0.42, i * 4, 4, '#767c86');
        this.box(g, x + 1.15, y + 1.2, 0.5, 0.5, 0, 9, '#8a6a42', 'wood');
        break;
      }
      case 'granary': {
        this.box(g, x + 0.2, y + 0.2, 1.6, 1.6, 0, 4, stoneD, 'stone');
        this.box(g, x + 0.25, y + 0.25, 1.5, 1.5, 4, 24, wood, 'wood');
        this.gable(g, x + 0.12, y + 0.12, 1.76, 1.76, 28, 20, '#b88b4e', wood);
        this.door(g, x + 0.75, y + 1.75, 0.5, 16, 0);
        for (const [sx, sy] of [[1.55, 1.75], [1.75, 1.45]]) { g.fillStyle = '#dcc590'; const p = P(x + sx, y + sy); g.beginPath(); g.ellipse(p[0], p[1] - 4, 4, 5, 0, 0, 7); g.fill(); g.fillStyle = 'rgba(80,55,25,0.3)'; g.beginPath(); g.ellipse(p[0] + 1, p[1] - 3, 3, 4, 0, 0, 7); g.fill(); }
        break;
      }
      case 'woodcutter': {
        this.box(g, x + 0.2, y + 0.2, 1.2, 1.1, 0, 18, wood, 'wood');
        this.pyramid(g, x + 0.08, y + 0.08, 1.44, 1.34, 18, 15, '#8a6038');
        this.box(g, x + 0.42, y + 0.36, 0.18, 0.18, 22, 10, stoneD);
        this.door(g, x + 0.55, y + 1.3, 0.35, 12, 0);
        for (let i = 0; i < 3; i++) this.logs(g, x + 1.1, y + 1.15 + i * 0.16, 0.7, i * 2);
        const st = P(x + 0.55, y + 1.65);
        g.fillStyle = '#7a5230'; g.beginPath(); g.ellipse(st[0], st[1] - 4, 5, 2.5, 0, 0, 7); g.fill();
        g.fillStyle = '#5e3e22'; g.fillRect(st[0] - 5, st[1] - 4, 10, 4);
        g.fillStyle = '#c9a06a'; g.beginPath(); g.ellipse(st[0], st[1] - 4, 5, 2.5, 0, 0, 7); g.fill();
        g.strokeStyle = '#6e4b2a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(st[0], st[1] - 5); g.lineTo(st[0] + 5, st[1] - 14); g.stroke();
        g.fillStyle = '#b9bec6'; g.beginPath(); g.moveTo(st[0] - 1, st[1] - 5); g.lineTo(st[0] + 2, st[1] - 8); g.lineTo(st[0] + 3, st[1] - 5); g.closePath(); g.fill();
        break;
      }
      case 'quarry': {
        g.fillStyle = '#857d6f'; this.rectPath(g, x + 0.15, y + 0.15, 2.7, 2.7); g.fill();
        g.fillStyle = '#6c655a'; this.rectPath(g, x + 0.5, y + 0.5, 1.6, 1.6); g.fill();
        g.fillStyle = '#58524a'; this.rectPath(g, x + 0.8, y + 0.8, 1.0, 1.0); g.fill();
        for (let k = 0; k < 4; k++) { const a = P(x + 0.5 + k * 0.4, y + 2.1), b2 = P(x + 0.5 + k * 0.4 + 0.1, y + 1.6); g.strokeStyle = 'rgba(255,240,220,0.2)'; g.lineWidth = 1; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b2[0], b2[1]); g.stroke(); }
        this.box(g, x + 2.2, y + 0.35, 0.55, 0.55, 0, 9, '#bdb5a5', 'stone');
        this.box(g, x + 2.2, y + 1.05, 0.55, 0.55, 0, 9, '#bdb5a5', 'stone');
        this.box(g, x + 2.2, y + 1.05, 0.55, 0.55, 9, 8, '#c8c0b0', 'stone');
        this.box(g, x + 1.4, y + 2.3, 0.5, 0.45, 0, 7, '#bdb5a5', 'stone');
        const a = P(x + 0.45, y + 2.5), c2 = P(x + 1.3, y + 1.3);
        g.strokeStyle = '#6e4b2a'; g.lineWidth = 3; g.lineCap = 'round';
        g.beginPath(); g.moveTo(a[0] - 6, a[1]); g.lineTo(a[0], a[1] - 44); g.lineTo(a[0] + 6, a[1]); g.stroke();
        g.lineWidth = 2.5; g.beginPath(); g.moveTo(a[0], a[1] - 42); g.lineTo(c2[0], c2[1] - 38); g.stroke();
        g.lineCap = 'butt'; g.lineWidth = 1; g.strokeStyle = '#2e2014';
        g.beginPath(); g.moveTo(c2[0], c2[1] - 38); g.lineTo(c2[0], c2[1] - 14); g.stroke();
        this.box(g, x + 1.2, y + 1.2, 0.26, 0.26, 8, 6, '#c8c0b0');
        break;
      }
      case 'mine': {
        g.fillStyle = '#6f4532'; this.rectPath(g, x + 0.1, y + 0.1, 1.8, 1.8); g.fill();
        this.boulder(g, x + 0.6, y + 0.5, 16, '#8a5a40', 0.4);
        this.box(g, x + 0.35, y + 0.4, 1.05, 1.05, 0, 18, woodD, 'wood');
        this.pyramid(g, x + 0.28, y + 0.33, 1.2, 1.2, 18, 11, '#5d3f25');
        this.door(g, x + 0.62, y + 1.45, 0.48, 15, 0);
        // Lore mit Erz
        this.box(g, x + 1.42, y + 1.2, 0.42, 0.32, 2, 6, '#5c4a3a');
        for (let k = 0; k < 4; k++) { const p = P(x + 1.5 + (k % 2) * 0.18, y + 1.28 + (k >> 1) * 0.12); g.fillStyle = k % 2 ? '#8a4e34' : '#a8603c'; g.beginPath(); g.arc(p[0], p[1] - 9, 2.2, 0, 7); g.fill(); }
        break;
      }
      case 'orchard': {
        g.fillStyle = '#5c7a32'; this.rectPath(g, x + 0.08, y + 0.08, 2.84, 2.84); g.fill();
        g.strokeStyle = 'rgba(60,45,20,0.35)'; g.lineWidth = 1;
        for (let t = 0.4; t < 2.8; t += 0.35) { const a = P(x + 0.1, y + t), b2 = P(x + 2.9, y + t); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b2[0], b2[1]); g.stroke(); }
        // Zaun
        g.strokeStyle = '#8a6a42'; g.lineWidth = 1.2;
        const fence = [[0.05, 0.05], [2.95, 0.05], [2.95, 2.95], [0.05, 2.95]];
        for (let i = 0; i < 4; i++) {
          const a = P(...fence[i]), b2 = P(...fence[(i + 1) % 4]);
          g.beginPath(); g.moveTo(a[0], a[1] - 4); g.lineTo(b2[0], b2[1] - 4); g.stroke();
          for (let k = 0; k <= 6; k++) { const q = [a[0] + (b2[0] - a[0]) * k / 6, a[1] + (b2[1] - a[1]) * k / 6]; g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0], q[1] - 6); g.stroke(); }
        }
        const trees = [[0.7, 0.7], [1.5, 0.7], [2.3, 0.7], [0.7, 1.5], [1.5, 1.5], [2.3, 1.5], [0.7, 2.3], [1.5, 2.3], [2.3, 2.3]];
        for (const [ox, oy] of trees) {
          const p = P(x + ox, y + oy);
          g.fillStyle = 'rgba(30,40,10,0.35)'; g.beginPath(); g.ellipse(p[0] + 4, p[1], 8, 3.5, 0, 0, 7); g.fill();
          g.fillStyle = '#5a3e24'; g.fillRect(p[0] - 1.2, p[1] - 9, 2.4, 9);
          const gr = g.createRadialGradient(p[0] - 3, p[1] - 17, 1, p[0], p[1] - 14, 9);
          gr.addColorStop(0, '#6f9c3c'); gr.addColorStop(1, '#2f5a22');
          g.fillStyle = gr; g.beginPath(); g.arc(p[0], p[1] - 14, 8, 0, 7); g.fill();
          for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? '#d63b2c' : '#e8553e'; g.beginPath(); g.arc(p[0] - 5 + U.hash(k, ox * 9, 1) * 10, p[1] - 18 + U.hash(oy * 9, k, 2) * 9, 1.4, 0, 7); g.fill(); }
        }
        break;
      }
      case 'house': {
        this.box(g, x + 0.28, y + 0.28, 1.44, 1.44, 0, 22, plaster, 'plaster');
        // Fachwerk
        g.strokeStyle = '#6a4626'; g.lineWidth = 1.6;
        const Dd = P(x + 0.28, y + 1.72), Cc = P(x + 1.72, y + 1.72), Bb = P(x + 1.72, y + 0.28);
        for (const [a, b2] of [[Dd, Cc], [Cc, Bb]]) {
          g.beginPath(); g.moveTo(a[0], a[1] - 11); g.lineTo(b2[0], b2[1] - 11); g.moveTo(a[0], a[1] - 21); g.lineTo(b2[0], b2[1] - 21); g.stroke();
          const m = [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2];
          g.beginPath(); g.moveTo(a[0], a[1] - 11); g.lineTo(m[0], m[1] - 21); g.lineTo(b2[0], b2[1] - 11); g.stroke();
        }
        this.pyramid(g, x + 0.14, y + 0.14, 1.72, 1.72, 22, 20, thatch);
        this.box(g, x + 1.25, y + 0.6, 0.2, 0.2, 26, 16, '#9d8f7a', 'stone');
        this.door(g, x + 0.82, y + 1.72, 0.36, 13, 0);
        this.window(g, x + 1.72, y + 0.85, 10, 1, true);
        break;
      }
      case 'chapel': {
        this.box(g, x + 0.28, y + 0.22, 1.42, 1.55, 0, 32, '#ece5d3', 'plaster');
        this.gable(g, x + 0.2, y + 0.15, 1.58, 1.7, 32, 17, tile, '#ece5d3');
        this.box(g, x + 1.22, y + 1.25, 0.5, 0.5, 0, 48, '#e2dac6', 'plaster');
        this.pyramid(g, x + 1.17, y + 1.2, 0.6, 0.6, 48, 20, tile);
        const bp = P(x + 1.47, y + 1.75);
        g.fillStyle = '#2a1d12'; g.beginPath(); g.arc(bp[0] - 4, bp[1] - 40, 3, Math.PI, 0); g.fill();
        g.fillStyle = '#d4a24a'; g.beginPath(); g.arc(bp[0] - 4, bp[1] - 39, 1.6, 0, 7); g.fill();
        this.door(g, x + 0.62, y + 1.77, 0.36, 15, 0);
        const rw = P(x + 0.98, y + 1.77);
        g.fillStyle = '#7fb0d8'; g.beginPath(); g.arc(rw[0], rw[1] - 25, 3, 0, 7); g.fill();
        g.strokeStyle = '#7a6a50'; g.lineWidth = 1; g.stroke();
        break;
      }
      case 'barracks': {
        this.box(g, x + 0.2, y + 0.2, 2.6, 1.95, 0, 6, stoneD, 'stone');
        this.box(g, x + 0.25, y + 0.25, 2.5, 1.85, 6, 30, stoneD, 'stone');
        this.merlons(g, x + 0.25, y + 0.25, 2.5, 1.85, 36, stoneD, 0.42);
        this.door(g, x + 1.2, y + 2.1, 0.6, 20, 0);
        for (const k of [0.5, 2.05]) this.window(g, x + k, y + 2.1, 22, 0);
        for (const [a0, a1] of [[0.45, 0.85], [2.15, 2.55]]) {
          const a = P(x + a0, y + 2.1), c2 = P(x + a1, y + 2.1);
          const gr = g.createLinearGradient(0, a[1] - 34, 0, a[1] - 12);
          gr.addColorStop(0, U.shade(col, 0.1)); gr.addColorStop(1, U.shade(col, -0.25));
          g.fillStyle = gr;
          g.beginPath(); g.moveTo(a[0], a[1] - 34); g.lineTo(c2[0], c2[1] - 34); g.lineTo(c2[0], c2[1] - 14); g.lineTo((a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2 - 18); g.lineTo(a[0], a[1] - 14); g.closePath(); g.fill();
        }
        // Waffenständer und Übungspuppe
        const r1 = P(x + 2.3, y + 2.55);
        g.strokeStyle = '#6e4b2a'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(r1[0] - 7, r1[1] - 2); g.lineTo(r1[0] + 7, r1[1] - 2); g.stroke();
        g.strokeStyle = '#a8adb5'; g.lineWidth = 1.2;
        for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(r1[0] + k * 3, r1[1]); g.lineTo(r1[0] + k * 3 + 1, r1[1] - 16); g.stroke(); }
        const d1 = P(x + 0.6, y + 2.6);
        g.strokeStyle = '#6e4b2a'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(d1[0], d1[1]); g.lineTo(d1[0], d1[1] - 14); g.moveTo(d1[0] - 6, d1[1] - 10); g.lineTo(d1[0] + 6, d1[1] - 10); g.stroke();
        g.fillStyle = '#d9b77a'; g.beginPath(); g.ellipse(d1[0], d1[1] - 10, 3.5, 5, 0, 0, 7); g.fill();
        g.fillStyle = '#c9a66b'; g.beginPath(); g.arc(d1[0], d1[1] - 17, 3, 0, 7); g.fill();
        break;
      }
      case 'wall': {
        this.box(g, x, y, 1, 1, 0, 28, stone, 'stone');
        this.merlons(g, x, y, 1, 1, 28, stone, 0.42);
        break;
      }
      case 'gate': {
        this.box(g, x, y, 1, 1, 0, 36, stoneD, 'stone');
        this.merlons(g, x, y, 1, 1, 36, stoneD, 0.42);
        this.door(g, x + 0.18, y + 1, 0.64, 26, 0);
        this.door(g, x + 1, y + 0.18, 0.64, 26, 1);
        // Fallgitter
        g.strokeStyle = 'rgba(40,40,45,0.7)'; g.lineWidth = 0.8;
        const a = P(x + 0.22, y + 1), b2 = P(x + 0.78, y + 1);
        for (let k = 1; k < 5; k++) { const q = [a[0] + (b2[0] - a[0]) * k / 5, a[1] + (b2[1] - a[1]) * k / 5]; g.beginPath(); g.moveTo(q[0], q[1] - 2); g.lineTo(q[0], q[1] - 22); g.stroke(); }
        const pa = P(x + 0.32, y + 1);
        g.fillStyle = col; g.fillRect(pa[0] - 1, pa[1] - 33, 7, 6);
        break;
      }
      case 'tower': {
        this.box(g, x + 0.08, y + 0.08, 1.84, 1.84, 0, 6, stoneD, 'stone');
        this.box(g, x + 0.14, y + 0.14, 1.72, 1.72, 6, 52, stone, 'stone');
        this.merlons(g, x + 0.14, y + 0.14, 1.72, 1.72, 58, stone, 0.4);
        for (const k of [0.6, 1.25]) { this.window(g, x + k, y + 1.86, 34, 0); this.window(g, x + 1.86, y + k - 0.1, 34, 1); }
        const a = P(x + 0.4, y + 1.86);
        g.fillStyle = col; g.fillRect(a[0] - 2, a[1] - 54, 6, 10);
        break;
      }
    }
  },
  logs(g, x, y, len, z) {
    for (let k = 0; k < 3; k++) {
      const a = P(x + 0.02, y + k * 0.05), b = P(x + len, y + k * 0.05);
      const zz = z + (k === 1 ? 3 : 0);
      g.strokeStyle = '#6e4a28'; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(a[0], a[1] - zz - 2); g.lineTo(b[0], b[1] - zz - 2); g.stroke();
      g.strokeStyle = '#94683c'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(a[0], a[1] - zz - 3); g.lineTo(b[0], b[1] - zz - 3); g.stroke();
      g.lineCap = 'butt';
      g.fillStyle = '#d6aa70'; g.beginPath(); g.arc(b[0], b[1] - zz - 2, 2, 0, 7); g.fill();
    }
  },

  drawFire(g, f) {
    const p = P(f.x + 0.5, f.y + 0.5);
    if (!this.visible(p[0], p[1])) return;
    const fl = Math.sin(this.t * 13) * 1.5 + Math.sin(this.t * 7.3) * 1;
    const grd = g.createRadialGradient(p[0], p[1] - 4, 2, p[0], p[1] - 4, 34);
    grd.addColorStop(0, 'rgba(255,190,90,0.4)'); grd.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = grd; g.beginPath(); g.ellipse(p[0], p[1], 36, 20, 0, 0, 7); g.fill();
    for (let k = 0; k < 7; k++) { const a = k / 7 * 7; this.pebble(g, f.x + 0.5 + Math.cos(a) * 0.22, f.y + 0.5 + Math.sin(a) * 0.22, 1.8, '#8a7f70'); }
    g.strokeStyle = '#4a2e16'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(p[0] - 7, p[1] + 1); g.lineTo(p[0] + 7, p[1] - 2); g.moveTo(p[0] - 6, p[1] - 2); g.lineTo(p[0] + 6, p[1] + 2); g.stroke();
    g.lineCap = 'butt';
    g.fillStyle = '#f07a1e';
    g.beginPath(); g.moveTo(p[0] - 6, p[1] - 1); g.quadraticCurveTo(p[0] - 4, p[1] - 11 - fl, p[0], p[1] - 17 - fl); g.quadraticCurveTo(p[0] + 5, p[1] - 10, p[0] + 6, p[1] - 1); g.closePath(); g.fill();
    g.fillStyle = '#ffd35a';
    g.beginPath(); g.moveTo(p[0] - 3, p[1] - 1); g.quadraticCurveTo(p[0], p[1] - 11 - fl, p[0] + 3, p[1] - 1); g.closePath(); g.fill();
    for (let k = 0; k < 3; k++) {
      const ph = (this.t * 0.8 + k / 3) % 1;
      g.fillStyle = 'rgba(255,200,90,' + (1 - ph) + ')';
      g.fillRect(p[0] + Math.sin(ph * 9 + k * 2) * 5, p[1] - 14 - ph * 26, 1.4, 1.4);
    }
  },

  // ======================================================================
  // Einheiten
  // ======================================================================
  drawUnit(g, u) {
    const p = P(u.x, u.y);
    const x = p[0], y = p[1] - (u.z || 0);
    const col = PLAYER_COLORS[u.owner];
    const walk = u.moving ? Math.sin(u.anim * 11) : 0;
    const f = u.face || 1;
    if (!u.tower) {
      g.fillStyle = 'rgba(30,18,6,0.32)';
      g.beginPath(); g.ellipse(x + 3, y + 1, u.type === 'knight' ? 12 : 7, u.type === 'knight' ? 4 : 3, 0, 0, 7); g.fill();
    }
    const hit = u.hitT > 0;
    if (u.type === 'knight') { this.drawKnight(g, u, x, y, col, walk, f, hit); return; }
    const OL = 'rgba(25,14,6,0.85)';
    const bob = u.working ? Math.abs(Math.sin(u.anim * 6)) * 1.5 : Math.abs(walk) * 0.8;
    let tunic = col, tunic2 = U.shade(col, -0.35), legs = '#4a3424';
    if (u.type === 'peasant') { tunic = u.owner === 0 ? '#b69c6a' : '#a98a5e'; tunic2 = '#7d6642'; legs = '#5a4630'; }
    if (u.type === 'sword') { tunic = '#a7aeb7'; tunic2 = '#6e757e'; legs = '#5c6068'; }
    // Beine
    g.lineCap = 'round';
    g.strokeStyle = OL; g.lineWidth = 3.4;
    g.beginPath(); g.moveTo(x - 1.6, y - 8); g.lineTo(x - 1.6 + walk * 2.8, y - 0.6); g.moveTo(x + 1.6, y - 8); g.lineTo(x + 1.6 - walk * 2.8, y - 0.6); g.stroke();
    g.strokeStyle = legs; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x - 1.6, y - 8); g.lineTo(x - 1.6 + walk * 2.8, y - 0.8); g.moveTo(x + 1.6, y - 8); g.lineTo(x + 1.6 - walk * 2.8, y - 0.8); g.stroke();
    // hinterer Arm
    g.strokeStyle = OL; g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(x - 3.2 * f, y - 16 - bob); g.lineTo(x - 3.8 * f - walk * 2 * f, y - 9 - bob); g.stroke();
    // Körper
    g.beginPath();
    g.moveTo(x - 4.6, y - 7.5 - bob); g.lineTo(x - 4, y - 16.5 - bob); g.quadraticCurveTo(x, y - 19 - bob, x + 4, y - 16.5 - bob); g.lineTo(x + 4.6, y - 7.5 - bob); g.quadraticCurveTo(x, y - 6 - bob, x - 4.6, y - 7.5 - bob);
    g.closePath();
    const gr = g.createLinearGradient(x - 4, 0, x + 4, 0);
    gr.addColorStop(0, hit ? '#ff6a55' : U.shade(tunic, 0.15)); gr.addColorStop(1, hit ? '#c03020' : tunic2);
    g.fillStyle = gr; g.fill();
    g.strokeStyle = OL; g.lineWidth = 0.9; g.stroke();
    if (u.type === 'sword') { g.fillStyle = col; g.fillRect(x - 2.2, y - 16 - bob, 4.4, 8.5); }
    if (u.type === 'peasant' || u.type === 'archer') { g.fillStyle = 'rgba(40,25,10,0.7)'; g.fillRect(x - 4.4, y - 10.5 - bob, 8.8, 1.4); }
    if (u.type === 'peasant') { g.fillStyle = col; g.fillRect(x - 1, y - 10.6 - bob, 2, 1.6); }
    // Kopf
    const hy = y - 21 - bob;
    g.fillStyle = '#e4b994'; g.beginPath(); g.arc(x, hy, 3.3, 0, 7); g.fill();
    g.strokeStyle = OL; g.lineWidth = 0.9; g.stroke();
    g.fillStyle = 'rgba(120,60,30,0.25)'; g.beginPath(); g.arc(x + 1.2 * f, hy + 0.6, 1.8, 0, 7); g.fill();
    if (u.type === 'peasant') {
      g.fillStyle = '#d8bf86'; g.beginPath(); g.ellipse(x, hy - 2.2, 5.2, 1.9, 0, 0, 7); g.fill(); g.stroke();
      g.beginPath(); g.ellipse(x, hy - 3, 2.6, 1.8, 0, Math.PI, 0); g.fill();
    } else if (u.type === 'archer') {
      g.fillStyle = U.shade(col, -0.3); g.beginPath(); g.moveTo(x - 3.8, hy - 0.5); g.quadraticCurveTo(x, hy - 7, x + 3.8 + f, hy - 1.5); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#e8d6a0'; g.fillRect(x - 0.5 * f + 2 * f, hy - 7, 1, 4);
    } else {
      const hg = g.createLinearGradient(x - 3, 0, x + 3, 0); hg.addColorStop(0, '#c9ced6'); hg.addColorStop(1, '#6f767f');
      g.fillStyle = hg; g.beginPath(); g.arc(x, hy - 0.4, 3.8, Math.PI, 0); g.lineTo(x + 3.8, hy + 0.6); g.lineTo(x - 3.8, hy + 0.6); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#3a3a40'; g.fillRect(x - 0.5 + f * 0.8, hy - 1, 1, 3.4);
    }
    const atk = u.atkT > 0 ? u.atkT / 0.35 : 0;
    // vorderer Arm + Ausrüstung
    if (u.type === 'archer') {
      g.strokeStyle = '#5b3b1d'; g.lineWidth = 1.8;
      const bx = x + 6 * f, by = y - 14 - bob;
      g.beginPath(); g.moveTo(bx - 1 * f, by - 8); g.quadraticCurveTo(bx + 4 * f, by, bx - 1 * f, by + 8); g.stroke();
      g.strokeStyle = 'rgba(245,235,205,0.9)'; g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(bx - 1 * f, by - 8); g.lineTo(bx - (2 + atk * 4) * f, by); g.lineTo(bx - 1 * f, by + 8); g.stroke();
      g.strokeStyle = OL; g.lineWidth = 2.6; g.beginPath(); g.moveTo(x + 3 * f, y - 16 - bob); g.lineTo(bx + 1.5 * f, by); g.stroke();
      g.fillStyle = '#7a5230'; g.fillRect(x - 5 * f - 1, y - 19 - bob, 2.4, 8);
    } else if (u.type === 'spear') {
      const thrust = atk * 6 * f;
      g.strokeStyle = '#6e4b2a'; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(x - 5 * f + thrust, y - 3); g.lineTo(x + 9 * f + thrust, y - 31); g.stroke();
      g.fillStyle = '#d6dae0'; g.beginPath(); g.moveTo(x + 9.6 * f + thrust, y - 33); g.lineTo(x + 7.3 * f + thrust, y - 27); g.lineTo(x + 10.6 * f + thrust, y - 28); g.closePath(); g.fill();
      g.strokeStyle = OL; g.lineWidth = 2.6; g.beginPath(); g.moveTo(x + 3 * f, y - 16 - bob); g.lineTo(x + 4.5 * f + thrust * 0.6, y - 13 - bob); g.stroke();
      // Rundschild
      g.fillStyle = U.shade(col, -0.15); g.beginPath(); g.ellipse(x - 4.5 * f, y - 12 - bob, 3, 5, 0, 0, 7); g.fill(); g.strokeStyle = '#d6a54a'; g.lineWidth = 0.8; g.stroke();
    } else if (u.type === 'sword') {
      g.fillStyle = col; g.beginPath(); g.moveTo(x - 7 * f, y - 17 - bob); g.lineTo(x - 2 * f, y - 17 - bob); g.lineTo(x - 2 * f, y - 9 - bob); g.quadraticCurveTo(x - 4.5 * f, y - 5 - bob, x - 7 * f, y - 9 - bob); g.closePath(); g.fill();
      g.strokeStyle = '#e8c66a'; g.lineWidth = 0.9; g.stroke();
      const a = -0.9 + atk * 2;
      const hx = x + 4.5 * f, hy2 = y - 13 - bob;
      g.strokeStyle = OL; g.lineWidth = 2.6; g.beginPath(); g.moveTo(x + 3 * f, y - 16 - bob); g.lineTo(hx, hy2); g.stroke();
      g.strokeStyle = '#eef1f5'; g.lineWidth = 1.9;
      g.beginPath(); g.moveTo(hx, hy2); g.lineTo(hx + Math.cos(a) * 11 * f, hy2 - 6 - Math.sin(-a) * 11); g.stroke();
      g.strokeStyle = '#8a6a30'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(hx - 2 * f, hy2 + 1); g.lineTo(hx + 2 * f, hy2 - 1); g.stroke();
    } else if (u.type === 'peasant') {
      if (u.carry) {
        const cy = y - 24 - bob;
        if (u.carry.res === 'holz') { g.strokeStyle = '#7a5230'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(x - 6, cy + 2); g.lineTo(x + 6, cy - 1); g.stroke(); g.strokeStyle = '#a07040'; g.lineWidth = 1; g.stroke(); }
        else if (u.carry.res === 'stein') { this.poly(g, [[x - 4, cy + 2], [x - 3, cy - 3], [x + 3, cy - 3], [x + 4, cy + 2]], '#b8b1a2'); }
        else if (u.carry.res === 'eisen') { this.poly(g, [[x - 4, cy + 2], [x - 2, cy - 2], [x + 2, cy - 2], [x + 4, cy + 2]], '#7d848e'); }
        else { g.fillStyle = '#c89a5a'; g.beginPath(); g.ellipse(x, cy, 5, 3.5, 0, 0, 7); g.fill(); g.fillStyle = '#d63b2c'; g.beginPath(); g.arc(x - 1.5, cy - 2.5, 1.6, 0, 7); g.arc(x + 1.8, cy - 2.2, 1.6, 0, 7); g.fill(); }
        g.lineCap = 'round';
        g.strokeStyle = OL; g.lineWidth = 2.4; g.beginPath(); g.moveTo(x + 3 * f, y - 16 - bob); g.lineTo(x + 3 * f, cy + 2); g.stroke();
      } else if (u.working) {
        const a = Math.sin(u.anim * 8) * 0.9;
        g.strokeStyle = OL; g.lineWidth = 2.6; g.beginPath(); g.moveTo(x + 3 * f, y - 16 - bob); g.lineTo(x + 5 * f, y - 13 - bob); g.stroke();
        g.strokeStyle = '#6e4b2a'; g.lineWidth = 1.6;
        const ex = x + 5 * f + Math.cos(a) * 9 * f, ey = y - 13 - Math.sin(a) * 9 - 3;
        g.beginPath(); g.moveTo(x + 5 * f, y - 13 - bob); g.lineTo(ex, ey); g.stroke();
        g.fillStyle = '#b9bec6'; g.beginPath(); g.arc(ex, ey, 1.8, 0, 7); g.fill();
      } else {
        g.strokeStyle = OL; g.lineWidth = 2.6; g.beginPath(); g.moveTo(x + 3.2 * f, y - 16 - bob); g.lineTo(x + 3.8 * f + walk * 2 * f, y - 9 - bob); g.stroke();
      }
    }
    g.lineCap = 'butt';
  },

  drawKnight(g, u, x, y, col, walk, f, hit) {
    const OL = 'rgba(25,14,6,0.85)';
    const horse = hit ? '#ff6a55' : '#7a5232';
    g.lineCap = 'round';
    g.strokeStyle = '#3e2816'; g.lineWidth = 2.4;
    g.beginPath();
    for (const [lx, ph] of [[-7, 1], [-4, -1], [4, -1], [7, 1]]) { g.moveTo(x + lx * f, y - 8); g.lineTo(x + lx * f + walk * 3.2 * ph, y - 0.5); }
    g.stroke();
    const hg = g.createLinearGradient(0, y - 17, 0, y - 6);
    hg.addColorStop(0, U.shade(horse, 0.15)); hg.addColorStop(1, U.shade(horse, -0.3));
    g.fillStyle = hg; g.beginPath(); g.ellipse(x, y - 11.5, 10.5, 5.2, 0, 0, 7); g.fill(); g.strokeStyle = OL; g.lineWidth = 0.9; g.stroke();
    g.beginPath(); g.moveTo(x + 7 * f, y - 14); g.quadraticCurveTo(x + 10 * f, y - 22, x + 13 * f, y - 21); g.lineTo(x + 14 * f, y - 17); g.quadraticCurveTo(x + 11 * f, y - 15, x + 9 * f, y - 10); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#2e1c0e'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x + 9 * f, y - 21); g.lineTo(x + 6 * f, y - 16); g.stroke();
    g.beginPath(); g.moveTo(x - 10 * f, y - 12); g.quadraticCurveTo(x - 14 * f, y - 10, x - 13 * f, y - 5); g.stroke();
    // Schabracke
    g.fillStyle = col; g.beginPath(); g.moveTo(x - 7, y - 15); g.lineTo(x + 6, y - 15); g.lineTo(x + 7, y - 8); g.lineTo(x - 8, y - 8); g.closePath(); g.fill();
    g.fillStyle = '#e0b654'; g.fillRect(x - 8, y - 9, 15, 1.2);
    // Reiter
    const rg = g.createLinearGradient(x - 4, 0, x + 4, 0); rg.addColorStop(0, '#c9ced6'); rg.addColorStop(1, '#6f767f');
    g.fillStyle = rg; g.beginPath(); g.ellipse(x, y - 21, 3.8, 5.6, 0, 0, 7); g.fill(); g.strokeStyle = OL; g.lineWidth = 0.9; g.stroke();
    g.fillStyle = col; g.fillRect(x - 2, y - 24, 4, 6);
    g.fillStyle = rg; g.beginPath(); g.arc(x, y - 29, 3.5, 0, 7); g.fill(); g.stroke();
    g.fillStyle = col; g.beginPath(); g.moveTo(x - 1, y - 32); g.quadraticCurveTo(x - 5 * f, y - 38, x - 7 * f, y - 33); g.lineTo(x - 1, y - 31); g.closePath(); g.fill();
    const atk = u.atkT > 0 ? u.atkT / 0.35 : 0;
    g.strokeStyle = '#6e4b2a'; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(x - 4 * f, y - 18); g.lineTo(x + (15 + atk * 5) * f, y - 27 + atk * 9); g.stroke();
    g.fillStyle = '#e8ecf0'; g.beginPath(); const tx = x + (15 + atk * 5) * f, ty = y - 27 + atk * 9; g.moveTo(tx, ty); g.lineTo(tx - 3 * f, ty - 1.5); g.lineTo(tx - 2 * f, ty + 2); g.closePath(); g.fill();
    g.lineCap = 'butt';
  },

  drawProjectiles(g) {
    for (const pr of G.proj) {
      const k = pr.t / pr.dur;
      const d = U.dist(pr.x0, pr.y0, pr.tx, pr.ty);
      const pos = kk => {
        const x = pr.x0 + (pr.tx - pr.x0) * kk, y = pr.y0 + (pr.ty - pr.y0) * kk;
        const z = pr.z0 + (pr.tz - pr.z0) * kk + Math.sin(Math.PI * kk) * d * 5;
        const p = P(x, y); return [p[0], p[1] - z];
      };
      const a = pos(k), b = pos(Math.min(1, k + 0.04));
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      g.strokeStyle = '#3a2a1a'; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(a[0] - dx / l * 9, a[1] - dy / l * 9); g.stroke();
      g.strokeStyle = '#f0ece0'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(a[0] - dx / l * 7, a[1] - dy / l * 7); g.lineTo(a[0] - dx / l * 9, a[1] - dy / l * 9); g.stroke();
    }
  },

  drawFx(g, f) {
    const p = P(f.x, f.y);
    const k = f.t / f.dur;
    if (f.k === 'dust' || f.k === 'leave' || f.k === 'fall') {
      const r = (f.r || 1) * 14 * (0.5 + k);
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2;
        g.fillStyle = 'rgba(215,190,145,' + (0.45 * (1 - k)) + ')';
        g.beginPath(); g.arc(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r * 0.5 - 6 - k * 8, 6 + k * 7, 0, 7); g.fill();
      }
    } else if (f.k === 'rubble') {
      g.globalAlpha = Math.min(1, (1 - k) * 2);
      for (let i = 0; i < 10; i++) {
        const h1 = U.hash(i, f.x | 0, 1), h2 = U.hash(i, f.y | 0, 2);
        this.box(g, f.x + (h1 - 0.5) * f.r - 0.15, f.y + (h2 - 0.5) * f.r - 0.15, 0.3, 0.3, 0, 4 + h1 * 6, '#a39886');
      }
      g.fillStyle = 'rgba(90,80,70,' + (0.45 * (1 - k)) + ')';
      g.beginPath(); g.arc(p[0], p[1] - 20 - k * 36, 12 + k * 24, 0, 7); g.fill();
      g.globalAlpha = 1;
    } else if (f.k === 'mark') {
      g.strokeStyle = f.c; g.globalAlpha = 1 - k; g.lineWidth = 2.2;
      const r = (f.r || 0.5) * (1.2 - k * 0.5);
      g.beginPath(); g.ellipse(p[0], p[1], r * HW * 1.2, r * HH * 1.2, 0, 0, 7); g.stroke();
      g.beginPath(); g.ellipse(p[0], p[1], r * HW * 0.6, r * HH * 0.6, 0, 0, 7); g.stroke();
      g.globalAlpha = 1;
    } else if (f.k === 'death') {
      g.globalAlpha = 1 - k;
      g.fillStyle = 'rgba(110,20,12,0.6)'; g.beginPath(); g.ellipse(p[0] + 2, p[1] + 1, 7, 3, 0, 0, 7); g.fill();
      g.fillStyle = f.type === 'peasant' ? '#b39a6c' : PLAYER_COLORS[f.owner];
      g.beginPath(); g.ellipse(p[0], p[1] - 3 - (f.z || 0) * (1 - Math.min(1, k * 4)), 7.5, 3.2, 0.3, 0, 7); g.fill();
      g.fillStyle = '#e2b78f'; g.beginPath(); g.arc(p[0] + 7, p[1] - 4, 2.8, 0, 7); g.fill();
      g.globalAlpha = 1;
    }
  },

  // ======================================================================
  // Platzierungsvorschau
  // ======================================================================
  drawGhost(g) {
    const gh = this.ghost;
    if (!gh) return;
    if (gh.line) {
      for (const t of gh.line) {
        g.fillStyle = t.ok ? 'rgba(120,220,120,0.35)' : 'rgba(230,80,60,0.45)';
        this.diamond(g, t.x, t.y); g.fill();
        if (t.ok) this.drawBuilding(g, { type: gh.type, owner: 0, x: t.x, y: t.y, w: 1, h: 1, hp: 1, maxHp: 1, id: 0 }, 0.6);
      }
      return;
    }
    const D = BUILDINGS[gh.type];
    for (let yy = gh.y; yy < gh.y + D.h; yy++) for (let xx = gh.x; xx < gh.x + D.w; xx++) {
      g.fillStyle = gh.ok ? 'rgba(120,220,120,0.35)' : 'rgba(230,80,60,0.45)';
      this.diamond(g, xx, yy); g.fill();
    }
    this.drawBuilding(g, { type: gh.type, owner: 0, x: gh.x, y: gh.y, w: D.w, h: D.h, hp: 1, maxHp: 1, id: 0 }, gh.ok ? 0.7 : 0.4);
    if (gh.type === 'woodcutter' || gh.type === 'tower') {
      const r = gh.type === 'tower' ? UNITS.archer.range + 3 : 18;
      const c = P(gh.x + D.w / 2, gh.y + D.h / 2);
      g.strokeStyle = 'rgba(255,240,180,0.45)'; g.lineWidth = 1.5; g.setLineDash([6, 6]);
      g.beginPath(); g.ellipse(c[0], c[1], r * HW * 1.414, r * HH * 1.414, 0, 0, 7); g.stroke();
      g.setLineDash([]);
    }
  },

  // ======================================================================
  // Minikarte
  // ======================================================================
  buildMiniTerrain() {
    const n = World.n;
    const c = document.createElement('canvas');
    c.width = n; c.height = n;
    const g = c.getContext('2d');
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const col = TCOL[World.tile(x, y)][0];
      const i = (y * n + x) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.miniTerrain = c;
  },

  miniXf(mc) {
    const n = World.n, W = mc.width;
    const s = W / n;
    return { s, f: (x, y) => [W / 2 + (x - y) * s / 2, (x + y) * s / 4 + (mc.height - W / 2) / 2] };
  },

  drawMini(mc) {
    if (!G.s || !this.miniTerrain || !mc.offsetParent) return;
    const g = mc.getContext('2d');
    const n = World.n;
    const { s, f } = this.miniXf(mc);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, mc.width, mc.height);
    const o = f(0, 0);
    g.setTransform(s / 2, s / 4, -s / 2, s / 4, o[0], o[1]);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.miniTerrain, 0, 0);
    g.fillStyle = 'rgba(50,85,30,0.8)';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (World.trees[y * n + x]) g.fillRect(x, y, 1, 1);
    for (const b of G.s.buildings) { g.fillStyle = b.owner === 0 ? '#6f9bff' : '#ff6a52'; g.fillRect(b.x, b.y, b.w, b.h); }
    for (const u of G.s.units) {
      if (u.type === 'peasant') continue;
      g.fillStyle = u.owner === 0 ? '#d6e3ff' : '#ffc2b6';
      g.fillRect(u.x - 0.7, u.y - 0.7, 1.4, 1.4);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const corners = [[0, 0], [this.W, 0], [this.W, this.H], [0, this.H]].map(([sx, sy]) => { const t = this.screenToTile(sx, sy); return f(t[0], t[1]); });
    g.strokeStyle = 'rgba(255,245,215,0.95)'; g.lineWidth = 1.2;
    g.beginPath(); corners.forEach((c, i) => i ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1])); g.closePath(); g.stroke();
  },

  miniToTile(mc, mx, my) {
    const n = World.n, W = mc.width, s = W / n;
    const oy = (mc.height - W / 2) / 2;
    const a = (mx - W / 2) / (s / 2), b = (my - oy) / (s / 4);
    return [(a + b) / 2, (b - a) / 2];
  },

  // Symbolbild eines Gebäudes für die Bauleiste
  icon(type, size) {
    const c = document.createElement('canvas');
    const W = size || 64;
    c.width = W * 2; c.height = W * 2;
    const g = c.getContext('2d');
    const D = BUILDINGS[type];
    const fw = (D.w + D.h) * HW, fh = (BUILD_H[type] || 30) + (D.w + D.h) * HH;
    const sc = Math.min(2.4, (W * 2 * 0.9) / Math.max(fw, fh));
    g.translate(W, W * 2 - 8);
    g.scale(sc, sc);
    const c0 = P(D.w, D.h);
    g.translate(-c0[0], -c0[1]);
    this.drawStatic(g, type, 0, D.w, D.h, type === 'stockpile' ? '221' : '');
    return c.toDataURL();
  },
};
