/* storage.js — Die Datenschicht.
 *
 * WICHTIG: Dies ist die EINZIGE Datei der App, die localStorage kennt.
 * Kein anderer Code darf direkt auf localStorage zugreifen. Wenn hier spaeter
 * Cloud-Sync oder IndexedDB dazukommt, wird nur diese Datei ausgetauscht.
 *
 * Deshalb sind auch alle Funktionen async (geben ein Promise zurueck), obwohl
 * localStorage synchron arbeitet. Das kostet heute nichts und sorgt dafuer,
 * dass ein spaeterer Umbau auf Cloud oder IndexedDB keine einzige aufrufende
 * Zeile aendern muss.
 *
 * Datenform: Einzelne Datensaetze mit id und updatedAt statt eines grossen
 * verschachtelten Blocks. Das ist die Form, die sich spaeter sauber
 * synchronisieren laesst.
 */
window.Store = (function () {
  'use strict';

  var DB_KEY = 'standards.v1';
  var SCHEMA_VERSION = 2;

  var cache = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function nowIso() { return new Date().toISOString(); }

  /* ---------- Startdaten ---------- */

  // Drei Habit-Typen:
  //   daily    - Ja/Nein pro Tag
  //   dayquota - Zaehler pro Tag mit Minimum, z.B. 3 Mahlzeiten
  //   quota    - Zaehler pro Woche mit Minimum und optionalem Maximum
  //
  // activeWeekdays: null = jeden Tag, sonst Array von Wochentag-Indizes
  // (Mo=0 ... So=6). Damit zaehlen z.B. bei "Mittagspause" nur Werktage
  // als moegliche Tage, nicht 7.
  var WORKDAYS = [0, 1, 2, 3, 4];

  function seedHabits(createdAt) {
    var seed = [
      { type: 'daily',    name: 'Glas Wasser nach dem Aufstehen' },
      { type: 'daily',    name: '5 Min Stretching oder Yoga' },
      { type: 'dayquota', name: 'Mahlzeiten', min: 3, max: null },
      { type: 'daily',    name: 'Mittagspause gemacht', activeWeekdays: WORKDAYS },
      { type: 'daily',    name: 'Draußen spazieren gewesen' },
      { type: 'quota',    name: 'Sport', min: 2, max: 6 },
      { type: 'quota',    name: 'Haushalt und Putzen', min: 1, max: null },
      { type: 'quota',    name: 'Lesen, 5 Min', min: 3, max: 7 }
    ];
    return seed.map(function (s, i) {
      return {
        id: uid(), type: s.type, name: s.name,
        min: s.min || null, max: s.max || null,
        activeWeekdays: s.activeWeekdays || null,
        order: i,
        createdAt: createdAt, archivedAt: null, updatedAt: nowIso()
      };
    });
  }

  function defaults() {
    var t = Dates.today();
    return {
      schemaVersion: SCHEMA_VERSION,
      meta: {
        firstUseAt: t,
        lastExportAt: null,        // Datum des letzten Exports, null = noch nie
        backupSnoozedUntil: null
      },
      settings: {
        reflectionIntervalDays: 7,
        backupReminderDays: 14,
        theme: 'auto'              // 'auto' | 'light' | 'dark'
      },
      habits: seedHabits(t),
      checks: [],        // { id, habitId, date, done, updatedAt }  -> taegliche Habits
      counts: [],        // { id, habitId, date, updatedAt }        -> ein Eintrag je Einheit
      reflections: [],   // { id, questionId, date, engaged, updatedAt }
      reflectionMeta: { snoozeUntil: null, usedQuestionIds: [] }
    };
  }

  /* ---------- Laden und Speichern ---------- */

  /* ---------- Migrationen ---------- */

  // Wandelt aeltere Datenstaende auf die aktuelle Schema-Version um.
  //
  // Wichtig: Die Startliste der Habits wird nur beim allerersten Oeffnen
  // angelegt. Aenderungen daran erreichen bestehende Installationen NICHT.
  // Wer schon Daten hat, braucht deshalb hier eine ausdrueckliche Migration.
  // Gibt true zurueck, wenn etwas geaendert wurde.
  function migrate(db) {
    var from = db.schemaVersion || 1;

    // 1 -> 2: "Mittagspause gemacht" wurde ohne Wochentags-Einschraenkung
    // angelegt und zaehlte dadurch 7 statt 5 moegliche Tage pro Woche.
    if (from < 2) {
      db.habits.forEach(function (h) {
        if (h.name === 'Mittagspause gemacht' && !h.activeWeekdays) {
          h.activeWeekdays = WORKDAYS.slice();
          h.updatedAt = nowIso();
        }
      });
    }

    if (from < SCHEMA_VERSION) {
      db.schemaVersion = SCHEMA_VERSION;
      return true;
    }
    return false;
  }

  // Fehlende Felder ergaenzen, damit aeltere oder unvollstaendige Datenstaende
  // nicht zu Abstuerzen fuehren.
  function normalize(db) {
    var d = defaults();
    if (!db || typeof db !== 'object') return d;
    db.schemaVersion = db.schemaVersion || 1;
    db.meta = Object.assign({}, d.meta, db.meta || {});
    db.settings = Object.assign({}, d.settings, db.settings || {});
    db.habits = Array.isArray(db.habits) ? db.habits : d.habits;
    db.checks = Array.isArray(db.checks) ? db.checks : [];
    db.counts = Array.isArray(db.counts) ? db.counts : [];
    db.reflections = Array.isArray(db.reflections) ? db.reflections : [];
    db.reflectionMeta = Object.assign({}, d.reflectionMeta, db.reflectionMeta || {});
    migrate(db);
    return db;
  }

  function readRaw() {
    try { return localStorage.getItem(DB_KEY); }
    catch (e) { return null; }
  }

  function writeRaw(str) {
    try {
      localStorage.setItem(DB_KEY, str);
      return true;
    } catch (e) {
      console.error('Speichern fehlgeschlagen', e);
      return false;
    }
  }

  function load() {
    if (cache) return cache;
    var raw = readRaw();
    if (!raw) {
      cache = defaults();
      persist();
      return cache;
    }
    try {
      var parsed = JSON.parse(raw);
      var wasVersion = parsed && parsed.schemaVersion;
      cache = normalize(parsed);
      // Migration sofort festschreiben, damit sie nicht bei jedem Start
      // erneut laeuft.
      if (cache.schemaVersion !== wasVersion) persist();
    } catch (e) {
      console.error('Daten unlesbar, starte mit Standardwerten', e);
      cache = defaults();
    }
    return cache;
  }

  function persist() {
    return writeRaw(JSON.stringify(cache));
  }

  /* ---------- Oeffentliche API (alles async) ---------- */

  async function init() {
    load();
    return true;
  }

  // Gesamter Datenstand, NUR ZUM LESEN (Statistik-Berechnungen).
  async function getState() {
    return load();
  }

  async function getSettings() {
    return Object.assign({}, load().settings);
  }

  async function updateSettings(patch) {
    var db = load();
    db.settings = Object.assign({}, db.settings, patch);
    persist();
    return Object.assign({}, db.settings);
  }

  async function getMeta() {
    return Object.assign({}, load().meta);
  }

  async function updateMeta(patch) {
    var db = load();
    db.meta = Object.assign({}, db.meta, patch);
    persist();
    return Object.assign({}, db.meta);
  }

  /* ---------- Habits ---------- */

  async function getHabits(opts) {
    opts = opts || {};
    var db = load();
    return db.habits
      .filter(function (h) {
        if (!opts.includeArchived && h.archivedAt) return false;
        if (opts.type && h.type !== opts.type) return false;
        return true;
      })
      .sort(function (a, b) { return a.order - b.order; })
      .map(function (h) { return Object.assign({}, h); });
  }

  async function addHabit(data) {
    var db = load();
    var maxOrder = db.habits.reduce(function (m, h) { return Math.max(m, h.order); }, -1);
    var habit = {
      id: uid(),
      type: data.type,
      name: data.name,
      min: data.type === 'daily' ? null : (data.min || 1),
      max: data.type === 'daily' ? null : (data.max || null),
      activeWeekdays: data.activeWeekdays || null,
      order: maxOrder + 1,
      createdAt: Dates.today(),
      archivedAt: null,
      updatedAt: nowIso()
    };
    db.habits.push(habit);
    persist();
    return Object.assign({}, habit);
  }

  async function updateHabit(id, patch) {
    var db = load();
    var h = db.habits.find(function (x) { return x.id === id; });
    if (!h) return null;
    Object.assign(h, patch, { updatedAt: nowIso() });
    persist();
    return Object.assign({}, h);
  }

  // Bewusst kein echtes Loeschen: die Historie bleibt erhalten, damit alte
  // Monatswerte korrekt bleiben.
  async function archiveHabit(id) {
    return updateHabit(id, { archivedAt: Dates.today() });
  }

  async function unarchiveHabit(id) {
    return updateHabit(id, { archivedAt: null });
  }

  async function moveHabit(id, direction) {
    var db = load();
    var h = db.habits.find(function (x) { return x.id === id; });
    if (!h) return false;
    var siblings = db.habits
      .filter(function (x) { return x.type === h.type && !x.archivedAt; })
      .sort(function (a, b) { return a.order - b.order; });
    var i = siblings.findIndex(function (x) { return x.id === id; });
    var j = i + direction;
    if (j < 0 || j >= siblings.length) return false;
    var tmp = siblings[i].order;
    siblings[i].order = siblings[j].order;
    siblings[j].order = tmp;
    siblings[i].updatedAt = nowIso();
    siblings[j].updatedAt = nowIso();
    persist();
    return true;
  }

  /* ---------- Tageseintraege ---------- */

  // Alles, was fuer einen Tag angezeigt werden muss, in einem Rutsch.
  async function getDay(date) {
    var db = load();
    var checks = {}, counts = {};
    db.checks.forEach(function (c) {
      if (c.date === date && c.done) checks[c.habitId] = true;
    });
    db.counts.forEach(function (c) {
      if (c.date === date) counts[c.habitId] = (counts[c.habitId] || 0) + 1;
    });
    return { date: date, checks: checks, counts: counts };
  }

  async function setCheck(habitId, date, done) {
    var db = load();
    var rec = db.checks.find(function (c) { return c.habitId === habitId && c.date === date; });
    if (rec) {
      rec.done = !!done;
      rec.updatedAt = nowIso();
    } else {
      db.checks.push({ id: uid(), habitId: habitId, date: date, done: !!done, updatedAt: nowIso() });
    }
    persist();
    return !!done;
  }

  async function addCount(habitId, date) {
    var db = load();
    db.counts.push({ id: uid(), habitId: habitId, date: date, updatedAt: nowIso() });
    persist();
    return true;
  }

  // Entfernt eine Einheit dieses Tages (die zuletzt hinzugefuegte).
  async function removeCount(habitId, date) {
    var db = load();
    for (var i = db.counts.length - 1; i >= 0; i--) {
      if (db.counts[i].habitId === habitId && db.counts[i].date === date) {
        db.counts.splice(i, 1);
        persist();
        return true;
      }
    }
    return false;
  }

  // Zaehlerstand eines Habits in einer Woche
  async function countInWeek(habitId, mondayKey) {
    var db = load();
    var end = Dates.addDays(mondayKey, 6);
    return db.counts.filter(function (c) {
      return c.habitId === habitId && c.date >= mondayKey && c.date <= end;
    }).length;
  }

  /* ---------- Reflexion ---------- */

  async function getReflectionMeta() {
    var db = load();
    return {
      snoozeUntil: db.reflectionMeta.snoozeUntil,
      usedQuestionIds: db.reflectionMeta.usedQuestionIds.slice(),
      lastDecisionDate: db.reflections.length
        ? db.reflections[db.reflections.length - 1].date
        : null
    };
  }

  async function recordReflection(questionId, date, engaged) {
    var db = load();
    db.reflections.push({
      id: uid(), questionId: questionId, date: date,
      engaged: !!engaged, updatedAt: nowIso()
    });
    if (db.reflectionMeta.usedQuestionIds.indexOf(questionId) === -1) {
      db.reflectionMeta.usedQuestionIds.push(questionId);
    }
    persist();
    return true;
  }

  async function setReflectionSnooze(untilDate) {
    var db = load();
    db.reflectionMeta.snoozeUntil = untilDate;
    persist();
    return true;
  }

  async function resetUsedQuestions() {
    var db = load();
    db.reflectionMeta.usedQuestionIds = [];
    persist();
    return true;
  }

  /* ---------- Export und Import ---------- */

  async function exportData() {
    var db = load();
    return JSON.parse(JSON.stringify(db));
  }

  // Ersetzt den kompletten Datenstand. Bewusst kein Zusammenfuehren:
  // Mischen wuerde stille Duplikate erzeugen, die niemand bemerkt.
  async function importData(obj) {
    if (!obj || typeof obj !== 'object') {
      return { ok: false, error: 'Die Datei enthält keine gültigen Daten.' };
    }
    if (typeof obj.schemaVersion !== 'number') {
      return { ok: false, error: 'Das ist keine Sicherung dieser App (Versionsangabe fehlt).' };
    }
    if (obj.schemaVersion > SCHEMA_VERSION) {
      return { ok: false, error: 'Die Sicherung stammt aus einer neueren Version der App.' };
    }
    if (!Array.isArray(obj.habits)) {
      return { ok: false, error: 'Die Sicherung enthält keine Habits.' };
    }
    cache = normalize(obj);
    if (!persist()) {
      return { ok: false, error: 'Speichern fehlgeschlagen. Möglicherweise ist der Speicher voll.' };
    }
    return { ok: true };
  }

  async function resetAll() {
    cache = defaults();
    persist();
    return true;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    init: init,
    getState: getState,
    getSettings: getSettings,
    updateSettings: updateSettings,
    getMeta: getMeta,
    updateMeta: updateMeta,
    getHabits: getHabits,
    addHabit: addHabit,
    updateHabit: updateHabit,
    archiveHabit: archiveHabit,
    unarchiveHabit: unarchiveHabit,
    moveHabit: moveHabit,
    getDay: getDay,
    setCheck: setCheck,
    addCount: addCount,
    removeCount: removeCount,
    countInWeek: countInWeek,
    getReflectionMeta: getReflectionMeta,
    recordReflection: recordReflection,
    setReflectionSnooze: setReflectionSnooze,
    resetUsedQuestions: resetUsedQuestions,
    exportData: exportData,
    importData: importData,
    resetAll: resetAll
  };
})();
