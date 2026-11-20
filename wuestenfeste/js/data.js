'use strict';
// Spieldaten: Gelände, Gebäude, Einheiten, Steuern, Rationen, Infotexte

const TW = 64, TH = 32;
const MAP_N = 64;
const SAVE_VERSION = 2;

const T = { SAND: 0, GRASS: 1, ROCK: 2, IRON: 3, WATER: 4 };

const RES = ['holz', 'stein', 'eisen', 'weizen', 'mehl', 'nahrung', 'brot', 'gold'];
const RES_NAME = { holz: 'Holz', stein: 'Stein', eisen: 'Eisen', weizen: 'Weizen', mehl: 'Mehl', nahrung: 'Äpfel', brot: 'Brot', gold: 'Gold' };
const FOODS = ['nahrung', 'brot'];

const PLAYER_COLORS = ['#2f63c9', '#c23a2b'];
const PLAYER_NAMES = ['Du', 'Der Wüstenfürst'];

// terrain: erlaubte Geländearten; walk: Einheiten können darüber laufen; info: Liste für das „i“-Fenster
const BUILDINGS = {
  keep: { name: 'Burgfried', w: 3, h: 3, cost: {}, hp: 2500, housing: 8, hidden: true, upgrade: true,
    desc: 'Dein Herrschersitz. Fällt er, ist das Spiel verloren.',
    info: ['Wohnraum für 8 Bauern, mit jeder Stufe 4 mehr.', 'Hier stellst du Steuern und Rationen ein (Taste B oder Knopf „Burg“).', 'Fällt der Burgfried, ist das Spiel verloren – schütze ihn mit Mauern und Türmen.'] },
  stockpile: { name: 'Lager', w: 2, h: 2, cost: { holz: 5 }, hp: 300, cat: 'wirtschaft',
    desc: 'Holz, Stein, Eisen, Weizen und Mehl werden hierher gebracht.',
    info: ['Arbeiter bringen ihre Waren zum nächsten Lager.', 'Ein zweites Lager nahe weit entfernter Steinbrüche oder Holzfäller spart lange Wege.'] },
  granary: { name: 'Kornspeicher', w: 2, h: 2, cost: { holz: 10 }, hp: 300, cat: 'wirtschaft',
    desc: 'Lagert Äpfel und Brot.',
    info: ['Ohne Kornspeicher wird keine Nahrung eingelagert.', 'Aus dem Speicher essen deine Bauern ihre Rationen.'] },
  woodcutter: { name: 'Holzfäller', w: 2, h: 2, cost: { holz: 3 }, hp: 200, worker: true, cat: 'wirtschaft', upgrade: true,
    desc: 'Fällt Palmen und Bäume in der Nähe. 1 Arbeiter.',
    info: ['Liefert 4 Holz pro Gang zum Lager.', 'Reichweite 18 Felder – nah an dichte Palmenhaine bauen.', 'Bäume wachsen nicht nach.', 'Aufwerten: schnelleres Fällen.'] },
  quarry: { name: 'Steinbruch', w: 3, h: 3, cost: { holz: 20 }, hp: 300, worker: true, terrain: [T.ROCK], cat: 'wirtschaft', upgrade: true,
    desc: 'Nur auf grauem Fels. 1 Arbeiter.',
    info: ['Alle 9 Felder müssen grauer Fels sein.', 'Liefert 4 Stein pro Gang zum Lager.', 'Stein brauchst du für Mauern, Türme und Tore.', 'Aufwerten: schnellere Arbeit.'] },
  mine: { name: 'Eisenmine', w: 2, h: 2, cost: { holz: 20 }, hp: 300, worker: true, terrain: [T.IRON], cat: 'wirtschaft', upgrade: true,
    desc: 'Nur auf rostrotem Erzboden. 1 Arbeiter.',
    info: ['Liefert 2 Eisen pro Gang.', 'Eisen brauchen Schwertkämpfer, Pikeniere, Armbrustschützen und Reiter.', 'Aufwerten: schnellere Förderung.'] },
  orchard: { name: 'Apfelhain', w: 3, h: 3, cost: { holz: 5 }, hp: 200, worker: true, terrain: [T.GRASS], cat: 'nahrung', upgrade: true,
    desc: 'Nur auf grünem Oasenboden. Liefert Äpfel.',
    info: ['Alle 9 Felder müssen grüner Oasenboden sein.', 'Liefert 5 Äpfel pro Gang zum Kornspeicher.', 'Einfachste Nahrungsquelle für den Anfang.'] },
  farm: { name: 'Weizenfeld', w: 3, h: 3, cost: { holz: 15 }, hp: 200, worker: true, cat: 'nahrung', upgrade: true,
    desc: 'Baut Weizen an – überall außer auf Fels.',
    info: ['Liefert 4 Weizen pro Gang ins Lager.', 'Weizen allein macht nicht satt: Die Mühle mahlt ihn zu Mehl, der Bäcker backt daraus Brot.', 'Zwei Nahrungsarten (Äpfel und Brot) geben +1 Beliebtheit.'] },
  mill: { name: 'Mühle', w: 2, h: 2, cost: { holz: 20 }, hp: 300, worker: true, cat: 'nahrung', upgrade: true,
    desc: 'Mahlt Weizen zu Mehl.',
    info: ['Holt 4 Weizen aus dem Lager und bringt 4 Mehl zurück.', 'Eine Mühle reicht für etwa zwei Weizenfelder.'] },
  bakery: { name: 'Bäckerei', w: 2, h: 2, cost: { holz: 10, stein: 5 }, hp: 300, worker: true, cat: 'nahrung', upgrade: true,
    desc: 'Backt aus Mehl Brot.',
    info: ['Holt 2 Mehl aus dem Lager und bringt 6 Brot in den Kornspeicher.', 'Brot ist die ergiebigste Nahrung.'] },
  house: { name: 'Hütte', w: 2, h: 2, cost: { holz: 6 }, hp: 200, housing: 8, cat: 'stadt', upgrade: true,
    desc: 'Wohnraum für 8 Bauern.',
    info: ['Mehr Wohnraum = mehr Bauern, wenn die Beliebtheit über 50 liegt.', 'Aufwerten: +4 Wohnraum pro Stufe.'] },
  chapel: { name: 'Kapelle', w: 2, h: 2, cost: { stein: 10, gold: 250 }, hp: 500, cat: 'stadt', upgrade: true,
    desc: '+2 Beliebtheit (höchstens zwei zählen).',
    info: ['+2 Beliebtheit pro Runde, mit jeder Stufe +1 mehr.', 'Höchstens zwei Kapellen zählen.', 'Gut, um höhere Steuern auszugleichen.'] },
  market: { name: 'Markt', w: 3, h: 3, cost: { holz: 30 }, hp: 400, cat: 'stadt',
    desc: 'Waren kaufen und verkaufen.',
    info: ['Antippen öffnet den Handel.', 'Verkaufen bringt die Hälfte des Kaufpreises.', 'Nützlich, wenn dir Stein oder Eisen fehlt.'] },
  barracks: { name: 'Kaserne', w: 3, h: 3, cost: { stein: 15 }, hp: 700, cat: 'militaer',
    desc: 'Bildet freie Bauern zu Soldaten aus.',
    info: ['Jeder Soldat braucht einen freien Bauern am Lagerfeuer.', 'Soldaten essen nicht und zählen nicht zum Wohnraum.', 'Auch Rammbock und Katapult werden hier gebaut.'] },
  wall: { name: 'Mauer', w: 1, h: 1, cost: { stein: 1 }, hp: 450, defense: true, cat: 'burg', anyTerrain: true,
    desc: 'Ziehen zum Bauen einer Linie. 1 Stein pro Feld.',
    info: ['Hält Feinde auf, bis sie sich durchgeschlagen haben.', 'Diagonale Mauern sind ebenfalls dicht.', 'Vergiss die Tore, sonst kommen deine Arbeiter nicht mehr hinaus.', 'Schwertkämpfer und Rammböcke reißen Mauern am schnellsten ein.'] },
  palisade: { name: 'Palisade', w: 1, h: 1, cost: { holz: 2 }, hp: 220, defense: true, cat: 'burg', anyTerrain: true,
    desc: 'Billige Holzwand. 2 Holz pro Feld.',
    info: ['Schnelle Notlösung, bevor du Stein hast.', 'Hält nur halb so viel aus wie eine Steinmauer.'] },
  gate: { name: 'Tor', w: 1, h: 1, cost: { stein: 10 }, hp: 900, defense: true, cat: 'burg', anyTerrain: true,
    desc: 'Lässt nur deine eigenen Leute durch.',
    info: ['Setze Tore in deine Mauer, damit Arbeiter zu Steinbruch und Bäumen kommen.', 'Feinde müssen das Tor erst zerstören.'] },
  tower: { name: 'Wachturm', w: 2, h: 2, cost: { stein: 10 }, hp: 1100, defense: true, garrison: 4, rangeBonus: 3, range: 10, cat: 'burg', upgrade: true,
    desc: 'Bis zu 4 Soldaten. Schützen schießen 3 Felder weiter.',
    info: ['Wähle Bogen- oder Armbrustschützen und tippe auf den Turm, um ihn zu besetzen.', 'Truppen auf Türmen erleiden weniger Fernkampfschaden.', 'Nahkämpfer können Turmbesatzungen nicht erreichen.', 'Aufwerten: mehr Leben und +1 Reichweite pro Stufe.'] },
  bigtower: { name: 'Großer Turm', w: 3, h: 3, cost: { stein: 35 }, hp: 2600, defense: true, garrison: 8, rangeBonus: 4, range: 11, cat: 'burg', upgrade: true,
    desc: 'Bis zu 8 Soldaten, sehr viel Leben, +4 Reichweite.',
    info: ['Das Rückgrat jeder Verteidigung.', 'Fasst 8 Schützen, die 4 Felder weiter schießen.', 'Aufwerten: mehr Leben und +1 Reichweite pro Stufe.'] },
  ballista: { name: 'Ballistenturm', w: 2, h: 2, cost: { holz: 20, stein: 15, eisen: 5 }, hp: 1300, defense: true, worker: true, range: 11, cat: 'burg', upgrade: true,
    desc: 'Schießt selbstständig schwere Bolzen. 1 Arbeiter.',
    info: ['Braucht einen Bauern als Bedienung.', 'Schießt alle 4 Sekunden einen Bolzen (40 Schaden), durchschlägt Rüstung.', 'Dreifacher Schaden gegen Rammböcke und Katapulte.', 'Reichweite 11 Felder.'] },
  moat: { name: 'Burggraben', w: 1, h: 1, cost: { gold: 5 }, hp: 160, defense: true, cat: 'fallen', anyTerrain: true, flat: true,
    desc: 'Wassergraben. Niemand kommt durch, bis er zugeschüttet ist.',
    info: ['Blockiert Feinde UND deine eigenen Leute – plane Durchgänge.', 'Feinde müssen ihn erst zuschütten (wie eine schwache Mauer).', 'Kostet nur Gold.'] },
  pitch: { name: 'Pechgraben', w: 1, h: 1, cost: { gold: 15, holz: 2 }, hp: 100, cat: 'fallen', anyTerrain: true, flat: true, walk: true,
    desc: 'Entzündet sich, wenn Feinde darüber laufen.',
    info: ['Zündet, sobald ein Feind darauf steht und einer deiner Soldaten in 10 Feldern Nähe ist.', 'Brennt 4 Sekunden und verletzt alle darauf schwer.', 'Wird dabei verbraucht – danach neu bauen.', 'Mehrere Felder nebeneinander brennen zusammen.'] },
  trap: { name: 'Fallgrube', w: 1, h: 1, cost: { holz: 5, gold: 10 }, hp: 50, cat: 'fallen', anyTerrain: true, flat: true, walk: true, hiddenEnemy: true,
    desc: 'Versteckte Grube: 90 Schaden für den ersten Feind.',
    info: ['Für den Gegner unsichtbar.', 'Der erste Feind, der darauf tritt, erleidet 90 Schaden.', 'Wird dabei verbraucht.'] },
};

