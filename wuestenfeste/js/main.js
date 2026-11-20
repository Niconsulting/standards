'use strict';
// Spielstart, Hauptschleife, Menüs

const Main = {
  running: false, paused: false, speed: 1, acc: 0, last: 0,
  overlays: new Set(), autoT: 0, tips: [],
  confirmCb: null, xferMode: null,

  init() {
    R.init(document.getElementById('view'));
    UI.init();
    G.onMsg = (t, k) => UI.pushMsg(t, k);
    G.onEnd = r => this.gameOver(r);
    this.bindMenus();
    this.refreshSlots();
    this.openOverlay('menu');
    // Neuladen der Seite durch den Artefakt-Viewer: Spiel fortsetzen
    const hot = window.claude && window.claude.hot;
    try { if (hot && hot.snapshot) hot.snapshot(() => (this.running && G.s ? Save.serialize() : null)); } catch (e) { /* optional */ }
    const boot = data => { if (data && data.game === 'wuestenfeste') { try { this.startLoaded(data); } catch (e) { /* ignorieren */ } } };
    try { if (hot && hot.ready) hot.ready(boot); else boot(hot && hot.data); } catch (e) { /* optional */ }
    window.addEventListener('beforeunload', () => { if (this.running && G.s && !G.s.over) Save.write('auto'); });
    requestAnimationFrame(t => { this.last = t; this.loop(t); });
  },

  // ---------- Spiel starten ----------
  startNew() {
    this.openOverlay('loading');
    setTimeout(() => this.startNew2(), 60);
  },
  startNew2() {
    const diff = document.getElementById('optDiff').value;
    const peace = +document.getElementById('optPeace').value;
    G.newGame({ difficulty: diff, peace });
    R.buildTerrain();
    R.cam.z = 1;
    const k = G.bmap.get(G.s.players[0].keep);
    R.centerOn(k.x + 4, k.y - 1);
    this.begin();
    this.tips = [
      [1, 'Willkommen, Burgherr! Baue zuerst Holzfäller nahe den Palmen (Reiter „Wirtschaft“).'],
      [18, 'Apfelhaine gehen nur auf grünem Oasenboden. Ohne Nahrung sinkt die Beliebtheit.'],
      [40, 'Stein bricht man auf grauem Fels, Eisen auf rostrotem Boden.'],
      [70, 'Mehr Hütten bringen mehr Bauern. Mit einer Kaserne bildest du Soldaten aus.'],
      [110, 'Umschließe deine Burg mit Mauern und Türmen – und setze Tore, damit deine Arbeiter hinauskommen.'],
    ];
    G.msg('Der Wüstenfürst greift frühestens nach ' + peace + ' Minuten an.', 'info');
  },

  startLoaded(data) {
    Save.apply(data);
    this.tips = [];
    this.begin();
    G.msg('Spielstand geladen: ' + G.dateText(), 'good');
  },

  begin() {
    UI.sel.clear(); UI.selB = 0; UI.inspectU = 0; UI.setMode('select'); UI.lastInfo = ''; UI.lastRes = '';
    document.getElementById('msgs').innerHTML = '';
    this.closeAll();
    document.getElementById('top').hidden = false;
    document.getElementById('bottom').hidden = false;
    R.resize();
    this.running = true; this.paused = false; this.autoT = 0;
    this.setSpeed(1);
  },

  // ---------- Hauptschleife ----------
  loop(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.running && !this.paused && this.overlays.size === 0 && G.s && !G.s.over) {
      this.acc += dt * this.speed;
      let n = 0;
      while (this.acc >= 0.05 && n < 12) { G.step(0.05); this.acc -= 0.05; n++; }
      if (n >= 12) this.acc = 0;
      // Tipps
      while (this.tips.length && G.s.time >= this.tips[0][0]) G.msg(this.tips.shift()[1], 'info');
      this.autoT += dt * this.speed;
      if (this.autoT > 60) { this.autoT = 0; Save.write('auto'); }
    }
    if (this.running) {
      UI.tick(dt);
      R.frame(dt);
      this.miniT = (this.miniT || 0) - dt;
      if (this.miniT <= 0) { this.miniT = 0.15; R.drawMini(document.getElementById('mini')); }
    } else R.frame(dt);
    requestAnimationFrame(tt => this.loop(tt));
  },

  setSpeed(s) {
    this.speed = s; this.paused = false;
    this.updateSpeedUI();
  },
  togglePause() { this.paused = !this.paused; this.updateSpeedUI(); },
  updateSpeedUI() {
    document.getElementById('spPause').classList.toggle('on', this.paused);
    for (const s of [1, 2, 3]) document.getElementById('sp' + s).classList.toggle('on', !this.paused && this.speed === s);
    document.getElementById('pausedTag').hidden = !this.paused;
  },

  quickSave() {
    if (G.s && !G.s.over && Save.write('quick')) G.msg('Schnell gespeichert.', 'good');
  },

  escape() {
    if (this.overlays.has('confirm')) { this.closeOverlay('confirm'); return; }
    if (this.overlays.has('xfer')) { this.closeOverlay('xfer'); return; }
    if (this.overlays.has('help')) { this.closeOverlay('help'); return; }
    if (this.overlays.has('pause')) { this.closeOverlay('pause'); return; }
    if (!this.running) return;
    if (UI.mode !== 'select') { UI.setMode('select'); return; }
    if (UI.sel.size || UI.selB || UI.inspectU) { UI.sel.clear(); UI.selB = 0; UI.inspectU = 0; UI.lastInfo = ''; return; }
    this.openPause();
  },

  gameOver(r) {
    Save.remove('auto');
    const t = document.getElementById('endTitle');
    t.textContent = r === 'win' ? 'Sieg!' : 'Niederlage';
    t.style.color = r === 'win' ? 'var(--brass-2)' : 'var(--bad)';
    document.getElementById('endText').textContent = r === 'win'
      ? 'Der Burgfried des Wüstenfürsten ist gefallen. Die Wüste gehört dir – ' + G.dateText() + '.'
      : 'Dein Burgfried ist gefallen. Der Wüstenfürst hat gesiegt – ' + G.dateText() + '.';
    setTimeout(() => this.openOverlay('end'), 1200);
  },

  // ---------- Overlays ----------
  openOverlay(id) { document.getElementById(id).hidden = false; this.overlays.add(id); },
  closeOverlay(id) { document.getElementById(id).hidden = true; this.overlays.delete(id); },
  closeAll() { for (const id of [...this.overlays]) this.closeOverlay(id); },

  openPause() { this.refreshSlots(); this.openOverlay('pause'); },

  toMenu() {
    if (this.running && G.s && !G.s.over) Save.write('auto');
    this.running = false;
    this.closeAll();
    document.getElementById('top').hidden = true;
    document.getElementById('bottom').hidden = true;
    this.refreshSlots();
    this.openOverlay('menu');
  },

  ask(text, yes, cb) {
    document.getElementById('confirmText').textContent = text;
    document.getElementById('confirmYes').textContent = yes || 'Ja';
    this.confirmCb = cb;
    this.openOverlay('confirm');
  },

  refreshSlots() {
    const render = (el, inGame) => {
      el.innerHTML = '';
      for (const s of Save.SLOTS) {
        const m = Save.meta(s.id);
        if (!inGame && !m) continue;
        const row = document.createElement('div');
        row.className = 'slot';
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.innerHTML = '<b>' + s.name + (m ? ' · ' + m.date : '') + '</b><small>' + (m ? m.diff + ' · ' + m.when + (m.over ? ' · beendet' : '') : 'leer') + '</small>';
        row.appendChild(meta);
        const canSave = inGame && s.id !== 'auto';
        const sv = document.createElement('button');
        sv.textContent = 'Speichern';
        sv.disabled = !canSave;
        sv.style.visibility = canSave ? 'visible' : 'hidden';
        sv.addEventListener('click', () => {
          const go = () => { if (Save.write(s.id)) { G.msg('Gespeichert in ' + s.name + '.', 'good'); this.refreshSlots(); } };
          if (m) this.ask(s.name + ' überschreiben?', 'Überschreiben', go); else go();
        });
        row.appendChild(sv);
        const ld = document.createElement('button');
        ld.textContent = 'Laden';
        ld.disabled = !m;
        ld.addEventListener('click', () => {
          const go = () => {
            const d = Save.read(s.id);
            try { this.startLoaded(d); } catch (e) { G.msg('Laden fehlgeschlagen: ' + e.message, 'bad'); }
          };
          if (inGame) this.ask('Aktuelles Spiel verlassen und ' + s.name + ' laden? Nicht gespeicherter Fortschritt geht verloren.', 'Laden', go); else go();
        });
        row.appendChild(ld);
        el.appendChild(row);
      }
      if (!el.children.length) el.innerHTML = '<p class="small">Noch keine Spielstände. Das Spiel speichert jede Minute automatisch.</p>';
    };
    render(document.getElementById('menuSlots'), false);
    render(document.getElementById('pauseSlots'), true);
  },

  openXfer(mode) {
    this.xferMode = mode;
    const ta = document.getElementById('xferData');
    document.getElementById('xferTitle').textContent = mode === 'export' ? 'Spielstand exportieren' : 'Spielstand importieren';
    document.getElementById('xferText').textContent = mode === 'export'
      ? 'Speichere die Datei auf deinem Laptop oder kopiere den Text. So bleibt der Spielstand erhalten, auch wenn der Browser-Speicher gelöscht wird.'
      : 'Wähle eine gespeicherte Datei oder füge den kopierten Text ein.';
    ta.value = mode === 'export' ? JSON.stringify(Save.serialize()) : '';
    ta.readOnly = mode === 'export';
    document.getElementById('xferCopy').hidden = mode !== 'export';
    // In eingebetteten Ansichten blockiert der Browser Downloads – dort nur Kopieren anbieten
    let framed = false;
    try { framed = window.self !== window.top; } catch (e) { framed = true; }
    document.getElementById('xferDownload').hidden = mode !== 'export' || framed;
    document.getElementById('xferPick').hidden = mode === 'export';
    document.getElementById('xferLoad').hidden = mode === 'export';
    this.openOverlay('xfer');
    if (mode === 'export') { ta.focus(); ta.select(); }
  },

  bindMenus() {
    const on = (id, f) => document.getElementById(id).addEventListener('click', f);
    on('btnNew', () => {
      const l = Save.latest();
      if (l && l.id === 'auto') this.ask('Ein neues Spiel überschreibt den automatischen Spielstand. Fortfahren?', 'Neues Spiel', () => this.startNew());
      else this.startNew();
    });
    on('btnImport1', () => this.openXfer('import'));
    on('btnImport2', () => this.openXfer('import'));
    on('btnExport', () => this.openXfer('export'));
    on('btnHelp', () => this.openOverlay('help'));
    on('btnHelp2', () => this.openOverlay('help'));
    on('btnHelp3', () => this.openOverlay('help'));
    on('helpClose', () => this.closeOverlay('help'));
    on('btnMenu', () => this.openPause());
    on('btnKeep', () => UI.openKeep());
    on('btnMap', () => document.body.classList.toggle('showmap'));
    on('btnResume', () => this.closeOverlay('pause'));
    on('btnToMenu', () => this.toMenu());
    on('spPause', () => this.togglePause());
    for (const s of [1, 2, 3]) on('sp' + s, () => this.setSpeed(s));
    on('confirmNo', () => this.closeOverlay('confirm'));
    on('confirmYes', () => { this.closeOverlay('confirm'); const cb = this.confirmCb; this.confirmCb = null; if (cb) cb(); });
    on('endMenu', () => this.toMenu());
    on('endNew', () => { this.closeAll(); this.toMenu(); });
    on('xferClose', () => this.closeOverlay('xfer'));
    on('xferCopy', () => {
      const ta = document.getElementById('xferData');
      const done = () => G.msg('Spielstand in die Zwischenablage kopiert.', 'good');
      try {
        navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); document.execCommand('copy'); done(); });
      } catch (e) { ta.select(); try { document.execCommand('copy'); done(); } catch (e2) { /* manuell kopieren */ } }
    });
    on('xferDownload', () => {
      const blob = new Blob([document.getElementById('xferData').value], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = Save.fileName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    on('xferPick', () => document.getElementById('xferFile').click());
    document.getElementById('xferFile').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { document.getElementById('xferData').value = rd.result; };
      rd.readAsText(f);
      e.target.value = '';
    });
    on('xferLoad', () => {
      let d;
      try { d = JSON.parse(document.getElementById('xferData').value.trim()); }
      catch (e) { UI.pushMsg('Der Text ist kein gültiger Spielstand.', 'bad'); return; }
      try { this.startLoaded(d); }
      catch (e) { UI.pushMsg('Laden fehlgeschlagen: ' + e.message, 'bad'); }
    });
  },
};

window.addEventListener('DOMContentLoaded', () => Main.init());
