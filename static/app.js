(() => {
  const views = document.querySelectorAll(".view");
  const backBtn = document.getElementById("backBtn");
  let vorausgewaehlterFilm = null;

  const VALID_VIEWS = Array.from(views).map(v => v.dataset.view);

  function navigate(name) {
    if (location.hash.slice(1) === name) {
      showView(name);
    } else {
      location.hash = name;
    }
  }

  window.addEventListener("hashchange", () => {
    const name = location.hash.slice(1);
    showView(VALID_VIEWS.includes(name) ? name : "start");
  });

  function showView(name) {
    views.forEach(v => v.hidden = v.dataset.view !== name);
    if (backBtn) backBtn.hidden = name === "start";
    if (name === "start") initStart();
    if (name === "neuer-film") initNeuerFilm();
    if (name === "neue-aufnahme") initNeueAufnahme();
    if (name === "film-abschliessen") initFilmAbschliessen();
    if (name === "zuletzt") initZuletzt();
    if (name === "downloads") initDownloads();
    if (name === "auswahllisten") initAuswahllisten();
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

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".frame-delete-btn");
    if (!btn) return;
    const filmNummer = btn.dataset.filmNummer;
    const frameTitle = btn.dataset.frameTitle;
    const frameNr = btn.dataset.frameNr;
    if (!confirm(`"${frameTitle}" wirklich löschen?`)) return;
    try {
      await api(`/api/films/${filmNummer}/aufnahmen/${frameNr}`, { method: "DELETE" });
      initZuletzt();
      initStart();
    } catch (err) {
      alert(err.message);
    }
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
    filterSelect.onchange = () => ladeZuletztListe();
  }

  await ladeZuletztListe();

  async function ladeZuletztListe() {
    const filmNummer = filterSelect.value;
    container.innerHTML = `<p class="empty-state">Wird geladen …</p>`;
    try {
      const url = filmNummer
        ? `/api/aufnahmen/recent?limit=36&film_nummer=${filmNummer}`
        : `/api/aufnahmen/recent?limit=25`;
      const liste = await api(url);
      if (!liste.length) {
        container.innerHTML = `<p class="empty-state">Noch keine Aufnahmen protokolliert.</p>`;
        return;
      }
      const heute = todayStr();
      const heuteListe = liste.filter(a => a.datum === heute);
      const aelterListe = liste.filter(a => a.datum !== heute);
      container.innerHTML = `
        ${heuteListe.length ? `<p class="dashboard-label">Heute</p>${renderFrames(heuteListe, true, true)}` : ""}
        ${aelterListe.length ? `<p class="dashboard-label">Älter</p>${renderFrames(aelterListe, true, true)}` : ""}
      `;
    } catch (err) {
      container.innerHTML = `<p class="error-msg">${escapeHtml(err.message)}</p>`;
    }
  }
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
        return `
          <div class="download-row">
            ${eckeKlasse ? `<div class="dashboard-typ-ecke ${eckeKlasse}"></div>` : ""}
            <div class="download-row-info">
              <div class="download-row-title">#${String(f.nummer)} — ${escapeHtml(f.name)}</div>
              <div class="download-row-meta">${escapeHtml(f.kamera)} · ${f.anzahl_aufnahmen} Aufnahmen${ablaufPille}</div>
              ${angelegtDatum ? `<div class="download-row-meta">Angelegt: ${angelegtDatum}</div>` : ""}
              ${f.entwickelt && entwickeltDatum ? `<div class="download-row-meta">Entwickelt: ${entwickeltDatum}</div>` : ""}
            </div>
            <div class="download-row-actions">
              <a class="download-btn" href="/api/films/${f.nummer}/export" download title="Protokoll herunterladen">📥</a>
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

  function kameraKuerzel(kamera) {
    if (!kamera) return "";
    const woerter = kamera.trim().split(/\s+/).filter(Boolean);
    if (woerter.length >= 2) {
      return woerter[0].slice(0, 2) + woerter[1].slice(0, 1);
    }
    return (woerter[0] || "").slice(0, 3);
  }

  function renderFrames(liste, mitFilmname, mitAktionen = false) {
    return liste.map(a => {
      const eckeKlasse = a.film_typ === "sw" ? "dashboard-typ-sw" : a.film_typ === "farbe" ? "dashboard-typ-farbe" : "";
      return `
      <div class="frame">
        ${eckeKlasse ? `<div class="dashboard-typ-ecke ${eckeKlasse}"></div>` : ""}
        <div class="frame-nr">${a.film_kamera ? escapeHtml(kameraKuerzel(a.film_kamera)) : String(a.frame_nr)}</div>
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
  ${mitAktionen ? `<button type="button" class="frame-delete-btn" data-film-nummer="${a.film_nummer}" data-frame-nr="${a.frame_nr}" data-frame-title="${escapeHtml(a.motiv || `Aufnahme ${a.frame_nr}`)}">Löschen</button>` : ""}
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

  const initialName = location.hash.slice(1);
  showView(VALID_VIEWS.includes(initialName) ? initialName : "start");
})();