const BUILD_CATS = [
  { id: 'burg', name: 'Burg', items: ['ring', 'wall', 'palisade', 'gate', 'tower', 'bigtower', 'ballista'] },
  { id: 'fallen', name: 'Fallen', items: ['moat', 'pitch', 'trap'] },
  { id: 'wirtschaft', name: 'Wirtschaft', items: ['woodcutter', 'quarry', 'mine', 'stockpile'] },
  { id: 'nahrung', name: 'Nahrung', items: ['orchard', 'farm', 'mill', 'bakery', 'granary'] },
  { id: 'stadt', name: 'Stadt', items: ['house', 'chapel', 'market'] },
  { id: 'militaer', name: 'Militär', items: ['barracks'] },
];
// Sonder-Eintrag in der Bauleiste
const RING_ITEM = { name: 'Mauerring', desc: 'Legt automatisch Mauern, Tore und Ecktürme um deinen Burgfried.',
  info: ['Antippen zeigt einen Vorschlag rund um deinen Burgfried.', 'Nochmal antippen macht den Ring größer.', 'Gebaut wird, was dein Stein hergibt – zuerst Tore und Türme.', 'Felder mit Gebäuden oder Wasser werden ausgelassen.'] };

// Produktion pro Arbeitszyklus; input: wird vorher aus dem Lager geholt
const PROD = {
  woodcutter: { res: 'holz', amt: 4, time: 7, store: 'stockpile' },
  quarry: { res: 'stein', amt: 4, time: 13, store: 'stockpile' },
  mine: { res: 'eisen', amt: 2, time: 16, store: 'stockpile' },
  orchard: { res: 'nahrung', amt: 5, time: 15, store: 'granary' },
  farm: { res: 'weizen', amt: 4, time: 16, store: 'stockpile' },
  mill: { res: 'mehl', amt: 4, time: 8, store: 'stockpile', input: { res: 'weizen', amt: 4 } },
  bakery: { res: 'brot', amt: 6, time: 10, store: 'granary', input: { res: 'mehl', amt: 2 } },
};

