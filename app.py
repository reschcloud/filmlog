import os
import re
import threading
import io
import zipfile
from collections import Counter
from datetime import date, datetime, timedelta

import yaml
from flask import Flask, Response, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CLIENT_DIR = os.path.join(BASE_DIR, "client")
DB_PATH = os.path.join(DATA_DIR, "db.yaml")
OPTIONEN_PATH = os.path.join(DATA_DIR, "optionen.yaml")

KATEGORIEN = {
    "filme": "Filme",
    "kameras": "Kameras",
    "objektive": "Objektive",
    "belichtungszeiten": "Belichtungszeiten",
    "blenden": "Blenden",
}

app = Flask(__name__, static_folder="static", template_folder="templates")
_lock = threading.Lock()


def _default_optionen():
    return {
        "filme": ["Kodak Tri-X 400 35mm", "Ilford HP5 Plus 400 35mm"],
        "kameras": ["Zenit TTL"],
        "objektive": ["Helios 44-2"],
        "belichtungszeiten": ["1/60", "1/125", "1/250", "1/500"],
        "blenden": ["f/2.8", "f/4", "f/5.6", "f/8", "f/11", "f/16"],
    }


def load_optionen():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(OPTIONEN_PATH):
        optionen = _default_optionen()
        save_optionen(optionen)
        return optionen
    with open(OPTIONEN_PATH, "r", encoding="utf-8") as f:
        optionen = yaml.safe_load(f)
    if not optionen:
        optionen = _default_optionen()
    for kategorie in KATEGORIEN:
        optionen.setdefault(kategorie, [])
    return optionen


def save_optionen(optionen):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp_path = OPTIONEN_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(optionen, f, allow_unicode=True, sort_keys=False)
    os.replace(tmp_path, OPTIONEN_PATH)


def _empty_db():
    return {"next_film_number": 1, "films": {}}


def load_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(DB_PATH):
        db = _empty_db()
        save_db(db)
        return db
    with open(DB_PATH, "r", encoding="utf-8") as f:
        db = yaml.safe_load(f)
    if not db:
        db = _empty_db()
    db.setdefault("next_film_number", 1)
    db.setdefault("films", {})
    return db


def save_db(db):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp_path = DB_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(db, f, allow_unicode=True, sort_keys=False)
    os.replace(tmp_path, DB_PATH)


def film_summary(nummer, film):
    return {
        "nummer": int(nummer),
        "name": film["name"],
        "kamera": film["kamera"],
        "ablaufdatum": film.get("ablaufdatum"),
        "status": film["status"],
        "angelegt_am": film.get("angelegt_am"),
        "abgeschlossen_am": film.get("abgeschlossen_am"),
        "entwickelt_am": film.get("entwickelt_am"),
        "anzahl_aufnahmen": len(film.get("aufnahmen", [])),
        "kapazitaet": film.get("kapazitaet"),
        "entwickelt": film.get("entwickelt", False),
        "filmtyp": film.get("filmtyp"),
        "archiviert": film.get("archiviert", False),
    }


@app.route("/")
def index():
    return send_from_directory(app.template_folder, "index.html")


@app.route("/api/films", methods=["GET"])
def get_films():
    status = request.args.get("status")
    sortierung = request.args.get("sortierung")
    with _lock:
        db = load_db()
    films = db["films"]
    result = []
    for nummer, film in films.items():
        if status and film["status"] != status:
            continue
        eintrag = film_summary(nummer, film)
        if sortierung == "zuletzt_genutzt":
            aufnahmen = film.get("aufnahmen", [])
            zeiten = [a.get("aufgenommen_am") for a in aufnahmen if a.get("aufgenommen_am")]
            eintrag["_sortier_zeit"] = max(zeiten) if zeiten else (film.get("angelegt_am") or "")
        result.append(eintrag)

    if sortierung == "zuletzt_genutzt":
        result.sort(key=lambda f: f["_sortier_zeit"], reverse=True)
        for f in result:
            del f["_sortier_zeit"]
    else:
        result.sort(key=lambda f: f["nummer"], reverse=True)

    return jsonify(result)

