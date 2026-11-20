# Wüstenfeste

Ein Burgenbau-Strategiespiel für einen Spieler, offline im Browser.

## Spielen

- **Am einfachsten:** `Wuestenfeste.html` auf den Laptop kopieren und doppelklicken.
- Oder `index.html` in diesem Ordner öffnen (lädt die Dateien aus `js/`).

Läuft in Chrome, Edge, Firefox und Safari. Kein Internet nötig (nur die Schriftart wird online geladen, sonst wird eine Ersatzschrift benutzt).

## Spielstände

- Automatisch jede Spielminute und beim Schließen (Platz „Automatisch“).
- Manuell über **Menü → Speichern** in Platz 1–3, oder **Strg + S** für den Schnellspeicher.
- Die Stände liegen im Browser-Speicher. Zur Sicherheit über **Menü → Exportieren** als Datei sichern; über **Importieren** wieder laden.

## Entwickeln

Quellcode in `js/`, Stil in `style.css`. Nach Änderungen die Einzeldatei neu bauen:

```
python3 tools/bundle.py
```