const MARKET = { holz: 4, stein: 8, eisen: 18, weizen: 5, mehl: 8, nahrung: 5, brot: 8 }; // Kaufpreis für 5 Stück

// armor: Faktor auf erlittenen Schaden [Fernkampf, Nahkampf]
const UNITS = {
  peasant: { name: 'Bauer', hp: 30, speed: 1.7, civil: true },
  archer: { name: 'Bogenschütze', hp: 60, dmg: 9, bdmg: 1, range: 7, cd: 1.6, speed: 1.7, ranged: true,
    armor: [1, 1], aggro: 8, cost: { gold: 12, holz: 4 }, tower: true,
    desc: 'Schießt 7 Felder weit, von Türmen weiter.',
    info: ['Günstiger Fernkämpfer.', 'Am besten auf Türmen: geschützt und mit mehr Reichweite.', 'Schwach im Nahkampf und gegen Rüstung.'] },
  crossbow: { name: 'Armbrustschütze', hp: 75, dmg: 24, bdmg: 2, range: 6, cd: 2.8, speed: 1.3, ranged: true, pierce: true,
    armor: [0.8, 0.9], aggro: 7, cost: { gold: 25, holz: 3, eisen: 2 }, tower: true,
    desc: 'Langsam, aber durchschlägt Rüstung.',
    info: ['Hoher Schaden, ignoriert Rüstung.', 'Ideal gegen Schwertkämpfer und Reiter.', 'Lädt langsam nach.'] },
  spear: { name: 'Speerträger', hp: 90, dmg: 12, bdmg: 6, range: 1.15, cd: 1.1, speed: 1.9,
    armor: [1, 1], aggro: 5, cost: { gold: 8, holz: 2 }, bonus: { knight: 1.6 },
    desc: 'Billig und schnell. Gut gegen Reiter.',
    info: ['Günstige Masse für den Anfang.', '+60 % Schaden gegen Reiter.'] },
  pike: { name: 'Pikenier', hp: 210, dmg: 14, bdmg: 6, range: 1.4, cd: 1.4, speed: 1.0,
    armor: [0.5, 0.7], aggro: 4, cost: { gold: 25, holz: 3, eisen: 2 }, bonus: { knight: 2.5 },
    desc: 'Zäher Verteidiger mit langer Pike.',
    info: ['Hält viel aus, ideal zum Halten von Toren.', '2,5-facher Schaden gegen Reiter.', 'Langsam.'] },
  sword: { name: 'Schwertkämpfer', hp: 230, dmg: 22, bdmg: 16, range: 1.15, cd: 1.5, speed: 1.0,
    armor: [0.45, 0.8], aggro: 5, cost: { gold: 40, eisen: 4 },
    desc: 'Schwer gepanzert. Reißt Mauern schnell ein.',
    info: ['Starker Nahkämpfer mit Rüstung gegen Pfeile.', 'Guter Mauerbrecher.', 'Langsam.'] },
  knight: { name: 'Reiter', hp: 170, dmg: 18, bdmg: 5, range: 1.25, cd: 1.1, speed: 3.0,
    armor: [0.7, 0.9], aggro: 6, cost: { gold: 60, eisen: 3 },
    desc: 'Sehr schnell und stark. Teuer.',
    info: ['Schnellste Einheit – gut, um Schützen zu jagen.', 'Anfällig für Pikeniere und Speerträger.'] },
  assassin: { name: 'Assassine', hp: 70, dmg: 32, bdmg: 3, range: 1.15, cd: 1.0, speed: 2.6,
    armor: [1, 1], aggro: 6, cost: { gold: 50 }, bonus: { archer: 1.5, crossbow: 1.5, monk: 2 },
    desc: 'Schnell und tödlich gegen Schützen.',
    info: ['Hoher Schaden, wenig Leben.', '+50 % gegen Schützen, doppelt gegen Mönche.', 'Braucht kein Eisen.'] },
  monk: { name: 'Mönch', hp: 60, dmg: 0, heal: 7, range: 4, cd: 1, speed: 1.5, healer: true,
    armor: [1, 1], aggro: 0, cost: { gold: 40 },
    desc: 'Heilt verletzte Truppen in der Nähe.',
    info: ['Heilt jede Sekunde einen verletzten Verbündeten in 4 Feldern um 7 Leben.', 'Kämpft nicht – schütze ihn.'] },
  ram: { name: 'Rammbock', hp: 520, dmg: 0, bdmg: 120, range: 1.2, cd: 3, speed: 0.75, siege: true,
    armor: [0.2, 0.8], aggro: 0, cost: { gold: 100, holz: 30 },
    desc: 'Zerstört Tore und Mauern in Sekunden.',
    info: ['Greift nur Gebäude an.', 'Fast immun gegen Pfeile, aber verwundbar im Nahkampf.', 'Wähle ihn und tippe auf ein feindliches Tor.'] },
  catapult: { name: 'Katapult', hp: 220, dmg: 30, bdmg: 90, range: 13, minRange: 3, cd: 6, speed: 0.6, siege: true, ranged: true, splash: 1.2,
    armor: [0.8, 1], aggro: 13, cost: { gold: 150, holz: 40, stein: 10 },
    desc: 'Wirft Felsbrocken auf Gebäude, 13 Felder weit.',
    info: ['Schießt von selbst auf Gebäude in Reichweite.', 'Trifft auch Truppen in der Nähe des Einschlags.', 'Kann nicht auf weniger als 3 Felder schießen.'] },
};
const SOLDIER_TYPES = ['archer', 'crossbow', 'spear', 'pike', 'sword', 'knight', 'assassin', 'monk', 'ram', 'catapult'];