FILMTYPEN = {"sw", "farbe", "anderes"}

@app.route("/api/films", methods=["POST"])
def create_film():
    payload = request.get_json(force=True) or {}
    name = (payload.get("name") or "").strip()
    kamera = (payload.get("kamera") or "").strip()
    ablaufdatum = (payload.get("ablaufdatum") or "").strip()
    kapazitaet_raw = (payload.get("kapazitaet") or "").strip()
    filmtyp = (payload.get("filmtyp") or "").strip()
    if filmtyp not in FILMTYPEN:
        filmtyp = ""

    if not name or not kamera:
        return jsonify({"error": "Filmname und Kamera sind erforderlich."}), 400
    if ablaufdatum and not re.fullmatch(r"\d{4}", ablaufdatum):
        return jsonify({"error": "Ablaufjahr muss eine vierstellige Jahreszahl sein."}), 400
    kapazitaet_raw = (payload.get("kapazitaet") or "").strip()
    if not kapazitaet_raw or not kapazitaet_raw.isdigit() or int(kapazitaet_raw) <= 0:
        return jsonify({"error": "Anzahl Aufnahmen ist ein Pflichtfeld und muss eine positive Zahl sein."}), 400
    kapazitaet = int(kapazitaet_raw)
    if kapazitaet_raw:
        if not kapazitaet_raw.isdigit() or int(kapazitaet_raw) <= 0:
            return jsonify({"error": "Anzahl Aufnahmen muss eine positive Zahl sein."}), 400
        kapazitaet = int(kapazitaet_raw)

    with _lock:
        db = load_db()
        nummer = db["next_film_number"]
        db["films"][str(nummer)] = {
            "name": name,
            "kamera": kamera,
            "ablaufdatum": ablaufdatum or None,
            "kapazitaet": kapazitaet,
            "filmtyp": filmtyp,
            "status": "offen",
            "angelegt_am": datetime.now().isoformat(timespec="seconds"),
            "aufnahmen": [],
        }
        db["next_film_number"] = nummer + 1
        save_db(db)

    return jsonify(film_summary(str(nummer), db["films"][str(nummer)])), 201


@app.route("/api/films/<int:nummer>", methods=["GET"])
def get_film(nummer):
    with _lock:
        db = load_db()
    film = db["films"].get(str(nummer))
    if not film:
        return jsonify({"error": "Film nicht gefunden."}), 404
    data = film_summary(str(nummer), film)
    data["aufnahmen"] = film.get("aufnahmen", [])
    return jsonify(data)


@app.route("/api/films/<int:nummer>/complete", methods=["POST"])
def complete_film(nummer):
    with _lock:
        db = load_db()
        film = db["films"].get(str(nummer))
        if not film:
            return jsonify({"error": "Film nicht gefunden."}), 404
        film["status"] = "abgeschlossen"
        film["abgeschlossen_am"] = datetime.now().isoformat(timespec="seconds")
        save_db(db)
        data = film_summary(str(nummer), film)
        data["aufnahmen"] = film.get("aufnahmen", [])
    return jsonify(data)

@app.route("/api/films/<int:nummer>/reopen", methods=["POST"])
def reopen_film(nummer):
    with _lock:
        db = load_db()
        film = db["films"].get(str(nummer))
        if not film:
            return jsonify({"error": "Film nicht gefunden."}), 404
        if film["status"] != "abgeschlossen":
            return jsonify({"error": "Nur abgeschlossene Filme können wieder geöffnet werden."}), 400
        film["status"] = "offen"
        film.pop("abgeschlossen_am", None)
        save_db(db)
        data = film_summary(str(nummer), film)
    return jsonify(data)

@app.route("/api/films/<int:nummer>/entwickelt", methods=["POST"])
def markiere_entwickelt(nummer):
    with _lock:
        db = load_db()
        film = db["films"].get(str(nummer))
        if not film:
            return jsonify({"error": "Film nicht gefunden."}), 404
        film["entwickelt"] = True
        film["entwickelt_am"] = datetime.now().isoformat(timespec="seconds")
        save_db(db)
        data = film_summary(str(nummer), film)
    return jsonify(data)

