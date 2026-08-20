import os
import re
import threading
from datetime import datetime

import yaml
from flask import Flask, Response, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "db.yaml")
OPTIONEN_PATH = os.path.join(DATA_DIR, "optionen.yaml")

KATEGORIEN = {
    "filme": "Filme",
    "kameras": "Kameras",
    "objektive": "Objektive",
    "brennweiten": "Brennweiten",
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
        "brennweiten": ["50mm", "58mm"],
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
        "anzahl_aufnahmen": len(film.get("aufnahmen", [])),
        "kapazitaet": film.get("kapazitaet"),
        "entwickelt": film.get("entwickelt", False),
        "filmtyp": film.get("filmtyp"),
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
    kapazitaet = None
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
        save_db(db)
        data = film_summary(str(nummer), film)
    return jsonify(data)


@app.route("/api/films/<int:nummer>/entwickelt", methods=["DELETE"])
def entferne_entwickelt_markierung(nummer):
    with _lock:
        db = load_db()
        film = db["films"].get(str(nummer))
        if not film:
            return jsonify({"error": "Film nicht gefunden."}), 404
        film["entwickelt"] = False
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

        eintrag = {
            "datum": (payload.get("datum") or "").strip(),
            "uhrzeit": (payload.get("uhrzeit") or "").strip(),
            "ort_text": (payload.get("ort_text") or "").strip() or None,
            "ort_lat": payload.get("ort_lat"),
            "ort_lon": payload.get("ort_lon"),
            "objektiv": (payload.get("objektiv") or "").strip() or None,
            "brennweite": (payload.get("brennweite") or "").strip() or None,
            "belichtungszeit": (payload.get("belichtungszeit") or "").strip() or None,
            "blende": (payload.get("blende") or "").strip() or None,
            "motiv": (payload.get("motiv") or "").strip() or None,
            "aufgenommen_am": datetime.now().isoformat(timespec="seconds"),
        }
        film.setdefault("aufnahmen", []).append(eintrag)
        save_db(db)
        frame_nr = len(film["aufnahmen"])

    result = dict(eintrag)
    result["film_nummer"] = film_nummer
    result["film_name"] = film["name"]
    result["frame_nr"] = frame_nr
    return jsonify(result), 201

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
            row["film_name"] = film["name"]
            row["frame_nr"] = idx
            alle.append(row)

    alle.sort(key=lambda r: r.get("aufgenommen_am") or "", reverse=True)
    return jsonify(alle[:limit])

UNSORTIERTE_KATEGORIEN = {"brennweiten", "belichtungszeiten", "blenden", "kameras", "objektive", "filme"}


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
        "brennweite": letzte.get("brennweite"),
        "belichtungszeit": letzte.get("belichtungszeit"),
        "blende": letzte.get("blende"),
        "motiv": letzte.get("motiv"),
    })


def _slugify(text):
    text = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    return re.sub(r"[-\s]+", "-", text) or "film"


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
        if a.get("brennweite"):
            details.append(f"Brennweite: {a['brennweite']}")
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
