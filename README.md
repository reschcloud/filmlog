# Filmlog

> **Dieser Stand ist v1 und wird nicht mehr weiterentwickelt.** Der Neubau läuft als
> Docker-Container mit Login und SQLite: **[filmlog-v2](https://github.com/reschcloud/filmlog-v2)**.
> Die Daten aus `data/db.yaml` lassen sich dorthin importieren; die Anleitung steht im v2-Repo.
> Der Code hier bleibt zum Nachschlagen und für bestehende Installationen erhalten (Tag `v1.0`).

Kleine Webapp im lokalen Netz zur Dokumentation analoger Filme und ihrer Aufnahmen.
Kein Login, keine Datenbank — die Daten liegen als YAML in `data/db.yaml` auf dem Server.

## Installation

```bash
cd filmlog
python3 -m venv venv
source venv/bin/activate        # unter Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Starten

```bash
python app.py
```

Die App läuft dann auf Port 5000 und ist im lokalen Netz erreichbar unter:

```
http://<IP-des-Servers>:5000
```

Die IP des Rechners/Pi findest du z. B. mit `hostname -I` (Linux) oder `ipconfig` (Windows).
Vom Handy/Tablet aus einfach diese Adresse im Browser öffnen — für das GPS-Feld bei „Neue
Aufnahme“ muss der Browser Standortzugriff erlauben (bei reinem HTTP fragen manche Browser
das nicht automatisch ab; in dem Fall den Ort einfach manuell eintragen).

## Dauerbetrieb als systemd-Dienst

Wenn das Paket bereits inklusive `venv` und installierten Abhängigkeiten auf dem
Server liegt, richtet ihr den Dienst so ein:

```bash
sudo bash deploy/install-service.sh
```

Das Skript nimmt standardmäßig an, dass das venv unter `venv/` direkt im
Projektverzeichnis liegt und der Dienst mit dem aktuellen Benutzer laufen
soll. Beides lässt sich überschreiben:

```bash
sudo bash deploy/install-service.sh /pfad/zum/venv benutzername
```

Es wird eine `filmlog.service`-Datei unter `/etc/systemd/system/` angelegt,
per `systemctl enable --now` aktiviert (startet also automatisch beim
Booten) und sofort gestartet.

Nützliche Befehle danach:

```bash
sudo systemctl status filmlog     # Status prüfen
sudo systemctl restart filmlog    # neu starten (z. B. nach Code-Änderungen)
sudo systemctl stop filmlog       # anhalten
journalctl -u filmlog -f          # Logs live verfolgen
```

## Datenmodell (`data/db.yaml`)

```yaml
next_film_number: 3
films:
  1:
    name: Kodak Tri-X 400 35mm
    kamera: Zenit TTL
    ablaufdatum: '2027-01-01'
    status: offen            # oder: abgeschlossen
    angelegt_am: '2026-08-09T10:15:00'
    aufnahmen:
      - datum: '2026-08-09'
        uhrzeit: '10:20'
        ort_text: 'Stadtpark'
        ort_lat: 52.5
        ort_lon: 13.4
        objektiv: Helios 44-2
        brennweite: 58mm
        belichtungszeit: 1/125
        blende: f/5.6
        motiv: Kastanienbaum am Teich
        aufgenommen_am: '2026-08-09T10:20:11'
```

Die Datei kann bei Bedarf einfach gesichert, versioniert oder von Hand nachbearbeitet werden.
