/* backup.js — Sicherung als JSON-Datei.
 *
 * Auf dem iPhone ist der klassische Datei-Download unzuverlaessig, sobald die
 * App im Standalone-Modus vom Home-Bildschirm laeuft. Deshalb versucht der
 * Export drei Wege nacheinander:
 *   1. iOS-Teilen-Dialog ("In Dateien sichern", iCloud, an sich selbst senden)
 *   2. normaler Download
 *   3. JSON zum Kopieren anzeigen
 * Damit kommt man in jedem Fall an seine Daten.
 */
window.Backup = (function () {
  'use strict';

  function filename() {
    return 'standards-' + Dates.today() + '.json';
  }

  async function buildJson() {
    var data = await Store.exportData();
    return JSON.stringify(data, null, 2);
  }

  // Stufe 1 und 2. Gibt zurueck, welcher Weg genommen wurde.
  async function exportData() {
    var json = await buildJson();
    var name = filename();
    var blob = new Blob([json], { type: 'application/json' });

    // Stufe 1: Teilen-Dialog (der zuverlaessigste Weg auf dem iPhone)
    try {
      if (navigator.canShare && typeof File === 'function') {
        var file = new File([blob], name, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: name });
          await Store.updateMeta({ lastExportAt: Dates.today() });
          return { ok: true, via: 'share' };
        }
      }
    } catch (e) {
      // Abbruch durch den Nutzer ist kein Fehler - dann bewusst nichts tun.
      if (e && e.name === 'AbortError') return { ok: false, aborted: true };
    }

    // Stufe 2: normaler Download
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      await Store.updateMeta({ lastExportAt: Dates.today() });
      return { ok: true, via: 'download' };
    } catch (e) {
      return { ok: false, error: 'Export nicht möglich.' };
    }
  }

  // Stufe 3: Rohtext, falls die anderen Wege nichts sichtbar produziert haben.
  async function exportAsText() {
    var json = await buildJson();
    await Store.updateMeta({ lastExportAt: Dates.today() });
    return json;
  }

  // Liest eine Datei ein und gibt den geparsten Inhalt zurueck, ohne
  // schon etwas zu ueberschreiben - die Bestaetigung passiert davor.
  function readFile(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          resolve({ ok: true, data: JSON.parse(reader.result) });
        } catch (e) {
          resolve({ ok: false, error: 'Die Datei ist keine gültige JSON-Sicherung.' });
        }
      };
      reader.onerror = function () {
        resolve({ ok: false, error: 'Die Datei konnte nicht gelesen werden.' });
      };
      reader.readAsText(file);
    });
  }

  // Kurzbeschreibung des Inhalts, damit man vor dem Ersetzen sieht,
  // was in der Sicherung steckt.
  function describe(data) {
    if (!data || typeof data !== 'object') return null;
    var habits = Array.isArray(data.habits) ? data.habits.length : 0;
    var checks = Array.isArray(data.checks) ? data.checks.length : 0;
    var counts = Array.isArray(data.counts) ? data.counts.length : 0;
    return habits + ' Habits, ' + (checks + counts) + ' Einträge';
  }

  // Ist wieder eine Sicherung faellig?
  // Der Zaehler startet ab der ersten Nutzung, nicht bei null - sonst waere
  // der Hinweis schon am ersten Tag da.
  function backupDue(meta, settings, todayKey) {
    if (meta.backupSnoozedUntil && todayKey < meta.backupSnoozedUntil) return false;
    var anchor = meta.lastExportAt || meta.firstUseAt;
    if (!anchor) return false;
    var days = settings.backupReminderDays || 14;
    return Dates.diffDays(anchor, todayKey) >= days;
  }

  function daysSinceBackup(meta, todayKey) {
    var anchor = meta.lastExportAt || meta.firstUseAt;
    if (!anchor) return 0;
    return Dates.diffDays(anchor, todayKey);
  }

  return {
    exportData: exportData,
    exportAsText: exportAsText,
    readFile: readFile,
    describe: describe,
    backupDue: backupDue,
    daysSinceBackup: daysSinceBackup,
    hasNeverExported: function (meta) { return !meta.lastExportAt; }
  };
})();
