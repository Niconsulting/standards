'use strict';
// Isometrische Darstellung (Canvas 2D)

const HW = TW / 2, HH = TH / 2;
function P(x, y) { return [(x - y) * HW, (x + y) * HH]; }

const TERRAIN_COL = {
  [T.SAND]: '#d8b878', [T.GRASS]: '#82984a', [T.ROCK]: '#928a7c', [T.IRON]: '#9b5d3e', [T.WATER]: '#3d7d9c',
};

const R = {
  cv: null, ctx: null, W: 0, H: 0, dpr: 1,
  cam: { x: 0, y: 0, z: 1 },
  terrain: null, ox: 0,
  hover: null,     // {x,y} Kachel unter der Maus
  ghost: null,     // {type, x, y, ok} oder Mauerlinie
  selRect: null,
  t: 0,

  init(cv) {
    this.cv = cv;
    this.ctx = cv.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = this.cv.clientWidth; this.H = this.cv.clientHeight;
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
  },

  centerOn(x, y) { const p = P(x, y); this.cam.x = p[0]; this.cam.y = p[1]; this.clampCam(); },
  clampCam() {
    const n = World.n;
    this.cam.x = U.clamp(this.cam.x, -n * HW, n * HW);
    this.cam.y = U.clamp(this.cam.y, 0, n * TH);
  },
  screenToWorld(sx, sy) {
    return [(sx - this.W / 2) / this.cam.z + this.cam.x, (sy - this.H / 2) / this.cam.z + this.cam.y];
  },
  screenToTile(sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const a = wx / HW, b = wy / HH;
    return [(a + b) / 2, (b - a) / 2];
  },
  tileToScreen(x, y, z) {
    const p = P(x, y);
    return [(p[0] - this.cam.x) * this.cam.z + this.W / 2, (p[1] - (z || 0) - this.cam.y) * this.cam.z + this.H / 2];
  },

  // ---------- Gelände vorberechnen ----------
  buildTerrain() {
    const n = World.n;
    const c = document.createElement('canvas');
    c.width = n * TW; c.height = n * TH + 4;
    const g = c.getContext('2d');
    this.ox = n * HW;
    g.translate(this.ox, 0);
    const seed = World.seed;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = World.tile(x, y);
      const h = U.hash(x, y, seed);
      const base = TERRAIN_COL[t];
      const v = (h - 0.5) * (t === T.WATER ? 0.06 : 0.12);
      g.fillStyle = U.shade(base, v);
      this.diamond(g, x, y, 1.02);
      g.fill();
    }
    // Übergänge weich zeichnen: Flecken der Nachbarfarbe
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = World.tile(x, y);
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (!World.inb(nx, ny)) continue;
        const nt = World.tile(nx, ny);
        if (nt === t || nt === T.WATER || t === T.WATER) continue;
        g.globalAlpha = 0.45;
        g.fillStyle = TERRAIN_COL[nt];
        for (let j = 0; j < 3; j++) {
          const r1 = U.hash(x * 3 + j, y * 7 + k, seed + 9), r2 = U.hash(x * 5 + k, y * 3 + j, seed + 4);
          const px = x + 0.5 + DX[k] * 0.42 + (r1 - 0.5) * (DY[k] ? 0.9 : 0.2);
          const py = y + 0.5 + DY[k] * 0.42 + (r2 - 0.5) * (DX[k] ? 0.9 : 0.2);
          const p = P(px, py);
          g.beginPath(); g.ellipse(p[0], p[1], 7 + r1 * 6, 3.5 + r2 * 3, 0, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
      }
    }
    // Details
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = World.tile(x, y);
      const r = k => U.hash(x * 17 + k, y * 31 + k * 7, seed + k);
      if (t === T.SAND) {
        g.strokeStyle = 'rgba(150,110,60,0.22)'; g.lineWidth = 1;
        if (r(1) < 0.55) {
          const p = P(x + 0.2 + r(2) * 0.5, y + 0.2 + r(3) * 0.5);
          g.beginPath(); g.moveTo(p[0] - 8, p[1]); g.quadraticCurveTo(p[0], p[1] - 3, p[0] + 8, p[1]); g.stroke();
        }
        if (r(4) < 0.12) { const p = P(x + r(5), y + r(6)); g.fillStyle = 'rgba(120,90,60,0.5)'; g.fillRect(p[0], p[1], 2, 1.5); }
      } else if (t === T.GRASS) {
        g.strokeStyle = 'rgba(70,100,35,0.8)'; g.lineWidth = 1;
        for (let j = 0; j < 4; j++) {
          const p = P(x + r(j + 1), y + r(j + 9));
          g.beginPath(); g.moveTo(p[0] - 2, p[1]); g.lineTo(p[0] - 1, p[1] - 4); g.moveTo(p[0] + 1, p[1]); g.lineTo(p[0] + 2, p[1] - 3); g.stroke();
        }
      } else if (t === T.ROCK || t === T.IRON) {
        for (let j = 0; j < 3; j++) {
          const p = P(x + 0.15 + r(j + 1) * 0.7, y + 0.15 + r(j + 5) * 0.7);
          const s = 3 + r(j + 3) * 5;
          g.fillStyle = t === T.ROCK ? U.shade('#a39b8c', (r(j) - 0.5) * 0.3) : U.shade('#7a4a33', (r(j) - 0.5) * 0.3);
          g.beginPath(); g.moveTo(p[0] - s, p[1]); g.lineTo(p[0] - s * 0.4, p[1] - s * 0.8); g.lineTo(p[0] + s * 0.6, p[1] - s * 0.6); g.lineTo(p[0] + s, p[1]); g.closePath(); g.fill();
          g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.moveTo(p[0] - s, p[1]); g.lineTo(p[0] + s, p[1]); g.lineTo(p[0] + s * 0.4, p[1] + 2); g.closePath(); g.fill();
        }
      } else if (t === T.WATER) {
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], ny = y + DY[k];
          if (World.inb(nx, ny) && World.tile(nx, ny) !== T.WATER) {
            g.strokeStyle = 'rgba(230,220,180,0.55)'; g.lineWidth = 2;
            const a = k === 0 ? [P(x + 1, y), P(x + 1, y + 1)] : k === 1 ? [P(x, y), P(x, y + 1)] : k === 2 ? [P(x, y + 1), P(x + 1, y + 1)] : [P(x, y), P(x + 1, y)];
            g.beginPath(); g.moveTo(a[0][0], a[0][1]); g.lineTo(a[1][0], a[1][1]); g.stroke();
          }
        }
      }
    }
    this.terrain = c;
    this.buildMiniTerrain();
  },

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

  // ---------- Bild ----------
  frame(dt) {
    this.t += dt;
    const g = this.ctx, z = this.cam.z, dpr = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1d1712';
    g.fillRect(0, 0, this.cv.width, this.cv.height);
    if (!G.s || !this.terrain) return;
    const ox = dpr * (this.W / 2 - this.cam.x * z), oy = dpr * (this.H / 2 - this.cam.y * z);
    g.setTransform(dpr * z, 0, 0, dpr * z, ox, oy);
    // sichtbarer Weltausschnitt
    const [wx0, wy0] = this.screenToWorld(0, 0), [wx1, wy1] = this.screenToWorld(this.W, this.H);
    this.view = { x0: wx0 - 80, y0: wy0 - 120, x1: wx1 + 80, y1: wy1 + 60 };
    const sx = U.clamp(wx0 + this.ox, 0, this.terrain.width), sy = U.clamp(wy0, 0, this.terrain.height);
    const ex = U.clamp(wx1 + this.ox, 0, this.terrain.width), ey = U.clamp(wy1, 0, this.terrain.height);
    g.imageSmoothingEnabled = true;
    if (ex > sx && ey > sy) g.drawImage(this.terrain, sx, sy, ex - sx, ey - sy, sx - this.ox, sy, ex - sx, ey - sy);
    this.drawWater(g);
    this.drawOverlays(g);
    this.drawObjects(g);
    this.drawProjectiles(g);
    this.drawGhost(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.selRect) {
      const r = this.selRect;
      g.strokeStyle = 'rgba(255,240,200,0.9)'; g.lineWidth = dpr;
      g.fillStyle = 'rgba(255,240,200,0.08)';
      const x = Math.min(r.x0, r.x1) * dpr, y = Math.min(r.y0, r.y1) * dpr, w = Math.abs(r.x1 - r.x0) * dpr, h = Math.abs(r.y1 - r.y0) * dpr;
      g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
    }
  },

  visible(wx, wy) { const v = this.view; return wx > v.x0 && wx < v.x1 && wy > v.y0 && wy < v.y1 + 100; },

  drawWater(g) {
    const n = World.n, t = this.t;
    g.strokeStyle = 'rgba(200,235,255,0.35)'; g.lineWidth = 1;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (World.tile(x, y) !== T.WATER) continue;
      const p = P(x + 0.5, y + 0.5);
      if (!this.visible(p[0], p[1])) continue;
      const ph = U.hash(x, y, 5) * 6 + t * 1.2;
      const o = Math.sin(ph) * 6;
      g.beginPath(); g.moveTo(p[0] - 8 + o, p[1] - 2); g.lineTo(p[0] + o, p[1] - 2); g.stroke();
    }
  },

  drawOverlays(g) {
    // Auswahl-Markierung Gebäude
    const sb = G.bmap.get(UI.selB);
    if (sb) {
      g.strokeStyle = sb.owner === 0 ? 'rgba(255,240,170,0.9)' : 'rgba(255,120,100,0.9)'; g.lineWidth = 2 / this.cam.z;
      this.rectPath(g, sb.x - 0.05, sb.y - 0.05, sb.w + 0.1, sb.h + 0.1); g.stroke();
    }
    // Ringe ausgewählter Einheiten
    for (const id of UI.sel) {
      const u = G.umap.get(id);
      if (!u) continue;
      const p = P(u.x, u.y);
      g.strokeStyle = 'rgba(255,240,170,0.95)'; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(p[0], p[1] - (u.z || 0), 11, 5.5, 0, 0, Math.PI * 2); g.stroke();
    }
    if (this.hover && UI.mode === 'select') {
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
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
    // Lebensbalken
    for (const o of list) {
      if (o.k === 1) {
        const b = o.b;
        if (b.hp < b.maxHp || UI.selB === b.id) {
          const p = P(b.x + b.w / 2, b.y + b.h / 2);
          this.bar(g, p[0], p[1] - (BUILD_H[b.type] || 30) - 14, 34, b.hp / b.maxHp);
        }
      } else if (o.k === 2) {
        const u = o.u;
        if (u.hp < u.maxHp || UI.sel.has(u.id)) {
          const p = P(u.x, u.y);
          this.bar(g, p[0], p[1] - (u.z || 0) - (u.type === 'knight' ? 38 : 32), 18, u.hp / u.maxHp);
        }
      }
    }
  },

  bar(g, x, y, w, f) {
    f = U.clamp(f, 0, 1);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
    g.fillStyle = f > 0.5 ? '#6fcf4f' : f > 0.25 ? '#e3b23c' : '#d9442f';
    g.fillRect(x - w / 2, y, w * f, 3);
  },

  // ---------- Grundformen ----------
  poly(g, pts, fill) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath(); g.fillStyle = fill; g.fill();
  },
  box(g, x, y, w, d, z0, h, top, left, right) {
    const A = P(x, y), B = P(x + w, y), C = P(x + w, y + d), D = P(x, y + d);
    const lo = z0, hi = z0 + h;
    this.poly(g, [[D[0], D[1] - lo], [C[0], C[1] - lo], [C[0], C[1] - hi], [D[0], D[1] - hi]], left);
    this.poly(g, [[C[0], C[1] - lo], [B[0], B[1] - lo], [B[0], B[1] - hi], [C[0], C[1] - hi]], right);
    if (top) this.poly(g, [[A[0], A[1] - hi], [B[0], B[1] - hi], [C[0], C[1] - hi], [D[0], D[1] - hi]], top);
  },
  // Kasten mit Grundfarbe, automatisch schattiert
  sbox(g, x, y, w, d, z0, h, col) {
    this.box(g, x, y, w, d, z0, h, U.shade(col, 0.12), U.shade(col, -0.12), U.shade(col, -0.32));
  },
  pyramid(g, x, y, w, d, z, rh, col) {
    const A = P(x, y), B = P(x + w, y), C = P(x + w, y + d), D = P(x, y + d);
    const M = P(x + w / 2, y + d / 2);
    const ap = [M[0], M[1] - z - rh];
    const up = q => [q[0], q[1] - z];
    this.poly(g, [up(A), up(B), ap], U.shade(col, 0.15));
    this.poly(g, [up(A), up(D), ap], U.shade(col, 0.05));
    this.poly(g, [up(D), up(C), ap], U.shade(col, -0.05));
    this.poly(g, [up(C), up(B), ap], U.shade(col, -0.3));
  },
  gable(g, x, y, w, d, z, rh, col, wallCol) {
    // First entlang x
    const A = P(x, y), B = P(x + w, y), C = P(x + w, y + d), D = P(x, y + d);
    const R1 = P(x, y + d / 2), R2 = P(x + w, y + d / 2);
    const up = (q, e) => [q[0], q[1] - z - (e || 0)];
    this.poly(g, [up(A), up(B), up(R2, rh), up(R1, rh)], U.shade(col, 0.1));
    this.poly(g, [up(D), up(C), up(R2, rh), up(R1, rh)], U.shade(col, -0.05));
    this.poly(g, [up(C), up(B), up(R2, rh)], U.shade(wallCol || col, -0.3));
  },
  merlons(g, x, y, w, d, z, col, step) {
    step = step || 0.34;
    const s = 0.16, h = 6;
    const pts = [];
    for (let t = 0; t <= w - s + 0.001; t += step) { pts.push([x + t, y]); pts.push([x + t, y + d - s]); }
    for (let t = step; t <= d - s - step + 0.001; t += step) { pts.push([x, y + t]); pts.push([x + w - s, y + t]); }
    pts.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    for (const [mx, my] of pts) this.sbox(g, mx, my, s, s, z, h, col);
  },
  flag(g, x, y, z, color, size) {
    size = size || 1;
    const p = P(x, y);
    const top = p[1] - z - 26 * size;
    g.strokeStyle = '#3b2b1b'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(p[0], p[1] - z); g.lineTo(p[0], top); g.stroke();
    const wv = Math.sin(this.t * 4 + x) * 2;
    g.fillStyle = color;
    g.beginPath(); g.moveTo(p[0], top); g.quadraticCurveTo(p[0] + 8 * size, top + wv - 1, p[0] + 15 * size, top + 3 + wv);
    g.lineTo(p[0] + 15 * size, top + 11 * size + wv); g.quadraticCurveTo(p[0] + 8 * size, top + 8 * size + wv, p[0], top + 9 * size); g.closePath(); g.fill();
  },
  window(g, x, y, z, face) {
    // kleines dunkles Fenster auf der linken (face=0, entlang x) oder rechten Fassade (face=1, entlang y)
    const a = face ? P(x, y) : P(x, y), b = face ? P(x, y + 0.18) : P(x + 0.18, y);
    g.fillStyle = 'rgba(30,20,15,0.85)';
    g.beginPath(); g.moveTo(a[0], a[1] - z); g.lineTo(b[0], b[1] - z); g.lineTo(b[0], b[1] - z - 7); g.lineTo(a[0], a[1] - z - 7); g.closePath(); g.fill();
  },
  door(g, x, y, w, h, face) {
    // face 0: auf der Fassade y = const (links-unten), face 1: auf x = const (rechts-unten)
    const a = P(x, y), b = face ? P(x, y + w) : P(x + w, y);
    g.fillStyle = '#2e2117';
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(b[0], b[1] - h * 0.75);
    g.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - h * 1.15, a[0], a[1] - h * 0.75); g.closePath(); g.fill();
  },

  // ---------- Bäume ----------
  drawTree(g, x, y, wood, terr) {
    const h = U.hash(x, y, 3);
    const p = P(x + 0.5 + (h - 0.5) * 0.3, y + 0.5 + (U.hash(y, x, 4) - 0.5) * 0.3);
    const s = 0.75 + Math.min(wood, 8) / 8 * 0.35;
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath(); g.ellipse(p[0] + 4, p[1], 12 * s, 5 * s, 0, 0, Math.PI * 2); g.fill();
    if (terr === T.GRASS && h < 0.45) {
      // Laubbaum
      g.fillStyle = '#5a3e24'; g.fillRect(p[0] - 1.5, p[1] - 14 * s, 3, 14 * s);
      const c = U.shade('#4f7a2e', (h - 0.2) * 0.4);
      g.fillStyle = c;
      g.beginPath(); g.arc(p[0], p[1] - 22 * s, 11 * s, 0, Math.PI * 2); g.fill();
      g.fillStyle = U.shade('#4f7a2e', 0.2);
      g.beginPath(); g.arc(p[0] - 3 * s, p[1] - 25 * s, 6 * s, 0, Math.PI * 2); g.fill();
      return;
    }
    // Palme
    const sway = Math.sin(this.t * 1.3 + h * 10) * 1.2;
    const lean = (h - 0.5) * 10;
    const tx = p[0] + lean * s + sway, ty = p[1] - 34 * s;
    g.strokeStyle = '#7a5833'; g.lineWidth = 3.2 * s; g.lineCap = 'round';
    g.beginPath(); g.moveTo(p[0], p[1]); g.quadraticCurveTo(p[0] + lean * 0.2, p[1] - 18 * s, tx, ty); g.stroke();
    g.strokeStyle = 'rgba(60,40,20,0.5)'; g.lineWidth = 1;
    for (let k = 1; k < 5; k++) {
      const yy = p[1] - k * 7 * s, xx = p[0] + lean * s * (k / 5) * (k / 5);
      g.beginPath(); g.moveTo(xx - 2, yy); g.lineTo(xx + 2, yy - 1); g.stroke();
    }
    const fronds = 7;
    for (let k = 0; k < fronds; k++) {
      const a = k / fronds * Math.PI * 2 + h * 3;
      const len = 15 * s;
      const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.5 + 6 * s;
      g.strokeStyle = k % 2 ? '#4d7a2c' : '#5f8f35'; g.lineWidth = 3.5 * s;
      g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo((tx + ex) / 2, ty - 6 * s, ex, ey); g.stroke();
    }
    g.lineCap = 'butt';
    g.fillStyle = '#6b4a24';
    g.beginPath(); g.arc(tx, ty + 1, 2.2 * s, 0, Math.PI * 2); g.fill();
  },

  // ---------- Gebäude ----------
  drawBuilding(g, b, alpha) {
    if (alpha < 1) g.globalAlpha = alpha;
    const col = PLAYER_COLORS[b.owner];
    const { x, y, w, h } = b;
    const stone = '#b9ad98', stoneD = '#a0947f', wood = '#9a6c3f', woodD = '#7a5230', plaster = '#d9c9a6';
    // Bodenplatte
    if (b.type !== 'wall' && b.type !== 'gate') {
      g.fillStyle = 'rgba(80,60,40,0.22)';
      this.rectPath(g, x + 0.05, y + 0.05, w - 0.1, h - 0.1); g.fill();
    }
    switch (b.type) {
      case 'keep': {
        this.sbox(g, x + 0.2, y + 0.2, 2.6, 2.6, 0, 74, stone);
        this.merlons(g, x + 0.2, y + 0.2, 2.6, 2.6, 74, stone, 0.42);
        this.sbox(g, x + 1.9, y + 1.9, 1.0, 1.0, 0, 92, stoneD);
        this.merlons(g, x + 1.9, y + 1.9, 1.0, 1.0, 92, stoneD, 0.42);
        this.door(g, x + 0.9, y + 2.8, 0.7, 22, 0);
        for (const k of [0.6, 1.4, 2.2]) { this.window(g, x + k, y + 2.8, 44, 0); this.window(g, x + 2.8, y + k - 0.2, 52, 1); }
        // Banner an der Fassade
        const a = P(x + 0.35, y + 2.8), c2 = P(x + 0.65, y + 2.8);
        g.fillStyle = col;
        g.beginPath(); g.moveTo(a[0], a[1] - 66); g.lineTo(c2[0], c2[1] - 66); g.lineTo(c2[0], c2[1] - 38); g.lineTo((a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2 - 43); g.lineTo(a[0], a[1] - 38); g.closePath(); g.fill();
        this.flag(g, x + 2.4, y + 2.4, 98, col, 1.2);
        break;
      }
      case 'stockpile': {
        g.fillStyle = '#b89a6a'; this.rectPath(g, x + 0.1, y + 0.1, w - 0.2, h - 0.2); g.fill();
        g.strokeStyle = '#6f5333'; g.lineWidth = 1.5; g.stroke();
        const r = G.s ? G.s.players[b.owner].res : { holz: 80, stein: 80, eisen: 40 };
        const lv = k => Math.min(4, Math.ceil((r[k] || 0) / 40));
        for (let i = 0; i < lv('holz'); i++) this.sbox(g, x + 0.25, y + 0.25 + i * 0.15, 0.8, 0.12, i * 3, 5, wood);
        for (let i = 0; i < lv('stein'); i++) this.sbox(g, x + 1.1, y + 0.3, 0.6, 0.6, i * 5, 5, '#a9a291');
        for (let i = 0; i < lv('eisen'); i++) this.sbox(g, x + 0.3, y + 1.15, 0.5, 0.4, i * 4, 4, '#6b6f78');
        this.sbox(g, x + 1.15, y + 1.2, 0.5, 0.5, 0, 8, '#8a6a42');
        break;
      }
      case 'granary': {
        this.sbox(g, x + 0.25, y + 0.25, 1.5, 1.5, 0, 26, wood);
        this.gable(g, x + 0.15, y + 0.15, 1.7, 1.7, 26, 18, '#b5894e', wood);
        this.door(g, x + 0.75, y + 1.75, 0.5, 15, 0);
        this.sbox(g, x + 1.6, y + 1.4, 0.3, 0.3, 0, 6, '#d8c08a');
        break;
      }
      case 'woodcutter': {
        this.sbox(g, x + 0.2, y + 0.2, 1.2, 1.1, 0, 18, wood);
        this.pyramid(g, x + 0.1, y + 0.1, 1.4, 1.3, 18, 14, '#8a6038');
        for (let i = 0; i < 3; i++) this.sbox(g, x + 1.2, y + 1.2 + i * 0.18, 0.6, 0.15, 0, 4 + i, '#8a5d33');
        this.sbox(g, x + 0.5, y + 1.55, 0.25, 0.25, 0, 5, '#6b4a2a');
        break;
      }
      case 'quarry': {
        g.fillStyle = '#7c7568'; this.rectPath(g, x + 0.2, y + 0.2, 2.6, 2.6); g.fill();
        g.fillStyle = '#5d574d'; this.rectPath(g, x + 0.6, y + 0.6, 1.4, 1.4); g.fill();
        this.sbox(g, x + 2.2, y + 0.4, 0.5, 0.5, 0, 9, '#b7b0a1');
        this.sbox(g, x + 2.2, y + 1.1, 0.5, 0.5, 0, 9, '#b7b0a1');
        this.sbox(g, x + 2.2, y + 1.1, 0.5, 0.5, 9, 7, '#c2bbac');
        // Kran
        const a = P(x + 0.5, y + 2.5), c2 = P(x + 1.3, y + 1.3);
        g.strokeStyle = '#6e4b2a'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(a[0], a[1] - 40); g.lineTo(c2[0], c2[1] - 34); g.stroke();
        g.lineWidth = 1; g.strokeStyle = '#3a2a1a';
        g.beginPath(); g.moveTo(c2[0], c2[1] - 34); g.lineTo(c2[0], c2[1] - 12); g.stroke();
        this.sbox(g, x + 1.2, y + 1.2, 0.25, 0.25, 6, 5, '#b7b0a1');
        break;
      }
      case 'mine': {
        g.fillStyle = '#6f4532'; this.rectPath(g, x + 0.15, y + 0.15, 1.7, 1.7); g.fill();
        this.sbox(g, x + 0.3, y + 0.3, 1.1, 1.1, 0, 16, woodD);
        this.pyramid(g, x + 0.25, y + 0.25, 1.2, 1.2, 16, 10, '#5d3f25');
        this.door(g, x + 0.6, y + 1.4, 0.5, 13, 0);
        for (let i = 0; i < 3; i++) this.sbox(g, x + 1.45, y + 1.1 + i * 0.22, 0.35, 0.2, 0, 4, '#5a3527');
        break;
      }
      case 'orchard': {
        g.fillStyle = '#5f7f34'; this.rectPath(g, x + 0.1, y + 0.1, 2.8, 2.8); g.fill();
        g.strokeStyle = '#7a5a36'; g.lineWidth = 1.5; g.stroke();
        for (const [ox, oy] of [[0.75, 0.75], [2.15, 0.75], [0.75, 2.15], [2.15, 2.15], [1.45, 1.45]]) {
          const p = P(x + ox, y + oy);
          g.fillStyle = '#5a3e24'; g.fillRect(p[0] - 1.2, p[1] - 10, 2.4, 10);
          g.fillStyle = '#3f6e2a'; g.beginPath(); g.arc(p[0], p[1] - 15, 8, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#c7342a';
          for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(p[0] - 5 + k * 3.2, p[1] - 14 - (k % 2) * 5, 1.4, 0, Math.PI * 2); g.fill(); }
        }
        break;
      }
      case 'house': {
        this.sbox(g, x + 0.3, y + 0.3, 1.4, 1.4, 0, 20, plaster);
        this.pyramid(g, x + 0.2, y + 0.2, 1.6, 1.6, 20, 18, '#b48a4c');
        this.door(g, x + 0.85, y + 1.7, 0.35, 12, 0);
        this.window(g, x + 1.7, y + 0.8, 10, 1);
        break;
      }
      case 'chapel': {
        this.sbox(g, x + 0.3, y + 0.25, 1.4, 1.5, 0, 30, '#e3dccb');
        this.gable(g, x + 0.25, y + 0.2, 1.5, 1.6, 30, 16, '#8a5a3a', '#e3dccb');
        this.sbox(g, x + 1.25, y + 1.3, 0.45, 0.45, 0, 46, '#d6cfbd');
        this.pyramid(g, x + 1.2, y + 1.25, 0.55, 0.55, 46, 18, '#8a5a3a');
        this.door(g, x + 0.6, y + 1.75, 0.35, 14, 0);
        break;
      }
      case 'barracks': {
        this.sbox(g, x + 0.25, y + 0.25, 2.5, 1.9, 0, 32, stoneD);
        this.merlons(g, x + 0.25, y + 0.25, 2.5, 1.9, 32, stoneD, 0.42);
        this.door(g, x + 1.2, y + 2.15, 0.6, 18, 0);
        const a = P(x + 0.5, y + 2.15), c2 = P(x + 0.85, y + 2.15);
        g.fillStyle = col;
        g.beginPath(); g.moveTo(a[0], a[1] - 28); g.lineTo(c2[0], c2[1] - 28); g.lineTo(c2[0], c2[1] - 8); g.lineTo(a[0], a[1] - 8); g.closePath(); g.fill();
        // Übungspuppe
        const d1 = P(x + 2.4, y + 2.6);
        g.strokeStyle = '#6e4b2a'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(d1[0], d1[1]); g.lineTo(d1[0], d1[1] - 14); g.moveTo(d1[0] - 5, d1[1] - 10); g.lineTo(d1[0] + 5, d1[1] - 10); g.stroke();
        g.fillStyle = '#c9a66b'; g.beginPath(); g.arc(d1[0], d1[1] - 16, 3, 0, Math.PI * 2); g.fill();
        this.flag(g, x + 2.5, y + 0.5, 38, col, 1);
        break;
      }
      case 'wall': {
        this.sbox(g, x, y, 1, 1, 0, 30, stone);
        this.merlons(g, x, y, 1, 1, 30, stone, 0.42);
        break;
      }
      case 'gate': {
        this.sbox(g, x, y, 1, 1, 0, 38, stoneD);
        this.merlons(g, x, y, 1, 1, 38, stoneD, 0.42);
        this.door(g, x + 0.2, y + 1, 0.6, 24, 0);
        this.door(g, x + 1, y + 0.2, 0.6, 24, 1);
        const a = P(x + 0.35, y + 1);
        g.fillStyle = col; g.fillRect(a[0] - 1, a[1] - 34, 6, 7);
        break;
      }
      case 'tower': {
        this.sbox(g, x + 0.1, y + 0.1, 1.8, 1.8, 0, 56, stone);
        this.merlons(g, x + 0.1, y + 0.1, 1.8, 1.8, 56, stone, 0.4);
        for (const k of [0.6, 1.3]) { this.window(g, x + k, y + 1.9, 36, 0); this.window(g, x + 1.9, y + k - 0.1, 36, 1); }
        const a = P(x + 0.4, y + 1.9);
        g.fillStyle = col; g.fillRect(a[0] - 2, a[1] - 52, 5, 9);
        break;
      }
    }
    // Schaden: Rauch
    if (b.hp < b.maxHp * 0.5 && alpha === 1) {
      const p = P(x + w / 2, y + h / 2);
      const hh = BUILD_H[b.type] || 30;
      for (let k = 0; k < 3; k++) {
        const ph = (this.t * 0.6 + k / 3) % 1;
        g.fillStyle = 'rgba(60,55,50,' + (0.45 * (1 - ph)) + ')';
        g.beginPath(); g.arc(p[0] + Math.sin(ph * 6 + k) * 5, p[1] - hh - ph * 30, 4 + ph * 8, 0, Math.PI * 2); g.fill();
      }
    }
    if (b.hitT > 0 && alpha === 1) {
      b.hitT -= 0.016;
      g.fillStyle = 'rgba(255,230,180,0.25)';
      this.rectPath(g, x, y, w, h); g.fill();
    }
    g.globalAlpha = 1;
  },

  drawFire(g, f) {
    const p = P(f.x + 0.5, f.y + 0.5);
    if (!this.visible(p[0], p[1])) return;
    const fl = Math.sin(this.t * 13) * 1.5 + Math.sin(this.t * 7.3) * 1;
    const grd = g.createRadialGradient(p[0], p[1] - 4, 2, p[0], p[1] - 4, 26);
    grd.addColorStop(0, 'rgba(255,190,90,0.35)'); grd.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = grd; g.beginPath(); g.ellipse(p[0], p[1], 28, 16, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#5a3a1e'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(p[0] - 7, p[1] + 1); g.lineTo(p[0] + 7, p[1] - 2); g.moveTo(p[0] - 6, p[1] - 2); g.lineTo(p[0] + 6, p[1] + 2); g.stroke();
    g.fillStyle = '#f08a24';
    g.beginPath(); g.moveTo(p[0] - 5, p[1] - 1); g.quadraticCurveTo(p[0] - 3, p[1] - 10 - fl, p[0], p[1] - 15 - fl); g.quadraticCurveTo(p[0] + 4, p[1] - 9, p[0] + 5, p[1] - 1); g.closePath(); g.fill();
    g.fillStyle = '#ffd25a';
    g.beginPath(); g.moveTo(p[0] - 2.5, p[1] - 1); g.quadraticCurveTo(p[0], p[1] - 9 - fl, p[0] + 2.5, p[1] - 1); g.closePath(); g.fill();
  },

  // ---------- Einheiten ----------
  drawUnit(g, u) {
    const p = P(u.x, u.y);
    const x = p[0], y = p[1] - (u.z || 0);
    const col = PLAYER_COLORS[u.owner];
    const walk = u.moving ? Math.sin(u.anim * 12) : 0;
    const f = u.face || 1;
    if (!u.tower) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.ellipse(x, y, u.type === 'knight' ? 10 : 6, u.type === 'knight' ? 4 : 3, 0, 0, Math.PI * 2); g.fill();
    }
    const hit = u.hitT > 0;
    if (u.type === 'knight') { this.drawKnight(g, u, x, y, col, walk, f, hit); return; }
    // Beine
    g.strokeStyle = '#3a2a1c'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x - 1.5, y - 8); g.lineTo(x - 1.5 + walk * 2.5, y - 0.5); g.moveTo(x + 1.5, y - 8); g.lineTo(x + 1.5 - walk * 2.5, y - 0.5); g.stroke();
    // Körper
    let body = col, head = '#e2b78f';
    if (u.type === 'peasant') body = u.owner === 0 ? '#b39a6c' : '#a8875f';
    if (u.type === 'sword') body = '#9aa0a8';
    const bob = u.working ? Math.abs(Math.sin(u.anim * 6)) * 1.5 : 0;
    g.fillStyle = hit ? '#ff5a4a' : body;
    g.beginPath(); g.ellipse(x, y - 12 - bob, 4.2, 6, 0, 0, Math.PI * 2); g.fill();
    if (u.type === 'sword') { g.fillStyle = col; g.fillRect(x - 2.5, y - 15 - bob, 5, 8); }
    if (u.type === 'peasant') { g.fillStyle = PLAYER_COLORS[u.owner]; g.fillRect(x - 4, y - 10 - bob, 8, 1.6); }
    // Kopf
    g.fillStyle = head;
    g.beginPath(); g.arc(x, y - 20 - bob, 3.2, 0, Math.PI * 2); g.fill();
    // Kopfbedeckung
    if (u.type === 'peasant') { g.fillStyle = '#cdb27a'; g.beginPath(); g.ellipse(x, y - 22 - bob, 4.5, 1.8, 0, 0, Math.PI * 2); g.fill(); }
    else if (u.type === 'archer') { g.fillStyle = U.shade(col, -0.3); g.beginPath(); g.arc(x, y - 21, 3.4, Math.PI, 0); g.fill(); }
    else { g.fillStyle = '#8c939c'; g.beginPath(); g.arc(x, y - 21, 3.6, Math.PI, 0); g.fill(); g.fillRect(x - 0.6, y - 21, 1.2, 3); }
    const atk = u.atkT > 0 ? u.atkT / 0.35 : 0;
    g.lineCap = 'round';
    if (u.type === 'archer') {
      g.strokeStyle = '#5b3b1d'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x + 5 * f, y - 14, 7, f > 0 ? -1.2 : Math.PI - 1.9, f > 0 ? 1.2 : Math.PI + 1.9 - 0.7); g.stroke();
      g.strokeStyle = 'rgba(240,230,200,0.8)'; g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(x + 5 * f + 2.5 * f, y - 20.5); g.lineTo(x + 5 * f - atk * 4 * f, y - 14); g.lineTo(x + 5 * f + 2.5 * f, y - 7.5); g.stroke();
    } else if (u.type === 'spear') {
      const thrust = atk * 5 * f;
      g.strokeStyle = '#6e4b2a'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(x - 5 * f + thrust, y - 4); g.lineTo(x + 9 * f + thrust, y - 28); g.stroke();
      g.fillStyle = '#c9ccd2'; g.beginPath(); g.moveTo(x + 9 * f + thrust, y - 28); g.lineTo(x + 7.5 * f + thrust, y - 24); g.lineTo(x + 10.5 * f + thrust, y - 25); g.closePath(); g.fill();
    } else if (u.type === 'sword') {
      g.fillStyle = U.shade(col, -0.2); g.beginPath(); g.ellipse(x - 4 * f, y - 12, 2.5, 5, 0, 0, Math.PI * 2); g.fill();
      const a = -0.8 + atk * 1.8;
      g.strokeStyle = '#dfe3e8'; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(x + 4 * f, y - 12); g.lineTo(x + 4 * f + Math.cos(a) * 10 * f, y - 12 - Math.sin(-a) * 10 - 6); g.stroke();
    } else if (u.type === 'peasant') {
      if (u.carry) {
        const c = { holz: '#8a5d33', stein: '#b5ae9f', eisen: '#5f6670', nahrung: '#c7342a' }[u.carry.res] || '#fff';
        g.fillStyle = c; g.fillRect(x - 3.5, y - 30 - bob, 7, 5);
      }
      if (u.working) {
        const a = Math.sin(u.anim * 8) * 0.9;
        g.strokeStyle = '#6e4b2a'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x + 3 * f, y - 13); g.lineTo(x + 3 * f + Math.cos(a) * 8 * f, y - 13 - Math.sin(a) * 8 - 3); g.stroke();
      }
    }
    g.lineCap = 'butt';
  },

  drawKnight(g, u, x, y, col, walk, f, hit) {
    const horse = hit ? '#ff5a4a' : '#7a5232';
    g.strokeStyle = '#4e331d'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x - 6, y - 8); g.lineTo(x - 6 + walk * 3, y);
    g.moveTo(x - 3, y - 8); g.lineTo(x - 3 - walk * 3, y);
    g.moveTo(x + 4, y - 8); g.lineTo(x + 4 + walk * 3, y);
    g.moveTo(x + 7, y - 8); g.lineTo(x + 7 - walk * 3, y);
    g.stroke();
    g.fillStyle = horse;
    g.beginPath(); g.ellipse(x, y - 11, 10, 5, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(x + 10 * f, y - 16, 3, 5.5, f * 0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = col; g.fillRect(x - 6, y - 13, 12, 4);
    g.fillStyle = '#9aa0a8';
    g.beginPath(); g.ellipse(x, y - 21, 3.5, 5.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8c939c'; g.beginPath(); g.arc(x, y - 28, 3.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = col; g.fillRect(x - 0.8, y - 34, 1.6, 3);
    const atk = u.atkT > 0 ? u.atkT / 0.35 : 0;
    g.strokeStyle = '#dfe3e8'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x + 2 * f, y - 21); g.lineTo(x + (11 + atk * 4) * f, y - 30 + atk * 10); g.stroke();
  },

  drawProjectiles(g) {
    g.strokeStyle = '#3a2a1a'; g.lineWidth = 1.4;
    for (const pr of G.proj) {
      const k = pr.t / pr.dur;
      const x = pr.x0 + (pr.tx - pr.x0) * k, y = pr.y0 + (pr.ty - pr.y0) * k;
      const d = U.dist(pr.x0, pr.y0, pr.tx, pr.ty);
      const z = pr.z0 + (pr.tz - pr.z0) * k + Math.sin(Math.PI * k) * d * 5;
      const k2 = Math.min(1, k + 0.05);
      const x2 = pr.x0 + (pr.tx - pr.x0) * k2, y2 = pr.y0 + (pr.ty - pr.y0) * k2;
      const z2 = pr.z0 + (pr.tz - pr.z0) * k2 + Math.sin(Math.PI * k2) * d * 5;
      const a = P(x, y), b = P(x2, y2);
      const dx = b[0] - a[0], dy = (b[1] - z2) - (a[1] - z);
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      g.beginPath(); g.moveTo(a[0], a[1] - z); g.lineTo(a[0] - dx / l * 8, a[1] - z - dy / l * 8); g.stroke();
    }
  },

  drawFx(g, f) {
    const p = P(f.x, f.y);
    const k = f.t / f.dur;
    if (f.k === 'dust' || f.k === 'leave' || f.k === 'fall') {
      g.fillStyle = 'rgba(200,175,130,' + (0.5 * (1 - k)) + ')';
      const r = (f.r || 1) * 14 * (0.5 + k);
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2;
        g.beginPath(); g.arc(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r * 0.5 - 6, 6 + k * 6, 0, Math.PI * 2); g.fill();
      }
    } else if (f.k === 'rubble') {
      g.globalAlpha = Math.min(1, (1 - k) * 2);
      for (let i = 0; i < 9; i++) {
        const h1 = U.hash(i, f.x | 0, 1), h2 = U.hash(i, f.y | 0, 2);
        const q = P(f.x + (h1 - 0.5) * f.r, f.y + (h2 - 0.5) * f.r);
        this.sbox(g, (f.x + (h1 - 0.5) * f.r) - 0.15, (f.y + (h2 - 0.5) * f.r) - 0.15, 0.3, 0.3, 0, 4 + h1 * 6, '#a39886');
        void q;
      }
      g.fillStyle = 'rgba(90,80,70,' + (0.4 * (1 - k)) + ')';
      g.beginPath(); g.arc(p[0], p[1] - 20 - k * 30, 10 + k * 20, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    } else if (f.k === 'mark') {
      g.strokeStyle = f.c; g.globalAlpha = 1 - k; g.lineWidth = 2;
      const r = (f.r || 0.5) * (1 - k * 0.5);
      g.beginPath(); g.ellipse(p[0], p[1], r * HW * 1.2, r * HH * 1.2, 0, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    } else if (f.k === 'death') {
      g.globalAlpha = 1 - k;
      g.fillStyle = f.type === 'peasant' ? '#b39a6c' : PLAYER_COLORS[f.owner];
      g.beginPath(); g.ellipse(p[0], p[1] - 3 - (f.z || 0) * (1 - Math.min(1, k * 4)), 7, 3, 0.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e2b78f'; g.beginPath(); g.arc(p[0] + 7, p[1] - 4, 2.6, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(120,20,15,0.6)'; g.beginPath(); g.ellipse(p[0] + 2, p[1], 6, 2.5, 0, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
  },

  // ---------- Platzierungsvorschau ----------
  drawGhost(g) {
    const gh = this.ghost;
    if (!gh) return;
    if (gh.line) {
      for (const t of gh.line) {
        g.fillStyle = t.ok ? 'rgba(120,220,120,0.35)' : 'rgba(230,80,60,0.4)';
        this.diamond(g, t.x, t.y); g.fill();
        if (t.ok) this.drawBuilding(g, { type: gh.type, owner: 0, x: t.x, y: t.y, w: 1, h: 1, hp: 1, maxHp: 1 }, 0.55);
      }
      return;
    }
    const D = BUILDINGS[gh.type];
    for (let yy = gh.y; yy < gh.y + D.h; yy++) for (let xx = gh.x; xx < gh.x + D.w; xx++) {
      g.fillStyle = gh.ok ? 'rgba(120,220,120,0.35)' : 'rgba(230,80,60,0.4)';
      this.diamond(g, xx, yy); g.fill();
    }
    this.drawBuilding(g, { type: gh.type, owner: 0, x: gh.x, y: gh.y, w: D.w, h: D.h, hp: 1, maxHp: 1 }, gh.ok ? 0.65 : 0.4);
    if (gh.type === 'woodcutter' || gh.type === 'tower') {
      const r = gh.type === 'tower' ? UNITS.archer.range + 3 : 18;
      const c = P(gh.x + D.w / 2, gh.y + D.h / 2);
      g.strokeStyle = 'rgba(255,240,180,0.35)'; g.lineWidth = 1.5; g.setLineDash([6, 6]);
      g.beginPath(); g.ellipse(c[0], c[1], r * HW * 1.414, r * HH * 1.414, 0, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }
  },

  // ---------- Minikarte ----------
  buildMiniTerrain() {
    const n = World.n;
    const c = document.createElement('canvas');
    c.width = n; c.height = n;
    const g = c.getContext('2d');
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const col = TERRAIN_COL[World.tile(x, y)];
      const v = parseInt(col.slice(1), 16);
      const i = (y * n + x) * 4;
      img.data[i] = (v >> 16) & 255; img.data[i + 1] = (v >> 8) & 255; img.data[i + 2] = v & 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.miniTerrain = c;
  },

  miniXf(mc) {
    // Kachel -> Minikarten-Pixel
    const n = World.n, W = mc.width;
    const s = W / n;
    return { s, f: (x, y) => [W / 2 + (x - y) * s / 2, (x + y) * s / 4 + (mc.height - W / 2) / 2] };
  },

  drawMini(mc) {
    if (!G.s || !this.miniTerrain) return;
    const g = mc.getContext('2d');
    const n = World.n;
    const { s, f } = this.miniXf(mc);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, mc.width, mc.height);
    const o = f(0, 0);
    g.setTransform(s / 2, s / 4, -s / 2, s / 4, o[0], o[1]);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.miniTerrain, 0, 0);
    // Bäume
    g.fillStyle = 'rgba(50,85,30,0.75)';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (World.trees[y * n + x]) g.fillRect(x, y, 1, 1);
    for (const b of G.s.buildings) { g.fillStyle = b.owner === 0 ? '#5f8ef0' : '#e8604c'; g.fillRect(b.x, b.y, b.w, b.h); }
    for (const u of G.s.units) {
      if (u.type === 'peasant') continue;
      g.fillStyle = u.owner === 0 ? '#bfd4ff' : '#ffb3a6';
      g.fillRect(u.x - 0.6, u.y - 0.6, 1.2, 1.2);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    // Sichtfenster
    const corners = [[0, 0], [this.W, 0], [this.W, this.H], [0, this.H]].map(([sx, sy]) => { const t = this.screenToTile(sx, sy); return f(t[0], t[1]); });
    g.strokeStyle = 'rgba(255,245,215,0.9)'; g.lineWidth = 1;
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
    g.translate(W, W * 2 - 10);
    g.scale(sc, sc);
    const c0 = P(D.w, D.h);
    g.translate(-c0[0], -c0[1]);
    const old = this.t; this.t = 0.7;
    this.drawBuilding(g, { type, owner: 0, x: 0, y: 0, w: D.w, h: D.h, hp: 1, maxHp: 1 }, 1);
    this.t = old;
    return c.toDataURL();
  },
};

const BUILD_H = { keep: 110, stockpile: 20, granary: 44, woodcutter: 32, quarry: 40, mine: 26, orchard: 24, house: 38, chapel: 64, barracks: 40, wall: 36, gate: 44, tower: 62 };
