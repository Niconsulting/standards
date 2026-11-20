'use strict';
// Kampagne: Missionen mit eigenen Zielen

const Campaign = {
  KEY: 'wuestenfeste.campaign',
  MISSIONS: [
    {
      id: 1, name: 'Ankunft in der Oase', diff: 'leicht',
      intro: 'Du hast ein Stück Wüste zugesprochen bekommen. Noch droht kein Feind – baue eine Siedlung auf, die ihre Leute ernährt.',
      goals: ['24 Bauern', '120 Nahrung im Speicher', 'Beliebtheit mindestens 60'],
      setup(s) { s.ai.passive = true; },
      check(s) {
        const p = s.players[0];
        const pop = G.peasants(0).all, food = FOODS.reduce((a, k) => a + (p.res[k] || 0), 0);
        return [[pop, 24], [Math.floor(food), 120], [Math.round(p.popularity), 60]];
      },
    },
    {
      id: 2, name: 'Brot und Steine', diff: 'leicht',
      intro: 'Äpfel allein machen nicht lange satt. Lege Weizenfelder an, baue Mühle und Bäckerei und beginne mit der Befestigung.',
      goals: ['60 Brot im Speicher', '1 Wachturm oder Großer Turm', '30 Mauerfelder'],
      setup(s) { s.ai.passive = true; },
      check(s) {
        const p = s.players[0];
        const towers = G.count(0, 'tower') + G.count(0, 'bigtower');
        return [[Math.floor(p.res.brot || 0), 60], [towers, 1], [G.count(0, 'wall'), 30]];
      },
    },
    {
      id: 3, name: 'Der erste Überfall', diff: 'leicht', peace: 5,
      intro: 'Späher melden Reiter am Horizont. Der Wüstenfürst wird dreimal angreifen. Halte stand!',
      goals: ['3 Angriffswellen abwehren', 'Burgfried halten'],
      setup(s) { s.ai.waveInterval = 150; },
      check(s) {
        const alive = s.units.some(u => u.attacker && !u.dead);
        const done = s.ai.waves >= 3 && !alive ? 3 : Math.max(0, s.ai.waves - (alive ? 1 : 0));
        return [[done, 3], [1, 1]];
      },
    },
    {
      id: 4, name: 'Der Wüstenfürst', diff: 'normal', peace: 8,
      intro: 'Jetzt oder nie: Baue ein Heer auf und zerstöre den Burgfried des Wüstenfürsten.',
      goals: ['Feindlichen Burgfried zerstören'],
      setup() {},
      check(s) { return [[G.bmap.has(s.players[1].keep) ? 0 : 1, 1]]; },
    },
    {
      id: 5, name: 'Sturm auf die Feste', diff: 'normal', peace: 99,
      intro: 'Dein Heer steht vor der Feste des Fürsten. Du hast 20 Minuten, um den Burgfried zu Fall zu bringen. Rammböcke öffnen Tore, Katapulte zerschlagen Türme.',
      goals: ['Feindlichen Burgfried zerstören', 'Zeit: 20 Minuten'],
      limit: 20 * 60,
      setup(s) {
        s.ai.passive = true;
        const P0 = s.players[0];
        P0.res.gold = 1500; P0.res.holz = 200; P0.res.stein = 100; P0.res.eisen = 30;
        const k = G.bmap.get(P0.keep);
        const army = { sword: 8, crossbow: 6, pike: 4, archer: 6, knight: 3, monk: 2, ram: 2, catapult: 2 };
        let i = 0;
        for (const t in army) for (let j = 0; j < army[t]; j++, i++) {
          const u = G.addUnit(t, 0, k.x + 6 + (i % 8) * 0.8, k.y - 6 - Math.floor(i / 8) * 0.8);
          G.pushOut(u);
          u.order = { t: 'idle', gx: u.x, gy: u.y };
        }
        // Feste des Gegners vorbauen
        const p1 = s.players[1], c = AI.center();
        for (let n = 0; n < 30; n++) { const e = G.edgeSpawn(1); const u = G.addUnit('peasant', 1, e.x + 0.5, e.y + 0.5); u.task = 'idle'; }
        for (let n = 0; n < 160; n++) { p1.res.holz = 400; p1.res.stein = 400; p1.res.gold = 2000; p1.res.eisen = 100; AI.build(c); }
        for (let n = 0; n < 28; n++) { s.ai.recruitT = 0; AI.army(c); }
        p1.res.gold = 800;
      },
      check(s) {
        const left = Math.max(0, Math.ceil((this.limit - s.time) / 60));
        return [[G.bmap.has(s.players[1].keep) ? 0 : 1, 1], [left, 0, 'Noch ' + left + ' min']];
      },
      fail(s) { return s.time > this.limit ? 'Die Zeit ist abgelaufen.' : null; },
    },
  ],

  get(id) { return this.MISSIONS.find(m => m.id === id); },
  unlocked() {
    try { return Math.max(1, +localStorage.getItem(this.KEY) || 1); } catch (e) { return 1; }
  },
  complete(id) {
    try { if (id + 1 > this.unlocked()) localStorage.setItem(this.KEY, String(id + 1)); } catch (e) { /* egal */ }
  },

  setup(s) {
    const m = this.get(s.mission.id);
    if (!m) return;
    m.setup(s);
    s.mission.t = 0;
  },

  update(dt) {
    const s = G.s, mi = s.mission;
    mi.t = (mi.t || 0) - dt;
    if (mi.t > 0 || s.over) return;
    mi.t = 1;
    const m = this.get(mi.id);
    if (!m) return;
    const prog = m.check(s);
    mi.prog = prog;
    const fail = m.fail && m.fail(s);
    if (fail) { s.over = 'lose'; mi.failText = fail; if (G.onEnd) G.onEnd('lose'); return; }
    const done = prog.every(([v, need, label]) => label ? true : v >= need);
    if (done) { s.over = 'win'; this.complete(mi.id); if (G.onEnd) G.onEnd('win'); }
  },

  // Zielanzeige
  html() {
    const s = G.s;
    if (!s || !s.mission) return '';
    const m = this.get(s.mission.id);
    if (!m) return '';
    const prog = s.mission.prog || m.check(s);
    return '<b>' + m.id + '. ' + m.name + '</b><ul>' + m.goals.map((g, i) => {
      const p = prog[i] || [0, 1];
      const ok = p[2] ? false : p[0] >= p[1];
      const txt = p[2] ? p[2] : (p[1] > 1 ? Math.min(p[0], p[1]) + ' / ' + p[1] : '');
      return '<li class="' + (ok ? 'ok' : '') + '"><span>' + (ok ? '✓' : '○') + '</span>' + g + (txt ? ' <small>' + txt + '</small>' : '') + '</li>';
    }).join('') + '</ul>';
  },
};
