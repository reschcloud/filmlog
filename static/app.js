(() => {
  const views = document.querySelectorAll(".view");
  const backBtn = document.getElementById("backBtn");
  let vorausgewaehlterFilm = null;
  let statsZeitraum = "30";   // gewaehlter Stats-Zeitraum, bleibt beim Wechsel der Ansicht erhalten

  const VALID_VIEWS = Array.from(views).map(v => v.dataset.view);

  // Ansicht plus optionale Parameter, z. B. navigate("film-detail", 12, 5) -> #film-detail/12/5
  function navigate(name, ...params) {
    const ziel = [name, ...params.filter(p => p !== undefined)].join("/");
    if (location.hash.slice(1) === ziel) {
      showView(name, ...params);
    } else {
      location.hash = ziel;
    }
  }

  function parseHash() {
    const [name, param, param2] = location.hash.slice(1).split("/");
    return { name: VALID_VIEWS.includes(name) ? name : "start", param, param2 };
  }

  window.addEventListener("hashchange", () => {
    const { name, param, param2 } = parseHash();
    showView(name, param, param2);
  });

  function showView(name, param, param2) {
    views.forEach(v => v.hidden = v.dataset.view !== name);
    if (backBtn) backBtn.hidden = name === "start";
    if (name === "film-detail") initFilmDetail(param, param2);
    if (name === "start") initStart();
    if (name === "neuer-film") initNeuerFilm();
    if (name === "neue-aufnahme") initNeueAufnahme();
    if (name === "film-abschliessen") initFilmAbschliessen();
    if (name === "zuletzt") initZuletzt();
    if (name === "downloads") initDownloads();
    if (name === "auswahllisten") initAuswahllisten();
    if (name === "stats") initStats();
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  document.querySelectorAll("[data-nav]").forEach(el => {
    el.addEventListener("click", () => navigate(el.dataset.nav));
  });
  if (backBtn) backBtn.addEventListener("click", () => navigate("start"));

  function pad(n) { return String(n).padStart(2, "0"); }
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function nowTimeStr() {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function api(path, options) {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Unbekannter Fehler");
    return data;
  }

  function showError(container, message) {
    const p = document.createElement("p");
    p.className = "error-msg";
    p.textContent = message;
    container.prepend(p);
    setTimeout(() => p.remove(), 5000);
  }

  // ---------- Auswahllisten (Optionen) ----------
  const KATEGORIE_LABELS = {
    filme: "Filme",
    kameras: "Kameras",
    objektive: "Objektive",
    belichtungszeiten: "Belichtungszeiten",
    blenden: "Blenden",
  };
  const PFLICHT_KATEGORIEN = new Set(["filme", "kameras"]);

  function fillSelectRequired(select, values, emptyLabel) {
    if (!values.length) {
      select.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>`;
      return;
    }
    select.innerHTML = values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  }

  function fillSelectOptional(select, values, selected) {
    select.innerHTML = `<option value="">– keine Angabe –</option>`
      + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    if (selected && values.includes(selected)) select.value = selected;
  }

  async function handleAddClick(btn) {
    const kategorie = btn.dataset.kategorie;
    const select = document.getElementById(btn.dataset.target);
    const wert = prompt(`Neuen Wert für „${KATEGORIE_LABELS[kategorie] || kategorie}" eingeben:`);
    if (wert === null) return;
    const trimmed = wert.trim();
    if (!trimmed) return;
    try {
      const liste = await api(`/api/optionen/${kategorie}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wert: trimmed }),
      });
      if (PFLICHT_KATEGORIEN.has(kategorie)) {
        fillSelectRequired(select, liste, "");
      } else {
        fillSelectOptional(select, liste, trimmed);
      }
      select.value = trimmed;
    } catch (err) {
      alert(err.message);
    }
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".add-btn");
    if (btn) handleAddClick(btn);
  });

  async function initAuswahllisten() {
    const container = document.getElementById("auswahllistenContainer");
    container.innerHTML = `<p class="empty-state">Wird geladen …</p>`;
    let optionen;
    try {
      optionen = await api("/api/optionen");
    } catch (err) {
      container.innerHTML = `<p class="error-msg">${escapeHtml(err.message)}</p>`;
      return;
    }

    container.innerHTML = Object.entries(KATEGORIE_LABELS).map(([kategorie, label]) => `
      <div class="optionen-card">
        <h2>${label}</h2>
        <ul class="optionen-liste">
          ${optionen[kategorie].length
            ? optionen[kategorie].map(v => `
                <li>
                  <span>${escapeHtml(v)}</span>
                  <button type="button" class="del-btn" data-kategorie="${kategorie}" data-wert="${escapeHtml(v)}" title="Entfernen">×</button>
                </li>`).join("")
            : `<li class="empty-state">Noch keine Werte</li>`}
        </ul>
        <form class="optionen-add-row" data-kategorie="${kategorie}">
          <input type="text" placeholder="Neuer Wert" required>
          <button type="submit">+</button>
        </form>
      </div>
    `).join("");

    container.querySelectorAll(".optionen-add-row").forEach(form => {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const input = form.querySelector("input");
        const wert = input.value.trim();
        if (!wert) return;
        try {
          await api(`/api/optionen/${form.dataset.kategorie}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wert }),
          });
          initAuswahllisten();
        } catch (err) {
          alert(err.message);
        }
      };
    });

    container.querySelectorAll(".del-btn").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm(`„${btn.dataset.wert}" wirklich aus der Liste entfernen?`)) return;
        try {
          await api(`/api/optionen/${btn.dataset.kategorie}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wert: btn.dataset.wert }),
          });
          initAuswahllisten();
        } catch (err) {
          alert(err.message);
        }
      };
    });
  }

  // ---------- Startseite (Dashboard) ----------
  async function initStart() {
    const container = document.getElementById("startDashboard");
    container.innerHTML = `<p class="empty-state">Wird geladen …</p>`;
    try {
      const filme = await api("/api/films?status=offen&sortierung=zuletzt_genutzt");
      container.innerHTML = filme.length
        ? `<div class="dashboard-grid">${filme.map(f => {
          const voll = f.kapazitaet && f.anzahl_aufnahmen >= f.kapazitaet;
          const balken = f.kapazitaet
            ? `<div class="dashboard-fill-track"><div class="dashboard-fill-bar${voll ? " dashboard-fill-voll" : ""}" style="width:${Math.min(100, Math.round(f.anzahl_aufnahmen / f.kapazitaet * 100))}%"></div></div>`
            : "";
          const eckeKlasse = f.filmtyp === "sw" ? "dashboard-typ-sw" : f.filmtyp === "farbe" ? "dashboard-typ-farbe" : "";
          const verbleibend = f.kapazitaet ? Math.max(0, f.kapazitaet - f.anzahl_aufnahmen) : null;
          const jetzt = new Date().getFullYear();
          const jahreAbgelaufen = f.ablaufdatum ? jetzt - parseInt(f.ablaufdatum, 10) : 0;
          const ablaufPille = jahreAbgelaufen > 0
            ? `<span class="ablauf-pille">${jahreAbgelaufen} Jahr${jahreAbgelaufen === 1 ? "" : "e"}</span>`
            : "";
          return `
            <div class="dashboard-card" data-film-nummer="${f.nummer}">
              ${eckeKlasse ? `<div class="dashboard-typ-ecke ${eckeKlasse}"></div>` : ""}
              ${voll ? `<button type="button" class="dashboard-done-btn" data-nummer="${f.nummer}" data-kamera="${escapeHtml(f.kamera)}" title="Film abschließen">✓</button>` : ""}
              <div class="dashboard-info">
                <div class="dashboard-kamera">${escapeHtml(f.kamera)}</div>
                <div class="dashboard-film">${escapeHtml(f.name)} #${f.nummer} ${ablaufPille}</div>
              </div>
              <div class="dashboard-right">
                <div class="dashboard-count">${f.anzahl_aufnahmen}${f.kapazitaet ? `<span class="dashboard-max">/${f.kapazitaet}</span>` : ""}</div>
                ${balken}
              </div>
            </div>
          `;
        }).join("")}</div>`
        : `<p class="empty-state">Lege einen neuen Film an, um zu beginnen.</p>`;

      container.querySelectorAll(".dashboard-card").forEach(card => {
        card.onclick = () => {
          vorausgewaehlterFilm = Number(card.dataset.filmNummer);
          navigate("neue-aufnahme");
        };
      });
      container.querySelectorAll(".dashboard-done-btn").forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const nummer = btn.dataset.nummer;
          const kamera = btn.dataset.kamera;
          if (!confirm(`Film #${nummer} (${kamera}) wirklich abschließen?`)) return;
          try {
            await api(`/api/films/${nummer}/complete`, { method: "POST" });
            initStart();
          } catch (err) {
            alert(err.message);
          }
        };
      });
    } catch (err) {
      container.innerHTML = `<p class="error-msg">${escapeHtml(err.message)}</p>`;
    }
    const letzteContainer = document.getElementById("letzteAufnahme");
    try {
      const liste = await api("/api/aufnahmen/recent?limit=1");
      if (liste.length) {
        const alterMs = Date.now() - new Date(liste[0].aufgenommen_am).getTime();
        const frisch = alterMs <= 2 * 60 * 1000;
        letzteContainer.innerHTML = `<p class="dashboard-label">Zuletzt${frisch ? ` <span class="frisch-punkt" title="Vor weniger als 2 Minuten aufgenommen"></span>` : ""}</p>${renderFrames(liste, true)}`;
        letzteContainer.querySelector(".frame").onclick = () => navigate("zuletzt");
      } else {
        letzteContainer.innerHTML = "";
      }
    } catch (err) {
      letzteContainer.innerHTML = "";
    }
    const downloadsDesc = document.getElementById("downloadsTileDesc");
    try {
      const abgeschlosseneFilme = await api("/api/films?status=abgeschlossen");
      const nichtEntwickelt = abgeschlosseneFilme.filter(f => !f.entwickelt);
      const anzahlSw = nichtEntwickelt.filter(f => f.filmtyp === "sw").length;
      const anzahlFarbe = nichtEntwickelt.filter(f => f.filmtyp === "farbe").length;

      downloadsDesc.textContent = nichtEntwickelt.length
        ? `Zu entwickeln: 🏁 ${anzahlSw} · 🌈 ${anzahlFarbe}`
        : "Protokolle abgeschlossener Filme herunterladen";
    } catch (err) {
      // Original-Text bleibt stehen, kein Blockieren der Startseite.
    }
  }

  // ---------- Neuer Film ----------
  async function initNeuerFilm() {
    const form = document.getElementById("formNeuerFilm");
    const result = document.getElementById("neuerFilmResult");
    const filmnameSelect = document.getElementById("filmnameSelect");
    const kameraSelect = document.getElementById("kameraSelect");
    result.hidden = true;
    form.reset();
    document.getElementById("ablaufjahrInput").value = new Date().getFullYear() + 1;

    try {
      const optionen = await api("/api/optionen");
      fillSelectRequired(filmnameSelect, optionen.filme, "– noch keine Filme definiert, bitte über + hinzufügen –");
      fillSelectRequired(kameraSelect, optionen.kameras, "– noch keine Kameras definiert, bitte über + hinzufügen –");
    } catch (err) {
      showError(form, "Auswahllisten konnten nicht geladen werden.");
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd);
      if (!payload.name || !payload.kamera) {
        showError(form, "Bitte Filmname und Kamera auswählen.");
        return;
      }
      if (!payload.kapazitaet || Number(payload.kapazitaet) <= 0) {
        showError(form, "Bitte Anzahl Aufnahmen angeben.");
        return;
      }
      try {
        await api("/api/films", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        showView("start");
      } catch (err) {
        showError(form, err.message);
      }
    };
  }

  function filmtypEmoji(typ) {
    if (typ === "sw") return "🖤";
    if (typ === "farbe") return "🌈";
    return "";
  }

  // ---------- Neue Aufnahme ----------
  async function initNeueAufnahme() {
    const form = document.getElementById("formNeueAufnahme");
    const result = document.getElementById("neueAufnahmeResult");
    const filmSelect = document.getElementById("filmSelect");
    const gpsStatus = document.getElementById("gpsStatus");
    const ortText = document.getElementById("ortText");
    const objektivSelect = document.getElementById("objektivSelect");
    const belichtungszeitSelect = document.getElementById("belichtungszeitSelect");
    const blendeSelect = document.getElementById("blendeSelect");
    result.hidden = true;
    form.reset();
    form.datum.value = todayStr();
    form.uhrzeit.value = nowTimeStr();
    document.getElementById("jetztBtn").onclick = () => {
      form.datum.value = todayStr();
      form.uhrzeit.value = nowTimeStr();
    };
    document.getElementById("motivLoeschenBtn").onclick = () => {
      form.motiv.value = "";
      form.motiv.focus();
    };
    document.getElementById("anzahlMinus").onclick = () => {
      const input = document.getElementById("anzahlInput");
      input.value = Math.max(1, parseInt(input.value, 10) - 1);
    };
    document.getElementById("anzahlPlus").onclick = () => {
      const input = document.getElementById("anzahlInput");
      input.value = Math.min(50, parseInt(input.value, 10) + 1);
    };
    let lat = null, lon = null;

    filmSelect.innerHTML = `<option>Filme werden geladen …</option>`;
    try {
      const filme = await api("/api/films?status=offen");
      if (filme.length === 0) {
        filmSelect.innerHTML = `<option value="">Kein offener Film — bitte zuerst einen anlegen</option>`;
      } else {
        filmSelect.innerHTML = filme
          .map(f => `<option value="${f.nummer}">${escapeHtml(f.kamera)} (${escapeHtml(f.name)}) </option>`)
          .join("");
      }
    } catch (err) {
      filmSelect.innerHTML = `<option value="">Fehler beim Laden</option>`;
    }

    if (vorausgewaehlterFilm !== null) {
      filmSelect.value = vorausgewaehlterFilm;
      vorausgewaehlterFilm = null;
    }

    let optionen = { objektive: [], belichtungszeiten: [], blenden: [] };
    try {
      optionen = await api("/api/optionen");
    } catch (err) {
      showError(form, "Auswahllisten konnten nicht geladen werden.");
    }
    fillSelectOptional(objektivSelect, optionen.objektive);
    fillSelectOptional(belichtungszeitSelect, optionen.belichtungszeiten);
    fillSelectOptional(blendeSelect, optionen.blenden);

    async function ladeLetzteEinstellungen(filmNummer) {
      if (!filmNummer) return;
      try {
        const letzte = await api(`/api/einstellungen/letzte?film_nummer=${filmNummer}`);
        fillSelectOptional(objektivSelect, optionen.objektive, letzte.objektiv);
        fillSelectOptional(belichtungszeitSelect, optionen.belichtungszeiten, letzte.belichtungszeit);
        fillSelectOptional(blendeSelect, optionen.blenden, letzte.blende);
        form.motiv.value = letzte.motiv || "";
      } catch (err) {
        // Vorbefüllung ist ein Komfort-Feature, kein Grund das Formular zu blockieren.
      }
    }

    filmSelect.onchange = () => ladeLetzteEinstellungen(filmSelect.value);
    await ladeLetzteEinstellungen(filmSelect.value);

    if ("geolocation" in navigator) {
      gpsStatus.textContent = "GPS wird ermittelt …";
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
          gpsStatus.textContent = `GPS: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
          if (!ortText.value) ortText.value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        },
        () => { gpsStatus.textContent = "GPS nicht verfügbar — bitte Ort manuell eingeben."; },
        { timeout: 8000 }
      );
    } else {
      gpsStatus.textContent = "GPS wird von diesem Browser nicht unterstützt.";
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd);
      payload.ort_lat = lat;
      payload.ort_lon = lon;
      const anzahl = Math.max(1, parseInt(payload.anzahl, 10) || 1);
      delete payload.anzahl;
      try {
        for (let i = 0; i < anzahl; i++) {
          await api("/api/aufnahmen", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        }
        showView("start");
      } catch (err) {
        showError(form, err.message);
      }
    };
  }

  // ---------- Film abschließen ----------
  async function initFilmAbschliessen() {
    const form = document.getElementById("formFilmAbschliessen");
    const select = document.getElementById("filmAbschliessenSelect");
    const result = document.getElementById("filmAbschliessenResult");
    result.hidden = true;
    result.innerHTML = "";

    select.innerHTML = `<option>Filme werden geladen …</option>`;
    try {
      const filme = await api("/api/films?status=offen");
      if (filme.length === 0) {
        select.innerHTML = `<option value="">Kein offener Film vorhanden</option>`;
      } else {
        select.innerHTML = filme
          .map(f => `<option value="${f.nummer}" data-kamera="${escapeHtml(f.kamera)}">${escapeHtml(f.kamera)} (${escapeHtml(f.name)} #${String(f.nummer)}) ${f.anzahl_aufnahmen} Aufnahmen</option>`)
          .join("");
      }
    } catch (err) {
      select.innerHTML = `<option value="">Fehler beim Laden</option>`;
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      const nummer = select.value;
      if (!nummer) return;
      const kamera = select.options[select.selectedIndex].dataset.kamera;
      if (!confirm(`Film #${nummer} (${kamera}) wirklich abschließen? Danach können keine weiteren Aufnahmen mehr hinzugefügt werden.`)) return;
      try {
        await api(`/api/films/${nummer}/complete`, { method: "POST" });
        showView("start");
      } catch (err) {
        showError(form, err.message);
      }
    };
  }

  // ---------- Zuletzt ----------
  async function initZuletzt() {
    const container = document.getElementById("zuletztListe");
    const filterSelect = document.getElementById("zuletztFilterSelect");
    const SCHRITT = 25;                                  // so viele Eintraege kommen pro Klick dazu
    const startLimit = () => (filterSelect.value ? 36 : SCHRITT);   // gefiltert: ein ganzer Film
    let anzeigeLimit = startLimit();

    if (!filterSelect.dataset.geladen) {
      filterSelect.innerHTML = `<option value="">Alle</option>`;
      try {
        const filme = await api("/api/films?status=offen");
        filterSelect.innerHTML += filme
          .map(f => `<option value="${f.nummer}">${escapeHtml(f.kamera)} (${escapeHtml(f.name)} #${f.nummer})</option>`)
          .join("");
      } catch (err) {
        // Filter-Liste ist ein Komfort-Feature, kein Grund die Ansicht zu blockieren.
      }
      filterSelect.dataset.geladen = "true";
    }
    // bei jedem Aufruf neu zuweisen, damit der Handler zum aktuellen Zustand (anzeigeLimit) gehoert
    filterSelect.onchange = () => ladeZuletztListe(true);

    function karteHtml(a, i) {
      const eckeKlasse = a.film_typ === "sw" ? "dashboard-typ-sw" : a.film_typ === "farbe" ? "dashboard-typ-farbe" : "";
      return `
        <div class="eintrag eintrag-zuletzt">
          ${eckeKlasse ? `<div class="dashboard-typ-ecke ${eckeKlasse}"></div>` : ""}
          <div class="eintrag-info">
            <div class="eintrag-motiv">${a.motiv ? escapeHtml(a.motiv) : "(kein Motiv)"}</div>
            <div class="eintrag-film">${escapeHtml(a.film_kamera)} · ${escapeHtml(a.film_name)}</div>
            <div class="eintrag-meta">${aufnahmeMetaText(a)}</div>
          </div>
          <div class="eintrag-aktionen">
            ${a.film_archiviert ? "" : `<button type="button" class="eintrag-edit-btn" data-i="${i}" title="Bearbeiten">✏️</button>`}
            <button type="button" class="eintrag-del-btn" data-i="${i}" title="Löschen">🗑️</button>
          </div>
        </div>`;
    }

    // neu = true: von vorn beginnen (Aufruf der Ansicht, Filterwechsel); sonst Limit beibehalten bzw. erhoehen
    async function ladeZuletztListe(neu) {
      if (neu) {
        anzeigeLimit = startLimit();
        container.innerHTML = `<p class="empty-state">Wird geladen …</p>`;
      }
      const filmNummer = filterSelect.value;
      try {
        // einen Eintrag mehr anfordern als angezeigt wird: so erkennt man, ob es weitere gibt
        const url = `/api/aufnahmen/recent?limit=${anzeigeLimit + 1}` + (filmNummer ? `&film_nummer=${filmNummer}` : "");
        const geladen = await api(url);
        const gibtMehr = geladen.length > anzeigeLimit;
        const liste = geladen.slice(0, anzeigeLimit);
        if (!liste.length) {
          container.innerHTML = `<p class="empty-state">Noch keine Aufnahmen protokolliert.</p>`;
          return;
        }

        const heute = todayStr();
        const gruppe = (titel, test) => {
          const karten = liste.map((a, i) => (test(a) ? karteHtml(a, i) : "")).join("");
          return karten
            ? `<p class="dashboard-label">${titel}</p><div class="eintraege-liste eintraege-liste-abstand">${karten}</div>`
            : "";
        };
        container.innerHTML = `
          ${gruppe("Heute", a => a.datum === heute)}
          ${gruppe("Älter", a => a.datum !== heute)}
          ${gibtMehr ? `<button type="button" class="mehr-anzeigen-btn">Mehr anzeigen</button>` : ""}
        `;

        // Bearbeiten: in die Detailansicht des Films springen, die gleich das Formular dieser Aufnahme oeffnet
        container.querySelectorAll(".eintrag-edit-btn").forEach(btn => {
          btn.onclick = () => {
            const a = liste[Number(btn.dataset.i)];
            navigate("film-detail", a.film_nummer, a.frame_nr);
          };
        });

        container.querySelectorAll(".eintrag-del-btn").forEach(btn => {
          btn.onclick = async () => {
            const a = liste[Number(btn.dataset.i)];
            const bezeichnung = a.motiv || `Aufnahme ${a.frame_nr}`;
            if (!confirm(`„${bezeichnung}" (${a.film_kamera} · ${a.film_name}, Nr. ${a.frame_nr}) wirklich löschen? Die folgenden Aufnahmen dieses Films rücken nach.`)) return;
            try {
              await api(`/api/films/${a.film_nummer}/aufnahmen/${a.frame_nr}`, { method: "DELETE" });
              await ladeZuletztListe(false);   // gleiche Laenge wie vorher, kein Zurueckspringen
              initStart();
            } catch (err) {
              alert(err.message);
            }
          };
        });

        const mehrBtn = container.querySelector(".mehr-anzeigen-btn");
        if (mehrBtn) {
          mehrBtn.onclick = async () => {
            mehrBtn.disabled = true;          // verhindert Doppelklick
            anzeigeLimit += SCHRITT;
            await ladeZuletztListe(false);    // Liste bleibt stehen, bis die neue da ist
          };
        }
      } catch (err) {
        if (neu) {
          container.innerHTML = `<p class="error-msg">${escapeHtml(err.message)}</p>`;
        } else {
          // beim Nachladen die vorhandene Liste nicht wegwerfen
          alert(err.message);
          anzeigeLimit = Math.max(startLimit(), anzeigeLimit - SCHRITT);
          const btn = container.querySelector(".mehr-anzeigen-btn");
          if (btn) btn.disabled = false;
        }
      }
    }

    await ladeZuletztListe(true);
  }

  // ---------- Stats: Aufnahmen pro Filmtyp und Kamera ----------
  async function initStats() {
    const container = document.getElementById("statsInhalt");
    const tabs = document.querySelectorAll(".stats-tab");
    const markiereTab = key => tabs.forEach(btn => btn.classList.toggle("aktiv", btn.dataset.zeitraum === key));

    markiereTab(statsZeitraum);
    container.innerHTML = `<p class="empty-state">Wird geladen …</p>`;

    let daten;
    try {
      daten = await api("/api/stats");
    } catch (err) {
      container.innerHTML = `<p class="error-msg">${escapeHtml(err.message)}</p>`;
      return;
    }

    // Eine Rangliste (die Liste kommt vom Server bereits absteigend sortiert).
    function rangliste(titel, eintraege) {
      if (!eintraege.length) return "";
      // Eintraege mit Filmtyp (nur die Filmstock-Listen) bekommen die Typ-Ecke wie auf den anderen Karten
      const eckeKlasse = e => e.filmtyp === "sw" ? "dashboard-typ-sw" : e.filmtyp === "farbe" ? "dashboard-typ-farbe" : "";
      const zeilen = eintraege.map(e => `
        <div class="stats-zeile">
          ${eckeKlasse(e) ? `<div class="dashboard-typ-ecke ${eckeKlasse(e)}"></div>` : ""}
          <div class="stats-kopf">
            <span class="stats-name">${escapeHtml(e.name)}</span>
            <span class="stats-anzahl">${e.anzahl}</span>
          </div>
        </div>`).join("");
      return `<p class="dashboard-label">${titel}</p><div class="stats-karte">${zeilen}</div>`;
    }

    function render() {
      const z = daten.zeitraeume.find(x => x.key === statsZeitraum) || daten.zeitraeume[0];
      markiereTab(z.key);
      // Summe der Rollen steht hinter der Summe der Aufnahmen (fehlt sie in der Antwort, bleibt es bei den Aufnahmen)
      const rollenText = z.gesamt_rollen != null
        ? ` · <span>${z.gesamt_rollen}</span> ${z.gesamt_rollen === 1 ? "Rolle" : "Rollen"}`
        : "";
      container.innerHTML = (z.gesamt || z.gesamt_rollen)
        ? `<p class="stats-gesamt"><span>${z.gesamt}</span> ${z.gesamt === 1 ? "Aufnahme" : "Aufnahmen"}${rollenText}</p>`
          + rangliste("Filmtyp", z.filmtypen)
          + rangliste("Kamera", z.kameras)
          + rangliste("Filmstock", z.filmstocks || [])
          + rangliste("Rollen pro Filmstock", z.rollen_filmstocks || [])
        : `<p class="empty-state">Keine Aufnahmen in diesem Zeitraum.</p>`;
    }

    // Umschalten rechnet nur neu aus den schon geladenen Daten, ohne neue Anfrage
    tabs.forEach(btn => {
      btn.onclick = () => {
        statsZeitraum = btn.dataset.zeitraum;
        render();
      };
    });
    render();
  }

  // ---------- Downloads ----------
  async function initDownloads() {
    const container = document.getElementById("downloadsListe");
    const archivCheckbox = document.getElementById("archivCheckbox");
    archivCheckbox.onchange = () => initDownloads();

    container.innerHTML = `<p class="empty-state">Wird geladen …</p>`;
    try {
      const filme = await api("/api/films?status=abgeschlossen");
      if (!filme.length) {
        container.innerHTML = `<p class="empty-state">Noch kein Film abgeschlossen.</p>`;
        return;
      }

      const sortierDatum = f => f.abgeschlossen_am || f.angelegt_am || "";
      filme.sort((a, b) => sortierDatum(b).localeCompare(sortierDatum(a)));
      const zeile = f => {
        const eckeKlasse = f.filmtyp === "sw" ? "dashboard-typ-sw" : f.filmtyp === "farbe" ? "dashboard-typ-farbe" : "";
        const abgeschlossenDatum = (f.abgeschlossen_am || "").slice(0, 10);
        const angelegtDatum = (f.angelegt_am || "").slice(0, 10);
        const entwickeltDatum = (f.entwickelt_am || "").slice(0, 10);
        const ablaufPille = `<span class="ablauf-pille">${f.ablaufdatum}</span>`;
        const bearbeitbar = !f.archiviert;
        return `
          <div class="download-row${bearbeitbar ? " download-row-klickbar" : ""}" data-nummer="${f.nummer}">
            ${eckeKlasse ? `<div class="dashboard-typ-ecke ${eckeKlasse}"></div>` : ""}
            <div class="download-row-info">
              <div class="download-row-title">#${String(f.nummer)} — ${escapeHtml(f.name)}</div>
              <div class="download-row-meta">${escapeHtml(f.kamera)} · ${f.anzahl_aufnahmen} Aufnahmen${ablaufPille}</div>
              ${angelegtDatum ? `<div class="download-row-meta">Angelegt: ${angelegtDatum}</div>` : ""}
              ${f.entwickelt && entwickeltDatum ? `<div class="download-row-meta">Entwickelt: ${entwickeltDatum}</div>` : ""}
            </div>
            <div class="download-row-actions">
              ${bearbeitbar ? `<button type="button" class="edit-icon-btn" data-nummer="${f.nummer}" title="Aufnahmen ansehen und bearbeiten">✏️</button>` : ""}
              <a class="download-btn" href="/api/films/${f.nummer}/export" download title="Als CSV-Liste herunterladen">📥</a>
              ${!f.entwickelt ? `<button type="button" class="entwickeln-btn" data-nummer="${f.nummer}">Entwickelt</button>` : ""}
              ${f.entwickelt ? `<button type="button" class="archivieren-btn" data-nummer="${f.nummer}" data-archiviert="${f.archiviert ? "1" : "0"}">${f.archiviert ? "Dearchivieren" : "Archivieren"}</button>` : ""}
            </div>
          </div>
        `;
      };

      const sichtbar = filme.filter(f => !f.archiviert);
      const archiviert = filme.filter(f => f.archiviert);
      const nichtEntwickelt = sichtbar.filter(f => !f.entwickelt);
      const entwickelt = sichtbar.filter(f => f.entwickelt);

      let html = "";
      html += nichtEntwickelt.length ? `<p class="dashboard-label">Nicht entwickelt</p>${nichtEntwickelt.map(zeile).join("")}` : "";
      html += entwickelt.length ? `<p class="dashboard-label">Entwickelt</p>${entwickelt.map(zeile).join("")}` : "";

      if (archivCheckbox.checked && archiviert.length) {
        const nachJahr = {};
        archiviert.forEach(f => {
          const jahr = (f.abgeschlossen_am || f.angelegt_am || "").slice(0, 4) || "Unbekannt";
          (nachJahr[jahr] = nachJahr[jahr] || []).push(f);
        });
        const jahre = Object.keys(nachJahr).sort((a, b) => b.localeCompare(a));
        html += `<p class="dashboard-label">Archiviert</p>`;
        jahre.forEach(jahr => {
          html += `<p class="dashboard-label dashboard-label-jahr">${jahr}</p>${nachJahr[jahr].map(zeile).join("")}`;
        });
      }

      container.innerHTML = html || `<p class="empty-state">Noch kein Film abgeschlossen.</p>`;

      // Tipp auf die Karte oeffnet die Detailansicht (die Aktions-Buttons behalten ihre eigene Funktion)
      container.querySelectorAll(".download-row-klickbar").forEach(row => {
        row.onclick = (e) => {
          if (e.target.closest(".download-row-actions")) return;
          navigate("film-detail", row.dataset.nummer);
        };
      });
      container.querySelectorAll(".edit-icon-btn").forEach(btn => {
        btn.onclick = () => navigate("film-detail", btn.dataset.nummer);
      });

      container.querySelectorAll(".reopen-btn").forEach(btn => {
        btn.onclick = async () => {
          const nummer = btn.dataset.nummer;
          if (!confirm(`Film #${nummer} wieder öffnen? Danach können erneut Aufnahmen hinzugefügt werden.`)) return;
          try {
            await api(`/api/films/${nummer}/reopen`, { method: "POST" });
            initDownloads();
          } catch (err) {
            alert(err.message);
          }
        };
      });

      container.querySelectorAll(".archivieren-btn").forEach(btn => {
        btn.onclick = async () => {
          const nummer = btn.dataset.nummer;
          const istArchiviert = btn.dataset.archiviert === "1";
          try {
            await api(`/api/films/${nummer}/archivieren`, { method: istArchiviert ? "DELETE" : "POST" });
            initDownloads();
          } catch (err) {
            alert(err.message);
          }
        };
      });

      container.querySelectorAll(".entwickeln-btn").forEach(btn => {
        btn.onclick = async () => {
          const nummer = btn.dataset.nummer;
          if (!confirm(`Film #${nummer} als entwickelt markieren?`)) return;
          try {
            await api(`/api/films/${nummer}/entwickelt`, { method: "POST" });
            initDownloads();
          } catch (err) {
            alert(err.message);
          }
        };
      });
    } catch (err) {
      container.innerHTML = `<p class="error-msg">${escapeHtml(err.message)}</p>`;
    }
  }

  // Meta-Zeile einer Aufnahme (Detailansicht und Zuletzt-Liste): Objektiv · Belichtung · Blende · Blitz · Datum · Ort
  function aufnahmeMetaText(a) {
    return [
      a.objektiv,
      a.belichtungszeit,
      a.blende,
      a.blitz ? "⚡" : "",
      `${a.datum || ""} ${a.uhrzeit || ""}`.trim(),
      a.ort_text,
    ].filter(Boolean).map(escapeHtml).join(" · ");
  }

  // ---------- Film-Detail: Aufnahmen ansehen, bearbeiten, einfuegen, loeschen ----------
  async function initFilmDetail(nummerParam, positionParam) {
    const nummer = parseInt(nummerParam, 10);
    const titel = document.getElementById("filmDetailTitel");
    const info = document.getElementById("filmDetailInfo");
    const liste = document.getElementById("filmDetailListe");

    if (!nummer) {
      location.replace("#downloads");
      return;
    }

    liste.innerHTML = `<p class="empty-state">Wird geladen …</p>`;
    titel.textContent = "";
    info.textContent = "";

    let film;
    let optionen;
    try {
      [film, optionen] = await Promise.all([api(`/api/films/${nummer}`), api("/api/optionen")]);
    } catch (err) {
      liste.innerHTML = `<p class="error-msg">${escapeHtml(err.message)}</p>`;
      return;
    }
    // Archivierte Filme sind nicht bearbeitbar (das Backend lehnt es ebenfalls ab).
    if (film.archiviert) {
      location.replace("#downloads");
      return;
    }

    const jsonHeader = { "Content-Type": "application/json" };
    // null | { typ: "edit" | "insert", position }  -> welches Formular gerade offen ist
    let modus = null;
    let beimOeffnenZentrieren = false;

    // Aus der Zuletzt-Liste: #film-detail/12/5 oeffnet gleich das Bearbeiten-Formular der Aufnahme 5
    const gewuenschtePosition = parseInt(positionParam, 10);
    if (gewuenschtePosition >= 1 && gewuenschtePosition <= film.aufnahmen.length) {
      modus = { typ: "edit", position: gewuenschtePosition };
      beimOeffnenZentrieren = true;
    }
    if (positionParam !== undefined) {
      // Adresse bereinigen (ohne neuen Verlaufseintrag), damit ein Neuladen nicht erneut das Formular oeffnet
      history.replaceState(null, "", `#film-detail/${nummer}`);
    }

    function zeileHtml(a, pos) {
      return `
        <div class="eintrag">
          <div class="eintrag-nr">${pos}</div>
          <div class="eintrag-info">
            <div class="eintrag-motiv">${a.motiv ? escapeHtml(a.motiv) : "(kein Motiv)"}</div>
            <div class="eintrag-meta">${aufnahmeMetaText(a)}</div>
          </div>
          <div class="eintrag-aktionen">
            <button type="button" class="eintrag-edit-btn" data-pos="${pos}" title="Bearbeiten">✏️</button>
            <button type="button" class="eintrag-del-btn" data-pos="${pos}" title="Löschen">🗑️</button>
          </div>
        </div>`;
    }

    function slotHtml(pos) {
      const text = film.aufnahmen.length === 0 ? "+ Aufnahme hinzufügen" : "+";
      return `<button type="button" class="eintrag-plus" data-pos="${pos}" title="Hier einfügen">${text}</button>`;
    }

    function formHtml(typ, pos) {
      const kopf = typ === "edit" ? `Aufnahme ${pos} bearbeiten` : `Neue Aufnahme als Nr. ${pos}`;
      return `
        <form class="card eintrag-form" data-typ="${typ}" data-pos="${pos}">
          <div class="eintrag-form-titel">${kopf}</div>
          <label>Motivbeschreibung
            <textarea name="motiv" rows="2" placeholder="Was ist auf dem Bild zu sehen?"></textarea>
          </label>
          <div class="field-row">
            <label>Objektiv
              <select name="objektiv"></select>
            </label>
            <label class="blitz-feld">
              <label class="blitz-toggle">
                <input type="checkbox" name="blitz">
                Blitz
              </label>
            </label>
          </div>
          <div class="field-row">
            <label>Belichtungszeit
              <select name="belichtungszeit"></select>
            </label>
            <label>Blende
              <select name="blende"></select>
            </label>
          </div>
          <div class="field-row">
            <label>Datum
              <input type="date" name="datum" required>
            </label>
            <label>Uhrzeit
              <input type="time" name="uhrzeit" required>
            </label>
          </div>
          <label>Ort
            <input type="text" name="ort_text" placeholder="Ort (nur Text)">
          </label>
          <div class="eintrag-form-aktionen">
            <button type="submit" class="btn-primary">Speichern</button>
            <button type="button" class="eintrag-abbrechen-btn">Abbrechen</button>
          </div>
        </form>`;
    }

    // Werte in ein offenes Formular schreiben. Ist ein vorhandener Wert nicht (mehr) in den
    // Auswahllisten, wird er trotzdem angeboten, damit er beim Speichern nicht verloren geht.
    function befuelleForm(form, werte) {
      const el = form.elements;
      const mitAktuell = (werteListe, aktuell) => {
        const basis = werteListe || [];
        return aktuell && !basis.includes(aktuell) ? [...basis, aktuell] : basis;
      };
      fillSelectOptional(el.objektiv, mitAktuell(optionen.objektive, werte.objektiv), werte.objektiv);
      fillSelectOptional(el.belichtungszeit, mitAktuell(optionen.belichtungszeiten, werte.belichtungszeit), werte.belichtungszeit);
      fillSelectOptional(el.blende, mitAktuell(optionen.blenden, werte.blende), werte.blende);
      el.motiv.value = werte.motiv || "";
      el.blitz.checked = !!werte.blitz;
      el.datum.value = werte.datum || "";
      el.uhrzeit.value = werte.uhrzeit || "";
      el.ort_text.value = werte.ort_text || "";
    }

    // Vorbelegung beim Einfuegen: Einstellungen, Datum und Uhrzeit vom Vorgaenger
    // (an Position 1 vom Nachfolger), Motiv/Blitz/Ort bleiben leer.
    function vorlageFuerEinfuegen(pos) {
      const nachbar = film.aufnahmen[pos - 2] || film.aufnahmen[pos - 1];
      if (!nachbar) return { datum: todayStr(), uhrzeit: nowTimeStr() };
      return {
        objektiv: nachbar.objektiv,
        belichtungszeit: nachbar.belichtungszeit,
        blende: nachbar.blende,
        datum: nachbar.datum,
        uhrzeit: nachbar.uhrzeit,
      };
    }

    async function laden() {
      film = await api(`/api/films/${nummer}`);
      render();
    }

    function bind() {
      liste.querySelectorAll(".eintrag-plus").forEach(btn => {
        btn.onclick = () => {
          modus = { typ: "insert", position: Number(btn.dataset.pos) };
          render();
        };
      });
      liste.querySelectorAll(".eintrag-edit-btn").forEach(btn => {
        btn.onclick = () => {
          modus = { typ: "edit", position: Number(btn.dataset.pos) };
          render();
        };
      });
      liste.querySelectorAll(".eintrag-del-btn").forEach(btn => {
        btn.onclick = async () => {
          const pos = Number(btn.dataset.pos);
          const bezeichnung = film.aufnahmen[pos - 1].motiv || `Aufnahme ${pos}`;
          if (!confirm(`„${bezeichnung}" (Nr. ${pos}) wirklich löschen? Die folgenden Aufnahmen rücken nach.`)) return;
          try {
            await api(`/api/films/${nummer}/aufnahmen/${pos}`, { method: "DELETE" });
            modus = null;
            await laden();
          } catch (err) {
            alert(err.message);
          }
        };
      });

      const form = liste.querySelector(".eintrag-form");
      if (!form) return;
      const pos = Number(form.dataset.pos);
      const typ = form.dataset.typ;
      befuelleForm(form, typ === "edit" ? film.aufnahmen[pos - 1] : vorlageFuerEinfuegen(pos));

      form.querySelector(".eintrag-abbrechen-btn").onclick = () => {
        modus = null;
        render();
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const el = form.elements;
        const werte = {
          motiv: el.motiv.value,
          objektiv: el.objektiv.value,
          belichtungszeit: el.belichtungszeit.value,
          blende: el.blende.value,
          blitz: el.blitz.checked,
          datum: el.datum.value,
          uhrzeit: el.uhrzeit.value,
          ort_text: el.ort_text.value,
        };
        const speichernBtn = form.querySelector('[type="submit"]');
        speichernBtn.disabled = true; // verhindert doppeltes Absenden bei schnellem Tippen
        try {
          if (typ === "edit") {
            await api(`/api/films/${nummer}/aufnahmen/${pos}`, {
              method: "PUT", headers: jsonHeader, body: JSON.stringify(werte),
            });
          } else {
            await api(`/api/films/${nummer}/aufnahmen`, {
              method: "POST", headers: jsonHeader, body: JSON.stringify({ ...werte, position: pos }),
            });
          }
          modus = null;
          await laden();
        } catch (err) {
          alert(err.message);
          speichernBtn.disabled = false;
        }
      };
      if (form.scrollIntoView) {
        form.scrollIntoView({ behavior: "smooth", block: beimOeffnenZentrieren ? "center" : "nearest" });
      }
      beimOeffnenZentrieren = false;
    }

    function render() {
      const anzahl = film.aufnahmen.length;
      titel.textContent = `#${film.nummer} — ${film.name}`;
      info.textContent = `${film.kamera} · ${anzahl} Aufnahmen${film.kapazitaet ? ` (von ${film.kapazitaet})` : ""}`;

      let html = "";
      for (let pos = 1; pos <= anzahl + 1; pos++) {
        const einfuegenOffen = modus && modus.typ === "insert" && modus.position === pos;
        html += einfuegenOffen ? formHtml("insert", pos) : slotHtml(pos);
        if (pos <= anzahl) {
          const bearbeitenOffen = modus && modus.typ === "edit" && modus.position === pos;
          html += bearbeitenOffen ? formHtml("edit", pos) : zeileHtml(film.aufnahmen[pos - 1], pos);
        }
      }
      liste.innerHTML = html;
      bind();
    }

    render();
  }

  function renderFrames(liste, mitFilmname) {
    return liste.map(a => {
      const eckeKlasse = a.film_typ === "sw" ? "dashboard-typ-sw" : a.film_typ === "farbe" ? "dashboard-typ-farbe" : "";
      return `
      <div class="frame">
        ${eckeKlasse ? `<div class="dashboard-typ-ecke ${eckeKlasse}"></div>` : ""}
        <div>
  ${a.motiv ? `<div class="frame-motiv">${escapeHtml(a.motiv)}</div>` : ""}
  ${mitFilmname ? `<div class="frame-film">${escapeHtml(a.film_kamera)} · ${escapeHtml(a.film_name)}</div>` : ""}
          <div class="frame-meta">
  ${escapeHtml(a.datum || "")} ${escapeHtml(a.uhrzeit || "")}
          </div>
          <div class="frame-meta">
  ${a.objektiv ? escapeHtml(a.objektiv) : ""}
          </div>
          <div class="frame-meta">
  ${a.belichtungszeit ? escapeHtml(a.belichtungszeit) + " " : ""}
  ${a.blende ? escapeHtml(a.blende) : ""}
          </div>
        </div>
      </div>
    `;
    }).join("");
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const initial = parseHash();
  showView(initial.name, initial.param, initial.param2);
})();