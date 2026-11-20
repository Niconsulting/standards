'use strict';
// Spieldaten: Gelände, Gebäude, Einheiten, Steuern, Rationen

const TW = 64, TH = 32;          // Kachelgröße in Pixeln (isometrisch)
const MAP_N = 64;                // Kartengröße in Kacheln
const SAVE_VERSION = 1;

const T = { SAND: 0, GRASS: 1, ROCK: 2, IRON: 3, WATER: 4 };

const RES = ['holz', 'stein', 'eisen', 'nahrung', 'gold'];
const RES_NAME = { holz: 'Holz', stein: 'Stein', eisen: 'Eisen', nahrung: 'Nahrung', gold: 'Gold' };

const PLAYER_COLORS = ['#2f63c9', '#c23a2b'];
const PLAYER_NAMES = ['Du', 'Der Wüstenfürst'];

// terrain: erlaubte Geländearten; null = Sand/Gras
const BUILDINGS = {
  keep:       { name: 'Burgfried', w: 3, h: 3, cost: {}, hp: 2500, housing: 8, hidden: true,
                desc: 'Dein Herrschersitz. Fällt er, ist das Spiel verloren.' },
  stockpile:  { name: 'Lager', w: 2, h: 2, cost: { holz: 5 }, hp: 300, cat: 'wirtschaft',
                desc: 'Holz, Stein und Eisen werden hierher gebracht.' },
  granary:    { name: 'Kornspeicher', w: 2, h: 2, cost: { holz: 10 }, hp: 300, cat: 'wirtschaft',
                desc: 'Lagert die Nahrung. Ohne Speicher wird keine Ernte eingebracht.' },
  woodcutter: { name: 'Holzfäller', w: 2, h: 2, cost: { holz: 3 }, hp: 200, worker: true, cat: 'wirtschaft',
                desc: 'Fällt Palmen und Bäume in der Nähe. 1 Arbeiter.' },
  quarry:     { name: 'Steinbruch', w: 3, h: 3, cost: { holz: 20 }, hp: 300, worker: true, terrain: [T.ROCK], cat: 'wirtschaft',
                desc: 'Nur auf grauem Fels. Bricht Stein. 1 Arbeiter.' },
  mine:       { name: 'Eisenmine', w: 2, h: 2, cost: { holz: 20 }, hp: 300, worker: true, terrain: [T.IRON], cat: 'wirtschaft',
                desc: 'Nur auf rostrotem Erzboden. Fördert Eisen. 1 Arbeiter.' },
  orchard:    { name: 'Apfelhain', w: 3, h: 3, cost: { holz: 5 }, hp: 200, worker: true, terrain: [T.GRASS], cat: 'wirtschaft',
                desc: 'Nur auf grünem Oasenboden. Liefert Äpfel an den Kornspeicher. 1 Arbeiter.' },
  house:      { name: 'Hütte', w: 2, h: 2, cost: { holz: 6 }, hp: 200, housing: 8, cat: 'stadt',
                desc: 'Wohnraum für 8 Bauern.' },
  chapel:     { name: 'Kapelle', w: 2, h: 2, cost: { stein: 10, gold: 250 }, hp: 500, cat: 'stadt',
                desc: '+2 Beliebtheit (höchstens zwei Kapellen zählen).' },
  barracks:   { name: 'Kaserne', w: 3, h: 3, cost: { stein: 15 }, hp: 700, cat: 'militaer',
                desc: 'Bildet freie Bauern zu Soldaten aus.' },
  wall:       { name: 'Mauer', w: 1, h: 1, cost: { stein: 1 }, hp: 450, defense: true, cat: 'burg', anyTerrain: true,
                desc: 'Ziehen zum Bauen einer Linie. 1 Stein pro Feld.' },
  gate:       { name: 'Tor', w: 1, h: 1, cost: { stein: 10 }, hp: 900, defense: true, cat: 'burg', anyTerrain: true,
                desc: 'Lässt nur deine eigenen Leute durch.' },
  tower:      { name: 'Wachturm', w: 2, h: 2, cost: { stein: 10 }, hp: 1100, defense: true, garrison: 4, cat: 'burg', anyTerrain: true,
                desc: 'Bis zu 4 Soldaten. Bogenschützen auf dem Turm schießen 3 Felder weiter.' },
};

const BUILD_CATS = [
  { id: 'burg', name: 'Burg', items: ['wall', 'gate', 'tower'] },
  { id: 'wirtschaft', name: 'Wirtschaft', items: ['woodcutter', 'quarry', 'mine', 'orchard', 'stockpile', 'granary'] },
  { id: 'stadt', name: 'Stadt', items: ['house', 'chapel'] },
  { id: 'militaer', name: 'Militär', items: ['barracks'] },
];

// Produktion pro Arbeitszyklus
const PROD = {
  woodcutter: { res: 'holz', amt: 4, time: 7, store: 'stockpile' },
  quarry:     { res: 'stein', amt: 4, time: 13, store: 'stockpile' },
  mine:       { res: 'eisen', amt: 2, time: 16, store: 'stockpile' },
  orchard:    { res: 'nahrung', amt: 5, time: 15, store: 'granary' },
};

// armor: Faktor auf erlittenen Schaden (ranged / melee)
const UNITS = {
  peasant: { name: 'Bauer', hp: 30, speed: 1.7, civil: true },
  archer:  { name: 'Bogenschütze', hp: 60, dmg: 9, bdmg: 1, range: 7, cd: 1.6, speed: 1.7, ranged: true,
             armor: [1, 1], aggro: 8, cost: { gold: 12, holz: 4 },
             desc: 'Schießt auf 7 Felder, auf Türmen auf 10. Schwach im Nahkampf.' },
  spear:   { name: 'Speerträger', hp: 90, dmg: 12, bdmg: 6, range: 1.15, cd: 1.1, speed: 1.9,
             armor: [1, 1], aggro: 5, cost: { gold: 8, holz: 2 }, bonus: { knight: 1.6 },
             desc: 'Billig und schnell. Gut gegen Reiter.' },
  sword:   { name: 'Schwertkämpfer', hp: 230, dmg: 22, bdmg: 16, range: 1.15, cd: 1.5, speed: 1.0,
             armor: [0.45, 0.8], aggro: 5, cost: { gold: 40, eisen: 4 },
             desc: 'Schwer gepanzert, langsam. Reißt Mauern schnell ein.' },
  knight:  { name: 'Reiter', hp: 170, dmg: 18, bdmg: 5, range: 1.25, cd: 1.1, speed: 3.0,
             armor: [0.7, 0.9], aggro: 6, cost: { gold: 60, eisen: 3 },
             desc: 'Sehr schnell und stark. Teuer.' },
};
const SOLDIER_TYPES = ['archer', 'spear', 'sword', 'knight'];

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

const ECON_TICK = 10;        // Sekunden Spielzeit pro Wirtschaftsrunde
const FOOD_PER_PEASANT = 0.1;
const MONTH_SECONDS = 30;
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const DIFFICULTY = {
  leicht: { name: 'Leicht', gold: 8, mat: 1, iron: 0, wave: 4, waveStep: 2, interval: 300, armyCap: 18, recruit: 30, build: 5 },
  normal: { name: 'Normal', gold: 18, mat: 2, iron: 0.5, wave: 6, waveStep: 3, interval: 240, armyCap: 32, recruit: 18, build: 3.5 },
  schwer: { name: 'Schwer', gold: 32, mat: 3, iron: 1, wave: 9, waveStep: 4, interval: 180, armyCap: 48, recruit: 10, build: 2 },
};