const STANCES = {
  aggressive: { name: 'Angriff', aggro: 2.0, leash: 18 },
  defensive: { name: 'Verteidigen', aggro: 1.0, leash: 9 },
  hold: { name: 'Stellung halten', aggro: 0, leash: 0 },
};
const FORMATIONS = { block: 'Block', line: 'Linie', loose: 'Locker' };

const TAXES = [
  { name: 'Großzügige Spende', gold: -0.6, pop: 7 },
  { name: 'Spende', gold: -0.4, pop: 5 },
  { name: 'Kleine Spende', gold: -0.2, pop: 3 },
  { name: 'Keine Steuern', gold: 0, pop: 1 },
  { name: 'Niedrige Steuern', gold: 0.3, pop: -2 },
  { name: 'Mittlere Steuern', gold: 0.5, pop: -4 },
  { name: 'Hohe Steuern', gold: 0.7, pop: -6 },
  { name: 'Sehr hohe Steuern', gold: 0.9, pop: -8 },
  { name: 'Wucher', gold: 1.2, pop: -12 },
];

const RATIONS = [
  { name: 'Keine', eat: 0, pop: -8 },
  { name: 'Halbe', eat: 0.5, pop: -4 },
  { name: 'Normale', eat: 1, pop: 0 },
  { name: 'Reichliche', eat: 1.5, pop: 4 },
  { name: 'Doppelte', eat: 2, pop: 8 },
];

const ECON_TICK = 10;
const FOOD_PER_PEASANT = 0.1;
const MONTH_SECONDS = 30;
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const DIFFICULTY = {
  leicht: { name: 'Leicht', gold: 8, mat: 1, iron: 0, wave: 4, waveStep: 2, interval: 300, armyCap: 18, recruit: 30, build: 5 },
  normal: { name: 'Normal', gold: 18, mat: 2, iron: 0.5, wave: 6, waveStep: 3, interval: 240, armyCap: 32, recruit: 18, build: 3.5 },
  schwer: { name: 'Schwer', gold: 32, mat: 3, iron: 1, wave: 9, waveStep: 4, interval: 180, armyCap: 48, recruit: 10, build: 2 },
};

// Werte mit Gebäudestufe
function lvlMul(b) { return 1 + 0.35 * ((b.level || 1) - 1); }
function upgradeCost(b) {
  const D = BUILDINGS[b.type], L = b.level || 1, out = { gold: 60 * L };
  for (const k in D.cost) if (k !== 'gold') out[k] = Math.ceil(D.cost[k] * (L + 0.5));
  if (b.type === 'keep') { out.stein = 40 * L; out.gold = 200 * L; }
  return out;
}
