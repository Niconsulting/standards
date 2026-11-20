'use strict';
// Bedienoberfläche und Eingabe

const ICON = {
  holz: '<svg viewBox="0 0 20 20"><rect x="2" y="6" width="14" height="4" rx="2" fill="#8a5d33"/><rect x="3" y="11" width="14" height="4" rx="2" fill="#7a5230"/><circle cx="16" cy="8" r="2" fill="#d2a46a"/><circle cx="17" cy="13" r="2" fill="#c79a62"/></svg>',
  stein: '<svg viewBox="0 0 20 20"><path d="M3 15l2-7 5-3 6 3 1 7z" fill="#a9a291"/><path d="M10 5l6 3 1 7-7 0z" fill="#8b8475"/></svg>',
  eisen: '<svg viewBox="0 0 20 20"><path d="M2 14l3-6h10l3 6z" fill="#7d848e"/><path d="M5 8h10l-2 3H7z" fill="#a3aab4"/></svg>',
  nahrung: '<svg viewBox="0 0 20 20"><circle cx="10" cy="12" r="6" fill="#c7342a"/><circle cx="8" cy="10" r="1.6" fill="#e86a5a"/><path d="M10 6c0-2 1-3 3-3-1 1-2 2-3 3z" fill="#4f7a2e"/></svg>',
  gold: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="#d6a54a"/><circle cx="10" cy="10" r="5" fill="none" stroke="#9c7426" stroke-width="1.4"/></svg>',
  pop: '<svg viewBox="0 0 20 20"><circle cx="10" cy="6" r="3" fill="#e2b78f"/><path d="M4 18c0-5 3-8 6-8s6 3 6 8z" fill="#b39a6c"/></svg>',
  heart: '<svg viewBox="0 0 20 20"><path d="M10 17S3 12 3 7.5A3.5 3.5 0 0110 6a3.5 3.5 0 017 1.5C17 12 10 17 10 17z" fill="#d9573f"/></svg>',
};