@app.route("/api/films/<int:nummer>/archivieren", methods=["POST"])
def archiviere_film(nummer):
    with _lock:
        db = load_db()
        film = db["films"].get(str(nummer))
        if not film:
            return jsonify({"error": "Film nicht gefunden."}), 404
        film["archiviert"] = True
        save_db(db)
        data = film_summary(str(nummer), film)
    return jsonify(data)


@app.route("/api/films/<int:nummer>/archivieren", methods=["DELETE"])
def entarchiviere_film(nummer):
    with _lock:
        db = load_db()
        film = db["films"].get(str(nummer))
        if not film:
            return jsonify({"error": "Film nicht gefunden."}), 404
        film["archiviert"] = False
        save_db(db)
        data = film_summary(str(nummer), film)
    return jsonify(data)

@app.route("/api/films/<int:nummer>", methods=["DELETE"])
def delete_film(nummer):
    with _lock:
        db = load_db()
        film = db["films"].get(str(nummer))
        if not film:
            return jsonify({"error": "Film nicht gefunden."}), 404
        if film["status"] != "abgeschlossen":
            return jsonify({"error": "Nur abgeschlossene Filme können gelöscht werden."}), 400
        del db["films"][str(nummer)]
        save_db(db)
    return jsonify({"geloescht": nummer})

# Felder einer Aufnahme, die in der Detailansicht bearbeitet werden duerfen.
# Koordinaten (ort_lat/ort_lon) und der Zeitstempel gehoeren bewusst nicht dazu.
BEARBEITBARE_FELDER = (
    "datum", "uhrzeit", "ort_text", "objektiv",
    "belichtungszeit", "blende", "blitz", "motiv",
)


def _eintrag_aus_payload(payload):
    """Bereinigt die Felder einer Aufnahme (trimmen, leer wird None)."""
    return {
        "datum": (payload.get("datum") or "").strip(),
        "uhrzeit": (payload.get("uhrzeit") or "").strip(),
        "ort_text": (payload.get("ort_text") or "").strip() or None,
        "ort_lat": payload.get("ort_lat"),
        "ort_lon": payload.get("ort_lon"),
        "objektiv": (payload.get("objektiv") or "").strip() or None,
        "belichtungszeit": (payload.get("belichtungszeit") or "").strip() or None,
        "blende": (payload.get("blende") or "").strip() or None,
        "blitz": bool(payload.get("blitz")),
        "motiv": (payload.get("motiv") or "").strip() or None,
    }


@app.route("/api/aufnahmen", methods=["POST"])
def create_aufnahme():
    payload = request.get_json(force=True) or {}
    try:
        film_nummer = int(payload.get("film_nummer"))
    except (TypeError, ValueError):
        return jsonify({"error": "Ungültige Filmnummer."}), 400

    with _lock:
        db = load_db()
        film = db["films"].get(str(film_nummer))
        if not film:
            return jsonify({"error": "Film nicht gefunden."}), 404
        if film["status"] != "offen":
            return jsonify({"error": "Dieser Film ist bereits abgeschlossen."}), 400

        eintrag = _eintrag_aus_payload(payload)
        eintrag["aufgenommen_am"] = datetime.now().isoformat(timespec="seconds")
        film.setdefault("aufnahmen", []).append(eintrag)
        save_db(db)
        frame_nr = len(film["aufnahmen"])

    result = dict(eintrag)
    result["film_nummer"] = film_nummer
    result["film_name"] = film["name"]
    result["frame_nr"] = frame_nr
    return jsonify(result), 201

