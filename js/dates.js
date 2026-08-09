/* dates.js — Datums- und Wochenlogik.
 *
 * Zwei Konventionen, die in der ganzen App gelten:
 *  - Ein Datum ist immer ein String "YYYY-MM-DD" in LOKALER Zeit (nicht UTC).
 *  - Ein Wochenschlüssel ist das Datum des Montags dieser Woche, z.B. "2026-08-03".
 *    Dadurch gibt es keine Kalenderwochen-Sonderfaelle rund um den Jahreswechsel,
 *    und die Regel "eine Woche gehoert zu dem Monat, in dem ihr Montag liegt"
 *    ist direkt am Schluessel ablesbar.
 */
window.Dates = (function () {
  'use strict';

  var WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  var WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag',
                       'Freitag', 'Samstag', 'Sonntag'];
  var MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
                'August', 'September', 'Oktober', 'November', 'Dezember'];

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  // Date-Objekt -> "YYYY-MM-DD"
  function key(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // "YYYY-MM-DD" -> Date-Objekt, bewusst auf 12:00 Uhr gesetzt.
  // So kann der Sommerzeit-Wechsel beim Rechnen nie einen Tag verschieben.
  function parse(k) {
    var p = k.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0);
  }

  function today() { return key(new Date()); }

  function addDays(k, n) {
    var d = parse(k);
    d.setDate(d.getDate() + n);
    return key(d);
  }

  // Anzahl Tage von a bis b (positiv, wenn b spaeter liegt)
  function diffDays(a, b) {
    return Math.round((parse(b) - parse(a)) / 86400000);
  }

  // Montag der Woche, in der dieses Datum liegt
  function mondayOf(k) {
    var d = parse(k);
    var dow = (d.getDay() + 6) % 7; // Mo=0 ... So=6
    d.setDate(d.getDate() - dow);
    return key(d);
  }

  // Die sieben Tage einer Woche, Montag zuerst
  function weekDays(mondayKey) {
    var out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(mondayKey, i));
    return out;
  }

  // Ist diese Woche komplett vorbei? Nur abgeschlossene Wochen zaehlen in die Statistik.
  function weekIsComplete(mondayKey, todayKey) {
    return diffDays(addDays(mondayKey, 6), todayKey) > 0;
  }

  function monthOf(k) { return k.slice(0, 7); }        // "YYYY-MM"
  function currentMonth() { return monthOf(today()); }

  function daysInMonth(ym) {
    var p = ym.split('-');
    return new Date(+p[0], +p[1], 0).getDate();
  }

  function monthDays(ym) {
    var n = daysInMonth(ym), out = [];
    for (var i = 1; i <= n; i++) out.push(ym + '-' + pad(i));
    return out;
  }

  // Alle Wochen, deren Montag in diesem Monat liegt
  function monthWeeks(ym) {
    return monthDays(ym).filter(function (d) { return mondayOf(d) === d; });
  }

  function addMonths(ym, n) {
    var p = ym.split('-');
    var d = new Date(+p[0], +p[1] - 1 + n, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }

  // Wochentag-Index, Mo=0 ... So=6
  function weekdayIndex(k) {
    return (parse(k).getDay() + 6) % 7;
  }

  function formatDay(k, todayKey) {
    if (k === todayKey) return 'Heute';
    if (k === addDays(todayKey, -1)) return 'Gestern';
    var d = parse(k);
    return WEEKDAYS[weekdayIndex(k)] + ', ' + d.getDate() + '. ' + MONTHS[d.getMonth()];
  }

  // Vollstaendiges Datum, z.B. "Sonntag, 9. August"
  function formatFull(k) {
    var d = parse(k);
    return WEEKDAYS_LONG[weekdayIndex(k)] + ', ' + d.getDate() + '. ' + MONTHS[d.getMonth()];
  }

  function formatMonth(ym) {
    var p = ym.split('-');
    return MONTHS[+p[1] - 1] + ' ' + p[0];
  }

  // Kurzform fuer Listen, z.B. "Aug 26"
  function formatMonthShort(ym) {
    var p = ym.split('-');
    return MONTHS[+p[1] - 1].slice(0, 3) + ' ' + p[0].slice(2);
  }

  // Kurzform fuer den Wochenverlauf, z.B. "3.8."
  function formatWeekShort(mondayKey) {
    var d = parse(mondayKey);
    return d.getDate() + '.' + (d.getMonth() + 1) + '.';
  }

  return {
    WEEKDAYS: WEEKDAYS,
    MONTHS: MONTHS,
    key: key,
    parse: parse,
    today: today,
    addDays: addDays,
    diffDays: diffDays,
    mondayOf: mondayOf,
    weekDays: weekDays,
    weekIsComplete: weekIsComplete,
    monthOf: monthOf,
    currentMonth: currentMonth,
    daysInMonth: daysInMonth,
    monthDays: monthDays,
    monthWeeks: monthWeeks,
    addMonths: addMonths,
    weekdayIndex: weekdayIndex,
    formatDay: formatDay,
    formatFull: formatFull,
    formatMonth: formatMonth,
    formatMonthShort: formatMonthShort,
    formatWeekShort: formatWeekShort
  };
})();
