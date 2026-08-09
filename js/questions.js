/* questions.js — Der Katalog der Leitfragen fuer die Reflexion.
 *
 * Die App speichert bewusst KEINEN Antworttext. Sie merkt sich nur, ob und
 * wann du dich mit einer Frage beschaeftigt hast.
 *
 * Fragen aendern oder ergaenzen: einfach diese Liste bearbeiten. Wichtig ist
 * nur, dass jede id eindeutig bleibt und bestehende ids nicht neu vergeben
 * werden - daran haengt die Historie, welche Frage schon dran war.
 */
window.Questions = (function () {
  'use strict';

  var CATALOG = [
    { id: 'q01', text: 'Was hat mir in der letzten Zeit Energie gegeben, und was hat welche gekostet?' },
    { id: 'q02', text: 'Wo habe ich zuletzt mehr zugesagt, als mir gutgetan hat?' },
    { id: 'q03', text: 'Was schiebe ich gerade vor mir her, und was steckt eigentlich dahinter?' },
    { id: 'q04', text: 'Welcher Teil meines Alltags läuft gerade von selbst, ohne dass ich nachdenken muss?' },
    { id: 'q05', text: 'Wann habe ich mich zuletzt wirklich ausgeruht gefühlt?' },
    { id: 'q06', text: 'Was würde ich in dieser Woche weglassen, wenn ich müsste?' },
    { id: 'q07', text: 'Welche Erwartung an mich selbst stammt eigentlich gar nicht von mir?' },
    { id: 'q08', text: 'Was hat zuletzt besser funktioniert, als ich erwartet hatte?' },
    { id: 'q09', text: 'Wo war ich in letzter Zeit zu streng mit mir?' },
    { id: 'q10', text: 'Welche Kleinigkeit hat meinen Tag zuletzt spürbar besser gemacht?' },
    { id: 'q11', text: 'Was mache ich gerade nur aus Gewohnheit weiter?' },
    { id: 'q12', text: 'Wovon hätte ich gern mehr in meinem Alltag, und was steht dem konkret im Weg?' },
    { id: 'q13', text: 'Wie habe ich zuletzt reagiert, als etwas nicht nach Plan lief?' },
    { id: 'q14', text: 'Welches Gespräch schiebe ich gerade vor mir her?' },
    { id: 'q15', text: 'Was hat mich zuletzt gefreut, ohne dass ich es geplant hatte?' },
    { id: 'q16', text: 'Wo verwechsle ich gerade Beschäftigung mit Fortschritt?' },
    { id: 'q17', text: 'Was brauche ich morgens, damit der Tag gut startet, und bekomme ich das?' },
    { id: 'q18', text: 'Welcher Anspruch ist mir aktuell wichtiger, als er sein müsste?' },
    { id: 'q19', text: 'Wann hatte ich zuletzt Zeit, in der nichts von mir erwartet wurde?' },
    { id: 'q20', text: 'Was würde mein Alltag über meine Prioritäten sagen, wenn ich ihn von außen betrachte?' }
  ];

  function byId(id) {
    return CATALOG.find(function (q) { return q.id === id; }) || null;
  }

  // Waehlt die naechste Frage: erst alle unbenutzten durch, dann von vorn.
  // Der Zufall sorgt dafuer, dass die Reihenfolge nicht vorhersehbar wird.
  function pickNext(usedIds) {
    var unused = CATALOG.filter(function (q) { return usedIds.indexOf(q.id) === -1; });
    var pool = unused.length > 0 ? unused : CATALOG;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function isExhausted(usedIds) {
    return usedIds.length >= CATALOG.length;
  }

  return {
    CATALOG: CATALOG,
    byId: byId,
    pickNext: pickNext,
    isExhausted: isExhausted,
    count: CATALOG.length
  };
})();
