#!/usr/bin/env python3
"""
Filmlog -> ExifTool

Interaktives Kommandozeilen-Skript (kein GUI, os-neutral): liest einen
abgeschlossenen Film aus Filmlog und schreibt die Daten jeder einzelnen
Aufnahme per ExifTool individuell in die passende gescannte Bilddatei.

Ablauf:
  1. Prueft, ob ExifTool verfuegbar ist.
  2. Fragt beim Filmlog-Server alle abgeschlossenen, entwickelten und
     NICHT archivierten Filme ab und zeigt sie zur Auswahl.
  3. Zeigt alle Aufnahmen des gewaehlten Films zur Kontrolle an.
  4. Fragt nach dem Ordner mit den gescannten Bildern und vergleicht die
     Anzahl der Dateien mit der Anzahl der Filmlog-Eintraege.
  5. Zeigt die geplante Zuordnung Dateiname -> Motiv zur Bestaetigung.
  6. Schreibt erst nach expliziter Bestaetigung die Metadaten, Datei fuer
     Datei, mit -overwrite_original (keine *_original-Backups).
  7. Protokolliert jede geschriebene Datei in filmlog-exif-log.txt im
     Zielordner.
"""

import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

try:
    import requests
    import urllib3
except ImportError:
    print("Das Paket 'requests' fehlt. Installieren mit:\n  pip install requests")
    sys.exit(1)

# Zertifikatspruefung bewusst deaktiviert (z. B. bei selbstsigniertem oder
# unvollstaendigem Zertifikat auf dem Filmlog-Server). Damit prueft der
# Client nicht mehr, ob das Zertifikat zur Domain passt/gueltig ist -
# vertretbar fuer den eigenen Server im privaten Netz, aber kein Schutz
# mehr gegen einen Man-in-the-Middle.
VERIFY_SSL = False
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ---------- Konfiguration ----------

# Pfad/Name der ExifTool-Programmdatei. Liegt ExifTool im PATH, reicht
# "exiftool" (Linux/macOS) bzw. "exiftool.exe" (Windows wird automatisch
# mitgeprueft). Sonst hier den vollen Pfad eintragen.
EXIFTOOL_PATH = "exiftool"

# Bild-Dateiendungen, die beruecksichtigt werden.
IMAGE_EXTENSIONS = {".tif", ".tiff", ".jpg", ".jpeg", ".png"}

CONFIG_PATH = Path(__file__).resolve().parent / "filmlog-exif-writer.config.json"


# ---------- Hilfsfunktionen: Setup ----------

def get_filmlog_url():
    if CONFIG_PATH.exists():
        try:
            config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            url = (config.get("filmlog_url") or "").strip().rstrip("/")
            if url:
                return url
            print("Gespeicherte Server-URL ist leer, wird neu abgefragt.")
        except (json.JSONDecodeError, OSError):
            print("Konfigurationsdatei ist beschaedigt, wird neu abgefragt.")

    while True:
        url = input("Filmlog-Server-URL (z. B. https://srv3-hel1.resch.cloud:5000): ").strip().rstrip("/")
        if not url:
            print("Bitte eine URL eingeben.")
            continue
        if not url.startswith(("http://", "https://")):
            url = f"https://{url}"
        break

    CONFIG_PATH.write_text(json.dumps({"filmlog_url": url}, indent=2), encoding="utf-8")
    print(f"Gespeichert in {CONFIG_PATH}\n")
    return url


def find_exiftool():
    for kandidat in (EXIFTOOL_PATH, "exiftool.exe", "exiftool"):
        pfad = shutil.which(kandidat)
        if pfad:
            return pfad
    return None


def api_get(base_url, pfad):
    url = f"{base_url}{pfad}"
    try:
        antwort = requests.get(url, timeout=15, verify=VERIFY_SSL)
        antwort.raise_for_status()
        return antwort.json()
    except requests.RequestException as err:
        print(f"Filmlog-Anfrage an {url} fehlgeschlagen: {err}")
        sys.exit(1)


