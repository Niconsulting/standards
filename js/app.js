/* app.js — Oberflaeche und Ablauf.
 *
 * Diese Datei kennt keine Speicherdetails. Sie fragt Store nach Daten und
 * Stats nach Zahlen. Das ist die Trennung, die einen spaeteren Wechsel auf
 * Cloud-Sync einfach macht.
 */
(function () {
  'use strict';

  var MAX_BACKFILL_DAYS = 7;   // so weit darf man zurueckblaettern und nachtragen
  var DECLINE_PAUSE_DAYS = 3;  // Pause nach "heute nicht", dann kommt eine neue Frage

  var ui = {
    view: 'heute',
    day: Dates.today(),
    month: Dates.currentMonth(),
    pendingQuestion: null,      // aktuell angezeigte Reflexionsfrage
    reflectionOpen: false       // Leitfrage ist erst nach Antippen sichtbar
  };

  /* ---------- kleine Helfer ---------- */

  function $(sel) { return document.querySelector(sel); }

  // Habit-Namen kommen aus einem Eingabefeld und duerfen niemals ungeprueft
  // als HTML eingesetzt werden.
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';
  var ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  var ICON_MINUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';

  /* ---------- Darstellung ---------- */

  async function applyTheme() {
    var s = await Store.getSettings();
    if (s.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', s.theme);
  }

  function setView(name) {
    ui.view = name;
    ['heute', 'rueckschau', 'einstellungen'].forEach(function (v) {
      $('#view-' + v).classList.toggle('hidden', v !== name);
    });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.view === name);
    });
    window.scrollTo(0, 0);
    render();
  }

  async function render() {
    if (ui.view === 'heute') await renderHeute();
    else if (ui.view === 'rueckschau') await renderRueckschau();
    else if (ui.view === 'einstellungen') await Settings.render($('#einstellungenBody'));
  }

  /* ---------- Heute ---------- */

  async function renderHeute() {
    var today = Dates.today();
    var day = ui.day;
    var state = await Store.getState();
    var habits = await Store.getHabits();
    var dayData = await Store.getDay(day);

    $('#dayLabel').textContent = Dates.formatDay(day, today);
    $('#daySub').textContent = (day === today) ? Dates.formatFull(day) : '';

    // Zurueck bis maximal MAX_BACKFILL_DAYS, vorwaerts hoechstens bis heute.
    $('#dayPrev').disabled = Dates.diffDays(day, today) >= MAX_BACKFILL_DAYS;
    $('#dayNext').disabled = (day >= today);

    await renderBackupHint(today);
    renderReflection(state, day, today);
    renderDaily(state, habits, dayData, day);
    await renderQuota(habits, dayData, day, today);

    $('#heuteFootnote').textContent = (day === today)
      ? ''
      : 'Ein vergangener Tag. Nachtragen ist möglich, nötig ist es nicht.';
  }

  function renderDaily(state, habits, dayData, day) {
    var list = habits.filter(function (h) {
      return h.type === 'daily' || h.type === 'dayquota';
    });
    var el = $('#dailyList');

    if (!list.length) {
      el.innerHTML = '<p class="placeholder">Noch keine täglichen Habits angelegt.</p>';
      return;
    }

    el.innerHTML = list.map(function (h) {
      var r7 = Stats.rolling7(state, h, day);

      if (h.type === 'dayquota') {
        return dayQuotaRowHtml(h, dayData.counts[h.id] || 0, r7);
      }

      var done = !!dayData.checks[h.id];
      return '<button class="row' + (done ? ' is-done' : '') + '" data-habit="' + h.id + '">' +
               '<span class="row-text">' +
                 '<span class="row-name">' + esc(h.name) + '</span>' +
                 '<span class="row-meta">' + r7.done + ' von ' + r7.possible + ' Tagen</span>' +
               '</span>' +
               '<span class="tick">' + ICON_CHECK + '</span>' +
             '</button>';
    }).join('');
  }

  // Tagesquote: Zaehler mit Minimum pro Tag, z.B. drei Mahlzeiten.
  // Anders als bei der Wochenquote wird kein leeres Bonusfeld vorgehalten -
  // bei drei Mahlzeiten sind drei Felder die ganze Geschichte.
  function dayQuotaRowHtml(h, dayCount, r7) {
    var met = dayCount >= h.min;
    var total = h.max || Math.max(h.min, dayCount);
    if (total > 10) total = 10;
    var extra = Math.max(0, dayCount - total);

    var pips = '';
    for (var i = 0; i < total; i++) {
      var cls = 'pip';
      if (i >= h.min) cls += ' is-bonus';
      if (i < dayCount) cls += ' is-on';
      if (i === h.min - 1 && total > h.min) cls += ' is-boundary';
      pips += '<span class="' + cls + '"></span>';
    }
    if (extra > 0) pips += '<span class="pip-extra">+' + extra + '</span>';

    var countText = met
      ? dayCount + '× · Minimum erreicht'
      : dayCount + ' von ' + h.min;

    return '<div class="qrow' + (met ? ' is-met' : '') + '">' +
             '<div class="qrow-head">' +
               '<span class="qrow-name">' + esc(h.name) + '</span>' +
               '<span class="qrow-count">' + countText + '</span>' +
             '</div>' +
             '<div class="pips">' + pips + '</div>' +
             '<div class="qrow-controls">' +
               '<span class="qrow-today">an ' + r7.done + ' von ' + r7.possible + ' Tagen erreicht</span>' +
               '<button class="stepper" data-quota="' + h.id + '" data-action="minus" ' +
                 (dayCount === 0 ? 'disabled' : '') + ' aria-label="Eine Einheit entfernen">' +
                 ICON_MINUS + '</button>' +
               '<button class="stepper" data-quota="' + h.id + '" data-action="plus" ' +
                 'aria-label="Eine Einheit hinzufügen">' + ICON_PLUS + '</button>' +
             '</div>' +
           '</div>';
  }

  async function renderQuota(habits, dayData, day, today) {
    var list = habits.filter(function (h) { return h.type === 'quota'; });
    var el = $('#quotaList');
    var monday = Dates.mondayOf(day);

    $('#weekTitle').textContent = (monday === Dates.mondayOf(today))
      ? 'Diese Woche'
      : 'Woche ab ' + Dates.formatWeekShort(monday);

    if (!list.length) {
      el.innerHTML = '<p class="placeholder">Noch keine Wochenquoten angelegt.</p>';
      return;
    }

    var weekCounts = await Promise.all(list.map(function (h) {
      return Store.countInWeek(h.id, monday);
    }));

    el.innerHTML = list.map(function (h, i) {
      return quotaRowHtml(h, weekCounts[i], dayData.counts[h.id] || 0);
    }).join('');
  }

  function quotaRowHtml(h, weekCount, dayCount) {
    var met = weekCount >= h.min;

    // Segmentbalken: die ersten h.min Segmente sind der Minimum-Standard,
    // alles danach ist Bonus und wird zurueckhaltender dargestellt.
    var total = h.max || (Math.max(h.min, weekCount) + 1);
    if (total > 10) total = 10;
    var extra = Math.max(0, weekCount - total);

    var pips = '';
    for (var i = 0; i < total; i++) {
      var cls = 'pip';
      if (i >= h.min) cls += ' is-bonus';
      if (i < weekCount) cls += ' is-on';
      if (i === h.min - 1 && total > h.min) cls += ' is-boundary';
      pips += '<span class="' + cls + '"></span>';
    }
    if (extra > 0) pips += '<span class="pip-extra">+' + extra + '</span>';

    var countText = met
      ? weekCount + '× · Minimum erreicht'
      : weekCount + '× · Minimum ' + h.min;

    return '<div class="qrow' + (met ? ' is-met' : '') + '">' +
             '<div class="qrow-head">' +
               '<span class="qrow-name">' + esc(h.name) + '</span>' +
               '<span class="qrow-count">' + countText + '</span>' +
             '</div>' +
             '<div class="pips">' + pips + '</div>' +
             '<div class="qrow-controls">' +
               '<span class="qrow-today">' + dayCount + '× an diesem Tag</span>' +
               '<button class="stepper" data-quota="' + h.id + '" data-action="minus" ' +
                 (dayCount === 0 ? 'disabled' : '') + ' aria-label="Eine Einheit entfernen">' +
                 ICON_MINUS + '</button>' +
               '<button class="stepper" data-quota="' + h.id + '" data-action="plus" ' +
                 'aria-label="Eine Einheit hinzufügen">' + ICON_PLUS + '</button>' +
             '</div>' +
           '</div>';
  }

  /* ---------- Reflexion ---------- */

  /* ---------- Sicherungs-Hinweis ---------- */

  // Ruhiger Hinweis, keine Warnung: keine Signalfarbe, kein Ausrufezeichen,
  // jederzeit wegtippbar.
  async function renderBackupHint(today) {
    var slot = $('#backupSlot');
    var meta = await Store.getMeta();
    var settings = await Store.getSettings();

    if (!Backup.backupDue(meta, settings, today)) { slot.innerHTML = ''; return; }

    var days = Backup.daysSinceBackup(meta, today);
    var text = Backup.hasNeverExported(meta)
      ? 'Seit ' + days + ' Tagen in Benutzung, noch ohne Sicherung.'
      : 'Letzte Sicherung vor ' + days + ' Tagen.';

    slot.innerHTML =
      '<div class="hint">' +
        '<p class="hint-text">' + text + '</p>' +
        '<div class="hint-actions">' +
          '<button class="btn btn-primary" data-backup="now">Sicherung erstellen</button>' +
          '<button class="btn" data-backup="later">Später</button>' +
        '</div>' +
      '</div>';
  }

  var ICON_CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  // Die Leitfrage ist bewusst NICHT das Erste, was man sieht: erst ein
  // unauffaelliger Anstoss ganz unten, die eigentliche Frage nur nach Tap.
  function renderReflection(state, day, today) {
    var slot = $('#reflectionSlot');

    // Reflexion gibt es nur fuer heute, nicht rueckwirkend.
    if (day !== today || !Stats.reflectionDue(state, today)) {
      slot.innerHTML = '';
      ui.pendingQuestion = null;
      return;
    }

    if (!ui.reflectionOpen) {
      slot.innerHTML =
        '<button class="reflect-teaser" id="reflectTeaser">' +
          '<span class="reflect-teaser-dot"></span>' +
          '<span>Leitfrage verfügbar</span>' +
          ICON_CHEVRON +
        '</button>';
      return;
    }

    if (!ui.pendingQuestion) {
      var used = state.reflectionMeta.usedQuestionIds || [];
      ui.pendingQuestion = Questions.pickNext(used);
    }

    slot.innerHTML =
      '<div class="reflection">' +
        '<div class="reflection-head">' +
          '<p class="reflection-kicker">Leitfrage</p>' +
          '<button class="reflection-close" id="reflectClose" aria-label="Zuklappen">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' +
        '</div>' +
        '<p class="reflection-q">' + esc(ui.pendingQuestion.text) + '</p>' +
        '<div class="reflection-actions">' +
          '<button class="btn btn-primary" data-reflect="yes">Damit beschäftige ich mich</button>' +
          '<button class="btn" data-reflect="no">Heute nicht</button>' +
        '</div>' +
        '<p class="reflection-note">Die App speichert keine Antwort, nur dass die Frage dran war.</p>' +
      '</div>';
  }

  async function decideReflection(engaged) {
    var today = Dates.today();
    if (!ui.pendingQuestion) return;

    await Store.recordReflection(ui.pendingQuestion.id, today, engaged);

    if (engaged) {
      await Store.setReflectionSnooze(null);
      // Katalog durch? Dann wieder von vorn beginnen.
      var meta = await Store.getReflectionMeta();
      if (Questions.isExhausted(meta.usedQuestionIds)) await Store.resetUsedQuestions();
    } else {
      // Kurze Pause, danach kommt eine andere Frage. Kein Nachhaken.
      await Store.setReflectionSnooze(Dates.addDays(today, DECLINE_PAUSE_DAYS));
    }

    ui.pendingQuestion = null;
    ui.reflectionOpen = false;
    await render();
  }

  /* ---------- Rückschau ---------- */

  async function renderRueckschau() {
    var today = Dates.today();
    var state = await Store.getState();
    var meta = await Store.getMeta();

    // Vor dem ersten Tag mit der App gibt es nichts zu zeigen.
    var firstMonth = Dates.monthOf(meta.firstUseAt || today);
    if (ui.month < firstMonth) ui.month = firstMonth;
    var ym = ui.month;

    $('#monthLabel').textContent = Dates.formatMonth(ym);
    $('#monthNext').disabled = (ym >= Dates.currentMonth());
    $('#monthPrev').disabled = (ym <= firstMonth);

    var mf = Stats.monthFulfillment(state, ym, today);
    var series = Stats.monthSeries(state, ym, 6, today, firstMonth);
    var over = Stats.monthOverachievement(state, ym, today);
    var refl = Stats.reflectionsInMonth(state, ym);

    var html = '';
    html += heroHtml(mf);
    html += seriesHtml(series);
    html += habitGroupHtml('Täglich', mf.perHabit.filter(function (p) {
      return p.habit.type === 'daily' || p.habit.type === 'dayquota';
    }));
    html += quotaGroupHtml(mf.perHabit.filter(function (p) { return p.habit.type === 'quota'; }), ym, today, state);
    html += overachievementHtml(over);
    html += reflectionSummaryHtml(refl);

    $('#rueckschauBody').innerHTML = html;
  }

  function heroHtml(mf) {
    if (mf.possible === 0) {
      return '<section class="stat-hero">' +
               '<div class="stat-hero-value stat-hero-empty">–</div>' +
               '<div class="stat-hero-label">Noch keine abgeschlossenen Tage in diesem Monat</div>' +
             '</section>';
    }
    return '<section class="stat-hero">' +
             '<div class="stat-hero-value">' + mf.pct + '%</div>' +
             '<div class="stat-hero-label">Minimum-Standards erfüllt</div>' +
           '</section>';
  }

  function seriesHtml(series) {
    var rows = series.map(function (m) {
      var pct = m.pct == null ? 0 : m.pct;
      var label = m.pct == null ? '–' : m.pct + '%';
      return '<div class="bar-row">' +
               '<span class="bar-row-label">' + Dates.formatMonthShort(m.month) + '</span>' +
               '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
               '<span class="bar-row-value">' + label + '</span>' +
             '</div>';
    }).join('');
    return '<h2 class="section-title">Verlauf</h2><div class="card">' + rows + '</div>';
  }

  function habitGroupHtml(title, items) {
    if (!items.length) return '';
    var rows = items.map(function (p) {
      var label = p.possible === 0 ? 'keine Daten' : p.pct + '%';
      return '<div class="pctrow">' +
               '<span class="pctrow-name">' + esc(p.habit.name) + '</span>' +
               '<span class="pctrow-value">' + label + '</span>' +
             '</div>';
    }).join('');
    return '<h2 class="section-title">' + title + '</h2><div class="card">' + rows + '</div>';
  }

  function quotaGroupHtml(items, ym, today, state) {
    if (!items.length) return '';
    var refDay = (ym === Dates.currentMonth()) ? today : Dates.monthDays(ym).slice(-1)[0];
    var endMonday = Dates.mondayOf(refDay);

    var blocks = items.map(function (p) {
      var weeks = Stats.weekSeries(state, p.habit, endMonday, 8);
      var label = p.possible === 0 ? 'keine Daten' : p.pct + '%';
      var chips = weeks.map(function (w) {
        if (w.beforeStart) {
          return '<span class="weekchip is-empty">–<span class="weekchip-date">' +
                 Dates.formatWeekShort(w.monday) + '</span></span>';
        }
        var cls = 'weekchip' + (w.complete && w.count >= w.min ? ' is-met' : '');
        var val = w.complete ? String(w.count) : w.count + '…';
        return '<span class="' + cls + '">' + val +
               '<span class="weekchip-date">' + Dates.formatWeekShort(w.monday) + '</span></span>';
      }).join('');
      return '<div class="qgroup">' +
               '<div class="pctrow">' +
                 '<span class="pctrow-name">' + esc(p.habit.name) + '</span>' +
                 '<span class="pctrow-value">' + label + '</span>' +
               '</div>' +
               '<div class="weekchips">' + chips + '</div>' +
             '</div>';
    }).join('');

    return '<h2 class="section-title">Wochenquoten</h2><div class="card">' + blocks + '</div>';
  }

  function overachievementHtml(over) {
    if (!over.length) return '';
    var lines = over.map(function (o) {
      return '<p class="over-line">' + esc(o.habit.name) + ': in ' + o.weeksOver + ' von ' +
             o.weeks + ' Wochen über dem Minimum, bis zu ' + o.best + '×</p>';
    }).join('');
    return '<h2 class="section-title">Stärkere Wochen</h2><div class="card"><div class="over-note">' +
           lines + '</div></div>';
  }

  function reflectionSummaryHtml(refl) {
    if (refl.engaged === 0 && refl.skipped === 0) return '';
    return '<h2 class="section-title">Reflexion</h2><div class="card"><div class="over-note">' +
           '<p class="over-line">' + refl.engaged + '× damit beschäftigt, ' + refl.skipped + '× heute nicht</p>' +
           '</div></div>';
  }

  /* ---------- Eingaben ---------- */

  function bindEvents() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { setView(t.dataset.view); });
    });

    $('#dayPrev').addEventListener('click', function () {
      ui.day = Dates.addDays(ui.day, -1);
      render();
    });
    $('#dayNext').addEventListener('click', function () {
      ui.day = Dates.addDays(ui.day, 1);
      render();
    });

    // Beide Listen koennen Haken und Zaehler enthalten.
    async function handleListClick(e) {
      var step = e.target.closest('[data-quota]');
      if (step) {
        if (step.disabled) return;
        if (step.dataset.action === 'plus') await Store.addCount(step.dataset.quota, ui.day);
        else await Store.removeCount(step.dataset.quota, ui.day);
        await render();
        return;
      }
      var row = e.target.closest('[data-habit]');
      if (!row) return;
      await Store.setCheck(row.dataset.habit, ui.day, !row.classList.contains('is-done'));
      await render();
    }

    $('#dailyList').addEventListener('click', handleListClick);
    $('#quotaList').addEventListener('click', handleListClick);

    $('#backupSlot').addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-backup]');
      if (!btn) return;
      if (btn.dataset.backup === 'now') {
        var res = await Backup.exportData();
        if (res.ok && res.via === 'download') {
          alert('Sicherung heruntergeladen. Falls nichts passiert ist, findest du unter ' +
                '"Mehr" die Möglichkeit, die Sicherung als Text anzuzeigen.');
        }
      } else {
        // Wegtippen kostet nichts und fragt in drei Tagen erneut.
        await Store.updateMeta({ backupSnoozedUntil: Dates.addDays(Dates.today(), 3) });
      }
      await render();
    });

    $('#reflectionSlot').addEventListener('click', function (e) {
      var teaser = e.target.closest('#reflectTeaser');
      if (teaser) {
        ui.reflectionOpen = true;
        render();
        return;
      }
      // Zuklappen ohne Entscheidung: nichts wird gespeichert, die Frage
      // bleibt fuer spaeter stehen.
      if (e.target.closest('#reflectClose')) {
        ui.reflectionOpen = false;
        render();
        return;
      }
      var btn = e.target.closest('[data-reflect]');
      if (!btn) return;
      decideReflection(btn.dataset.reflect === 'yes');
    });

    $('#monthPrev').addEventListener('click', function () {
      ui.month = Dates.addMonths(ui.month, -1);
      render();
    });
    $('#monthNext').addEventListener('click', function () {
      ui.month = Dates.addMonths(ui.month, 1);
      render();
    });

    // Nach laengerer Pause im Hintergrund kann sich das Datum geaendert haben.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      var t = Dates.today();
      if (ui.day > t) ui.day = t;
      render();
    });
  }

  /* ---------- Start ---------- */

  async function start() {
    await Store.init();
    await applyTheme();
    bindEvents();
    setView('heute');
  }

  // Kleine Schnittstelle fuer die anderen Dateien.
  window.App = {
    refresh: render,
    applyTheme: applyTheme,
    goTo: setView
  };

  document.addEventListener('DOMContentLoaded', start);
})();
