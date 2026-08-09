/* settings.js — Die Einstellungen-Ansicht.
 *
 * Hier werden Habits verwaltet, die Darstellung gewaehlt und die Daten
 * gesichert. Wie ueberall gilt: kein direkter Speicherzugriff, alles laeuft
 * ueber Store.
 *
 * Loeschen gibt es bewusst nicht - Habits werden archiviert. Sonst wuerden
 * alte Monatswerte ploetzlich anders aussehen als damals.
 */
window.Settings = (function () {
  'use strict';

  var WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  // null = Liste, sonst wird ein Habit bearbeitet ('new' = neu anlegen)
  var editing = null;
  var newType = 'daily';
  var textDump = null;   // JSON-Rohtext, falls Stufe 3 des Exports genutzt wird

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function typeLabel(t) {
    if (t === 'daily') return 'Abhaken pro Tag';
    if (t === 'dayquota') return 'Zähler pro Tag';
    return 'Zähler pro Woche';
  }

  function weekdaySummary(h) {
    if (!h.activeWeekdays || h.activeWeekdays.length === 7) return 'jeden Tag';
    if (h.activeWeekdays.length === 5 &&
        h.activeWeekdays.every(function (d) { return d < 5; })) return 'Mo–Fr';
    return h.activeWeekdays.map(function (d) { return WEEKDAY_LABELS[d]; }).join(' ');
  }

  /* ---------- Liste ---------- */

  async function renderList(el) {
    var habits = await Store.getHabits();
    var archived = (await Store.getHabits({ includeArchived: true }))
      .filter(function (h) { return h.archivedAt; });
    var settings = await Store.getSettings();
    var meta = await Store.getMeta();
    var today = Dates.today();

    var daily = habits.filter(function (h) { return h.type !== 'quota'; });
    var quota = habits.filter(function (h) { return h.type === 'quota'; });

    var html = '';

    html += '<h2 class="section-title">Täglich</h2><div class="card">' +
            habitRows(daily) + '</div>';
    html += '<h2 class="section-title">Wochenquoten</h2><div class="card">' +
            habitRows(quota) + '</div>';

    html += '<div class="add-row">' +
              '<button class="btn" data-add="daily">+ Täglich</button>' +
              '<button class="btn" data-add="dayquota">+ Tageszähler</button>' +
              '<button class="btn" data-add="quota">+ Wochenquote</button>' +
            '</div>';

    // Reflexion
    html += '<h2 class="section-title">Reflexion</h2><div class="card">' +
              '<div class="setrow">' +
                '<span class="setrow-label">Abstand zwischen Fragen</span>' +
                '<span class="segmented">' +
                  seg('interval', '7', settings.reflectionIntervalDays === 7, '7 Tage') +
                  seg('interval', '14', settings.reflectionIntervalDays === 14, '14 Tage') +
                  seg('interval', '30', settings.reflectionIntervalDays === 30, '30 Tage') +
                '</span>' +
              '</div>' +
            '</div>';

    // Darstellung
    html += '<h2 class="section-title">Darstellung</h2><div class="card">' +
              '<div class="setrow">' +
                '<span class="setrow-label">Erscheinungsbild</span>' +
                '<span class="segmented">' +
                  seg('theme', 'auto', settings.theme === 'auto', 'Automatisch') +
                  seg('theme', 'light', settings.theme === 'light', 'Hell') +
                  seg('theme', 'dark', settings.theme === 'dark', 'Dunkel') +
                '</span>' +
              '</div>' +
            '</div>';

    // Daten
    var since = Backup.daysSinceBackup(meta, today);
    var backupNote = Backup.hasNeverExported(meta)
      ? 'Noch keine Sicherung erstellt. Seit ' + since + ' Tagen in Benutzung.'
      : 'Letzte Sicherung vor ' + since + ' Tagen.';

    html += '<h2 class="section-title">Daten</h2><div class="card">' +
              '<button class="setbtn" data-act="export">Sicherung erstellen' +
                '<span class="setbtn-sub">' + esc(backupNote) + '</span></button>' +
              '<button class="setbtn" data-act="export-text">Sicherung als Text anzeigen' +
                '<span class="setbtn-sub">Falls der Teilen-Dialog nichts speichert</span></button>' +
              '<button class="setbtn" data-act="import">Sicherung einspielen' +
                '<span class="setbtn-sub">Ersetzt alle aktuellen Daten</span></button>' +
              '<button class="setbtn" data-act="reset">Alles zurücksetzen' +
                '<span class="setbtn-sub">Startliste wiederherstellen, alle Einträge entfernen</span></button>' +
            '</div>' +
            '<input type="file" id="importFile" accept="application/json,.json" hidden>';

    if (textDump) {
      html += '<h2 class="section-title">Sicherung als Text</h2>' +
              '<div class="card"><div class="over-note">' +
                '<p class="over-line">Alles markieren und kopieren, dann in eine Notiz einfügen.</p>' +
                '<textarea class="dump" readonly>' + esc(textDump) + '</textarea>' +
                '<button class="btn" data-act="close-text">Schließen</button>' +
              '</div></div>';
    }

    if (archived.length) {
      html += '<h2 class="section-title">Archiviert</h2><div class="card">' +
                archived.map(function (h) {
                  return '<div class="setrow">' +
                           '<span class="setrow-label">' + esc(h.name) + '</span>' +
                           '<button class="minibtn" data-unarchive="' + h.id + '">Zurückholen</button>' +
                         '</div>';
                }).join('') +
              '</div>' +
              '<p class="footnote">Archivierte Habits bleiben in alten Monaten sichtbar, ' +
              'zählen aber ab Archivierung nicht mehr mit.</p>';
    }

    html += '<p class="footnote">Version ' + Store.SCHEMA_VERSION + ' · Daten liegen nur auf diesem Gerät.</p>';

    el.innerHTML = html;
  }

  function habitRows(list) {
    if (!list.length) return '<p class="placeholder">Noch nichts angelegt.</p>';
    return list.map(function (h) {
      var sub = typeLabel(h.type);
      if (h.type === 'quota') sub += ' · Minimum ' + h.min + (h.max ? ', Maximum ' + h.max : '');
      if (h.type === 'dayquota') sub += ' · Minimum ' + h.min;
      if (h.type !== 'quota') sub += ' · ' + weekdaySummary(h);
      return '<button class="row" data-edit="' + h.id + '">' +
               '<span class="row-text">' +
                 '<span class="row-name">' + esc(h.name) + '</span>' +
                 '<span class="row-meta">' + esc(sub) + '</span>' +
               '</span>' +
               '<span class="row-chevron">' +
                 '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
               '</span>' +
             '</button>';
    }).join('');
  }

  function seg(group, value, active, label) {
    return '<button class="seg' + (active ? ' is-active' : '') + '" ' +
           'data-seg="' + group + '" data-value="' + value + '">' + label + '</button>';
  }

  /* ---------- Editor ---------- */

  async function renderEditor(el) {
    var isNew = (editing === 'new');
    var h;
    if (isNew) {
      h = { name: '', type: newType, min: newType === 'quota' ? 2 : 3, max: null, activeWeekdays: null };
    } else {
      var all = await Store.getHabits({ includeArchived: true });
      h = all.find(function (x) { return x.id === editing; });
      if (!h) { editing = null; return render(el); }
    }

    var days = h.activeWeekdays || [0, 1, 2, 3, 4, 5, 6];

    var html = '<div class="editor">';
    html += '<label class="field"><span class="field-label">Name</span>' +
            '<input class="input" id="hName" type="text" value="' + esc(h.name) + '" ' +
            'placeholder="z.B. Sport" autocapitalize="sentences"></label>';

    html += '<p class="field-note">' + typeLabel(h.type) + '</p>';

    if (h.type !== 'daily') {
      html += '<label class="field"><span class="field-label">Minimum' +
              (h.type === 'quota' ? ' pro Woche' : ' pro Tag') + '</span>' +
              '<input class="input" id="hMin" type="number" inputmode="numeric" min="1" max="99" ' +
              'value="' + (h.min || 1) + '"></label>';
    }
    if (h.type === 'quota') {
      html += '<label class="field"><span class="field-label">Maximum pro Woche (optional)</span>' +
              '<input class="input" id="hMax" type="number" inputmode="numeric" min="1" max="99" ' +
              'value="' + (h.max || '') + '" placeholder="kein Maximum"></label>' +
              '<p class="field-note">Über dem Minimum ist Bonus. Das Maximum begrenzt nur, ' +
              'wie weit der Balken geht — es fließt nicht in die Prozentzahl ein.</p>';
    }

    if (h.type !== 'quota') {
      html += '<div class="field"><span class="field-label">An welchen Tagen?</span>' +
              '<div class="daypicker">' +
                WEEKDAY_LABELS.map(function (lbl, i) {
                  return '<button class="daybtn' + (days.indexOf(i) !== -1 ? ' is-on' : '') + '" ' +
                         'data-day="' + i + '">' + lbl + '</button>';
                }).join('') +
              '</div>' +
              '<p class="field-note">Nicht gewählte Tage zählen gar nicht erst als mögliche Tage.</p>' +
            '</div>';
    }

    html += '<div class="editor-actions">' +
              '<button class="btn btn-primary" data-act="save">Speichern</button>' +
              '<button class="btn" data-act="cancel">Abbrechen</button>';
    if (!isNew && !h.archivedAt) {
      html += '<button class="btn btn-quiet" data-act="archive">Archivieren</button>';
    }
    html += '</div></div>';

    el.innerHTML = html;
  }

  /* ---------- Aktionen ---------- */

  async function saveEditor(el) {
    var name = (el.querySelector('#hName').value || '').trim();
    if (!name) { alert('Bitte einen Namen eingeben.'); return; }

    var minEl = el.querySelector('#hMin');
    var maxEl = el.querySelector('#hMax');
    var min = minEl ? Math.max(1, parseInt(minEl.value, 10) || 1) : null;
    var max = (maxEl && maxEl.value) ? Math.max(1, parseInt(maxEl.value, 10) || 1) : null;
    if (min && max && max < min) { alert('Das Maximum darf nicht kleiner als das Minimum sein.'); return; }

    var dayBtns = el.querySelectorAll('.daybtn');
    var days = null;
    if (dayBtns.length) {
      days = [];
      dayBtns.forEach(function (b) {
        if (b.classList.contains('is-on')) days.push(parseInt(b.dataset.day, 10));
      });
      if (!days.length) { alert('Bitte mindestens einen Tag auswählen.'); return; }
      if (days.length === 7) days = null;   // jeden Tag = keine Einschraenkung
    }

    if (editing === 'new') {
      await Store.addHabit({ type: newType, name: name, min: min, max: max, activeWeekdays: days });
    } else {
      await Store.updateHabit(editing, { name: name, min: min, max: max, activeWeekdays: days });
    }
    editing = null;
  }

  async function doExport(el) {
    var res = await Backup.exportData();
    if (res.aborted) return;
    if (!res.ok) { alert(res.error || 'Export nicht möglich.'); return; }
    if (res.via === 'download') {
      alert('Sicherung heruntergeladen. Falls nichts passiert ist, nutze "Sicherung als Text anzeigen".');
    }
  }

  async function doImport(file, el) {
    var read = await Backup.readFile(file);
    if (!read.ok) { alert(read.error); return; }

    var desc = Backup.describe(read.data);
    var ok = confirm('Sicherung einspielen?\n\nInhalt: ' + desc +
                     '\n\nAlle aktuellen Daten auf diesem Gerät werden dabei ersetzt. ' +
                     'Das lässt sich nicht rückgängig machen.');
    if (!ok) return;

    var res = await Store.importData(read.data);
    if (!res.ok) { alert(res.error); return; }
    alert('Sicherung eingespielt.');
  }

  async function doReset() {
    var ok = confirm('Wirklich alles zurücksetzen?\n\nAlle Einträge und Habits werden entfernt ' +
                     'und die Startliste wiederhergestellt. Das lässt sich nicht rückgängig machen.');
    if (!ok) return false;
    var again = confirm('Sicher? Ohne vorherige Sicherung sind die Daten dann weg.');
    if (!again) return false;
    await Store.resetAll();
    return true;
  }

  /* ---------- Einstiegspunkt ---------- */

  async function render(el) {
    if (editing) await renderEditor(el);
    else await renderList(el);
    bind(el);
  }

  var bound = null;

  function bind(el) {
    if (bound === el) return;   // Delegation nur einmal anhaengen
    bound = el;

    el.addEventListener('click', async function (e) {
      var t = e.target;

      var edit = t.closest('[data-edit]');
      if (edit) { editing = edit.dataset.edit; return App.refresh(); }

      var add = t.closest('[data-add]');
      if (add) { newType = add.dataset.add; editing = 'new'; return App.refresh(); }

      var day = t.closest('[data-day]');
      if (day) { day.classList.toggle('is-on'); return; }

      var un = t.closest('[data-unarchive]');
      if (un) { await Store.unarchiveHabit(un.dataset.unarchive); return App.refresh(); }

      var segBtn = t.closest('[data-seg]');
      if (segBtn) {
        if (segBtn.dataset.seg === 'theme') {
          await Store.updateSettings({ theme: segBtn.dataset.value });
          await App.applyTheme();
        } else {
          await Store.updateSettings({ reflectionIntervalDays: parseInt(segBtn.dataset.value, 10) });
        }
        return App.refresh();
      }

      var act = t.closest('[data-act]');
      if (!act) return;

      switch (act.dataset.act) {
        case 'save':      await saveEditor(el); return App.refresh();
        case 'cancel':    editing = null; return App.refresh();
        case 'archive':
          if (confirm('Habit archivieren? Alte Monate bleiben unverändert, ' +
                      'ab jetzt zählt es nicht mehr mit.')) {
            await Store.archiveHabit(editing);
            editing = null;
            return App.refresh();
          }
          return;
        case 'export':    return doExport(el);
        case 'export-text':
          textDump = await Backup.exportAsText();
          return App.refresh();
        case 'close-text': textDump = null; return App.refresh();
        case 'import':    el.querySelector('#importFile').click(); return;
        case 'reset':
          if (await doReset()) return App.refresh();
          return;
      }
    });

    el.addEventListener('change', async function (e) {
      if (e.target.id !== 'importFile') return;
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) { await doImport(file, el); App.refresh(); }
    });
  }

  return { render: render };
})();
