/*
 * eclipse-core.js
 * ---------------------------------------------------------------------------
 * Berechnung der oertlichen Umstaende einer Sonnenfinsternis aus den
 * Besselschen Elementen. Verfahren nach Meeus, "Elements of Solar Eclipses"
 * bzw. Explanatory Supplement to the Astronomical Almanac.
 *
 * Alles laeuft offline im Browser - keine API, kein Netz noetig.
 * ---------------------------------------------------------------------------
 */

(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;

  /* ------------------------------------------------------------------
   * Besselsche Elemente: Totale Sonnenfinsternis 2026 August 12
   * Quelle: NASA/GSFC Five Millennium Canon of Solar Eclipses (Espenak/Meeus)
   * t = TT-Stunden - T0, alle Winkel in Grad, x/y/l in Erdaequatorradien.
   * ------------------------------------------------------------------ */
  var EC2026 = {
    id: '2026-08-12',
    name: 'Totale Sonnenfinsternis',
    dateUTC: '2026-08-12',
    // Bezugszeitpunkt der Elemente (Terrestrial Time, Stunden des Tages)
    t0: 18.0,
    // Differenz TT - UT in Sekunden (NASA-Vorhersagewert fuer 2026)
    deltaT: 75.4,
    // Polynomkoeffizienten [a0, a1, a2, a3]
    x: [0.4755140, 0.5189249, -0.0000773, -0.0000080],
    y: [0.7711830, -0.2301680, -0.0001246, 0.0000038],
    d: [14.7966700, -0.0120650, -0.0000030, 0.0000000],
    l1: [0.5379550, 0.0000939, -0.0000121, 0.0000000],
    l2: [-0.0081420, 0.0000935, -0.0000121, 0.0000000],
    mu: [88.747787, 15.003090, 0.000000, 0.000000],
    tanF1: 0.0046141,
    tanF2: 0.0045911,
    // Gueltigkeitsfenster in TT-Stunden relativ zu t0 (grosszuegig)
    tMin: -3.5,
    tMax: 3.5
  };

  // Erdabplattung (WGS84-nah, wie in den NASA-Elementen verwendet)
  var FLATTENING_FACTOR = 0.99664719;
  var EARTH_RADIUS_M = 6378140;

  /* ------------------------------------------------------------------
   * Hilfsfunktionen
   * ------------------------------------------------------------------ */

  function poly(coeffs, t) {
    var v = 0;
    for (var i = coeffs.length - 1; i >= 0; i--) v = v * t + coeffs[i];
    return v;
  }

  function polyDeriv(coeffs, t) {
    // Ableitung nach t (pro Stunde)
    var v = 0;
    for (var i = coeffs.length - 1; i >= 1; i--) v = v * t + i * coeffs[i];
    return v;
  }

  function norm360(a) {
    a = a % 360;
    return a < 0 ? a + 360 : a;
  }

  /**
   * Werte die Besselschen Elemente zum Zeitpunkt t (TT-Stunden seit t0) aus.
   */
  function elementsAt(el, t) {
    return {
      t: t,
      x: poly(el.x, t),
      y: poly(el.y, t),
      d: poly(el.d, t) * DEG,
      l1: poly(el.l1, t),
      l2: poly(el.l2, t),
      mu: norm360(poly(el.mu, t)) * DEG,
      dx: polyDeriv(el.x, t),
      dy: polyDeriv(el.y, t),
      dd: polyDeriv(el.d, t) * DEG,
      dmu: polyDeriv(el.mu, t) * DEG
    };
  }

  /**
   * Geozentrische Beobachterkoordinaten (rho*sin(phi'), rho*cos(phi')).
   * @param latDeg geodaetische Breite in Grad
   * @param heightM Hoehe ueber dem Ellipsoid in Metern
   */
  function observerGeocentric(latDeg, heightM) {
    var phi = latDeg * DEG;
    var u = Math.atan(FLATTENING_FACTOR * Math.tan(phi));
    var h = (heightM || 0) / EARTH_RADIUS_M;
    return {
      rhoSin: FLATTENING_FACTOR * Math.sin(u) + h * Math.sin(phi),
      rhoCos: Math.cos(u) + h * Math.cos(phi)
    };
  }

  /**
   * Kern: Zustand der Finsternis am Beobachterort zum Zeitpunkt t.
   *
   * Liefert u,v (Abstand Schattenachse <-> Beobachter in der Fundamentalebene),
   * die auf die Beobachterebene reduzierten Kegelradien L1', L2', die
   * relative Geschwindigkeit n sowie Sonnenhoehe/-azimut.
   */
  function stateAt(el, obs, t) {
    var e = elementsAt(el, t);

    // Oertlicher Stundenwinkel der Schattenachse (Laenge oestlich positiv)
    var theta = e.mu + obs.lonRad;

    var sinD = Math.sin(e.d), cosD = Math.cos(e.d);
    var sinTheta = Math.sin(theta), cosTheta = Math.cos(theta);

    // Beobachter im Besselschen System
    var xi = obs.rhoCos * sinTheta;
    var eta = obs.rhoSin * cosD - obs.rhoCos * cosTheta * sinD;
    var zeta = obs.rhoSin * sinD + obs.rhoCos * cosTheta * cosD;

    // Zeitliche Ableitungen (pro Stunde)
    var dXi = e.dmu * obs.rhoCos * cosTheta;
    var dEta = e.dmu * xi * sinD - zeta * e.dd;

    // Relativposition Schattenachse - Beobachter
    var u = e.x - xi;
    var v = e.y - eta;
    var du = e.dx - dXi;
    var dv = e.dy - dEta;

    var n = Math.sqrt(du * du + dv * dv);
    var m = Math.sqrt(u * u + v * v);

    // Kegelradien in der Beobachterebene
    var L1 = e.l1 - zeta * el.tanF1;
    var L2 = e.l2 - zeta * el.tanF2;

    // Scheinbare Radien von Sonne und Mond in Besselschen Einheiten
    var rSun = (L1 + L2) / 2;
    var rMoon = (L1 - L2) / 2;

    // Groessenverhaeltnis (Magnitude): 0 = kein Kontakt, 1 = total/ringfoermig
    var magnitude = (L1 + L2) === 0 ? 0 : (L1 - m) / (L1 + L2);
    if (magnitude < 0) magnitude = 0;

    // Verhaeltnis der scheinbaren Durchmesser Mond/Sonne. Innerhalb der
    // Totalitaetszone gibt die NASA diesen Wert als "Eclipse Magnitude" an.
    var diameterRatio = (L1 + L2) === 0 ? 0 : (L1 - L2) / (L1 + L2);

    // Sonnenhoehe/-azimut: Richtung der Schattenachse ~ Richtung der Sonne
    var sinAlt = obs.sinLat * sinD + obs.cosLat * cosD * cosTheta;
    var altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    // Azimut von Nord ueber Ost
    var azimuth = Math.atan2(
      -cosD * sinTheta,
      obs.cosLat * sinD - obs.sinLat * cosD * cosTheta
    );

    // Parallaktischer Winkel: dreht "Himmelsnord" in "Horizont-oben"
    var parallactic = Math.atan2(
      sinTheta,
      obs.tanLat * cosD - sinD * cosTheta
    );

    return {
      t: t,
      u: u, v: v, du: du, dv: dv,
      n: n, m: m,
      L1: L1, L2: L2,
      rSun: rSun, rMoon: rMoon,
      zeta: zeta,
      magnitude: magnitude,
      diameterRatio: diameterRatio,
      obscuration: circleOverlapFraction(m, rSun, rMoon),
      // Positionswinkel des Mondmittelpunkts, von Himmelsnord gegen Uhrzeiger
      positionAngle: norm360(Math.atan2(u, v) * RAD),
      // dasselbe, aber relativ zum Zenit (fuer die Horizontansicht)
      zenithAngle: norm360((Math.atan2(u, v) - parallactic) * RAD),
      altitudeDeg: altitude * RAD,
      azimuthDeg: norm360(azimuth * RAD),
      parallacticDeg: parallactic * RAD
    };
  }

  /**
   * Flaechenanteil der Sonnenscheibe, der vom Mond bedeckt ist.
   * Klassischer Kreis-Kreis-Schnitt.
   */
  function circleOverlapFraction(dist, rSun, rMoon) {
    if (rSun <= 0) return 0;
    if (dist >= rSun + rMoon) return 0;
    if (dist <= Math.abs(rMoon - rSun)) {
      return rMoon >= rSun ? 1 : (rMoon * rMoon) / (rSun * rSun);
    }
    var d2 = dist * dist, rs2 = rSun * rSun, rm2 = rMoon * rMoon;
    var a1 = Math.acos(Math.max(-1, Math.min(1, (d2 + rs2 - rm2) / (2 * dist * rSun))));
    var a2 = Math.acos(Math.max(-1, Math.min(1, (d2 + rm2 - rs2) / (2 * dist * rMoon))));
    var tri = 0.5 * Math.sqrt(
      Math.max(0, (-dist + rSun + rMoon) * (dist + rSun - rMoon) *
                  (dist - rSun + rMoon) * (dist + rSun + rMoon))
    );
    var area = rs2 * a1 + rm2 * a2 - tri;
    return Math.max(0, Math.min(1, area / (Math.PI * rs2)));
  }

  /**
   * Beobachterobjekt vorbereiten (spart Trigonometrie in der Schleife).
   */
  function makeObserver(latDeg, lonDeg, heightM) {
    var g = observerGeocentric(latDeg, heightM);
    var phi = latDeg * DEG;
    return {
      lat: latDeg,
      lon: lonDeg,
      height: heightM || 0,
      lonRad: lonDeg * DEG,
      sinLat: Math.sin(phi),
      cosLat: Math.cos(phi),
      tanLat: Math.tan(phi),
      rhoSin: g.rhoSin,
      rhoCos: g.rhoCos
    };
  }

  /* ------------------------------------------------------------------
   * Kontaktzeiten
   * ------------------------------------------------------------------ */

  /**
   * Iterative Bestimmung eines Kontakts.
   * @param which -1 = Eintritt (C1/C2), +1 = Austritt (C3/C4)
   * @param inner true = innerer Kontakt (C2/C3, Radius |L2'|)
   */
  function findContact(el, obs, tStart, which, inner) {
    var t = tStart;
    for (var i = 0; i < 60; i++) {
      var s = stateAt(el, obs, t);
      var L = inner ? Math.abs(s.L2) : s.L1;
      var n = s.n;
      if (n === 0) return null;

      // senkrechter Abstand der Schattenbahn vom Beobachter
      var delta = (s.u * s.dv - s.v * s.du) / n;
      var rad = L * L - delta * delta;
      if (rad < 0) return null; // Kontakt findet nicht statt

      var tau = -(s.u * s.du + s.v * s.dv) / (n * n) + which * Math.sqrt(rad) / n;
      t += tau;
      if (Math.abs(tau) < 1e-8) break;
      if (t < el.tMin || t > el.tMax) return null;
    }
    return t;
  }

  /**
   * Zeitpunkt der maximalen Bedeckung (kleinster Abstand u,v).
   */
  function findMaximum(el, obs, tStart) {
    var t = tStart;
    for (var i = 0; i < 60; i++) {
      var s = stateAt(el, obs, t);
      if (s.n === 0) break;
      var tau = -(s.u * s.du + s.v * s.dv) / (s.n * s.n);
      t += tau;
      if (Math.abs(tau) < 1e-9) break;
    }
    return t;
  }

  /* ------------------------------------------------------------------
   * Zeitumrechnung
   * ------------------------------------------------------------------ */

  function baseDateUTCms(el) {
    var p = el.dateUTC.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2], 0, 0, 0, 0);
  }

  /** TT-Stunden relativ zu t0  ->  JS-Date (UT) */
  function tToDate(el, t) {
    if (t === null || t === undefined || !isFinite(t)) return null;
    var ttHours = el.t0 + t;
    var utMs = baseDateUTCms(el) + ttHours * 3600000 - el.deltaT * 1000;
    return new Date(utMs);
  }

  /** JS-Date (UT) -> TT-Stunden relativ zu t0 */
  function dateToT(el, date) {
    var utHours = (date.getTime() - baseDateUTCms(el)) / 3600000;
    return utHours + el.deltaT / 3600 - el.t0;
  }

  /* ------------------------------------------------------------------
   * Sonnenauf-/-untergang im Finsternisfenster
   * ------------------------------------------------------------------ */

  /**
   * Sucht im Bereich [tA, tB] den Nulldurchgang der Sonnenhoehe.
   * Beruecksichtigt Refraktion und Halbmesser (-0.833 Grad Standard).
   */
  function findHorizonCrossing(el, obs, tA, tB) {
    var H0 = -0.833;
    var fa = stateAt(el, obs, tA).altitudeDeg - H0;
    var fb = stateAt(el, obs, tB).altitudeDeg - H0;
    if (fa * fb > 0) return null;
    var lo = tA, hi = tB;
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      var fm = stateAt(el, obs, mid).altitudeDeg - H0;
      if (fa * fm <= 0) { hi = mid; fb = fm; } else { lo = mid; fa = fm; }
    }
    return (lo + hi) / 2;
  }

  /* ------------------------------------------------------------------
   * Oeffentliche Hauptfunktion
   * ------------------------------------------------------------------ */

  /**
   * Berechnet die vollstaendigen oertlichen Umstaende.
   * @returns {Object} mit Kontaktzeiten (Date|null), Maximum, Magnitude,
   *                   Bedeckungsgrad, Sonnenhoehe usw.
   */
  function localCircumstances(latDeg, lonDeg, heightM, el) {
    el = el || EC2026;
    var obs = makeObserver(latDeg, lonDeg, heightM);

    // Startwert: Zeitpunkt der groessten Finsternis global
    var tMaxLocal = findMaximum(el, obs, 0);
    if (tMaxLocal < el.tMin || tMaxLocal > el.tMax) tMaxLocal = findMaximum(el, obs, -0.2);

    var sMax = stateAt(el, obs, tMaxLocal);

    var result = {
      element: el,
      observer: obs,
      hasEclipse: false,
      isTotal: false,
      isAnnular: false,
      type: 'keine',
      maxT: tMaxLocal,
      maxDate: tToDate(el, tMaxLocal),
      magnitude: 0,
      obscuration: 0,
      maxAltitude: sMax.altitudeDeg,
      maxAzimuth: sMax.azimuthDeg,
      c1: null, c2: null, c3: null, c4: null,
      c1T: null, c2T: null, c3T: null, c4T: null,
      durationTotalityS: 0,
      durationPartialS: 0,
      sunsetDuring: null,
      sunriseDuring: null,
      belowHorizonAtMax: sMax.altitudeDeg < -0.833
    };

    // Findet ueberhaupt eine Finsternis statt?
    if (sMax.m > sMax.L1) return result;

    result.hasEclipse = true;
    result.magnitude = sMax.magnitude;
    result.diameterRatio = sMax.diameterRatio;
    result.obscuration = sMax.obscuration;

    // Aeussere Kontakte
    result.c1T = findContact(el, obs, tMaxLocal, -1, false);
    result.c4T = findContact(el, obs, tMaxLocal, +1, false);

    // Innere Kontakte (nur wenn total/ringfoermig, also |m| < |L2'|)
    if (sMax.m < Math.abs(sMax.L2)) {
      if (sMax.L2 < 0) { result.isTotal = true; result.type = 'total'; }
      else { result.isAnnular = true; result.type = 'ringfoermig'; }
      result.c2T = findContact(el, obs, tMaxLocal, -1, true);
      result.c3T = findContact(el, obs, tMaxLocal, +1, true);
    } else {
      result.type = 'partiell';
    }

    result.c1 = tToDate(el, result.c1T);
    result.c2 = tToDate(el, result.c2T);
    result.c3 = tToDate(el, result.c3T);
    result.c4 = tToDate(el, result.c4T);

    if (result.c2T !== null && result.c3T !== null) {
      result.durationTotalityS = (result.c3T - result.c2T) * 3600;
    }
    if (result.c1T !== null && result.c4T !== null) {
      result.durationPartialS = (result.c4T - result.c1T) * 3600;
    }

    // Sonnenhoehe zu den Kontakten
    result.altC1 = result.c1T !== null ? stateAt(el, obs, result.c1T).altitudeDeg : null;
    result.altC4 = result.c4T !== null ? stateAt(el, obs, result.c4T).altitudeDeg : null;
    result.azC1 = result.c1T !== null ? stateAt(el, obs, result.c1T).azimuthDeg : null;
    result.azC4 = result.c4T !== null ? stateAt(el, obs, result.c4T).azimuthDeg : null;

    // Geht die Sonne waehrend der Finsternis unter (oder auf)?
    if (result.c1T !== null && result.c4T !== null) {
      var cross = findHorizonCrossing(el, obs, result.c1T, result.c4T);
      if (cross !== null) {
        var before = stateAt(el, obs, result.c1T).altitudeDeg;
        if (before > 0) result.sunsetDuring = tToDate(el, cross);
        else result.sunriseDuring = tToDate(el, cross);
        result.horizonCrossT = cross;
      }
    }

    return result;
  }

  /**
   * Zustand zu einer beliebigen Uhrzeit - fuer den Zeit-Slider.
   */
  function stateAtDate(obs, date, el) {
    el = el || EC2026;
    var t = dateToT(el, date);
    var s = stateAt(el, obs, t);
    s.date = date;
    return s;
  }

  /* ------------------------------------------------------------------
   * Export
   * ------------------------------------------------------------------ */

  global.EclipseCore = {
    ELEMENTS_2026: EC2026,
    makeObserver: makeObserver,
    localCircumstances: localCircumstances,
    stateAt: stateAt,
    stateAtDate: stateAtDate,
    elementsAt: elementsAt,
    tToDate: tToDate,
    dateToT: dateToT,
    findHorizonCrossing: findHorizonCrossing,
    circleOverlapFraction: circleOverlapFraction,
    DEG: DEG,
    RAD: RAD
  };
})(typeof window !== 'undefined' ? window : this);