@app.route("/api/films/<int:nummer>/aufnahmen", methods=["POST"])
def insert_aufnahme(nummer):
    """Fuegt eine Aufnahme an einer bestimmten Position ein (1 = ganz vorne,
    n+1 = ans Ende). Funktioniert auch bei abgeschlossenen Filmen, nicht aber
    bei archivierten."""
    payload = request.get_json(force=True) or {}
    try:
        position = int(payload.get("position"))
    except (TypeError, ValueError):
        return jsonify({"error": "Ungültige Position."}), 400

    with _lock:
        db = load_db()
        film = db["films"].get(str(nummer))
        if not film:
            return jsonify({"error": "Film nicht gefunden."}), 404
        if film.get("archiviert"):
            return jsonify({"error": "Archivierte Filme können nicht bearbeitet werden."}), 400

        aufnahmen = film.setdefault("aufnahmen", [])
        if position < 1 or position > len(aufnahmen) + 1:
            return jsonify({"error": "Ungültige Position."}), 400

        eintrag = _eintrag_aus_payload(payload)
        # Koordinaten werden nicht uebernommen, der Eintrag hat nur den Ort-Text.
        eintrag["ort_lat"] = None
        eintrag["ort_lon"] = None
        # Zeitstempel vom Vorgaenger (sonst Nachfolger, sonst Film-Datum), damit
        # der Eintrag nicht als "gerade aufgenommen" unter "Zuletzt" auftaucht.
        nachbar = aufnahmen[position - 2] if position > 1 else (aufnahmen[0] if aufnahmen else None)
        eintrag["aufgenommen_am"] = (
            (nachbar or {}).get("aufgenommen_am")
            or film.get("abgeschlossen_am")
            or film.get("angelegt_am")
            or datetime.now().isoformat(timespec="seconds")
        )
        aufnahmen.insert(position - 1, eintrag)
        save_db(db)

    result = dict(eintrag)
    result["film_nummer"] = nummer
    result["frame_nr"] = position
    return jsonify(result), 201


@app.route("/api/films/<int:nummer>/aufnahmen/<int:index>", methods=["PUT"])
def update_aufnahme(nummer, index):
    """Aendert die bearbeitbaren Felder einer Aufnahme. Koordinaten und
    Zeitstempel bleiben unveraendert."""
    payload = request.get_json(force=True) or {}
    with _lock:
        db = load_db()
        film = db["films"].get(str(nummer))
        if not film:
            return jsonify({"error": "Film nicht gefunden."}), 404
        if film.get("archiviert"):
            return jsonify({"error": "Archivierte Filme können nicht bearbeitet werden."}), 400
        aufnahmen = film.get("aufnahmen", [])
        if index < 1 or index > len(aufnahmen):
            return jsonify({"error": "Aufnahme nicht gefunden."}), 404

        neu = _eintrag_aus_payload(payload)
        eintrag = aufnahmen[index - 1]
        for feld in BEARBEITBARE_FELDER:
            eintrag[feld] = neu[feld]
        save_db(db)

    result = dict(eintrag)
    result["film_nummer"] = nummer
    result["frame_nr"] = index
    return jsonify(result)


@app.route("/api/films/<int:nummer>/aufnahmen/<int:index>", methods=["DELETE"])
def delete_aufnahme(nummer, index):
    with _lock:
        db = load_db()
        film = db["films"].get(str(nummer))
        if not film:
            return jsonify({"error": "Film nicht gefunden."}), 404
        aufnahmen = film.get("aufnahmen", [])
        if index < 1 or index > len(aufnahmen):
            return jsonify({"error": "Aufnahme nicht gefunden."}), 404
        del aufnahmen[index - 1]
        save_db(db)
    return jsonify({"geloescht": index})

@app.route("/api/aufnahmen/recent", methods=["GET"])
def recent_aufnahmen():
    film_nummer = request.args.get("film_nummer")
    try:
        limit = int(request.args.get("limit", 20))
    except ValueError:
        limit = 20

    with _lock:
        db = load_db()

    alle = []
    for nummer, film in db["films"].items():
        if film_nummer and str(nummer) != str(film_nummer):
            continue
        for idx, eintrag in enumerate(film.get("aufnahmen", []), start=1):
            row = dict(eintrag)
            row["film_nummer"] = int(nummer)
            row["film_kamera"] = film["kamera"]
            row["film_name"] = film["name"]
            row["film_kamera"] = film["kamera"]
            row["film_typ"] = film.get("filmtyp")
            row["film_archiviert"] = bool(film.get("archiviert"))
            row["film_name"] = film["name"]
            row["frame_nr"] = idx
            alle.append(row)

    alle.sort(key=lambda r: r.get("aufgenommen_am") or "", reverse=True)
    return jsonify(alle[:limit])

