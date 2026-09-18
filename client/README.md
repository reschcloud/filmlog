# Filmlog → ExifTool

Interaktives Kommandozeilen-Skript (kein GUI nötig, läuft unter Windows,
macOS und Linux): liest einen abgeschlossenen Film aus
[Filmlog](../filmlog) und schreibt die Daten jeder einzelnen Aufnahme per
[ExifTool](https://exiftool.org) individuell in die passende gescannte
Bilddatei. Praktisches Gegenstück zu
[`metadata_writer`](https://github.com/reschcloud/metadata_writer), nur
eben mit pro Bild unterschiedlichen Werten statt einheitlicher Metadaten
für den ganzen Ordner.

## Voraussetzungen

1. **Python 3** (3.8 oder neuer reicht).
2. **`requests`-Paket:**
   ```bash
   pip install -r requirements.txt
   ```
3. **ExifTool** — von [exiftool.org](https://exiftool.org) laden. Unter
   Windows `exiftool(-k).exe` in `exiftool.exe` umbenennen. Muss im `PATH`
   erreichbar sein (`exiftool -ver` sollte in einem normalen Terminal
   funktionieren) — sonst `EXIFTOOL_PATH` oben im Skript auf den vollen
   Pfad setzen.
4. **Filmlog-Server erreichbar** — läuft der Filmlog-Server über HTTPS mit
   einem echten, vertrauenswürdigen Zertifikat, funktioniert der Zugriff
   ohne weitere Einstellungen.

## Ausführen

```bash
python3 filmlog_exif_writer.py
```

(unter Windows: `python filmlog_exif_writer.py`)

## Ablauf

1. Beim ersten Start nach der Filmlog-Server-URL fragen (z. B.
   `https://srv3-hel1.resch.cloud:5000`) — wird in
   `filmlog-exif-writer.config.json` neben dem Skript gespeichert, danach
   nicht mehr erneut abgefragt.
2. Lädt alle **abgeschlossenen, entwickelten und nicht archivierten**
   Filme und zeigt sie zur Auswahl.
3. Zeigt alle Aufnahmen des gewählten Films zur Kontrolle (Motiv, Datum,
   Uhrzeit, Objektiv) — Abbruch möglich, falls das nicht passt.
4. Fragt nach dem Ordner mit den gescannten Bildern (`.tif`, `.tiff`,
   `.jpg`, `.jpeg`, `.png`, alphabetisch sortiert).
5. Vergleicht die Anzahl der Filmlog-Einträge mit der Anzahl gefundener
   Bilddateien — bei Abweichung eine Warnung mit der Möglichkeit,
   trotzdem fortzufahren oder abzubrechen.
6. Zeigt die geplante Zuordnung **Dateiname → Motiv** zur letzten
   Kontrolle.
7. Erst nach ausdrücklicher Bestätigung: schreibt die Metadaten Datei für
   Datei mit `-overwrite_original` (keine `*_original`-Backups).
8. Protokolliert jede geschriebene Datei in `filmlog-exif-log.txt` im
   Zielordner.

## Geschriebene EXIF-Tags

| Filmlog-Feld                      | EXIF-Tag                                                             |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Kamera                             | `Make`                                                                |
| Filmname                           | `Model` (EXIF hat kein eigenes Filmstock-Feld)                        |
| Objektiv                           | `LensModel`                                                           |
| Motivbeschreibung                  | `ImageDescription`, `XPTitle`                                         |
| Brennweite                         | `FocalLength`                                                         |
| Belichtungszeit                    | `ExposureTime`                                                        |
| Blende                             | `FNumber`                                                             |
| Blitz verwendet                    | `Flash` (nur gesetzt, wenn verwendet — sonst kein Tag)                |
| Datum + Uhrzeit                    | `DateTimeOriginal`, `CreateDate`                                       |
| GPS-Koordinaten (falls vorhanden)  | `GPSLatitude`/`GPSLatitudeRef`, `GPSLongitude`/`GPSLongitudeRef`       |

Leere/fehlende Felder werden übersprungen, nicht mit Platzhaltern befüllt.

## Bekannte Grenzen

- Die Zuordnung erfolgt rein über die **alphabetische Reihenfolge** der
  Dateinamen gegen die Reihenfolge der Aufnahmen in Filmlog — passt nur,
  wenn eure Scan-Dateien fortlaufend benannt sind (z. B. `001.tif`,
  `002.tif`, …) und in derselben Reihenfolge aufgenommen wurden. Es findet
  kein inhaltlicher Bildabgleich statt.
- ISO wird nicht geschrieben — Filmlog erfasst aktuell keine separate
  ISO-Angabe (nur den Filmnamen als Freitext, z. B. "Kodak Tri-X 400").
- Getestet gegen Filmlogs `/api/films` und `/api/films/<nummer>`
  Endpunkte; Änderungen an deren Feldnamen im Backend müssten hier
  nachgezogen werden.
