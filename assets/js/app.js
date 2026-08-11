/*
 * app.js - Oberflaeche des SoFi-Trackers.
 */
(function () {
  'use strict';

  var EC = window.EclipseCore;
  var EL = EC.ELEMENTS_2026;
  var DEG = Math.PI / 180;

  // Startort beim ersten Aufruf, solange nichts gespeichert ist
  var DEFAULT_CITY = 'Füssen';

  var state = {
    place: null,       // {name, lat, lon, height, tz, source}
    circ: null,        // oertliche Umstaende
    obs: null,         // Beobachterobjekt
    sliderT: null,     // aktuell gewaehlter Zeitpunkt (TT-Stunden rel. t0)
    tStart: null,
    tEnd: null,
    live: true,        // Slider folgt der echten Uhrzeit
    playing: false,
    playRAF: null
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ==================================================================
   * Zeitformatierung
   * ================================================================== */

  function tz() {
    return (state.place && state.place.tz) ||
      Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  function fmtTime(date, withSeconds) {
    if (!date) return '--:--';
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit', minute: '2-digit',
      second: withSeconds ? '2-digit' : undefined,
      timeZone: tz(), hour12: false
    }).format(date);
  }

  function tzAbbrev() {
    if (!state.place) return '';
    try {
      var parts = new Intl.DateTimeFormat('de-DE', {
        timeZone: tz(), timeZoneName: 'short'
      }).formatToParts(EL_maxDate());
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'timeZoneName') return parts[i].value;
      }
    } catch (e) { /* ignorieren */ }
    return '';
  }

  function EL_maxDate() {
    return state.circ && state.circ.maxDate ? state.circ.maxDate : new Date();
  }

  function fmtDuration(sec) {
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h > 0) return h + ' h ' + m + ' min';
    if (m > 0) return m + ' min ' + (s < 10 ? '0' : '') + s + ' s';
    return s + ' s';
  }

  function fmtDeg(d, digits) {
    return d.toFixed(digits === undefined ? 1 : digits).replace('.', ',') + '°';
  }

  /**
   * Bedeckungsgrad in Prozent. Knapp unter 100 % wird feiner aufgeloest,
   * damit aus 99,98 % nicht faelschlich "100 %" wird.
   */
  function fmtPct(frac) {
    var digits = (frac > 0.999 && frac < 1) ? 3 : 1;
    return (frac * 100).toFixed(digits).replace('.', ',') + ' %';
  }

  var COMPASS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  function compassName(az) {
    return COMPASS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
  }

  /* ==================================================================
   * Standort
   * ================================================================== */

  function setPlace(place) {
    state.place = place;
    state.obs = EC.makeObserver(place.lat, place.lon, place.height || 0);
    state.circ = EC.localCircumstances(place.lat, place.lon, place.height || 0, EL);

    try {
      localStorage.setItem('sofi2026.place', JSON.stringify(place));
    } catch (e) { /* privater Modus */ }

    setupSliderRange();
    // "Live" nur, wenn die Finsternis gerade wirklich laeuft. Sonst zeigt
    // der Regler das Maximum - das ist der interessanteste Moment.
    state.live = isNowInWindow();
    if (state.live) setSliderT(nowT());
    renderAll();
  }

  function loadSavedPlace() {
    try {
      var raw = localStorage.getItem('sofi2026.place');
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p.lat === 'number' && typeof p.lon === 'number') return p;
      }
    } catch (e) { /* ignorieren */ }
    return null;
  }

  function useGeolocation() {
    var btn = $('btnGeo');
    if (!navigator.geolocation) {
      showGeoError('Dieses Gerät unterstützt keine Standortbestimmung.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Suche…';

    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lon = pos.coords.longitude;
      var near = window.Cities.nearest(lat, lon);
      var label = near.distanceKm < 25
        ? 'Mein Standort (bei ' + near.city.name + ')'
        : 'Mein Standort';
      setPlace({
        name: label, lat: lat, lon: lon,
        height: pos.coords.altitude || (near.distanceKm < 25 ? near.city.height : 0),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        source: 'gps', accuracy: pos.coords.accuracy
      });
      btn.disabled = false;
      btn.textContent = '📍 GPS';
      $('geoError').classList.add('hidden');
    }, function (err) {
      btn.disabled = false;
      btn.textContent = '📍 GPS';
      var msg = 'Standort konnte nicht ermittelt werden.';
      if (err.code === 1) msg = 'Zugriff auf den Standort wurde abgelehnt. Du kannst deinen Ort unten suchen.';
      else if (err.code === 3) msg = 'Standortsuche hat zu lange gedauert. Bitte Ort manuell wählen.';
      showGeoError(msg);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
  }

  function showGeoError(msg) {
    var el = $('geoError');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  /* --- Suchfeld ----------------------------------------------------- */

  function setupSearch() {
    var input = $('citySearch');
    var box = $('suggestions');
    var activeIndex = -1;
    var current = [];

    function close() { box.innerHTML = ''; activeIndex = -1; current = []; }

    function render(list) {
      current = list;
      activeIndex = -1;
      box.innerHTML = '';
      list.forEach(function (c, i) {
        var d = document.createElement('div');
        d.className = 'sugg';
        d.setAttribute('role', 'option');
        d.innerHTML = '<span>' + c.name + '</span><span class="c">' + c.countryName + '</span>';
        d.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          choose(i);
        });
        box.appendChild(d);
      });
    }

    function choose(i) {
      var c = current[i];
      if (!c) return;
      input.value = c.name;
      close();
      input.blur();
      setPlace({
        name: c.name, lat: c.lat, lon: c.lon, height: c.height,
        tz: c.tz, source: 'city', countryName: c.countryName
      });
    }

    input.addEventListener('input', function () {
      var v = input.value.trim();
      if (v.length < 2) { close(); return; }
      render(window.Cities.search(v, 8));
    });

    input.addEventListener('keydown', function (e) {
      var items = box.querySelectorAll('.sugg');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        activeIndex += (e.key === 'ArrowDown' ? 1 : -1);
        if (activeIndex < 0) activeIndex = items.length - 1;
        if (activeIndex >= items.length) activeIndex = 0;
        items.forEach(function (el, i) { el.classList.toggle('active', i === activeIndex); });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choose(activeIndex >= 0 ? activeIndex : 0);
      } else if (e.key === 'Escape') {
        close();
      }
    });

    input.addEventListener('blur', function () { setTimeout(close, 120); });
  }

  /* --- Koordinaten manuell ------------------------------------------ */

  function setupManual() {
    $('btnManual').addEventListener('click', function () {
      var lat = parseFloat($('inLat').value.replace(',', '.'));
      var lon = parseFloat($('inLon').value.replace(',', '.'));
      var h = parseFloat($('inAlt').value.replace(',', '.'));
      if (!isFinite(lat) || lat < -90 || lat > 90) { alert('Breite muss zwischen -90 und 90 liegen.'); return; }
      if (!isFinite(lon) || lon < -180 || lon > 180) { alert('Länge muss zwischen -180 und 180 liegen.'); return; }
      setPlace({
        name: 'Eigene Koordinaten',
        lat: lat, lon: lon, height: isFinite(h) ? h : 0,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        source: 'manual'
      });
    });
  }

  /* ==================================================================
   * Slider
   * ================================================================== */

  function setupSliderRange() {
    var c = state.circ;
    var slider = $('timeSlider');

    if (c.hasEclipse && c.c1T !== null && c.c4T !== null) {
      state.tStart = c.c1T - 5 / 60;   // 5 min Vorlauf
      state.tEnd = c.c4T + 5 / 60;
    } else {
      state.tStart = -1.6;
      state.tEnd = 1.9;
    }

    slider.min = 0;
    slider.max = 1000;
    slider.step = 1;
    setSliderT(c.hasEclipse ? c.maxT : 0);
  }

  function sliderToT(val) {
    return state.tStart + (val / 1000) * (state.tEnd - state.tStart);
  }

  function tToSlider(t) {
    var v = (t - state.tStart) / (state.tEnd - state.tStart) * 1000;
    return Math.max(0, Math.min(1000, v));
  }

  function setSliderT(t) {
    state.sliderT = Math.max(state.tStart, Math.min(state.tEnd, t));
    var slider = $('timeSlider');
    var v = tToSlider(state.sliderT);
    slider.value = v;
    slider.style.setProperty('--pct', (v / 10) + '%');
  }

  function nowT() {
    return EC.dateToT(EL, new Date());
  }

  /** Laeuft die Finsternis am gewaehlten Ort gerade jetzt? */
  function isNowInWindow() {
    var t = nowT();
    return t >= state.tStart && t <= state.tEnd;
  }

  function setupSlider() {
    var slider = $('timeSlider');

    slider.addEventListener('input', function () {
      state.live = false;
      stopPlay();
      setSliderT(sliderToT(+slider.value));
      renderDynamic();
      updateModeButtons();
    });

    $('btnNow').addEventListener('click', function () {
      stopPlay();
      state.live = isNowInWindow();
      setSliderT(nowT());   // klemmt automatisch auf den Rand
      renderDynamic();
      updateModeButtons();
      if (!state.live) {
        var b = $('btnNow'), old = b.textContent;
        b.textContent = nowT() < state.tStart ? 'noch nicht' : 'vorbei';
        setTimeout(function () { b.textContent = old; }, 1600);
      }
    });

    $('btnMax').addEventListener('click', function () {
      stopPlay();
      state.live = false;
      setSliderT(state.circ.hasEclipse ? state.circ.maxT : 0);
      renderDynamic();
      updateModeButtons();
    });

    $('btnPlay').addEventListener('click', function () {
      if (state.playing) { stopPlay(); return; }
      startPlay();
    });
  }

  function startPlay() {
    state.playing = true;
    state.live = false;
    updateModeButtons();
    if (state.sliderT >= state.tEnd - 1e-6) setSliderT(state.tStart);

    var last = performance.now();
    // Ganzer Verlauf in ca. 20 Sekunden
    var speed = (state.tEnd - state.tStart) / 20000;

    function step(now) {
      if (!state.playing) return;
      var dt = now - last;
      last = now;
      var t = state.sliderT + dt * speed;
      if (t >= state.tEnd) { setSliderT(state.tEnd); renderDynamic(); stopPlay(); return; }
      setSliderT(t);
      renderDynamic();
      state.playRAF = requestAnimationFrame(step);
    }
    state.playRAF = requestAnimationFrame(step);
  }

  function stopPlay() {
    state.playing = false;
    if (state.playRAF) cancelAnimationFrame(state.playRAF);
    state.playRAF = null;
    updateModeButtons();
  }

  function updateModeButtons() {
    $('btnNow').classList.toggle('is-active', state.live);
    $('btnPlay').classList.toggle('is-active', state.playing);
    $('btnPlay').textContent = state.playing ? '⏸ Stopp' : '▶ Ablauf';
  }

  /* ==================================================================
   * Rendern
   * ================================================================== */

  function renderAll() {
    renderLocation();
    renderVerdict();
    renderPhases();
    renderStats();
    renderNotices();
    renderSliderMarks();
    renderVisibility();
    renderLive();
    renderDynamic();
    updateModeButtons();
    $('resultArea').classList.remove('hidden');
  }

  function renderLocation() {
    var p = state.place;
    $('locName').textContent = p.name;
    var acc = p.source === 'gps' && p.accuracy
      ? ' · ±' + Math.round(p.accuracy) + ' m'
      : '';
    $('locCoords').textContent =
      Math.abs(p.lat).toFixed(4) + '°' + (p.lat >= 0 ? 'N' : 'S') + ' ' +
      Math.abs(p.lon).toFixed(4) + '°' + (p.lon >= 0 ? 'O' : 'W') +
      ' · ' + Math.round(p.height || 0) + ' m' + acc;
  }

  function renderVerdict() {
    var c = state.circ;
    var box = $('verdict');
    box.classList.toggle('is-total', c.isTotal);

    if (!c.hasEclipse) {
      $('verdictBig').textContent = '—';
      $('verdictSub').textContent = 'Hier ist keine Finsternis sichtbar';
      return;
    }
    if (c.isTotal) {
      $('verdictBig').textContent = '100 %';
      $('verdictSub').textContent = 'TOTALITÄT · ' + fmtDuration(c.durationTotalityS);
    } else {
      // Knapp unter 100 % nicht auf "100,0" runden - das waere irrefuehrend
      $('verdictBig').textContent = fmtPct(c.obscuration);
      $('verdictSub').textContent = 'der Sonnenfläche bedeckt · maximal';
    }
  }

  function renderPhases() {
    var c = state.circ;
    var wrap = $('phases');
    wrap.innerHTML = '';

    if (!c.hasEclipse) {
      wrap.innerHTML = '<div class="notice notice-info"><span class="notice-icon">ℹ️</span>' +
        '<div>An diesem Ort bleibt die Sonne unbedeckt. Suche einen Ort in Europa, ' +
        'Nordafrika oder im Nordatlantik.</div></div>';
      return;
    }

    var rows = [];
    rows.push({
      icon: '◐', name: '1. Kontakt (C1)',
      desc: 'Der Mond berührt den Sonnenrand – die Finsternis beginnt.',
      t: c.c1T, date: c.c1, alt: c.altC1, az: c.azC1
    });

    if (c.c2T !== null) {
      rows.push({
        icon: '●', name: '2. Kontakt (C2)', highlight: true,
        desc: 'Beginn der Totalität – jetzt darf die Brille ab!',
        t: c.c2T, date: c.c2
      });
    }

    rows.push({
      icon: '☀', name: 'Maximum', highlight: true,
      desc: c.isTotal
        ? 'Mitte der Totalität.'
        : 'Größte Bedeckung: ' + fmtPct(c.obscuration) + ' der Sonnenfläche.',
      t: c.maxT, date: c.maxDate, alt: c.maxAltitude, az: c.maxAzimuth
    });

    if (c.c3T !== null) {
      rows.push({
        icon: '○', name: '3. Kontakt (C3)', warn: true,
        desc: 'Ende der Totalität – Brille sofort wieder aufsetzen!',
        t: c.c3T, date: c.c3
      });
    }

    if (c.sunsetDuring) {
      rows.push({
        icon: '\u{1F307}', name: 'Sonnenuntergang', warn: true,
        desc: 'Die Sonne geht unter, während die Finsternis noch läuft.',
        t: c.horizonCrossT, date: c.sunsetDuring
      });
    }
    if (c.sunriseDuring) {
      rows.push({
        icon: '\u{1F304}', name: 'Sonnenaufgang', warn: true,
        desc: 'Die Sonne geht auf, die Finsternis läuft bereits.',
        t: c.horizonCrossT, date: c.sunriseDuring
      });
    }

    rows.push({
      icon: '◑', name: '4. Kontakt (C4)',
      desc: 'Der Mond verlässt die Sonnenscheibe – die Finsternis endet.',
      t: c.c4T, date: c.c4, alt: c.altC4, az: c.azC4
    });

    rows.sort(function (a, b) { return a.t - b.t; });

    rows.forEach(function (r) {
      var el = document.createElement('div');
      el.className = 'phase' +
        (r.highlight ? ' is-highlight' : '') +
        (r.warn ? ' is-warn' : '');
      el.dataset.t = r.t;

      var sub = '';
      if (r.alt !== undefined && r.alt !== null) {
        sub = r.alt < EC.SUNSET_ALT_DEG
          ? '↓ unter dem Horizont'
          : fmtDeg(r.alt) + ' hoch · ' + compassName(r.az);
      }

      el.innerHTML =
        '<div class="phase-icon">' + r.icon + '</div>' +
        '<div><div class="phase-name">' + r.name + '</div>' +
        '<div class="phase-desc">' + r.desc + '</div></div>' +
        '<div><div class="phase-time">' + fmtTime(r.date, true) + '</div>' +
        (sub ? '<div class="phase-sub">' + sub + '</div>' : '') + '</div>';

      // Klick auf eine Phase springt im Slider dorthin
      el.addEventListener('click', function () {
        stopPlay();
        state.live = false;
        setSliderT(r.t);
        renderDynamic();
        updateModeButtons();
        document.querySelector('.stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      wrap.appendChild(el);
    });
  }

  function renderStats() {
    var c = state.circ;
    var grid = $('statGrid');
    if (!c.hasEclipse) { grid.innerHTML = ''; return; }

    var items = [
      ['Bedeckung (Fläche)', fmtPct(c.obscuration)],
      ['Magnitude', (c.isTotal || c.isAnnular ? c.diameterRatio : c.magnitude).toFixed(3).replace('.', ',')],
      ['Dauer gesamt', fmtDuration(c.durationPartialS)],
      ['Sonnenhöhe (Max)', fmtDeg(c.maxAltitude)]
    ];

    if (c.isTotal) {
      items.splice(2, 0, ['Totalität', fmtDuration(c.durationTotalityS)]);
    }

    grid.innerHTML = items.map(function (it) {
      return '<div class="stat"><div class="stat-val">' + it[1] +
        '</div><div class="stat-lab">' + it[0] + '</div></div>';
    }).join('');
  }

  function renderNotices() {
    var c = state.circ;
    var wrap = $('notices');
    var html = '';

    if (!c.hasEclipse) { wrap.innerHTML = ''; return; }

    // Augenschutz - immer, ausser waehrend der Totalitaet
    if (c.isTotal) {
      html += notice('danger', '⚠️',
        '<strong>Nur während der Totalität</strong> (zwischen C2 und C3) darf die Sonnenfinsternis-Brille ab. ' +
        'In allen anderen Phasen ist ein zertifizierter Sonnenfilter (EN&nbsp;ISO&nbsp;12312-2) Pflicht.');
    } else {
      html += notice('danger', '⚠️',
        '<strong>Nie ohne Schutz in die Sonne schauen.</strong> Hier wird die Sonne nie vollständig bedeckt – ' +
        'die ganze Zeit ist eine zertifizierte SoFi-Brille (EN&nbsp;ISO&nbsp;12312-2) nötig. ' +
        'Sonnenbrille, Ruß­glas oder Rettungsdecke reichen <em>nicht</em>.');
    }

    // Tiefstehende Sonne
    if (c.maxAltitude < 12) {
      html += notice('warn', '\u{1F3D4}️',
        'Die Sonne steht beim Maximum nur <strong>' + fmtDeg(c.maxAltitude) + '</strong> über dem Horizont ' +
        '(Richtung <strong>' + compassName(c.maxAzimuth) + '</strong>). Du brauchst freie Sicht Richtung ' +
        compassName(c.maxAzimuth) + ' – Häuser, Bäume oder Hügel verdecken sie sonst. ' +
        'Eine Anhöhe, ein Feld oder die Küste sind ideal.');
    }

    if (c.sunsetDuring) {
      html += notice('warn', '\u{1F307}',
        'Die Sonne geht um <strong>' + fmtTime(c.sunsetDuring, false) + '</strong> unter, ' +
        'noch während die Finsternis läuft. Der Rest des Verlaufs ist an deinem Ort nicht mehr zu sehen.');
    }

    if (c.belowHorizonAtMax) {
      html += notice('warn', '\u{1F311}',
        'Beim Maximum steht die Sonne bereits unter dem Horizont. An deinem Ort ist nur der frühe ' +
        'Teil der Finsternis sichtbar.');
    }

    // Randlage der Totalitaetszone
    if (c.hasEclipse && !c.isTotal && c.magnitude > 0.995) {
      html += notice('warn', '\u{1F3AF}',
        '<strong>Grenzfall.</strong> Dieser Ort liegt praktisch auf der Kante der Totalitätszone – ' +
        'nach dieser Rechnung wenige Kilometer außerhalb. Bei so knappen Lagen kommen ' +
        'verschiedene Quellen zu unterschiedlichen Ergebnissen, weil die Berge am Mondrand die ' +
        'Grenze um ein paar hundert Meter verschieben. Wer die Totalität sicher sehen will, ' +
        'sollte einige Kilometer in Richtung Zentrallinie fahren.');
    } else if (c.hasEclipse && !c.isTotal && c.magnitude > 0.97) {
      html += notice('info', '\u{1F3AF}',
        'Du bist <strong>knapp</strong> außerhalb der Totalitätszone. Wenige Kilometer machen hier ' +
        'den Unterschied zwischen 99&nbsp;% und echter Totalität – und das sind zwei völlig ' +
        'verschiedene Erlebnisse.');
    }
    if (c.isTotal && c.durationTotalityS < 45) {
      html += notice('info', '⏱️',
        'Du bist nah am Rand der Totalitätszone – die Totalität dauert hier nur ' +
        fmtDuration(c.durationTotalityS) + '. Näher an der Zentrallinie wird sie deutlich länger.');
    }

    wrap.innerHTML = html;
  }

  function notice(kind, icon, text) {
    return '<div class="notice notice-' + kind + '"><span class="notice-icon">' + icon +
      '</span><div>' + text + '</div></div>';
  }

  function renderSliderMarks() {
    var c = state.circ;
    var wrap = $('sliderMarks');
    wrap.innerHTML = '';
    if (!c.hasEclipse) return;

    var marks = [
      { t: c.c1T, label: 'C1', cls: '' },
      { t: c.maxT, label: 'Max', cls: 'is-max' },
      { t: c.c4T, label: 'C4', cls: '' }
    ];
    if (c.horizonCrossT) marks.push({ t: c.horizonCrossT, label: '\u{1F307}', cls: 'is-sunset' });

    marks.forEach(function (m) {
      if (m.t === null || m.t === undefined) return;
      var pct = (m.t - state.tStart) / (state.tEnd - state.tStart) * 100;
      if (pct < 0 || pct > 100) return;
      var d = document.createElement('div');
      d.className = 'mark ' + m.cls;
      d.style.left = pct + '%';
      d.textContent = m.label;
      wrap.appendChild(d);
    });
  }

  /* --- alles, was sich mit dem Slider aendert ------------------------ */

  function renderDynamic() {
    if (!state.circ) return;
    if (state.live) {
      if (isNowInWindow()) {
        setSliderT(nowT());
      } else {
        state.live = false;      // Finsternis ist durchgelaufen
        updateModeButtons();
      }
    }

    var t = state.sliderT;
    var s = EC.stateAt(EL, state.obs, t);
    var date = EC.tToDate(EL, t);

    $('stageTime').textContent = fmtTime(date, true);
    $('stageTz').textContent = tzAbbrev() + (state.live ? ' · LIVE' : '');

    var obsc = s.m < s.L1 ? s.obscuration : 0;
    $('roObsc').textContent = fmtPct(obsc);
    $('roAlt').textContent = fmtDeg(s.altitudeDeg);
    $('roAz').textContent = Math.round(s.azimuthDeg) + '° ' + compassName(s.azimuthDeg);

    drawSun(s);
    drawHorizon(s);
    markCurrentPhase(t);
  }

  function markCurrentPhase(t) {
    var els = document.querySelectorAll('.phase');
    var bestEl = null, bestD = Infinity;
    els.forEach(function (el) {
      var pt = parseFloat(el.dataset.t);
      el.classList.toggle('is-past', pt < t);
      var d = Math.abs(pt - t);
      if (d < bestD) { bestD = d; bestEl = el; }
    });
    els.forEach(function (el) { el.classList.remove('is-now'); });
    if (bestEl && bestD < 4 / 60) bestEl.classList.add('is-now');
  }

  /* ==================================================================
   * Sichtprognose (der einzige Teil, der Netz braucht)
   * ================================================================== */

  var VIS = window.Visibility;
  var visState = { data: null, clima: null, compare: [] };

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  function pctText(x) { return Math.round(x * 100) + ' %'; }

  /*
   * Stuetzstellen ueber den Finsternisverlauf: gleichmaessig zwischen erstem
   * und letztem Kontakt, dazu das Maximum und - falls er dazwischen liegt -
   * der Sonnenuntergang. Der ist ein harter Knick: davor ist etwas zu sehen,
   * danach nichts mehr. Ohne eigene Stuetzstelle fiele die Kurve verspaetet.
   */
  function buildSteps(steps) {
    var c = state.circ;
    if (!c || !c.hasEclipse) return [];
    var t0 = c.c1T !== null ? c.c1T : c.maxT;
    var t1 = c.c4T !== null ? c.c4T : c.maxT;
    var n = steps || 8;
    var ts = [];
    for (var i = 0; i <= n; i++) ts.push(t0 + (t1 - t0) * i / n);
    ts.push(c.maxT);
    if (c.sunsetDuring) {
      var st = EC.dateToT(EL, c.sunsetDuring);
      if (st > t0 && st < t1) ts.push(st);
    }
    ts.sort(function (x, y) { return x - y; });

    var out = [];
    for (var k = 0; k < ts.length; k++) {
      if (k > 0 && Math.abs(ts[k] - ts[k - 1]) < 1e-6) continue;
      var st2 = EC.stateAt(EL, state.obs, ts[k]);
      out.push({
        t: ts[k],
        date: EC.tToDate(EL, ts[k]),
        altitudeDeg: st2.altitudeDeg,
        azimuthDeg: st2.azimuthDeg,
        obscuration: st2.obscuration,
        isPeak: Math.abs(ts[k] - c.maxT) < 1e-9
      });
    }
    return out;
  }

  function renderVisibility() {
    visState.data = null;
    visState.clima = null;
    $('visResult').innerHTML = '';
    $('climaResult').innerHTML = '';
    $('cmpResult').innerHTML = '';
    resetBtn('btnVis', '☁ Sichtchance abrufen');
    resetBtn('btnClima', '📊 20 Jahre auswerten');
  }

  function resetBtn(id, label) {
    var b = $(id);
    if (!b) return;
    b.disabled = false;
    b.textContent = label;
  }

  function netError(box, err, btnId, label) {
    resetBtn(btnId, label);
    var msg = err && err.message ? err.message : String(err);

    /*
     * Open-Meteos freies Kontingent (10.000 Abrufe pro Tag und IP-Adresse)
     * meldet sich mit HTTP 429. Das ist kein Netzproblem - wer dann "du
     * brauchst Internet" liest, sucht den Fehler an der falschen Stelle.
     */
    var icon = '📡';
    var text = 'Die Wetterdaten konnten nicht geladen werden – dafür braucht es Internet. ' +
      'Alles andere auf dieser Seite funktioniert auch ohne.';
    if (/\b429\b/.test(msg)) {
      icon = '⏳';
      text = 'Der Wetterdienst hat vorerst dichtgemacht: Das kostenlose Kontingent von ' +
        'Open-Meteo ist für deine Internetverbindung erschöpft. Es füllt sich von selbst ' +
        'wieder auf – in ein paar Minuten noch einmal versuchen.';
    } else if (/\b5\d\d\b/.test(msg)) {
      icon = '🛠';
      text = 'Der Wetterdienst hat gerade eine Störung. Das liegt nicht an dir – ' +
        'später noch einmal versuchen.';
    }

    box.innerHTML = '<div class="notice notice-warn"><span class="notice-icon">' + icon +
      '</span><div>' + text +
      '<br><span class="vis-err">' + escapeHTML(msg) + '</span></div></div>';
  }

  function loadVisibility() {
    var c = state.circ;
    var box = $('visResult');
    if (!c || !c.hasEclipse) {
      box.innerHTML = '<div class="notice notice-info">An diesem Ort ist die Finsternis ' +
        'nicht zu sehen – es gibt nichts zu prognostizieren.</div>';
      return;
    }
    if (!VIS.isForecastable(c.maxDate)) {
      var d = Math.round(VIS.daysUntil(c.maxDate));
      box.innerHTML = '<div class="notice notice-info"><span class="notice-icon">📅</span>' +
        '<div>Die Finsternis liegt ' + d + ' Tage in der Zukunft – Wettermodelle reichen nur ' +
        VIS.MAX_FORECAST_DAYS + ' Tage. Weiter unten hilft die Klimatologie.</div></div>';
      return;
    }

    var btn = $('btnVis');
    btn.disabled = true;
    btn.textContent = '… wird abgerufen';
    box.innerHTML = '';

    VIS.analyse(state.place, buildSteps(8)).then(function (r) {
      visState.data = r;
      resetBtn('btnVis', '↻ Neu abrufen');
      box.innerHTML = visHTML(r);
      drawProfile(r);
      drawTimeline(r);
    }).catch(function (err) {
      netError(box, err, 'btnVis', '↻ Erneut versuchen');
    });
  }

  function visHTML(r) {
    var h = '<div class="vis-head vis-' + r.rating.key + '">' +
      '<div class="vis-pct">' + pctText(r.peak.chance) + '</div>' +
      '<div class="vis-rate">' + r.rating.label + '</div></div>';
    h += '<p class="vis-why">' + escapeHTML(r.explanation) + '</p>';

    // --- Faktoren: wie kommt die Zahl zustande? ---
    h += '<h3 class="vis-h3">Wie kommt diese Zahl zustande?</h3><div class="vis-fac">';
    var f = r.peak.factors;
    var facs = [
      ['Freie Sicht durch die Wolken', f.clouds],
      ['Dunst', f.haze],
      ['Niederschlag', f.precipitation]
    ];
    facs.forEach(function (x) {
      var v = Math.max(0, Math.min(1, x[1]));
      h += '<div class="fac-row"><span class="fac-lab">' + x[0] + '</span>' +
        '<span class="fac-bar"><i style="width:' + (v * 100).toFixed(1) + '%"></i></span>' +
        '<span class="fac-val">×' + v.toFixed(2).replace('.', ',') + '</span></div>';
    });
    h += '</div><p class="vis-foot">Die drei Faktoren werden multipliziert: ' +
      facs.map(function (x) { return Math.max(0, Math.min(1, x[1])).toFixed(2).replace('.', ','); }).join(' × ') +
      ' = ' + r.peak.chance.toFixed(2).replace('.', ',') + '</p>';

    // --- Sichtlinie ---
    h += '<h3 class="vis-h3">Sichtlinie zur Sonne</h3>';
    h += '<div class="vis-rows">';
    (r.lineOfSight || []).forEach(function (p) {
      var cover = p.cover == null ? '–' : Math.round(p.cover) + ' %';
      if (p.maxCover != null && Math.round(p.maxCover) > Math.round(p.cover)) {
        cover += ' <span class="vis-max">(max ' + Math.round(p.maxCover) + ')</span>';
      }
      var dist = p.samples
        ? Math.round(p.fromKm) + '–' + Math.round(p.toKm) + ' km' + (p.capped ? '+' : '')
        : '–';
      h += '<div class="vis-row"><span class="vis-layer">' + p.layer.label +
        (p.samples ? ' <span class="vis-n">' + p.samples + ' Punkte</span>' : '') + '</span>' +
        '<span class="vis-dist">' + dist + '</span>' +
        '<span class="vis-cover">' + cover + '</span></div>';
    });
    h += '</div><div class="prof-wrap"><canvas id="profCanvas"></canvas></div>';
    h += '<p class="vis-foot">Seitenansicht: der Sehstrahl vom Beobachter (links) zur Sonne. ' +
      'Abgefragt wird die Bewölkung an ' + (r.samplePoints || 0) + ' Punkten entlang der ' +
      'Sichtlinie – jeder in dem Stockwerk, in dem der Strahl dort verläuft. Gewertet wird ' +
      'je Stockwerk die schlechteste Stelle (85er-Perzentil), nicht der Durchschnitt.' +
      (r.rayCapped ? ' Der Strahl war bei 300 km noch unter der Wolkenobergrenze – das ' +
        'oberste Stück bleibt ungeprüft.' : '') + '</p>';

    // --- Verlauf ---
    h += '<h3 class="vis-h3">Verlauf der Sichtchance</h3>';
    h += '<div class="tl-wrap"><canvas id="tlCanvas"></canvas></div>';
    h += '<details class="vis-det"><summary>Werte als Tabelle</summary><div class="vis-rows">';
    r.timeline.forEach(function (e) {
      h += '<div class="vis-row' + (e.isPeak ? ' is-peak' : '') + '">' +
        '<span class="vis-layer">' + fmtTime(e.date) + (e.isPeak ? ' · Maximum' : '') + '</span>' +
        '<span class="vis-dist">' + fmtDeg(e.altitudeDeg) + '</span>' +
        '<span class="vis-cover">' + pctText(e.chance) + '</span></div>';
    });
    h += '</div></details>';

    // --- Modellvergleich ---
    if (r.perModel && r.perModel.length > 1) {
      h += '<h3 class="vis-h3">Wie einig sind sich die Wettermodelle?</h3><div class="vis-fac">';
      r.perModel.forEach(function (m) {
        h += '<div class="fac-row' + (m.model.primary ? ' is-primary' : '') + '">' +
          '<span class="fac-lab">' + m.model.label + '</span>' +
          '<span class="fac-bar"><i style="width:' + (m.chance * 100).toFixed(1) + '%"></i></span>' +
          '<span class="fac-val">' + pctText(m.chance) + '</span></div>';
      });
      h += '</div>';
      if (r.spread) {
        h += '<p class="vis-foot">Spanne ' + pctText(r.spread.min) + ' bis ' +
          pctText(r.spread.max) + ', Median ' + pctText(r.spread.median) +
          ' – Übereinstimmung <strong>' + r.spread.agreement + '</strong>. ' +
          (r.spread.agreement === 'gering'
            ? 'Die Modelle sind sich uneins; nimm die Spanne ernster als die Einzelzahl.'
            : 'Je enger die Spanne, desto belastbarer die Zahl.') + '</p>';
      }
    }

    // --- Wetterlage am Ort ---
    var co = r.conditions;
    if (co) {
      h += '<h3 class="vis-h3">Wetter an deinem Ort</h3><div class="grid2">';
      var tiles = [
        [co.totalCloudCover == null ? '–' : Math.round(co.totalCloudCover) + ' %', 'Bewölkung gesamt'],
        [co.temperature == null ? '–' : Math.round(co.temperature) + ' °C', 'Temperatur'],
        [co.wind == null ? '–' : Math.round(co.wind) + ' km/h', 'Wind'],
        [co.visibility == null ? '–' : Math.round(co.visibility / 1000) + ' km', 'Sichtweite']
      ];
      tiles.forEach(function (t) {
        h += '<div class="stat"><div class="stat-val">' + t[0] + '</div>' +
          '<div class="stat-lab">' + t[1] + '</div></div>';
      });
      h += '</div>';
    }

    h += '<p class="vis-foot">Bewölkung entlang der Sichtlinie, stündlich ' +
      'interpoliert. Quelle: Open-Meteo.</p>';
    return h;
  }

  /* --- Seitenprofil der Sichtlinie ---------------------------------- */

  function drawProfile(r) {
    var canvas = $('profCanvas');
    if (!canvas) return;
    var W = canvas.getBoundingClientRect().width;
    if (!W) return;
    var H = Math.max(140, Math.min(200, W * 0.5));
    canvas.style.height = H + 'px';
    var ctx = prepCanvas(canvas, W, H);

    var los = r.lineOfSight || [];
    var profile = r.rayProfile || [];
    var maxKm = 0;
    profile.forEach(function (p) { maxKm = Math.max(maxKm, p.distanceKm); });
    los.forEach(function (l) { if (l.toKm) maxKm = Math.max(maxKm, l.toKm); });
    maxKm = Math.max(maxKm * 1.1, 40);
    var maxH = 16; // km

    var padL = 34, padR = 12, padT = 10, padB = 24;
    var pw = W - padL - padR, ph = H - padT - padB;
    var X = function (km) { return padL + pw * (km / maxKm); };
    var Y = function (km) { return padT + ph * (1 - km / maxH); };

    // Stockwerksgrenzen nur als schwache Linien - die Farbe kommt aus dem Profil
    var bands = [[0, 3, 'tief'], [3, 8, 'mittel'], [8, 16, 'hoch']];
    bands.forEach(function (b) {
      ctx.fillStyle = 'rgba(170,200,240,0.05)';
      ctx.fillRect(padL, Y(b[1]), pw, Y(b[0]) - Y(b[1]));
      ctx.strokeStyle = 'rgba(120,160,230,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, Y(b[1])); ctx.lineTo(W - padR, Y(b[1])); ctx.stroke();
      ctx.fillStyle = 'rgba(150,175,215,0.75)';
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(b[2], padL + 4, Y(b[1]) + 11);
    });

    /*
     * Das eigentliche Wolkenprofil: je Stuetzpunkt ein Balken, der die Hoehe
     * seines Stockwerks fuellt und dessen Deckkraft der Bewoelkung dort
     * entspricht. So sieht man, wo entlang des Strahls die Wolken stehen.
     */
    if (profile.length > 1) {
      var stepPx = Math.max(2, X(profile[1].distanceKm) - X(profile[0].distanceKm));
      profile.forEach(function (p) {
        if (p.cover == null) return;
        var c = Math.max(0, Math.min(100, p.cover)) / 100;
        if (c <= 0.01) return;
        var top = Y(p.layer.maxM / 1000), bot = Y(p.layer.minM / 1000);
        ctx.fillStyle = (c > 0.5 ? 'rgba(255,120,150,' : 'rgba(120,200,255,') +
          (0.10 + c * 0.60).toFixed(3) + ')';
        ctx.fillRect(X(p.distanceKm) - stepPx / 2, top, stepPx, bot - top);
      });
    }

    // Boden
    ctx.strokeStyle = 'rgba(120,160,230,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(W - padR, Y(0)); ctx.stroke();

    // Sehstrahl: gekruemmt, weil der Boden unter ihm wegfaellt
    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (var i = 0; i <= 60; i++) {
      var km = maxKm * i / 60;
      // Umkehrung von groundDistanceToAltitude: Hoehe bei gegebener Bodendistanz
      var ang = km / VIS.EARTH_RADIUS_KM;
      var alt = r.peak.altitudeDeg * Math.PI / 180;
      var hh = VIS.EARTH_RADIUS_KM * (Math.cos(ang) + Math.sin(ang) * Math.tan(alt + ang / 2)) - VIS.EARTH_RADIUS_KM;
      var yy = Y(Math.max(0, Math.min(maxH, hh)));
      if (i === 0) ctx.moveTo(X(0), Y(0)); else ctx.lineTo(X(km), yy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Je Stockwerk die gewertete Stelle markieren - das ist die Zahl aus der Tabelle
    los.forEach(function (l) {
      if (!l.samples || l.cover == null) return;
      var mid = (l.fromKm + l.toKm) / 2;
      var x = X(mid), y = Y(l.layer.heightM / 1000);
      ctx.fillStyle = l.cover > 50 ? '#ff5c7a' : '#4ee1ff';
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(232,238,255,0.9)';
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(l.cover) + '%', x, y - 7);
    });

    // Beobachter
    ctx.fillStyle = '#e8eeff';
    ctx.beginPath(); ctx.arc(X(0), Y(0), 3.5, 0, Math.PI * 2); ctx.fill();

    // Achsen
    ctx.fillStyle = 'rgba(150,175,215,0.8)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('16 km', padL - 5, Y(16) + 8);
    ctx.fillText('0', padL - 5, Y(0) + 3);
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(maxKm) + ' km', W - padR - 14, H - 8);
    ctx.fillText('Entfernung →', padL + pw / 2, H - 8);
  }

  /* --- Verlaufsdiagramm --------------------------------------------- */

  function drawTimeline(r) {
    var canvas = $('tlCanvas');
    if (!canvas) return;
    var W = canvas.getBoundingClientRect().width;
    if (!W) return;
    var H = Math.max(150, Math.min(210, W * 0.52));
    canvas.style.height = H + 'px';
    var ctx = prepCanvas(canvas, W, H);

    var tl = r.timeline;
    if (!tl.length) return;
    var t0 = tl[0].date.getTime(), t1 = tl[tl.length - 1].date.getTime();
    var span = Math.max(1, t1 - t0);
    var padL = 34, padR = 12, padT = 12, padB = 26;
    var pw = W - padL - padR, ph = H - padT - padB;
    var X = function (d) { return padL + pw * ((d.getTime() - t0) / span); };
    var Y = function (c) { return padT + ph * (1 - c); };

    // Raster
    ctx.strokeStyle = 'rgba(120,160,230,0.16)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(150,175,215,0.8)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      var y = Y(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(Math.round(v * 100) + '%', padL - 5, y + 3);
    });

    // Flaeche
    var grad = ctx.createLinearGradient(0, padT, 0, padT + ph);
    grad.addColorStop(0, 'rgba(78,225,255,0.35)');
    grad.addColorStop(1, 'rgba(78,225,255,0.02)');
    ctx.beginPath();
    ctx.moveTo(X(tl[0].date), Y(0));
    tl.forEach(function (e) { ctx.lineTo(X(e.date), Y(e.chance)); });
    ctx.lineTo(X(tl[tl.length - 1].date), Y(0));
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // Linie
    ctx.strokeStyle = '#4ee1ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    tl.forEach(function (e, i) {
      var x = X(e.date), y = Y(e.chance);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Sonnenuntergang
    var c = state.circ;
    if (c.sunsetDuring && c.sunsetDuring.getTime() > t0 && c.sunsetDuring.getTime() < t1) {
      var xs = X(c.sunsetDuring);
      ctx.strokeStyle = 'rgba(255,92,122,0.8)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(xs, padT); ctx.lineTo(xs, padT + ph); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff5c7a';
      ctx.textAlign = 'center';
      ctx.fillText('SU', xs, padT - 2);
    }

    // Maximum
    tl.forEach(function (e) {
      if (!e.isPeak) return;
      var x = X(e.date), y = Y(e.chance);
      ctx.fillStyle = '#ffb347';
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillText('Max', x, y - 9);
    });

    // Zeitachse
    ctx.fillStyle = 'rgba(150,175,215,0.8)';
    ctx.textAlign = 'left';
    ctx.fillText(fmtTime(tl[0].date), padL, H - 8);
    ctx.textAlign = 'right';
    ctx.fillText(fmtTime(tl[tl.length - 1].date), W - padR, H - 8);
  }

  /* --- Klimatologie -------------------------------------------------- */

  function loadClimatology() {
    var c = state.circ;
    var box = $('climaResult');
    if (!c || !c.hasEclipse) {
      box.innerHTML = '<div class="notice notice-info">An diesem Ort ist die Finsternis nicht zu sehen.</div>';
      return;
    }
    var btn = $('btnClima');
    btn.disabled = true;
    btn.textContent = '… 0 / 20 Jahre';
    box.innerHTML = '';

    var sun = { altitudeDeg: c.maxAltitude, azimuthDeg: c.maxAzimuth };
    VIS.analyseClimatology(state.place, sun, c.maxDate, {
      onProgress: function (done, total) { btn.textContent = '… ' + done + ' / ' + total + ' Jahre'; }
    }).then(function (r) {
      resetBtn('btnClima', '↻ Neu auswerten');
      if (!r) {
        box.innerHTML = '<div class="notice notice-info">Keine Archivdaten für diesen Ort.</div>';
        return;
      }
      visState.clima = r;
      box.innerHTML = climaHTML(r);
      drawClima(r);
    }).catch(function (err) {
      netError(box, err, 'btnClima', '↻ Erneut versuchen');
    });
  }

  function climaHTML(r) {
    var h = '<div class="vis-head"><div class="vis-pct">' + pctText(r.median) + '</div>' +
      '<div class="vis-rate">Median über ' + r.perYear.length + ' Jahre</div></div>';
    h += '<p class="vis-why">In <strong>' + pctText(r.goodShare) + '</strong> der ausgewerteten Fälle ' +
      'wäre die Sonne gut zu sehen gewesen (Chance über 60 %). Mittleres Viertel: ' +
      pctText(r.p25) + ' bis ' + pctText(r.p75) + '.</p>';
    h += '<div class="clima-wrap"><canvas id="climaCanvas"></canvas></div>';
    h += '<p class="vis-foot">Ein Balken je Jahr: mittlere Sichtchance am ' +
      'Kalendertag der Finsternis (±3 Tage), zur selben Tageszeit. ' +
      r.samples + ' Stundenwerte aus dem ERA5-Archiv.</p>';
    return h;
  }

  function drawClima(r) {
    var canvas = $('climaCanvas');
    if (!canvas) return;
    var W = canvas.getBoundingClientRect().width;
    if (!W) return;
    var H = 130;
    canvas.style.height = H + 'px';
    var ctx = prepCanvas(canvas, W, H);

    var padL = 30, padR = 8, padT = 8, padB = 22;
    var pw = W - padL - padR, ph = H - padT - padB;
    var n = r.perYear.length || 1;
    var bw = pw / n;

    ctx.strokeStyle = 'rgba(120,160,230,0.16)';
    ctx.fillStyle = 'rgba(150,175,215,0.8)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    [0, 0.5, 1].forEach(function (v) {
      var y = padT + ph * (1 - v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(Math.round(v * 100) + '%', padL - 4, y + 3);
    });

    r.perYear.forEach(function (y, i) {
      var x = padL + bw * i;
      var hgt = ph * y.mean;
      ctx.fillStyle = y.mean > 0.6 ? 'rgba(67,232,160,0.75)'
        : y.mean > 0.4 ? 'rgba(255,179,71,0.75)' : 'rgba(255,92,122,0.7)';
      ctx.fillRect(x + bw * 0.15, padT + ph - hgt, bw * 0.7, hgt);
    });

    // Median als Linie
    var ym = padT + ph * (1 - r.median);
    ctx.strokeStyle = 'rgba(232,238,255,0.7)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padL, ym); ctx.lineTo(W - padR, ym); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(150,175,215,0.8)';
    ctx.textAlign = 'left';
    if (r.perYear.length) ctx.fillText(r.perYear[0].year, padL, H - 7);
    ctx.textAlign = 'right';
    if (r.perYear.length) ctx.fillText(r.perYear[r.perYear.length - 1].year, W - padR, H - 7);
  }

  /* --- Orte vergleichen ---------------------------------------------- */

  function setupCompare() {
    var input = $('cmpSearch');
    var box = $('cmpSuggestions');
    if (!input) return;

    function close() { box.innerHTML = ''; }

    input.addEventListener('input', function () {
      var v = input.value.trim();
      if (v.length < 2) { close(); return; }
      box.innerHTML = '';
      window.Cities.search(v, 6).forEach(function (c) {
        var d = document.createElement('div');
        d.className = 'sugg';
        d.innerHTML = '<span>' + c.name + '</span><span class="c">' + c.countryName + '</span>';
        d.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          addCompare(c);
          input.value = '';
          close();
        });
        box.appendChild(d);
      });
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
  }

  function addCompare(c) {
    for (var i = 0; i < visState.compare.length; i++) {
      if (visState.compare[i].name === c.name) return;
    }
    visState.compare.push({ name: c.name, lat: c.lat, lon: c.lon, height: c.height, tz: c.tz });
    renderCompareChips();
  }

  function renderCompareChips() {
    var box = $('cmpChips');
    box.innerHTML = '';
    visState.compare.forEach(function (p, i) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = escapeHTML(p.name) + ' <button type="button" aria-label="Entfernen">×</button>';
      chip.querySelector('button').addEventListener('click', function () {
        visState.compare.splice(i, 1);
        renderCompareChips();
      });
      box.appendChild(chip);
    });
  }

  /*
   * Vergleicht den aktuellen Standort mit den gewaehlten Orten. Fuer jeden Ort
   * werden eigene oertliche Umstaende gerechnet - das Maximum faellt anderswo
   * auf eine andere Uhrzeit und eine andere Sonnenhoehe.
   */
  function loadCompare() {
    var box = $('cmpResult');
    var places = [state.place].concat(visState.compare);
    if (places.length < 2) {
      box.innerHTML = '<div class="notice notice-info">Such dir oben mindestens einen ' +
        'weiteren Ort dazu.</div>';
      return;
    }
    var btn = $('btnCmp');
    btn.disabled = true;
    btn.textContent = '…';
    box.innerHTML = '';

    var jobs = places.map(function (p) {
      var circ = EC.localCircumstances(p.lat, p.lon, p.height || 0, EL);
      if (!circ.hasEclipse) return Promise.resolve({ place: p, circ: circ, chance: null });
      var obs = EC.makeObserver(p.lat, p.lon, p.height || 0);
      var st = EC.stateAt(EL, obs, circ.maxT);
      var step = [{
        date: circ.maxDate, altitudeDeg: st.altitudeDeg,
        azimuthDeg: st.azimuthDeg, isPeak: true
      }];
      return VIS.analyse(p, step, { models: [VIS.PRIMARY_MODEL] })
        .then(function (r) { return { place: p, circ: circ, chance: r.peak.chance, r: r }; });
    });

    Promise.all(jobs).then(function (rows) {
      resetBtn('btnCmp', 'Vergleichen');
      rows.sort(function (a, b) { return (b.chance || 0) - (a.chance || 0); });
      var h = '<div class="vis-rows">';
      rows.forEach(function (row, i) {
        var ch = row.chance === null ? '–' : pctText(row.chance);
        h += '<div class="vis-row' + (i === 0 && row.chance !== null ? ' is-best' : '') + '">' +
          '<span class="vis-layer">' + escapeHTML(row.place.name) +
          (row.place === state.place ? ' <em>(hier)</em>' : '') + '</span>' +
          '<span class="vis-dist">' + (row.circ.hasEclipse ? fmtPct(row.circ.obscuration) : '–') + '</span>' +
          '<span class="vis-cover">' + ch + '</span></div>';
      });
      h += '</div><p class="vis-foot">Mitte: Bedeckungsgrad, rechts: Sichtchance im ' +
        'Maximum des jeweiligen Ortes. Sortiert nach Sichtchance.</p>';
      box.innerHTML = h;
    }).catch(function (err) {
      netError(box, err, 'btnCmp', 'Vergleichen');
    });
  }

  /* --- Live-Ansicht -------------------------------------------------- */

  /*
   * Zeigt waehrend der Finsternis den aktuellen Stand: laufende Phase,
   * Fortschritt und die Zeit bis zum naechsten Ereignis. Ausserhalb des
   * Finsternisfensters sagt sie, wann es losgeht.
   */
  function renderLive() {
    var box = $('liveBody');
    if (!box) return;
    var c = state.circ;
    if (!c || !c.hasEclipse) {
      box.innerHTML = '<p class="vis-intro">An diesem Ort ist von der Finsternis nichts zu sehen.</p>';
      return;
    }

    var now = new Date();
    var t = nowT();
    var events = [];
    if (c.c1T !== null) events.push(['1. Kontakt', c.c1T]);
    if (c.c2T !== null) events.push(['Totalität beginnt', c.c2T]);
    events.push(['Maximum', c.maxT]);
    if (c.c3T !== null) events.push(['Totalität endet', c.c3T]);
    if (c.c4T !== null) events.push(['4. Kontakt', c.c4T]);

    var next = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i][1] > t) { next = events[i]; break; }
    }

    var running = c.c1T !== null && c.c4T !== null && t >= c.c1T && t <= c.c4T;
    var st = EC.stateAt(EL, state.obs, t);
    var progress = running ? (t - c.c1T) / (c.c4T - c.c1T) : (t < c.c1T ? 0 : 1);

    var h = '<div class="live-state ' + (running ? 'is-running' : '') + '">' +
      '<span class="live-dot"></span>' +
      (running ? 'Die Finsternis läuft gerade'
               : t < (c.c1T === null ? c.maxT : c.c1T) ? 'Noch nicht begonnen' : 'Vorbei') +
      '</div>';

    h += '<div class="live-bar"><i style="width:' +
      (Math.max(0, Math.min(1, progress)) * 100).toFixed(1) + '%"></i></div>';

    h += '<div class="readout" style="margin-top:12px">' +
      '<div class="ro"><div class="ro-val">' + fmtPct(st.obscuration) + '</div><div class="ro-lab">bedeckt jetzt</div></div>' +
      '<div class="ro"><div class="ro-val">' + fmtDeg(st.altitudeDeg) + '</div><div class="ro-lab">Sonnenhöhe</div></div>' +
      '<div class="ro"><div class="ro-val">' + compassName(st.azimuthDeg) + '</div><div class="ro-lab">Richtung</div></div>' +
      '</div>';

    if (next) {
      var secs = Math.max(0, (EC.tToDate(EL, next[1]) - now) / 1000);
      h += '<div class="live-next"><span>Nächstes: <strong>' + next[0] + '</strong></span>' +
        '<span class="live-timer">in ' + fmtDuration(secs) + '</span></div>';
    } else {
      h += '<div class="live-next"><span>Die Finsternis ist an deinem Ort vorbei.</span></div>';
    }

    if (c.sunsetDuring && c.sunsetDuring > now) {
      h += '<p class="vis-foot">Achtung: Die Sonne geht um ' + fmtTime(c.sunsetDuring) +
        ' unter, noch während die Finsternis läuft.</p>';
    }
    box.innerHTML = h;
  }

  /* ==================================================================
   * Canvas: Sonnenansicht
   * ================================================================== */

  function prepCanvas(canvas, cssW, cssH) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    return ctx;
  }

  function drawSun(s) {
    var canvas = $('sunCanvas');
    var rect = canvas.getBoundingClientRect();
    var W = rect.width || 340, H = rect.height || 340;
    if (!W) return;
    var ctx = prepCanvas(canvas, W, H);

    var cx = W / 2, cy = H / 2 - H * 0.03;
    var R = Math.min(W, H) * 0.205;  // Sonnenradius auf dem Bildschirm

    var covered = s.m < s.L1;
    var totalityNow = s.L2 < 0 && s.m < Math.abs(s.L2);

    // Massstab: Besselsche Einheiten -> Pixel
    var scale = R / s.rSun;
    var moonR = s.rMoon * scale;
    var dist = s.m * scale;

    // Position des Mondmittelpunkts: Zenitwinkel, vom Bildoben gegen Uhrzeiger
    var Z = s.zenithAngle * DEG;
    var mx = cx - Math.sin(Z) * dist;
    var my = cy - Math.cos(Z) * dist;

    // --- Korona / Glanz -------------------------------------------
    if (totalityNow) {
      // Totalitaet: Korona sichtbar
      var g = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 3.0);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.12, 'rgba(220,235,255,0.28)');
      g.addColorStop(0.4, 'rgba(160,200,255,0.10)');
      g.addColorStop(1, 'rgba(120,170,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 3.0, 0, Math.PI * 2);
      ctx.fill();

      // Koronastrahlen
      ctx.save();
      ctx.translate(cx, cy);
      for (var i = 0; i < 26; i++) {
        var a = (i / 26) * Math.PI * 2 + 0.4;
        var len = R * (1.35 + 0.85 * Math.abs(Math.sin(i * 2.7)));
        ctx.strokeStyle = 'rgba(225,240,255,' + (0.05 + 0.07 * Math.abs(Math.cos(i * 1.9))) + ')';
        ctx.lineWidth = R * 0.10;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * R * 1.0, Math.sin(a) * R * 1.0);
        ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      // Helligkeit sinkt mit der Bedeckung
      var bright = 1 - (covered ? s.obscuration : 0) * 0.72;
      var g2 = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 2.5);
      g2.addColorStop(0, 'rgba(255,200,110,' + (0.38 * bright) + ')');
      g2.addColorStop(0.45, 'rgba(255,160,60,' + (0.13 * bright) + ')');
      g2.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Sonnenscheibe --------------------------------------------
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    var sunG = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.25, R * 0.1, cx, cy, R);
    sunG.addColorStop(0, '#fff8e6');
    sunG.addColorStop(0.55, '#ffd479');
    sunG.addColorStop(1, '#ffa22e');
    ctx.fillStyle = sunG;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    // --- Mondscheibe ----------------------------------------------
    if (dist < moonR + R) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, moonR, 0, Math.PI * 2);
      ctx.fillStyle = totalityNow ? '#05070f' : '#070a14';
      ctx.fill();

      // feiner Rand, damit der Mond auf dem dunklen Grund erkennbar bleibt
      ctx.strokeStyle = 'rgba(150,180,230,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    // --- Sonnenrand als Kontur ------------------------------------
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = totalityNow ? 'rgba(255,255,255,0.25)' : 'rgba(255,210,140,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // --- Horizont, wenn die Sonne tief steht ----------------------
    var altPx = s.altitudeDeg;
    if (altPx < 6) {
      // Massstab: scheinbarer Sonnendurchmesser ~0.53 Grad
      var sunDiameterDeg = 0.53;
      var pxPerDeg = (2 * R) / sunDiameterDeg;
      // s.altitudeDeg ist die wahre (unrefraktierte) Hoehe des Sonnenmittelpunkts.
      // Der Text "Sonnenuntergang" meldet sich erst bei EC.SUNSET_ALT_DEG (-0.833°),
      // weil Refraktion die Scheibe am Horizont noch anhebt. Ohne diesen Ausgleich
      // waere die gezeichnete Scheibe schon deutlich frueher komplett hinter der
      // Horizontlinie verschwunden als der Text den Sonnenuntergang meldet.
      var refractionDeg = -EC.SUNSET_ALT_DEG - sunDiameterDeg / 2;
      var horizonY = cy + (altPx + refractionDeg) * pxPerDeg;
      if (horizonY < H + R) {
        var hg = ctx.createLinearGradient(0, horizonY - 30, 0, H);
        hg.addColorStop(0, 'rgba(20,14,40,0)');
        hg.addColorStop(0.35, 'rgba(40,20,50,0.75)');
        hg.addColorStop(1, 'rgba(8,8,20,0.98)');
        ctx.fillStyle = hg;
        ctx.fillRect(0, horizonY - 30, W, H - horizonY + 30);

        ctx.strokeStyle = 'rgba(255,150,90,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, horizonY);
        ctx.lineTo(W, horizonY);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,170,120,0.75)';
        ctx.font = '10px ' + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = 'left';
        ctx.fillText('HORIZONT', 8, horizonY - 7);
      }
    }

    // --- Beschriftung: Himmelsrichtung am Rand --------------------
    ctx.fillStyle = 'rgba(150,175,215,0.55)';
    ctx.font = '600 10px ' + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'center';
    ctx.fillText('ZENIT ↑', cx, 16);
  }

  /* ==================================================================
   * Canvas: Horizontansicht (wohin schauen?)
   * ================================================================== */

  function drawHorizon(sNow) {
    var canvas = $('horizonCanvas');
    var rect = canvas.getBoundingClientRect();
    var W = rect.width || 340;
    // Auf breiten Schirmen darf die Himmelsansicht hoeher werden, sonst
    // bleibt vom Sonnenbogen nur ein flacher Streifen uebrig.
    var H = Math.max(150, Math.min(260, W * 0.5));
    canvas.style.height = H + 'px';
    if (!W) return;
    var ctx = prepCanvas(canvas, W, H);

    var c = state.circ;
    if (!c.hasEclipse) return;

    // Azimut-Fenster um den Verlauf herum
    var azs = [c.azC1, c.maxAzimuth, c.azC4].filter(function (v) { return v !== null && v !== undefined; });
    var azMin = Math.min.apply(null, azs) - 14;
    var azMax = Math.max.apply(null, azs) + 14;
    if (azMax - azMin < 45) {
      var mid = (azMin + azMax) / 2;
      azMin = mid - 22.5; azMax = mid + 22.5;
    }

    var altMax = Math.max(14, c.maxAltitude + 6);
    var altMin = -4;
    // padT laesst Platz fuer die Beschriftung des hoechsten Punktes (C1)
    var padL = 26, padR = 26, padT = 26, padB = 36;

    function X(az) { return padL + (az - azMin) / (azMax - azMin) * (W - padL - padR); }
    function Y(alt) { return H - padB - (alt - altMin) / (altMax - altMin) * (H - padT - padB); }

    // Himmel
    var sky = ctx.createLinearGradient(0, padT, 0, Y(0));
    sky.addColorStop(0, 'rgba(30,45,90,0.55)');
    sky.addColorStop(0.6, 'rgba(70,50,90,0.5)');
    sky.addColorStop(1, 'rgba(140,70,60,0.45)');
    ctx.fillStyle = sky;
    ctx.fillRect(0, padT, W, Y(0) - padT);

    // Boden
    ctx.fillStyle = 'rgba(6,8,16,0.92)';
    ctx.fillRect(0, Y(0), W, H - Y(0));

    // Horizontlinie
    ctx.strokeStyle = 'rgba(255,150,90,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke();

    // Hoehenlinien
    ctx.font = '9px ' + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'left';
    for (var a = 10; a <= altMax; a += 10) {
      ctx.strokeStyle = 'rgba(120,160,230,0.13)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Y(a)); ctx.lineTo(W, Y(a)); ctx.stroke();
      ctx.fillStyle = 'rgba(150,175,215,0.5)';
      ctx.fillText(a + '°', 4, Y(a) - 3);
    }

    // Kompassmarken: Gradzahlen alle 10 Grad ...
    ctx.textAlign = 'center';
    var fam = getComputedStyle(document.body).fontFamily;
    for (var az = Math.ceil(azMin / 10) * 10; az <= azMax; az += 10) {
      var x = X(az);
      if (x < padL - 4 || x > W - padR + 4) continue;
      ctx.strokeStyle = 'rgba(120,160,230,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, Y(0)); ctx.lineTo(x, Y(0) + 5); ctx.stroke();
      ctx.fillStyle = 'rgba(150,175,215,0.6)';
      ctx.font = '9px ' + fam;
      ctx.fillText(Math.round(az) + '°', x, Y(0) + 16);
    }

    // ... und die Kompassnamen an den echten Kompasspunkten (alle 22,5 Grad)
    for (var ci = Math.floor(azMin / 22.5); ci <= Math.ceil(azMax / 22.5); ci++) {
      var caz = ci * 22.5;
      if (caz < azMin || caz > azMax) continue;
      var cxp = X(caz);
      if (cxp < padL + 6 || cxp > W - padR - 6) continue;
      ctx.strokeStyle = 'rgba(180,205,245,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cxp, Y(0)); ctx.lineTo(cxp, Y(0) + 9); ctx.stroke();
      ctx.fillStyle = 'rgba(200,220,255,0.95)';
      ctx.font = '700 11px ' + fam;
      ctx.fillText(COMPASS[((ci % 16) + 16) % 16], cxp, Y(0) + 24);
    }

    // Sonnenbahn C1 -> C4
    ctx.strokeStyle = 'rgba(255,179,71,0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    var started = false;
    for (var k = 0; k <= 80; k++) {
      var tt = c.c1T + (c.c4T - c.c1T) * (k / 80);
      var st = EC.stateAt(EL, state.obs, tt);
      var px = X(st.azimuthDeg), py = Y(st.altitudeDeg);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Marken C1 / Max / C4
    [[c.c1T, 'C1'], [c.maxT, 'Max'], [c.c4T, 'C4']].forEach(function (m) {
      if (m[0] === null) return;
      var st = EC.stateAt(EL, state.obs, m[0]);
      var px = X(st.azimuthDeg), py = Y(st.altitudeDeg);
      ctx.fillStyle = 'rgba(255,179,71,0.85)';
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,215,160,0.9)';
      ctx.font = '600 9.5px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'center';
      ctx.fillText(m[1], px, py - 8);
    });

    // Aktuelle Sonnenposition
    var sx = X(sNow.azimuthDeg), sy = Y(sNow.altitudeDeg);
    var glow = ctx.createRadialGradient(sx, sy, 1, sx, sy, 16);
    glow.addColorStop(0, 'rgba(255,220,150,0.9)');
    glow.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#fff2cf';
    ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* ==================================================================
   * Countdown
   * ================================================================== */

  function renderCountdown() {
    var c = state.circ;
    var target, label, live = false;
    var now = new Date();

    if (!c || !c.hasEclipse) {
      target = EC.tToDate(EL, 0);
      label = 'Bis zur größten Finsternis (weltweit)';
    } else if (now < c.c1) {
      target = c.c1;
      label = 'Bis zum Beginn an deinem Ort';
    } else if (c.c2 && now < c.c2) {
      target = c.c2;
      label = 'Bis zur TOTALITÄT';
      live = true;
    } else if (now < c.maxDate) {
      target = c.maxDate;
      label = 'Bis zum Maximum';
      live = true;
    } else if (now < c.c4) {
      target = c.c4;
      label = 'Bis zum Ende der Finsternis';
      live = true;
    } else {
      $('cdLabel').textContent = 'Die Sonnenfinsternis ist vorbei';
      ['cdD', 'cdH', 'cdM', 'cdS'].forEach(function (id) { $(id).textContent = '00'; });
      return;
    }

    var diff = Math.max(0, target - now);
    var totalS = Math.floor(diff / 1000);
    var d = Math.floor(totalS / 86400);
    var h = Math.floor((totalS % 86400) / 3600);
    var m = Math.floor((totalS % 3600) / 60);
    var s = totalS % 60;

    $('cdLabel').textContent = label;
    $('cdD').textContent = String(d).padStart(2, '0');
    $('cdH').textContent = String(h).padStart(2, '0');
    $('cdM').textContent = String(m).padStart(2, '0');
    $('cdS').textContent = String(s).padStart(2, '0');
    $('countdown').classList.toggle('is-live', live);
  }

  /* ==================================================================
   * Kalender-Export (ICS)
   * ================================================================== */

  function icsDate(d) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function downloadICS() {
    var c = state.circ;
    if (!c || !c.hasEclipse) return;

    var desc = [
      'Partielle Sonnenfinsternis in ' + state.place.name,
      'Beginn (C1): ' + fmtTime(c.c1, true),
      'Maximum: ' + fmtTime(c.maxDate, true) + ' (' + (c.obscuration * 100).toFixed(1) + ' % bedeckt)',
      'Ende (C4): ' + fmtTime(c.c4, true),
      'Sonnenhoehe beim Maximum: ' + c.maxAltitude.toFixed(1) + ' Grad Richtung ' + compassName(c.maxAzimuth),
      '',
      'ACHTUNG: Nur mit zertifizierter Sonnenfinsternis-Brille beobachten!'
    ].join('\\n');

    var title = c.isTotal
      ? 'Totale Sonnenfinsternis (' + fmtDuration(c.durationTotalityS) + ')'
      : 'Sonnenfinsternis – ' + (c.obscuration * 100).toFixed(0) + ' % bedeckt';

    var ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SoFi-Tracker 2026//DE',
      'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      'UID:sofi2026-' + Date.now() + '@sofi-tracker',
      'DTSTAMP:' + icsDate(new Date()),
      'DTSTART:' + icsDate(c.c1),
      'DTEND:' + icsDate(c.c4),
      'SUMMARY:' + title,
      'DESCRIPTION:' + desc,
      'LOCATION:' + state.place.name,
      'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY',
      'DESCRIPTION:Sonnenfinsternis beginnt in 30 Minuten – Brille nicht vergessen!',
      'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');

    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sonnenfinsternis-2026.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function shareResult() {
    var c = state.circ;
    if (!c || !c.hasEclipse) return;
    var text = 'Sonnenfinsternis am 12.08.2026 in ' + state.place.name + ':\n' +
      'Beginn ' + fmtTime(c.c1) + ' · Maximum ' + fmtTime(c.maxDate) +
      ' (' + (c.obscuration * 100).toFixed(1) + ' % bedeckt) · Ende ' + fmtTime(c.c4) + '\n' +
      'Sonne steht dann ' + fmtDeg(c.maxAltitude) + ' hoch Richtung ' + compassName(c.maxAzimuth) + '.';

    if (navigator.share) {
      navigator.share({ title: 'Sonnenfinsternis 2026', text: text, url: location.href })
        .catch(function () { /* abgebrochen */ });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text + '\n' + location.href).then(function () {
        var b = $('btnShare');
        var old = b.textContent;
        b.textContent = '✓ Kopiert';
        setTimeout(function () { b.textContent = old; }, 1800);
      });
    }
  }

  /* ==================================================================
   * Sternenfeld
   * ================================================================== */

  function drawStarfield() {
    var canvas = $('starfield');
    var W = window.innerWidth, H = window.innerHeight;
    var ctx = prepCanvas(canvas, W, H);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    var count = Math.min(190, Math.round(W * H / 9000));
    for (var i = 0; i < count; i++) {
      // deterministisches Pseudo-Rauschen, damit es beim Resize ruhig bleibt
      var r1 = Math.sin(i * 127.1) * 43758.5453;
      var r2 = Math.sin(i * 311.7) * 24634.6345;
      var r3 = Math.sin(i * 74.7) * 19873.1234;
      var x = (r1 - Math.floor(r1)) * W;
      var y = (r2 - Math.floor(r2)) * H;
      var a = 0.12 + (r3 - Math.floor(r3)) * 0.55;
      var rad = 0.4 + (r3 - Math.floor(r3)) * 1.1;
      ctx.fillStyle = 'rgba(210,230,255,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ==================================================================
   * Start
   * ================================================================== */

  function init() {
    setupSearch();
    setupManual();
    setupSlider();

    $('btnGeo').addEventListener('click', useGeolocation);
    $('btnIcs').addEventListener('click', downloadICS);
    $('btnShare').addEventListener('click', shareResult);
    $('btnVis').addEventListener('click', loadVisibility);
    $('btnClima').addEventListener('click', loadClimatology);
    $('btnCmp').addEventListener('click', loadCompare);
    setupCompare();

    drawStarfield();

    var saved = loadSavedPlace();
    if (saved) {
      setPlace(saved);
      if (saved.source === 'city') $('citySearch').value = saved.name;
    } else {
      // Sinnvoller Startwert, bis der Nutzer waehlt
      var start = window.Cities.search(DEFAULT_CITY, 1)[0] || window.Cities.all[0];
      setPlace({
        name: start.name, lat: start.lat, lon: start.lon,
        height: start.height, tz: start.tz, source: 'default'
      });
      $('citySearch').value = '';
    }

    renderCountdown();
    setInterval(function () {
      renderCountdown();
      renderLive();
      if (state.live) renderDynamic();
    }, 1000);

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        drawStarfield();
        renderDynamic();
        if (visState.data) { drawProfile(visState.data); drawTimeline(visState.data); }
        if (visState.clima) drawClima(visState.clima);
      }, 150);
    });

    // Service Worker fuer Offline-Betrieb
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* egal */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