UNSORTIERTE_KATEGORIEN = {"belichtungszeiten", "blenden", "kameras", "objektive", "filme"}


def sortiere_optionen(kategorie, werte):
    if kategorie in UNSORTIERTE_KATEGORIEN:
        return list(werte)
    return sorted(werte, key=str.casefold)

@app.route("/api/optionen", methods=["GET"])
def get_optionen():
    with _lock:
        optionen = load_optionen()
    result = {k: sortiere_optionen(k, v) for k, v in optionen.items()}
    return jsonify(result)


@app.route("/api/optionen/<kategorie>", methods=["POST"])
def add_option(kategorie):
    if kategorie not in KATEGORIEN:
        return jsonify({"error": "Unbekannte Kategorie."}), 404
    payload = request.get_json(force=True) or {}
    wert = (payload.get("wert") or "").strip()
    if not wert:
        return jsonify({"error": "Wert darf nicht leer sein."}), 400

    with _lock:
        optionen = load_optionen()
        vorhanden = [v for v in optionen[kategorie] if v.casefold() == wert.casefold()]
        if not vorhanden:
            optionen[kategorie].append(wert)
            save_optionen(optionen)
        liste = sortiere_optionen(kategorie, optionen[kategorie])

    return jsonify(liste), 201


@app.route("/api/optionen/<kategorie>", methods=["DELETE"])
def delete_option(kategorie):
    if kategorie not in KATEGORIEN:
        return jsonify({"error": "Unbekannte Kategorie."}), 404
    payload = request.get_json(force=True) or {}
    wert = (payload.get("wert") or "").strip()

    with _lock:
        optionen = load_optionen()
        optionen[kategorie] = [v for v in optionen[kategorie] if v != wert]
        save_optionen(optionen)
        liste = sortiere_optionen(kategorie, optionen[kategorie])

    return jsonify(liste)


# Zeitraeume der Statistik: (Schluessel, Beschriftung, Tage inkl. heute; None = alles)
STATS_ZEITRAEUME = (("30", "30 Tage", 30), ("365", "365 Tage", 365), ("alle", "Alles", None))
FILMTYP_LABELS = {"sw": "S/W", "farbe": "Farbe", "anderes": "Anderes"}


def _absteigend(zaehler):
    """Counter -> Liste {name, anzahl}, meiste zuerst; bei Gleichstand alphabetisch."""
    sortiert = sorted(zaehler.items(), key=lambda kv: (-kv[1], kv[0].casefold()))
    return [{"name": name, "anzahl": anzahl} for name, anzahl in sortiert]


@app.route("/api/stats", methods=["GET"])
def stats():
    """Anzahl der Aufnahmen pro Filmtyp, Kamera und Filmstock (= Filmname) fuer 30 Tage, 365 Tage und alles.
    Gezaehlt wird nach Aufnahmedatum ('datum', ersatzweise Tag von 'aufgenommen_am');
    'letzte 30 Tage' = heute und die 29 Tage davor."""
    with _lock:
        db = load_db()

    heute = date.today()
    zeitraeume = []
    for key, label, tage in STATS_ZEITRAEUME:
        grenze = (heute - timedelta(days=tage - 1)).isoformat() if tage else None
        pro_typ, pro_kamera, pro_film = Counter(), Counter(), Counter()
        for film in db["films"].values():
            typ = FILMTYP_LABELS.get(film.get("filmtyp"), "Ohne Angabe")
            kamera = film.get("kamera") or "Unbekannt"
            filmstock = film.get("name") or "Unbekannt"
            for a in film.get("aufnahmen", []):
                tag = a.get("datum") or (a.get("aufgenommen_am") or "")[:10]
                if grenze and tag < grenze:
                    continue
                pro_typ[typ] += 1
                pro_kamera[kamera] += 1
                pro_film[filmstock] += 1
        zeitraeume.append({
            "key": key,
            "label": label,
            "gesamt": sum(pro_typ.values()),
            "filmtypen": _absteigend(pro_typ),
            "kameras": _absteigend(pro_kamera),
            "filmstocks": _absteigend(pro_film),
        })
    return jsonify({"zeitraeume": zeitraeume})