def api_post(base_url, pfad):
    url = f"{base_url}{pfad}"
    try:
        antwort = requests.post(url, timeout=15, verify=VERIFY_SSL)
        antwort.raise_for_status()
        return antwort.json()
    except requests.RequestException as err:
        print(f"Filmlog-Anfrage an {url} fehlgeschlagen: {err}")
        return None


# ---------- Hilfsfunktionen: Wertumwandlung fuer ExifTool ----------

def zu_brennweite(wert):
    if not wert:
        return None
    zahl = re.sub(r"[^0-9.,]", "", wert).replace(",", ".")
    return zahl or None


def zu_blende(wert):
    if not wert:
        return None
    zahl = re.sub(r"^[fF]/?", "", wert).replace(",", ".")
    return zahl or None


def zu_exif_datum(datum, uhrzeit):
    if not datum:
        return None
    zeit = uhrzeit or "00:00"
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(f"{datum} {zeit}", fmt)
            return dt.strftime("%Y:%m:%d %H:%M:%S")
        except ValueError:
            continue
    return None


# ---------- Ablauf ----------

def main():
    print("=== Filmlog -> ExifTool ===\n")

    exiftool_pfad = find_exiftool()
    if not exiftool_pfad:
        print(
            "ExifTool wurde nicht gefunden. Von https://exiftool.org laden "
            "(Windows: 'exiftool(-k).exe' in 'exiftool.exe' umbenennen), "
            "und entweder in den PATH legen oder EXIFTOOL_PATH oben im "
            "Skript auf den vollen Pfad setzen."
        )
        sys.exit(1)

    filmlog_url = get_filmlog_url()

    # --- Film auswaehlen ---
    print(f"Lade abgeschlossene Filme von {filmlog_url} ...\n")
    alle_filme = api_get(filmlog_url, "/api/films?status=abgeschlossen")
    filme = [f for f in alle_filme if f.get("entwickelt") and not f.get("archiviert")]

    if not filme:
        print("Keine entwickelten, nicht archivierten Filme gefunden.")
        return

    print("Verfuegbare Filme:\n")
    for i, f in enumerate(filme, start=1):
        print(f"  [{i}] #{f['nummer']} - {f['name']} ({f['kamera']}, {f['anzahl_aufnahmen']} Aufnahmen)")

    auswahl = input("\nFilm auswaehlen (Klammer-Nummer oder Filmnummer, z. B. 2 oder 10): ").strip()
    gewaehlter_film = None
    if auswahl.isdigit():
        zahl = int(auswahl)
        nach_filmnummer = next((f for f in filme if f.get("nummer") == zahl), None)
        nach_index = filme[zahl - 1] if 1 <= zahl <= len(filme) else None

        if nach_filmnummer and nach_index and nach_filmnummer is not nach_index:
            print(f"\n'{zahl}' ist mehrdeutig:")
            print(f"  a) Position [{zahl}] in der Liste: #{nach_index['nummer']} - {nach_index['name']}")
            print(f"  b) Film mit der echten Nummer #{zahl}: #{nach_filmnummer['nummer']} - {nach_filmnummer['name']}")
            entscheidung = input("Welchen meinst du? (a/b): ").strip().lower()
            if entscheidung == "a":
                gewaehlter_film = nach_index
            elif entscheidung == "b":
                gewaehlter_film = nach_filmnummer
        elif nach_filmnummer:
            gewaehlter_film = nach_filmnummer
        elif nach_index:
            gewaehlter_film = nach_index

    if gewaehlter_film is None:
        print("Ungueltige Auswahl.")
        sys.exit(1)

    # --- Aufnahmen laden und zur Kontrolle anzeigen ---
    film_detail = api_get(filmlog_url, f"/api/films/{gewaehlter_film['nummer']}")
    aufnahmen = film_detail.get("aufnahmen", [])

    print(f"\nAufnahmen zu Nr. {gewaehlter_film['nummer']} - {gewaehlter_film['name']} ({gewaehlter_film['kamera']}):\n")
    for i, a in enumerate(aufnahmen, start=1):
        titel = a.get("motiv") or "(kein Motiv)"
        print(f"  {i:>3}. {titel}  |  {a.get('datum', '')} {a.get('uhrzeit', '')}  |  {a.get('objektiv') or ''}")

    weiter = input("\nPasst diese Liste? (j/n): ").strip().lower()
    if weiter != "j":
        print("Abgebrochen.")
        return

    # --- Bildordner waehlen ---
    ordner_str = input("\nPfad zum Ordner mit den gescannten Bildern: ").strip()
    ordner = Path(ordner_str)
    if not ordner.is_dir():
        print(f"Ordner nicht gefunden: {ordner}")
        sys.exit(1)

    dateien = sorted(
        (p for p in ordner.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS),
        key=lambda p: p.name,
    )

    if not dateien:
        print(f"Keine Bilddateien ({', '.join(sorted(IMAGE_EXTENSIONS))}) in {ordner} gefunden.")
        sys.exit(1)

    if len(dateien) != len(aufnahmen):
        print(f"\nWARNUNG: Anzahl passt nicht: {len(aufnahmen)} Filmlog-Eintraege, aber {len(dateien)} Bilddateien im Ordner.")
        trotzdem = input("Trotzdem fortfahren? (j/n): ").strip().lower()
        if trotzdem != "j":
            print("Abgebrochen.")
            return

    # --- Startdatei waehlen ---
    start_antwort = input(
        f"\nBei welcher Bilddatei soll der erste Filmlog-Eintrag beginnen? "
        f"(1-{len(dateien)}, Enter fuer 1): "
    ).strip()
    start_index = 1
    if start_antwort:
        if not start_antwort.isdigit() or not (1 <= int(start_antwort) <= len(dateien)):
            print("Ungueltige Eingabe.")
            sys.exit(1)
        start_index = int(start_antwort)

    dateien_ab_start = dateien[start_index - 1:]
    fuehrende_dateien = dateien[:start_index - 1]
    if fuehrende_dateien:
        uebersprungen = ", ".join(p.name for p in fuehrende_dateien)
        print(f"  ({len(fuehrende_dateien)} Bilddatei(en) am Anfang werden uebersprungen: {uebersprungen})")

    # --- Zuordnung anzeigen ---
    anzahl_paare = min(len(dateien_ab_start), len(aufnahmen))
    print("\nZuordnung (Dateiname  ->  Motiv):\n")
    for i in range(anzahl_paare):
        titel = aufnahmen[i].get("motiv") or "(kein Motiv)"
        print(f"  {dateien_ab_start[i].name:<30}  ->  {titel}")
    if len(dateien_ab_start) > anzahl_paare:
        print(f"\n  ({len(dateien_ab_start) - anzahl_paare} weitere Bilddatei(en) ohne Filmlog-Eintrag werden NICHT beschrieben)")
    if len(aufnahmen) > anzahl_paare:
        print(f"\n  ({len(aufnahmen) - anzahl_paare} weitere Filmlog-Eintraege ohne Bilddatei werden ignoriert)")

    bestaetigung = input("\nMetadaten jetzt schreiben? (j/n): ").strip().lower()
    if bestaetigung != "j":
        print("Abgebrochen, es wurde nichts geschrieben.")
        return

    # --- Schreiben ---
    log_pfad = ordner / "filmlog-exif-log.txt"
    erfolge = 0
    fehler = 0

    for i in range(anzahl_paare):
        datei = dateien_ab_start[i]
        a = aufnahmen[i]

        exif_args = ["-overwrite_original"]
        if gewaehlter_film.get("kamera"):
            exif_args.append(f"-Make={gewaehlter_film['kamera']}")
        if gewaehlter_film.get("name"):
            exif_args.append(f"-Model={gewaehlter_film['name']}")
        if a.get("objektiv"):
            exif_args.append(f"-LensModel={a['objektiv']}")
        if a.get("motiv"):
            exif_args.append(f"-ImageDescription={a['motiv']}")
            exif_args.append(f"-XPTitle={a['motiv']}")

        brennweite = zu_brennweite(a.get("brennweite"))
        if brennweite:
            exif_args.append(f"-FocalLength={brennweite}")

        if a.get("belichtungszeit"):
            exif_args.append(f"-ExposureTime={a['belichtungszeit']}")

        blende = zu_blende(a.get("blende"))
        if blende:
            exif_args.append(f"-FNumber={blende}")

        if a.get("blitz"):
            exif_args.append("-Flash=Fired")

        exif_datum = zu_exif_datum(a.get("datum"), a.get("uhrzeit"))
        if exif_datum:
            exif_args.append(f"-DateTimeOriginal={exif_datum}")
            exif_args.append(f"-CreateDate={exif_datum}")

        if a.get("ort_lat") is not None and a.get("ort_lon") is not None:
            lat = float(a["ort_lat"])
            lon = float(a["ort_lon"])
            exif_args.append(f"-GPSLatitude={abs(lat)}")
            exif_args.append(f"-GPSLatitudeRef={'N' if lat >= 0 else 'S'}")
            exif_args.append(f"-GPSLongitude={abs(lon)}")
            exif_args.append(f"-GPSLongitudeRef={'E' if lon >= 0 else 'W'}")

        exif_args.append(str(datei))

        ergebnis = subprocess.run(
            [exiftool_pfad, *exif_args],
            capture_output=True,
            text=True,
        )

        if ergebnis.returncode == 0:
            erfolge += 1
            titel_log = a.get("motiv") or "(kein Motiv)"
            zeitstempel = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with log_pfad.open("a", encoding="utf-8") as log_datei:
                log_datei.write(f"{zeitstempel}  {datei.name}  ->  {titel_log}\n")
        else:
            fehler += 1
            print(f"Fehler beim Schreiben von {datei.name}: {ergebnis.stderr.strip()}")

    print(f"\nFertig: {erfolge} Datei(en) beschrieben, {fehler} Fehler.")
    if erfolge:
        print(f"Log: {log_pfad}")

    # --- Unverpaarte Dateien (vor der Startdatei + nach dem letzten Eintrag): zumindest Kamera/Film eintragen ---
    nachfolgende_dateien = dateien_ab_start[anzahl_paare:]
    unverpaarte_dateien = fuehrende_dateien + nachfolgende_dateien
    if unverpaarte_dateien:
        print(f"\n{len(unverpaarte_dateien)} Bilddatei(en) ohne Filmlog-Eintrag:")
        for p in unverpaarte_dateien:
            print(f"  {p.name}")

        rest_antwort = input(
            "\nDiesen Dateien zumindest Kamera und Film eintragen "
            "(Make/Model, ohne Motiv/Datum/Objektiv etc.)? (j/n): "
        ).strip().lower()

        if rest_antwort == "j":
            rest_erfolge = 0
            rest_fehler = 0
            for datei in unverpaarte_dateien:
                exif_args = ["-overwrite_original"]
                if gewaehlter_film.get("kamera"):
                    exif_args.append(f"-Make={gewaehlter_film['kamera']}")
                if gewaehlter_film.get("name"):
                    exif_args.append(f"-Model={gewaehlter_film['name']}")
                exif_args.append(str(datei))

                ergebnis = subprocess.run(
                    [exiftool_pfad, *exif_args],
                    capture_output=True,
                    text=True,
                )

                if ergebnis.returncode == 0:
                    rest_erfolge += 1
                    zeitstempel = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    with log_pfad.open("a", encoding="utf-8") as log_datei:
                        log_datei.write(
                            f"{zeitstempel}  {datei.name}  ->  (nur Kamera/Film, kein Filmlog-Eintrag)\n"
                        )
                else:
                    rest_fehler += 1
                    print(f"Fehler beim Schreiben von {datei.name}: {ergebnis.stderr.strip()}")

            print(f"\nZusaetzlich beschrieben (nur Kamera/Film): {rest_erfolge} Datei(en), {rest_fehler} Fehler.")
        else:
            print("Uebersprungen, diese Dateien bleiben unveraendert.")

    if erfolge:
        archivieren = input("\nFilm jetzt in Filmlog archivieren? (j/n): ").strip().lower()
        if archivieren == "j":
            ergebnis = api_post(filmlog_url, f"/api/films/{gewaehlter_film['nummer']}/archivieren")
            if ergebnis is not None:
                print(f"Film #{gewaehlter_film['nummer']} wurde archiviert.")
            else:
                print("Archivieren fehlgeschlagen, bitte manuell in Filmlog nachholen.")


if __name__ == "__main__":
    main()
