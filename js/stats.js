/* stats.js — Alle Berechnungen. Reine Funktionen: rein geht der Datenstand,
 * raus kommen Zahlen. Kein Zugriff auf localStorage, kein Zugriff auf die
 * Oberflaeche. Dadurch laesst sich hier jederzeit etwas aendern, ohne dass
 * anderswo etwas kaputtgeht.
 *
 * Die zentrale Kennzahl ist die Erfuellungsquote in Prozent:
 *   erfuellte Minimum-Standards / moegliche Minimum-Standards
 *
 * Bewusste Entscheidungen, die hier fest verdrahtet sind:
 *  - Der laufende Tag und die laufende Woche zaehlen NICHT mit. Sonst stuende
 *    man morgens um 9 Uhr scheinbar schlecht da und wuerde sich ueber den Tag
 *    "hocharbeiten".
 *  - Uebererfuellung fliesst NICHT in die Quote ein. Damit kann eine besonders
 *    intensive Phase den eigenen Vergleichsmassstab nicht dauerhaft verschieben.
 *  - Eine Woche gehoert zu dem Monat, in dem ihr Montag liegt.
 *  - Ein Habit zaehlt erst ab dem Tag, an dem es angelegt wurde.
 */
window.Stats = (function () {
  'use strict';

  /* ---------- interne Helfer ---------- */

  function checkIndex(state) {
    var idx = {};
    state.checks.forEach(function (c) {
      if (c.done) idx[c.habitId + '|' + c.date] = true;
    });
    return idx;
  }

  // habitId|montagsdatum -> Anzahl Einheiten in dieser Woche
  function weekCountIndex(state) {
    var idx = {};
    state.counts.forEach(function (c) {
      var k = c.habitId + '|' + Dates.mondayOf(c.date);
      idx[k] = (idx[k] || 0) + 1;
    });
    return idx;
  }

  // habitId|datum -> Anzahl Einheiten an diesem Tag (fuer Tagesquoten)
  function dayCountIndex(state) {
    var idx = {};
    state.counts.forEach(function (c) {
      var k = c.habitId + '|' + c.date;
      idx[k] = (idx[k] || 0) + 1;
    });
    return idx;
  }

  // Passt dieser Wochentag zum Habit? (activeWeekdays: null = jeden Tag)
  function isActiveWeekday(habit, day) {
    return !habit.activeWeekdays || habit.activeWeekdays.indexOf(Dates.weekdayIndex(day)) !== -1;
  }

  // Zaehlt dieser Tag fuer dieses Habit?
  function dayCounts(habit, day, todayKey) {
    if (day >= todayKey) return false;                       // heute und Zukunft noch nicht
    if (day < habit.createdAt) return false;                 // Habit gab es noch nicht
    if (habit.archivedAt && day >= habit.archivedAt) return false;
    if (!isActiveWeekday(habit, day)) return false;           // z.B. Wochenende bei Werktags-Habits
    return true;
  }

  // Zaehlt diese Woche fuer dieses Quoten-Habit?
  function weekCounts(habit, mondayKey, todayKey) {
    if (!Dates.weekIsComplete(mondayKey, todayKey)) return false;
    if (mondayKey < habit.createdAt) return false;           // Habit gab es zu Wochenbeginn noch nicht
    if (habit.archivedAt && Dates.addDays(mondayKey, 6) >= habit.archivedAt) return false;
    return true;
  }

  /* ---------- Erfuellungsquote eines Monats ---------- */

  function monthFulfillment(state, ym, todayKey) {
    var ci = checkIndex(state);
    var wi = weekCountIndex(state);
    var di = dayCountIndex(state);
    var days = Dates.monthDays(ym);
    var weeks = Dates.monthWeeks(ym);

    var possible = 0, achieved = 0;
    var perHabit = [];

    state.habits.forEach(function (h) {
      var p = 0, a = 0;

      if (h.type === 'daily') {
        days.forEach(function (day) {
          if (!dayCounts(h, day, todayKey)) return;
          p++;
          if (ci[h.id + '|' + day]) a++;
        });
      } else if (h.type === 'dayquota') {
        days.forEach(function (day) {
          if (!dayCounts(h, day, todayKey)) return;
          p++;
          if ((di[h.id + '|' + day] || 0) >= h.min) a++;
        });
      } else {
        weeks.forEach(function (mon) {
          if (!weekCounts(h, mon, todayKey)) return;
          p++;
          if ((wi[h.id + '|' + mon] || 0) >= h.min) a++;
        });
      }

      if (p > 0) {
        perHabit.push({
          habit: h, possible: p, achieved: a,
          pct: Math.round((a / p) * 100)
        });
        possible += p;
        achieved += a;
      }
    });

    return {
      month: ym,
      possible: possible,
      achieved: achieved,
      pct: possible > 0 ? Math.round((achieved / possible) * 100) : null,
      perHabit: perHabit
    };
  }

  // Die Quoten der letzten n Monate, aeltester zuerst.
  function monthSeries(state, endYm, n, todayKey) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      out.push(monthFulfillment(state, Dates.addMonths(endYm, -i), todayKey));
    }
    return out;
  }

  /* ---------- Uebererfuellung ---------- */

  // Nur zur Anerkennung in der Rueckschau. Fliesst nirgends in eine Wertung ein.
  //
  // Bewusst nur Wochenquoten: Bei einer Tagesquote wie den Mahlzeiten waere
  // "mehr als das Minimum" keine Leistung, die man wuerdigen will.
  function monthOverachievement(state, ym, todayKey) {
    var wi = weekCountIndex(state);
    var weeks = Dates.monthWeeks(ym);
    var out = [];

    state.habits.filter(function (h) { return h.type === 'quota'; }).forEach(function (h) {
      var counted = 0, over = 0, best = 0, extra = 0;
      weeks.forEach(function (mon) {
        if (!weekCounts(h, mon, todayKey)) return;
        var c = wi[h.id + '|' + mon] || 0;
        counted++;
        if (c > best) best = c;
        if (c > h.min) { over++; extra += (c - h.min); }
      });
      if (counted > 0 && over > 0) {
        out.push({ habit: h, weeks: counted, weeksOver: over, best: best, extra: extra });
      }
    });

    return out;
  }

  /* ---------- Laufende Anzeigen ---------- */

  // Rollierendes 7-Tage-Fenster, inklusive des angezeigten Tages.
  // Reine Fortschrittsanzeige, kein Ziel. Zaehlt bei Tagesquoten die Tage,
  // an denen das Minimum erreicht war. "possible" beruecksichtigt
  // activeWeekdays, damit z.B. Mittagspause "von 5" statt "von 7" zeigt -
  // ein 7-Tage-Fenster enthaelt immer genau 5 Werktage, egal wo es beginnt.
  function rolling7(state, habit, endDate) {
    var ci = habit.type === 'daily' ? checkIndex(state) : null;
    var di = habit.type === 'dayquota' ? dayCountIndex(state) : null;
    var done = 0, possible = 0;
    for (var i = 0; i < 7; i++) {
      var day = Dates.addDays(endDate, -i);
      if (!isActiveWeekday(habit, day)) continue;
      possible++;
      if (habit.type === 'daily') {
        if (ci[habit.id + '|' + day]) done++;
      } else if (habit.type === 'dayquota') {
        if ((di[habit.id + '|' + day] || 0) >= habit.min) done++;
      }
    }
    return { done: done, possible: possible };
  }

  // Die letzten n Wochen eines Quoten-Habits, aelteste zuerst.
  function weekSeries(state, habit, endMondayKey, n) {
    var wi = weekCountIndex(state);
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var mon = Dates.addDays(endMondayKey, -7 * i);
      out.push({
        monday: mon,
        count: wi[habit.id + '|' + mon] || 0,
        min: habit.min,
        max: habit.max,
        complete: Dates.weekIsComplete(mon, Dates.today()),
        beforeStart: mon < habit.createdAt
      });
    }
    return out;
  }

  // Wie viele der letzten n abgeschlossenen Wochen lagen auf oder ueber dem Minimum?
  // Rein faktisch formuliert - die Einordnung nimmt die App bewusst nicht vor.
  function weeksAtMinimum(state, habit, todayKey, n) {
    var wi = weekCountIndex(state);
    var thisMonday = Dates.mondayOf(todayKey);
    var counted = 0, ok = 0;
    for (var i = 1; i <= n + 8 && counted < n; i++) {
      var mon = Dates.addDays(thisMonday, -7 * i);
      if (!weekCounts(habit, mon, todayKey)) continue;
      counted++;
      if ((wi[habit.id + '|' + mon] || 0) >= habit.min) ok++;
    }
    return { counted: counted, ok: ok };
  }

  /* ---------- Reflexion ---------- */

  function reflectionsInMonth(state, ym) {
    var engaged = 0, skipped = 0;
    state.reflections.forEach(function (r) {
      if (Dates.monthOf(r.date) !== ym) return;
      if (r.engaged) engaged++; else skipped++;
    });
    return { engaged: engaged, skipped: skipped };
  }

  // Ist wieder eine Frage faellig?
  //
  // Fuer das Intervall zaehlen nur Fragen, mit denen du dich beschaeftigt hast.
  // Ein "heute nicht" setzt stattdessen eine kurze Pause (snoozeUntil) und
  // danach kommt eine neue Frage - sonst wuerde ein Nein wie ein Ja wirken
  // und die naechste Frage um das volle Intervall nach hinten schieben.
  function reflectionDue(state, todayKey) {
    var meta = state.reflectionMeta || {};
    if (meta.snoozeUntil && todayKey < meta.snoozeUntil) return false;

    var last = null;
    state.reflections.forEach(function (r) {
      if (r.engaged && (!last || r.date > last)) last = r.date;
    });
    if (!last) return true;

    var interval = state.settings.reflectionIntervalDays || 7;
    return Dates.diffDays(last, todayKey) >= interval;
  }

  return {
    monthFulfillment: monthFulfillment,
    monthSeries: monthSeries,
    monthOverachievement: monthOverachievement,
    rolling7: rolling7,
    weekSeries: weekSeries,
    weeksAtMinimum: weeksAtMinimum,
    reflectionsInMonth: reflectionsInMonth,
    reflectionDue: reflectionDue
  };
})();