@app.route("/api/einstellungen/letzte", methods=["GET"])
def letzte_einstellungen():
    film_nummer = request.args.get("film_nummer")

    with _lock:
        db = load_db()

    letzte = None
    if film_nummer:
        film = db["films"].get(str(film_nummer))
        aufnahmen = film.get("aufnahmen", []) if film else []
        if aufnahmen:
            letzte = aufnahmen[-1]
    else:
        for film in db["films"].values():
            for eintrag in film.get("aufnahmen", []):
                if letzte is None or (eintrag.get("aufgenommen_am") or "") > (letzte.get("aufgenommen_am") or ""):
                    letzte = eintrag

    if not letzte:
        return jsonify({})

    return jsonify({
        "objektiv": letzte.get("objektiv"),
        "belichtungszeit": letzte.get("belichtungszeit"),
        "blende": letzte.get("blende"),
        "motiv": letzte.get("motiv"),
    })


def _slugify(text):
    text = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    return re.sub(r"[-\s]+", "-", text) or "film"

@app.route("/client/download", methods=["GET"])
def download_client():
    if not os.path.isdir(CLIENT_DIR):
        return jsonify({"error": "Client-Ordner nicht gefunden."}), 404

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for dateiname in os.listdir(CLIENT_DIR):
            pfad = os.path.join(CLIENT_DIR, dateiname)
            if os.path.isfile(pfad):
                zf.write(pfad, arcname=dateiname)
    buffer.seek(0)

    return Response(
        buffer.read(),
        mimetype="application/zip",
        headers={"Content-Disposition": 'attachment; filename="filmlog-exif-writer.zip"'},
    )

@app.route("/api/films/<int:nummer>/export", methods=["GET"])
def export_film(nummer):
    with _lock:
        db = load_db()
    film = db["films"].get(str(nummer))
    if not film:
        return jsonify({"error": "Film nicht gefunden."}), 404

    nr_str = str(nummer).zfill(3)
    lines = [
        f"FILM NR. {nr_str}",
        f"{film['name']} — {film['kamera']}",
        f"Ablaufjahr: {film.get('ablaufdatum') or '–'}",
        f"Angelegt: {film.get('angelegt_am') or '–'}",
        f"Status: {film['status']}"
        + (f" ({film['abgeschlossen_am']})" if film.get("abgeschlossen_am") else ""),
        "-" * 60,
        "",
    ]

    aufnahmen = film.get("aufnahmen", [])
    if not aufnahmen:
        lines.append("(keine Aufnahmen)")
    for idx, a in enumerate(aufnahmen, start=1):
        lines.append(f"Bild {idx:02d}  |  {a.get('datum') or ''} {a.get('uhrzeit') or ''}  |  {a.get('ort_text') or '–'}")
        details = []
        if a.get("objektiv"):
            details.append(f"Objektiv: {a['objektiv']}")
        if a.get("belichtungszeit"):
            details.append(f"Belichtungszeit: {a['belichtungszeit']}")
        if a.get("blende"):
            details.append(f"Blende: {a['blende']}")
        if details:
            lines.append("  " + "  ·  ".join(details))
        if a.get("motiv"):
            lines.append(f"  Motiv: {a['motiv']}")
        lines.append("")

    content = "\n".join(lines)
    filename = f"film_{nr_str}_{_slugify(film['name'])}.txt"
    return Response(
        content,
        mimetype="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


CERT_FILE = os.environ.get("FILMLOG_CERT_FILE", os.path.join(BASE_DIR, "certs", "cert.pem"))
KEY_FILE = os.environ.get("FILMLOG_KEY_FILE", os.path.join(BASE_DIR, "certs", "key.pem"))

if __name__ == "__main__":
    load_db()
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        app.run(host="0.0.0.0", port=5000, debug=False, ssl_context=(CERT_FILE, KEY_FILE))
    else:
        app.run(host="0.0.0.0", port=5000, debug=False)