const UI = {
  mode: 'select', buildType: null, cat: 'wirtschaft',
  sel: new Set(), selB: 0, inspectU: 0, keepPanel: true,
  wheelMode: 'auto', drag: null, mouse: { x: 0, y: 0, inside: false },
  keys: {}, refreshT: 0, lastInfo: '', lastRes: '', hoverItem: null, icons: {},

  $(id) { return document.getElementById(id); },

  init() {
    try { this.wheelMode = localStorage.getItem('wuestenfeste.wheel') || 'auto'; } catch (e) { /* egal */ }
    this.$('optWheel').value = this.wheelMode;
    this.$('optWheel').addEventListener('change', e => {
      this.wheelMode = e.target.value;
      try { localStorage.setItem('wuestenfeste.wheel', this.wheelMode); } catch (err) { /* egal */ }
    });
    this.buildBar();
    this.bindCanvas();
    try { if (matchMedia('(pointer: coarse)').matches) this.setTouch(true); } catch (e) { /* egal */ }
    this.bindKeys();
    this.$('info').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b) this.action(b.dataset.act);
    });
    const mini = this.$('mini');
    const miniJump = e => {
      const r = mini.getBoundingClientRect();
      const t = R.miniToTile(mini, (e.clientX - r.left) * mini.width / r.width, (e.clientY - r.top) * mini.height / r.height);
      R.centerOn(t[0], t[1]);
    };
    mini.addEventListener('mousedown', e => { miniJump(e); this.miniDrag = true; });
    window.addEventListener('mousemove', e => { if (this.miniDrag) miniJump(e); });
    window.addEventListener('mouseup', () => { this.miniDrag = false; });
  },

  // ---------- Bauleiste ----------
  buildBar() {
    const tabs = this.$('tabs');
    tabs.innerHTML = '';
    for (const c of BUILD_CATS) {
      const b = document.createElement('button');
      b.textContent = c.name; b.dataset.cat = c.id;
      b.addEventListener('click', () => {
        if (this.touch && this.cat === c.id && this.drawer) { this.drawer = false; document.body.classList.remove('drawer'); if (this.mode === 'build') this.setMode('select'); this.refreshItems(); return; }
        this.drawer = true; document.body.classList.add('drawer');
        this.setCat(c.id);
      });
      tabs.appendChild(b);
    }
    const d = document.createElement('button');
    d.textContent = 'Abreißen'; d.className = 'demo'; d.dataset.cat = 'demolish';
    d.title = 'Eigene Gebäude abreißen (halbe Kosten zurück)';
    d.addEventListener('click', () => this.setMode(this.mode === 'demolish' ? 'select' : 'demolish'));
    tabs.appendChild(d);
    const a = document.createElement('button');
    a.textContent = 'Truppen'; a.className = 'army'; a.dataset.cat = 'army';
    a.title = 'Alle Soldaten auswählen (Q)';
    a.addEventListener('click', () => this.selectArmy());
    tabs.appendChild(a);
    for (const t in BUILDINGS) if (!BUILDINGS[t].hidden) this.icons[t] = R.icon(t, 112);
    this.setCat(this.cat);
  },

  setCat(id) {
    this.cat = id;
    for (const b of this.$('tabs').children) b.classList.toggle('on', b.dataset.cat === id || (b.dataset.cat === 'demolish' && this.mode === 'demolish'));
    const items = this.$('items');
    items.innerHTML = '';
    const cat = BUILD_CATS.find(c => c.id === id);
    for (const t of cat.items) {
      const D = BUILDINGS[t];
      const el = document.createElement('div');
      el.className = 'bitem'; el.dataset.type = t;
      el.innerHTML = '<img alt="" src="' + this.icons[t] + '"><span>' + D.name + '</span><small>' + this.costText(D.cost) + '</small>';
      el.addEventListener('click', () => this.setBuild(this.buildType === t && this.mode === 'build' ? null : t));
      el.addEventListener('mouseenter', () => { this.hoverItem = t; this.updateHint(); });
      el.addEventListener('mouseleave', () => { this.hoverItem = null; this.updateHint(); });
      items.appendChild(el);
    }
    this.refreshItems();
  },

  costText(cost) {
    const parts = [];
    for (const k in cost) if (cost[k]) parts.push(cost[k] + ' ' + RES_NAME[k]);
    return parts.join(', ') || 'kostenlos';
  },

  refreshItems() {
    if (!G.s) return;
    for (const el of this.$('items').children) {
      const t = el.dataset.type;
      el.classList.toggle('on', this.mode === 'build' && this.buildType === t);
      el.classList.toggle('no', !G.canAfford(0, BUILDINGS[t].cost));
    }
    for (const b of this.$('tabs').children) {
      b.classList.toggle('on', b.dataset.cat === 'demolish' ? this.mode === 'demolish' : b.dataset.cat === 'army' ? false : b.dataset.cat === this.cat && (!this.touch || this.drawer));
    }
  },

  setBuild(t) {
    if (!t) { this.setMode('select'); return; }
    this.hideBar(); this.drag = null; R.ghost = null;
    this.mode = 'build'; this.buildType = t;
    this.sel.clear(); this.selB = 0; this.inspectU = 0;
    this.refreshItems(); this.updateHint();
    if (!this.touch) this.updateGhost();
    else G.msg('Tippe auf die Karte, um ' + BUILDINGS[t].name + ' zu platzieren.', 'info', 'tapbuild' + t, 30);
  },
  setMode(m) {
    this.mode = m;
    this.hideBar();
    if (m !== 'build') { this.buildType = null; R.ghost = null; }
    this.drag = null;
    this.refreshItems(); this.updateHint();
    this.$('view').style.cursor = m === 'demolish' ? 'not-allowed' : m === 'build' ? 'crosshair' : 'default';
  },

  updateHint() {
    const h = this.$('hint');
    const t = this.hoverItem || (this.mode === 'build' ? this.buildType : null);
    if (t) {
      const D = BUILDINGS[t];
      h.innerHTML = '<b>' + D.name + '</b> · ' + this.costText(D.cost) + ' · ' + D.desc + (this.mode === 'build' && !this.hoverItem ? this.T(' · Rechtsklick: abbrechen', ' · Nochmal antippen: abbrechen') : '');
    } else if (this.mode === 'demolish') {
      h.innerHTML = '<b>Abreißen:</b> ' + this.T('Klicke', 'Tippe') + ' auf ein eigenes Gebäude. Du bekommst die Hälfte von Holz und Stein zurück.';
    } else h.textContent = this.T('Wähle ein Gebäude aus. Linksklick setzt es, Rechtsklick bricht ab.', 'Wähle ein Gebäude, dann tippe auf die Karte.');
  },

  updateGhost() {
    if (this.mode !== 'build' || !R.hover) { R.ghost = null; return; }
    const t = this.buildType, D = BUILDINGS[t];
    if (this.drag && this.drag.wall) {
      const line = this.wallLine(this.drag.x0, this.drag.y0, R.hover.x, R.hover.y);
      let stone = G.s.players[0].res.stein;
      R.ghost = {
        type: t, line: line.map(([x, y]) => {
          const ok = !G.canPlace(t, 0, x, y) && stone >= D.cost.stein;
          if (ok) stone -= D.cost.stein;
          return { x, y, ok };
        }),
      };
      return;
    }
    const x = Math.floor(R.hover.fx - D.w / 2 + 0.5), y = Math.floor(R.hover.fy - D.h / 2 + 0.5);
    R.ghost = { type: t, x, y, ok: !G.canPlace(t, 0, x, y) && G.canAfford(0, D.cost) };
  },

  wallLine(x0, y0, x1, y1) {
    const out = [];
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    for (let i = 0; i < 200; i++) {
      out.push([x, y]);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return out;
  },

  // ---------- Leinwand ----------
  bindCanvas() {
    const cv = this.$('view');
    this.ptrs = new Map();
    cv.addEventListener('pointerdown', e => this.pDown(e));
    window.addEventListener('pointermove', e => this.pMove(e));
    window.addEventListener('pointerup', e => this.pUp(e, false));
    window.addEventListener('pointercancel', e => this.pUp(e, true));
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    cv.addEventListener('dblclick', e => this.onDbl(e));
    cv.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    cv.addEventListener('mouseenter', () => { this.mouse.inside = true; });
    // Safari/iOS: Browser-Zoom verhindern, Pinch übernimmt das Spiel
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', e => { if (e.target === cv) e.preventDefault(); }, { passive: false });
    this.$('cbarOk').addEventListener('click', () => this.cbarAct(true));
    this.$('cbarNo').addEventListener('click', () => this.cbarAct(false));
  },

  setTouch(on) {
    if (this.touch === on) return;
    this.touch = on;
    document.body.classList.toggle('touch', on);
    this.lastInfo = ''; this.updateHint();
  },
  T(mouse, touch) { return this.touch ? touch : mouse; },

  pDown(e) {
    if (e.pointerType === 'mouse') {
      this.setTouch(false);
      if (e.button === 2) { this.onRight(e.clientX, e.clientY); return; }
      this.onDown(e);
      return;
    }
    e.preventDefault();
    this.setTouch(true);
    if (!Main.running) return;
    try { this.$('view').setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptrs.size === 1) {
      this.tg = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, long: false, cancel: false };
      clearTimeout(this.longT);
      this.longT = setTimeout(() => this.onLong(), 450);
    } else {
      clearTimeout(this.longT);
      if (this.tg) this.tg.cancel = true;
      R.selRect = null;
      this.startPinch();
    }
  },

  startPinch() {
    const pts = [...this.ptrs.values()].slice(0, 2);
    if (pts.length < 2) { this.pinch = null; return; }
    const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
    this.pinch = R.pinchStart(cx, cy);
    this.pinch.d0 = Math.max(20, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
  },

  pMove(e) {
    if (e.pointerType === 'mouse') { this.onMove(e); return; }
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!Main.running) return;
    if (this.ptrs.size >= 2 && this.pinch) {
      const pts = [...this.ptrs.values()].slice(0, 2);
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
      const d = Math.max(20, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
      R.pinchMove(this.pinch, cx, cy, d / this.pinch.d0);
      return;
    }
    const tg = this.tg;
    if (!tg || tg.cancel || tg.id !== e.pointerId) return;
    if (!tg.moved && Math.hypot(p.x - tg.sx, p.y - tg.sy) > 10) { tg.moved = true; clearTimeout(this.longT); }
    if (tg.long) { if (tg.moved) R.selRect = { x0: tg.sx, y0: tg.sy, x1: p.x, y1: p.y }; return; }
    if (tg.moved) R.panBy(p.x - px, p.y - py);
  },

  pUp(e, cancel) {
    if (e.pointerType === 'mouse') { this.onUp(e); return; }
    const p = this.ptrs.get(e.pointerId);
    this.ptrs.delete(e.pointerId);
    if (!p) return;
    if (this.ptrs.size === 1) {
      // vom Zoomen zurück zum Verschieben mit dem verbleibenden Finger
      const [id, q] = [...this.ptrs.entries()][0];
      this.pinch = null;
      this.tg = { id, sx: q.x, sy: q.y, moved: true, long: false, cancel: false };
      return;
    }
    if (this.ptrs.size > 1) { this.startPinch(); return; }
    clearTimeout(this.longT);
    const tg = this.tg;
    this.tg = null; this.pinch = null;
    if (!tg || tg.cancel || cancel || tg.id !== e.pointerId) { R.selRect = null; return; }
    if (tg.long) {
      if (R.selRect) { this.boxSelect(R.selRect, false); R.selRect = null; }
      else this.clickSelect(p.x, p.y, false);
      return;
    }
    if (!tg.moved) this.onTap(p.x, p.y);
  },

  onLong() {
    const tg = this.tg;
    if (!tg || tg.moved || tg.cancel || this.mode !== 'select') return;
    tg.long = true;
    const t = R.screenToTile(tg.sx, tg.sy);
    G.fx.push({ k: 'mark', x: t[0], y: t[1], t: 0, dur: 0.5, c: '#ffe7a0', r: 0.8 });
    if (!this.hintLong) { this.hintLong = true; G.msg('Halten und ziehen: Soldaten einrahmen. Loslassen ohne Ziehen: auswählen.', 'info'); }
  },

  onTap(x, y) {
    if (!Main.running) return;
    const now = performance.now();
    const dbl = this.lastTap && now - this.lastTap.t < 330 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 30;
    this.lastTap = { t: now, x, y };
    if (this.mode === 'build') { this.touchPlace(x, y); return; }
    if (this.mode === 'demolish') {
      const b = this.buildingAt(x, y);
      if (b && b.owner === 0) {
        if (b.type === 'keep') G.msg('Den Burgfried kannst du nicht abreißen.', 'warn');
        else this.showBar(BUILDINGS[b.type].name + ' abreißen?', 'Abreißen', () => G.demolish(b));
      }
      return;
    }
    if (this.sel.size) {
      const u = this.unitAt(x, y);
      if (u && u.owner === 0 && u.type !== 'peasant') {
        if (dbl) this.onDbl({ clientX: x, clientY: y });
        else this.clickSelect(x, y, true);
        return;
      }
      this.onRight(x, y);
      return;
    }
    this.clickSelect(x, y, false);
    if (dbl) this.onDbl({ clientX: x, clientY: y });
  },

  // Bauen per Fingertipp: erst Vorschau, dann bestätigen
  touchPlace(x, y) {
    const [fx, fy] = R.screenToTile(x, y);
    const tx = Math.floor(fx), ty = Math.floor(fy);
    if (!World.inb(tx, ty)) return;
    const t = this.buildType;
    if (t === 'wall') {
      if (!this.drag || !this.drag.wall) {
        this.drag = { wall: true, x0: tx, y0: ty };
        R.hover = { x: tx, y: ty, fx, fy };
        this.updateGhost();
        this.showBar('Mauer: Tippe jetzt auf den Endpunkt.', null, null);
        return;
      }
      R.hover = { x: tx, y: ty, fx, fy };
      this.updateGhost();
      const n = R.ghost && R.ghost.line ? R.ghost.line.filter(q => q.ok).length : 0;
      this.showBar(n ? 'Mauer mit ' + n + ' Feldern bauen? · ' + n + ' Stein' : 'Hier geht keine Mauer.', n ? 'Bauen' : null, () => { this.buildWallLine(); this.drag = null; R.ghost = null; });
      return;
    }
    const prev = R.ghost;
    R.hover = { x: tx, y: ty, fx, fy };
    this.updateGhost();
    const g = R.ghost;
    if (!g) return;
    const D = BUILDINGS[t];
    // zweites Tippen auf dieselbe Stelle baut sofort
    if (prev && !prev.line && prev.x === g.x && prev.y === g.y && g.ok && this.cbarOpen) { this.cbarAct(true); return; }
    if (g.ok) {
      this.showBar(D.name + ' hier bauen? · ' + this.costText(D.cost), 'Bauen', () => {
        const b = G.tryBuild(t, 0, g.x, g.y);
        if (b) this.afterBuild(b);
        R.ghost = null;
      });
    } else this.showBar(G.canPlace(t, 0, g.x, g.y) || ('Nicht genug ' + G.missing(0, D.cost).join(' und ')), null, null);
  },

  showBar(text, okLabel, cb) {
    this.$('cbarText').textContent = text;
    const ok = this.$('cbarOk');
    ok.hidden = !okLabel;
    if (okLabel) ok.textContent = okLabel;
    this.cbarCb = cb;
    this.$('cbar').hidden = false;
    this.cbarOpen = true;
  },
  hideBar() { this.$('cbar').hidden = true; this.cbarOpen = false; this.cbarCb = null; },
  cbarAct(ok) {
    const cb = this.cbarCb;
    this.hideBar();
    if (ok && cb) cb();
    else if (!ok && this.mode === 'build') { this.drag = null; R.ghost = null; }
    this.lastInfo = '';
  },

  buildWallLine() {
    const line = R.ghost && R.ghost.line ? R.ghost.line : [];
    let failed = false;
    for (const t of line) {
      if (G.canPlace('wall', 0, t.x, t.y)) continue;
      if (!G.canAfford(0, BUILDINGS.wall.cost)) { failed = true; break; }
      G.tryBuild('wall', 0, t.x, t.y, true);
    }
    if (failed) G.msg('Nicht genug Stein für die ganze Mauer.', 'warn', 'afford', 1.5);
  },

  onDown(e) {
    if (!Main.running) return;
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    if (e.button === 1) { e.preventDefault(); this.drag = { pan: true, x: e.clientX, y: e.clientY }; return; }
    if (e.button !== 0) return;
    if (this.mode === 'build') {
      if (!R.hover) return;
      if (this.buildType === 'wall') { this.drag = { wall: true, x0: R.hover.x, y0: R.hover.y }; this.updateGhost(); return; }
      const g = R.ghost;
      if (g && !g.line) {
        const b = G.tryBuild(this.buildType, 0, g.x, g.y);
        if (b) { this.afterBuild(b); if (!e.shiftKey && (this.buildType === 'keep')) this.setMode('select'); }
      }
      this.updateGhost();
      return;
    }
    if (this.mode === 'demolish') {
      const b = this.buildingAt(e.clientX, e.clientY);
      if (b && b.owner === 0) {
        if (b.type === 'keep') G.msg('Den Burgfried kannst du nicht abreißen.', 'warn');
        else G.demolish(b);
      }
      return;
    }
    this.drag = { sel: true, x0: e.clientX, y0: e.clientY };
  },

  afterBuild(b) {
    if (b.type === 'barracks' && !this.hintBar) { this.hintBar = true; G.msg('Kaserne steht! ' + this.T('Klicke', 'Tippe') + ' sie an, um Soldaten auszubilden.', 'good'); }
    if (b.type === 'tower' && !this.hintTower) { this.hintTower = true; G.msg(this.T('Wähle Bogenschützen und rechtsklicke den Turm, um ihn zu besetzen.', 'Wähle Bogenschützen und tippe auf den Turm, um ihn zu besetzen.'), 'good'); }
  },

  onMove(e) {
    const prevX = this.mouse.x, prevY = this.mouse.y;
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    if (!Main.running || !G.s) return;
    if (this.drag && this.drag.pan) {
      R.panBy(e.clientX - prevX, e.clientY - prevY);
      return;
    }
    this.updateHover();
    if (this.drag && this.drag.sel) {
      const d = Math.abs(e.clientX - this.drag.x0) + Math.abs(e.clientY - this.drag.y0);
      if (d > 6) R.selRect = { x0: this.drag.x0, y0: this.drag.y0, x1: e.clientX, y1: e.clientY };
    }
  },

  updateHover() {
    const cv = this.$('view').getBoundingClientRect();
    const [fx, fy] = R.screenToTile(this.mouse.x - cv.left, this.mouse.y - cv.top);
    const x = Math.floor(fx), y = Math.floor(fy);
    R.hover = World.inb(x, y) ? { x, y, fx, fy } : null;
    this.updateGhost();
  },

  onUp(e) {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (d.wall) {
      this.buildWallLine();
      this.updateGhost();
      return;
    }
    if (d.sel) {
      const rect = R.selRect;
      R.selRect = null;
      if (rect) this.boxSelect(rect, e.shiftKey);
      else this.clickSelect(e.clientX, e.clientY, e.shiftKey);
    }
  },

  unitAt(mx, my) {
    let best = null, bd = Math.max(16, R.pxPerTile() * 0.45);
    for (const u of G.s.units) {
      if (u.dead) continue;
      const [sx, sy] = R.unitScreen(u);
      const d = Math.hypot(sx - mx, sy - my);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  },
  buildingAt(mx, my) { return R.pickBuilding(mx, my); },

  clickSelect(mx, my, add) {
    const u = this.unitAt(mx, my);
    if (u) {
      if (u.owner === 0 && u.type !== 'peasant') {
        if (!add) this.sel.clear();
        if (add && this.sel.has(u.id)) this.sel.delete(u.id); else this.sel.add(u.id);
        this.selB = 0; this.inspectU = 0;
      } else { this.sel.clear(); this.selB = 0; this.inspectU = u.id; }
      this.lastInfo = '';
      return;
    }
    const b = this.buildingAt(mx, my);
    this.sel.clear(); this.inspectU = 0;
    this.selB = b ? b.id : 0;
    this.lastInfo = '';
  },

  boxSelect(r, add) {
    if (!add) this.sel.clear();
    const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
    for (const u of G.s.units) {
      if (u.dead || u.owner !== 0 || u.type === 'peasant') continue;
      const [sx, sy] = R.unitScreen(u);
      if (sx >= x0 - 6 && sx <= x1 + 6 && sy >= y0 - 10 && sy <= y1 + 10) this.sel.add(u.id);
    }
    this.selB = 0; this.inspectU = 0; this.lastInfo = '';
  },

  onDbl(e) {
    const u = this.unitAt(e.clientX, e.clientY);
    if (!u || u.owner !== 0 || u.type === 'peasant') return;
    for (const v of G.s.units) {
      if (v.dead || v.owner !== 0 || v.type !== u.type) continue;
      const [sx, sy] = R.unitScreen(v);
      if (sx >= 0 && sy >= 0 && sx <= R.W && sy <= R.H) this.sel.add(v.id);
    }
    this.lastInfo = '';
  },

  onRight(mx, my) {
    if (!Main.running) return;
    if (this.mode !== 'select') { this.setMode('select'); return; }
    const units = [...this.sel].map(id => G.umap.get(id)).filter(Boolean);
    if (!units.length) { this.selB = 0; this.inspectU = 0; return; }
    const t = this.unitAt(mx, my);
    if (t && t.owner !== 0) {
      G.cmdAttackUnit(units, t);
      G.fx.push({ k: 'mark', x: t.x, y: t.y, t: 0, dur: 0.6, c: '#ff7a5a' });
      return;
    }
    const b = this.buildingAt(mx, my);
    if (b && b.owner !== 0) {
      G.cmdSiege(units, b);
      G.fx.push({ k: 'mark', x: b.x + b.w / 2, y: b.y + b.h / 2, t: 0, dur: 0.6, c: '#ff7a5a', r: 1.6 });
      return;
    }
    if (b && b.type === 'tower') {
      G.cmdGarrison(units, b);
      G.fx.push({ k: 'mark', x: b.x + 1, y: b.y + 1, t: 0, dur: 0.6, c: '#9fe07a', r: 1.4 });
      return;
    }
    const [fx, fy] = R.screenToTile(mx, my);
    const x = U.clamp(Math.floor(fx), 0, World.n - 1), y = U.clamp(Math.floor(fy), 0, World.n - 1);
    G.cmdMove(units, x, y);
    G.fx.push({ k: 'mark', x: x + 0.5, y: y + 0.5, t: 0, dur: 0.6, c: '#9fe07a' });
  },

  onWheel(e) {
    e.preventDefault();
    if (!Main.running) return;
    let zoom;
    if (e.ctrlKey) zoom = true;
    else if (this.wheelMode === 'zoom') zoom = true;
    else if (this.wheelMode === 'pan') zoom = false;
    else zoom = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
    if (zoom) {
      const k = e.ctrlKey ? 0.012 : 0.0016;
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.zoomAt(e.clientX, e.clientY, Math.exp(-dy * k));
    } else {
      R.panBy(-e.deltaX, -e.deltaY);
    }
    this.updateHover();
  },

  zoomAt(mx, my, f) { R.zoomAt(mx, my, f); },

  // ---------- Tastatur ----------
  bindKeys() {
    window.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input' || tag === 'select') return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); if (Main.running) Main.quickSave(); return; }
      if (k === 'escape') { e.preventDefault(); Main.escape(); return; }
      if (!Main.running) return;
      this.keys[k] = true;
      if (k === ' ') { e.preventDefault(); Main.togglePause(); }
      else if (k === '1' || k === '2' || k === '3') Main.setSpeed(+k);
      else if (k === 'h') Main.openOverlay('help');
      else if (k === 'r') R.rotate(1);
      else if (k === 't') R.rotate(-1);
      else if (k === 'b') this.openKeep();
      else if (k === 'q') this.selectArmy();
      else if (k === 'delete' || k === 'backspace') { const b = G.bmap.get(this.selB); if (b && b.owner === 0 && b.type !== 'keep') G.demolish(b); }
      else if (k === '+' || k === '=') this.zoomAt(R.W / 2, R.H / 2, 1.15);
      else if (k === '-') this.zoomAt(R.W / 2, R.H / 2, 1 / 1.15);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
  },

  selectArmy() {
    if (!Main.running) return;
    if (this.mode !== 'select') this.setMode('select');
    this.sel.clear(); this.selB = 0; this.inspectU = 0;
    for (const u of G.s.units) if (u.owner === 0 && u.type !== 'peasant' && !u.dead) this.sel.add(u.id);
    if (!this.sel.size) G.msg('Du hast noch keine Soldaten. Baue eine Kaserne.', 'warn', 'noarmy', 5);
    this.lastInfo = '';
  },
  openKeep() {
    if (!Main.running) return;
    this.sel.clear(); this.inspectU = 0; this.selB = G.s.players[0].keep; this.keepOpen = true; this.lastInfo = '';
    const kb = G.bmap.get(this.selB); if (kb) R.centerOn(kb.x + 1.5, kb.y + 1.5);
  },

  unselect(id) { this.sel.delete(id); if (this.inspectU === id) this.inspectU = 0; },

  // ---------- Laufende Aktualisierung ----------
  tick(dt) {
    if (!Main.running || !G.s) return;
    const k = this.keys, sp = 700 * dt;
    let mx = 0, my = 0;
    if (k.w || k.arrowup) my -= sp;
    if (k.s || k.arrowdown) my += sp;
    if (k.a || k.arrowleft) mx -= sp;
    if (k.d || k.arrowright) mx += sp;
    if (this.mouse.inside && !this.drag && document.hasFocus()) {
      const m = 4;
      if (this.mouse.x <= m) mx -= sp; if (this.mouse.x >= R.W - m) mx += sp;
    }
    if (mx || my) { R.panBy(-mx, -my); this.updateHover(); }
    this.refreshT -= dt;
    if (this.refreshT <= 0) {
      this.refreshT = 0.2;
      this.renderTop();
      this.renderInfo();
      this.refreshItems();
    }
  },

  renderTop() {
    const p = G.s.players[0];
    const r = p.res;
    const pc = G.peasants(0);
    const housing = G.housing(0);
    const tr = p.trend;
    const trend = tr > 0 ? '<span class="trend" style="color:var(--good)">▲' + tr + '</span>' : tr < 0 ? '<span class="trend" style="color:var(--bad)">▼' + (-tr) + '</span>' : '';
    const html =
      this.chip('holz', U.fmt(r.holz), 'Holz') +
      this.chip('stein', U.fmt(r.stein), 'Stein') +
      this.chip('eisen', U.fmt(r.eisen), 'Eisen') +
      this.chip('nahrung', U.fmt(r.nahrung), 'Nahrung im Kornspeicher') +
      this.chip('gold', U.fmt(r.gold), 'Gold') +
      this.chip('pop', pc.all + '<small>/' + housing + '</small>', 'Bauern / Wohnraum · ' + pc.idle + ' frei am Lagerfeuer', ' <small>(' + pc.idle + ' frei)</small>') +
      '<div class="chip ' + (p.popularity >= 50 ? 'pop-good' : 'pop-bad') + '" title="Beliebtheit: über 50 kommen Bauern, unter 50 gehen sie">' + ICON.heart + '<b>' + Math.round(p.popularity) + '</b>' + trend + '</div>';
    if (html !== this.lastRes) { this.$('resbar').innerHTML = html; this.lastRes = html; }
    this.$('date').textContent = G.dateText();
    const left = G.s.ai.nextAttack - G.s.time;
    const pe = this.$('peace');
    if (G.s.ai.waves === 0 && left > 0) {
      const m = Math.floor(left / 60), s = Math.floor(left % 60);
      pe.innerHTML = 'Friedenszeit: <b>' + m + ':' + String(s).padStart(2, '0') + '</b>';
    } else if (left > 0 && left < 60) pe.innerHTML = 'Nächster Angriff: <b>bald</b>';
    else pe.textContent = '';
  },
  chip(icon, val, title, extra) {
    return '<div class="chip" title="' + title + '">' + ICON[icon] + '<b>' + val + '</b>' + (extra || '') + '</div>';
  },

  renderInfo() {
    let html = '';
    const b = G.bmap.get(this.selB);
    const units = [...this.sel].map(id => G.umap.get(id)).filter(Boolean);
    const iu = G.umap.get(this.inspectU);
    if (units.length) html = this.infoUnits(units);
    else if (iu) html = this.infoSingle(iu);
    else if (b) html = this.infoBuilding(b);
    else if (!this.touch || this.keepOpen) html = this.infoKeep(true);
    if (html && this.touch) html = '<button class="close" data-act="close" aria-label="Schließen">×</button>' + html;
    const el = this.$('info');
    el.classList.toggle('empty', !html);
    if (html !== this.lastInfo) { el.innerHTML = html; this.lastInfo = html; }
  },

  hp(o) { return '<div class="hpbar"><i style="width:' + Math.max(0, Math.round(o.hp / o.maxHp * 100)) + '%;background:' + (o.hp / o.maxHp > 0.5 ? 'var(--good)' : o.hp / o.maxHp > 0.25 ? 'var(--warn)' : 'var(--bad)') + '"></i></div>'; },

  infoKeep(summary) {
    const p = G.s.players[0];
    const f = p.factors || {};
    const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v || 0);
    const cls = v => v > 0 ? 'p' : v < 0 ? 'n' : '';
    const pc = G.peasants(0);
    const eat = pc.all * RATIONS[p.ration].eat * FOOD_PER_PEASANT;
    const turns = eat > 0 ? Math.floor(p.res.nahrung / eat) : '∞';
    const gold = pc.all * TAXES[p.tax].gold;
    return '<h3>Burgfried <small>' + (summary ? 'Verwaltung · Taste B' : 'dein Herrschersitz') + '</small></h3>' +
      '<div class="ctrl"><label>Rationen</label><button class="sbtn" data-act="ration-" title="weniger">−</button><output>' + RATIONS[p.ration].name + ' · reicht ' + turns + ' Runden</output><button class="sbtn" data-act="ration+" title="mehr">+</button></div>' +
      '<div class="ctrl"><label>Steuern</label><button class="sbtn" data-act="tax-" title="weniger">−</button><output>' + TAXES[p.tax].name + ' · ' + (gold >= 0 ? '+' : '−') + Math.abs(Math.round(gold)) + ' Gold</output><button class="sbtn" data-act="tax+" title="mehr">+</button></div>' +
      '<div class="factors"><span>Beliebtheit pro Runde:</span>' +
      '<span class="' + cls(f.nahrung) + '">Nahrung ' + sgn(f.nahrung) + '</span>' +
      '<span class="' + cls(f.steuern) + '">Steuern ' + sgn(f.steuern) + '</span>' +
      (f.kapelle ? '<span class="p">Kapelle +' + f.kapelle + '</span>' : '') +
      '<span class="' + cls(f.gesamt) + '"><b>Gesamt ' + sgn(f.gesamt) + '</b></span></div>' +
      '<p class="note">Eine Runde dauert ' + ECON_TICK + ' Sekunden. Rationen und Steuern wirken ab der nächsten Runde.</p>';
  },

  infoBuilding(b) {
    const D = BUILDINGS[b.type];
    if (b.type === 'keep' && b.owner === 0) return this.infoKeep(false) + this.hp(b);
    let h = '<h3>' + D.name + ' <small>' + (b.owner === 0 ? 'dein Gebäude' : 'feindlich') + ' · ' + Math.max(0, Math.round(b.hp)) + ' / ' + b.maxHp + '</small></h3>' + this.hp(b);
    if (b.owner !== 0) return h + '<p>' + this.T('Wähle Soldaten und rechtsklicke das Gebäude, um es anzugreifen.', 'Wähle Soldaten und tippe auf das Gebäude, um es anzugreifen.') + '</p>';
    h += '<p>' + D.desc + '</p>';
    if (D.worker) {
      const w = G.umap.get(b.worker);
      let st = 'Kein Arbeiter – es gibt keinen freien Bauern.';
      if (w) st = w.task === 'toWork' ? 'Arbeiter ist auf dem Weg.' : w.task === 'wait' ? 'Arbeiter findet keinen Weg!' : w.phase === 'noTree' ? 'Keine Bäume in Reichweite.' : w.phase === 'noStore' ? 'Kein ' + BUILDINGS[PROD[b.type].store].name + ' erreichbar!' : w.carry ? 'Bringt ' + w.carry.amt + ' ' + RES_NAME[w.carry.res] + ' ins Lager.' : 'Arbeiter ist bei der Arbeit.';
      h += '<p>' + st + '</p>';
    }
    if (D.housing) h += '<p>Wohnraum: ' + D.housing + ' Bauern.</p>';
    if (b.type === 'barracks') h += this.recruitBox();
    if (b.type === 'tower') {
      h += '<p>Besatzung: ' + b.garrison.length + ' / 4. ' + this.T('Wähle Soldaten und rechtsklicke den Turm.', 'Wähle Soldaten und tippe auf den Turm.') + '</p>';
      if (b.garrison.length) h += '<div class="act"><button data-act="ungarrison">Besatzung auswählen</button></div>';
    }
    if (b.type !== 'keep') h += '<div class="act"><button class="danger" data-act="demolish">Abreißen</button></div>';
    return h;
  },

  recruitBox() {
    const pc = G.peasants(0);
    const cnt = {};
    for (const u of G.s.units) if (u.owner === 0 && !u.dead) cnt[u.type] = (cnt[u.type] || 0) + 1;
    let h = '<div class="recruit">';
    for (const t of SOLDIER_TYPES) {
      const D = UNITS[t];
      const ok = G.canAfford(0, D.cost) && pc.idle > 0;
      h += '<button data-act="recruit:' + t + '" class="' + (ok ? '' : 'no') + '" title="' + D.desc + '"><b>' + D.name + '</b><small>' + this.costText(D.cost) + '</small><small>' + (cnt[t] || 0) + ' im Dienst</small></button>';
    }
    h += '</div><p>' + pc.idle + ' freie Bauern am Lagerfeuer.' + this.T(' Umschalt + Klick bildet 5 aus.', '') + '</p>';
    return h;
  },

  infoUnits(units) {
    const cnt = {};
    for (const u of units) cnt[u.type] = (cnt[u.type] || 0) + 1;
    let h = '<h3>' + (units.length === 1 ? UNITS[units[0].type].name : units.length + ' Soldaten') + '</h3>';
    if (units.length === 1) h += this.hp(units[0]) + '<p>' + UNITS[units[0].type].desc + '</p>';
    else h += '<div class="unitlist">' + SOLDIER_TYPES.filter(t => cnt[t]).map(t => '<span>' + cnt[t] + '× ' + UNITS[t].name + '</span>').join('') + '</div>';
    h += '<p>' + this.T('Rechtsklick: bewegen · auf Feind: angreifen · auf eigenen Wachturm: besetzen. Doppelklick wählt alle gleichen Soldaten.', 'Tippe auf die Karte: bewegen · auf Feind: angreifen · auf eigenen Turm: besetzen. Halten und ziehen: einrahmen.') + '</p>';
    h += '<div class="act">' + (units.some(u => u.tower) ? '<button data-act="leave">Turm verlassen</button>' : '') + '<button data-act="deselect">Auswahl aufheben</button></div>';
    return h;
  },

  infoSingle(u) {
    const D = UNITS[u.type];
    let h = '<h3>' + D.name + ' <small>' + (u.owner === 0 ? 'dein Volk' : 'feindlich') + '</small></h3>' + this.hp(u);
    if (u.type === 'peasant') {
      const b = G.bmap.get(u.job);
      h += '<p>' + (b ? 'Arbeitet: ' + BUILDINGS[b.type].name : 'Wartet am Lagerfeuer auf Arbeit.') + '</p>';
    } else if (D.desc) h += '<p>' + D.desc + '</p>';
    return h;
  },

  action(a) {
    const p = G.s.players[0];
    if (a === 'ration-') p.ration = Math.max(0, p.ration - 1);
    else if (a === 'ration+') p.ration = Math.min(RATIONS.length - 1, p.ration + 1);
    else if (a === 'tax-') p.tax = Math.max(0, p.tax - 1);
    else if (a === 'tax+') p.tax = Math.min(TAXES.length - 1, p.tax + 1);
    else if (a.startsWith('recruit:')) {
      const n = this.shift ? 5 : 1;
      for (let i = 0; i < n; i++) if (!G.recruit(0, a.slice(8))) break;
    } else if (a === 'demolish') {
      const b = G.bmap.get(this.selB);
      if (b && b.owner === 0) G.demolish(b);
    } else if (a === 'ungarrison') {
      const b = G.bmap.get(this.selB);
      if (b) { this.sel = new Set(b.garrison); this.selB = 0; }
    } else if (a === 'deselect' || a === 'close') {
      this.sel.clear(); this.selB = 0; this.inspectU = 0; this.keepOpen = false;
    } else if (a === 'leave') {
      const units = [...this.sel].map(id => G.umap.get(id)).filter(Boolean);
      for (const u of units) { G.leaveTower(u); u.order = { t: 'idle', gx: u.x, gy: u.y }; }
    }
    this.lastInfo = '';
    this.renderInfo();
    this.renderTop();
  },

  // ---------- Meldungen ----------
  pushMsg(text, kind) {
    const box = this.$('msgs');
    const el = document.createElement('div');
    el.className = 'msg ' + kind;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => el.classList.add('fade'), kind === 'bad' ? 7000 : 5000);
    setTimeout(() => el.remove(), kind === 'bad' ? 7700 : 5700);
  },
};
window.addEventListener('keydown', e => { if (e.key === 'Shift') UI.shift = true; });
window.addEventListener('keyup', e => { if (e.key === 'Shift') UI.shift = false; });
