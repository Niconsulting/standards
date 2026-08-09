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
    pendingQuestion: null      // aktuell angezeigte Reflexionsfrage
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
    // Rueckschau und Einstellungen folgen im naechsten Schritt.
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
                 '<span class="row-meta">' + r7 + ' von 7 Tagen</span>' +
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
               '<span class="qrow-today">an ' + r7 + ' von 7 Tagen erreicht</span>' +
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

  function renderReflection(state, day, today) {
    var slot = $('#reflectionSlot');

    // Reflexion gibt es nur fuer heute, nicht rueckwirkend.
    if (day !== today || !Stats.reflectionDue(state, today)) {
      slot.innerHTML = '';
      ui.pendingQuestion = null;
      return;
    }

    if (!ui.pendingQuestion) {
      var used = state.reflectionMeta.usedQuestionIds || [];
      ui.pendingQuestion = Questions.pickNext(used);
    }

    slot.innerHTML =
      '<div class="reflection">' +
        '<p class="reflection-kicker">Leitfrage</p>' +
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
    await render();
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

    $('#reflectionSlot').addEventListener('click', function (e) {
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

  document.addEventListener('DOMContentLoaded', start);
})();
