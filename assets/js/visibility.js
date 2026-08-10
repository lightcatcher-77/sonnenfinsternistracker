/*
 * Sichtprognose: Wird die verfinsterte Sonne durch die Wolken hindurch
 * ueberhaupt zu sehen sein?
 *
 * Kernidee - und der Grund, warum ein normaler Wetterbericht hier nicht
 * reicht: Entscheidend ist nicht die Bewoelkung *ueber* dem Beobachter,
 * sondern die Bewoelkung entlang der *Sichtlinie zur Sonne*. Am 12.08.2026
 * steht die Sonne bei uns nur wenige Grad hoch; die Wolke, die sie verdeckt,
 * haengt dann zig bis hunderte Kilometer entfernt - in einem voellig anderen
 * Gitterpunkt des Wettermodells als der Standort selbst. Ueber dem Kopf kann
 * es klar sein, waehrend die Finsternis hinter einer Wolkenbank verschwindet.
 * Und umgekehrt.
 *
 * Fuer jede der drei Wolkenschichten wird deshalb der Punkt berechnet, an dem
 * die Sichtlinie sie durchstoesst, und *dort* das Wetter abgefragt.
 *
 * Der Rechenteil ist frei von Netz und DOM. Nur fetchAlongLineOfSight() geht
 * ins Netz - der Rest der App bleibt offline lauffaehig.
 *
 * Portiert aus der Sichtprognose-App (Branch eclipse-visibility-forecast).
 */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;

  /** Mittlerer Erdradius in km. */
  var EARTH_RADIUS_KM = 6371.0088;

  /** Weiter entfernte Stuetzpunkte sind meteorologisch nicht mehr sinnvoll zuzuordnen. */
  var MAX_LINE_OF_SIGHT_KM = 300;

  /*
   * Die drei Wolkenstockwerke, wie Open-Meteo sie liefert.
   *
   * heightM ist die repraesentative Hoehe der Schicht (tief bis 3 km,
   * mittelhoch 3-8 km, hoch darueber). opacity ist die Wahrscheinlichkeit,
   * dass eine Wolke dieser Gattung die Sonnenscheibe wirklich verdeckt statt
   * sie nur abzuschwaechen: Stratocumulus macht dicht, durch duenne Cirren
   * sieht man eine Finsternis dagegen meist noch.
   */
  var CLOUD_LAYERS = [
    { key: 'low', label: 'Tiefe Wolken', lowerLabel: 'tiefe Wolken', shortLabel: 'tief', heightM: 1500, opacity: 0.95, variable: 'cloud_cover_low' },
    { key: 'mid', label: 'Mittelhohe Wolken', lowerLabel: 'mittelhohe Wolken', shortLabel: 'mittel', heightM: 5000, opacity: 0.85, variable: 'cloud_cover_mid' },
    { key: 'high', label: 'Hohe Wolken (Cirren)', lowerLabel: 'hohe Wolken (Cirren)', shortLabel: 'hoch', heightM: 10000, opacity: 0.4, variable: 'cloud_cover_high' }
  ];

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  /*
   * Wie weit entfernt (am Boden) steht die Wolke, die gerade vor der Sonne haengt?
   *
   * Gerechnet wird sphaerisch statt mit h/tan(alpha). Weil der Erdboden unter
   * dem Sehstrahl wegkruemmt, erreicht der Strahl eine gegebene Hoehe frueher
   * als ueber einer Ebene - bei 5 Grad Sonnenhoehe und 10 km Wolkenhoehe nach
   * 104 statt 114 km, bei 1 Grad nach 262 statt 573 km. Bei tiefer Sonne ist
   * der Unterschied also erheblich, und genau dort liegt unser Fall.
   *
   * Dreieck aus Erdmittelpunkt O, Beobachter P und Wolke C:
   *   |OP| = R, |OC| = R + h, Winkel bei P = 90 + alpha
   *   Sinussatz -> sin(C) = R*cos(alpha)/(R+h)
   *   O = 90 - alpha - C,  Bogenlaenge = R*O
   *
   * elevationDeg ist die geometrische, refraktionsfreie Sonnenhoehe - genau
   * das, was EclipseCore.stateAt() als altitudeDeg liefert.
   */
  function groundDistanceToAltitude(elevationDeg, heightM) {
    if (elevationDeg < 0) return Infinity;
    var R = EARTH_RADIUS_KM;
    var h = heightM / 1000;
    var sinC = (R * Math.cos(elevationDeg * DEG)) / (R + h);
    if (sinC >= 1) return Infinity;
    var angleC = Math.asin(sinC) * RAD;
    var angleO = 90 - elevationDeg - angleC;
    return Math.max(0, R * angleO * DEG);
  }

  /** Zielpunkt in Richtung bearingDeg (von Nord ueber Ost) in distanceKm Entfernung. */
  function destinationPoint(lat, lon, bearingDeg, distanceKm) {
    var d = distanceKm / EARTH_RADIUS_KM;
    var p1 = lat * DEG;
    var l1 = lon * DEG;
    var th = bearingDeg * DEG;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
    var l2 = l1 + Math.atan2(
      Math.sin(th) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2)
    );
    return { lat: p2 * RAD, lon: (((l2 * RAD + 540) % 360) - 180) };
  }

  /** Die Punkte, an denen die Sichtlinie zur Sonne die Wolkenschichten durchstoesst. */
  function lineOfSight(place, sun, opts) {
    var maxKm = (opts && opts.maxDistanceKm) || MAX_LINE_OF_SIGHT_KM;
    return CLOUD_LAYERS.map(function (layer) {
      var raw = groundDistanceToAltitude(sun.altitudeDeg, layer.heightM);
      var capped = !isFinite(raw) || raw > maxKm;
      var dist = capped ? maxKm : raw;
      return {
        layer: layer,
        distanceKm: dist,
        rawDistanceKm: raw,
        capped: capped,
        point: destinationPoint(place.lat, place.lon, sun.azimuthDeg, dist)
      };
    });
  }

  /*
   * Sichtchance aus den Wetterwerten entlang der Sichtlinie.
   *
   * Modell: Eine Wolkenschicht mit Bedeckungsgrad c verdeckt die Sonne mit der
   * Wahrscheinlichkeit c*opacity. Die Schichten gelten als unabhaengig, also
   * ist die Chance auf freie Sicht das Produkt der Gegenwahrscheinlichkeiten.
   * Darauf kommen drei Daempfungsfaktoren:
   *
   *  - horizon: Bei tief stehender Sonne geht der Blick durch viel Grenz-
   *    schicht, ausserdem verdecken Huegel, Baeume und Haeuser den Horizont.
   *    Modelle sehen das nicht.
   *  - haze: Bodennahe Sichtweite, nur bei tiefer Sonne relevant.
   *  - precipitation: Niederschlag bedeutet in der Praxis dichte Bewoelkung.
   *
   * Das Ergebnis ist eine Heuristik, keine Strahlungsrechnung - bewusst so
   * kalibriert, dass "80 %" heisst: In vier von fuenf vergleichbaren Lagen
   * sieht man die Sonne.
   */
  function visibilityChance(clouds, opts) {
    opts = opts || {};
    var sunAltitude = opts.sunAltitude;
    var precipitation = opts.precipitation || 0;
    var visibility = opts.visibility === undefined ? null : opts.visibility;

    var factors = {};
    var perLayer = {};

    if (sunAltitude <= 0) {
      return {
        chance: 0,
        factors: { clouds: 0, horizon: 0, haze: 1, precipitation: 1 },
        perLayer: perLayer,
        belowHorizon: true
      };
    }

    var clear = 1;
    for (var i = 0; i < CLOUD_LAYERS.length; i++) {
      var layer = CLOUD_LAYERS[i];
      var raw = clouds[layer.key];
      var cover = clamp((raw == null ? 0 : raw) / 100, 0, 1);
      var blocked = cover * layer.opacity;
      perLayer[layer.key] = { cover: cover, blocked: blocked };
      clear *= 1 - blocked;
    }
    factors.clouds = clear;

    // Tiefe Sonne: Dunst und Gelaendehorizont. Ab 10 Grad kein Abschlag mehr.
    factors.horizon = sunAltitude >= 10 ? 1 : clamp(0.55 + 0.045 * sunAltitude, 0.55, 1);

    // Sichtweite zaehlt nur, solange die Sonne tief steht (langer Weg durch Dunst).
    if (visibility === null || isNaN(visibility)) {
      factors.haze = 1;
    } else {
      var weight = clamp((15 - sunAltitude) / 15, 0, 1);
      var quality = clamp(visibility / 25000, 0, 1);
      factors.haze = 1 - (1 - quality) * weight;
    }

    factors.precipitation = precipitation > 0.2 ? 0.25 : precipitation > 0.05 ? 0.7 : 1;

    var chance = clamp(
      factors.clouds * factors.horizon * factors.haze * factors.precipitation, 0, 1
    );
    return { chance: chance, factors: factors, perLayer: perLayer, belowHorizon: false };
  }

  /** Welche Schicht traegt am meisten zur Verdeckung bei? */
  function dominantLayer(perLayer) {
    var best = null;
    for (var i = 0; i < CLOUD_LAYERS.length; i++) {
      var layer = CLOUD_LAYERS[i];
      var v = perLayer[layer.key];
      if (!v) continue;
      if (!best || v.blocked > best.blocked) {
        best = { cover: v.cover, blocked: v.blocked, layer: layer };
      }
    }
    return best && best.blocked > 0.05 ? best : null;
  }

  var RATINGS = [
    { min: 0.8, key: 'sehr-gut', label: 'Sehr gute Aussichten' },
    { min: 0.6, key: 'gut', label: 'Gute Aussichten' },
    { min: 0.4, key: 'mittel', label: 'Durchwachsen' },
    { min: 0.2, key: 'schlecht', label: 'Schlechte Aussichten' },
    { min: 0, key: 'sehr-schlecht', label: 'Kaum Chancen' }
  ];

  /** Textbewertung zu einer Sichtchance. */
  function rating(chance) {
    for (var i = 0; i < RATINGS.length; i++) {
      if (chance >= RATINGS[i].min) return RATINGS[i];
    }
    return RATINGS[RATINGS.length - 1];
  }

  /** Erklaerender Satz zur Bewertung - beantwortet "warum diese Zahl?". */
  function explain(result, sunAltitude) {
    if (result.belowHorizon) return 'Die Sonne steht zu diesem Zeitpunkt unter dem Horizont.';

    var parts = [];
    var dom = dominantLayer(result.perLayer);
    if (dom) {
      parts.push(dom.layer.lowerLabel + ' mit ' + Math.round(dom.cover * 100) +
        ' % Bedeckung in Blickrichtung');
    } else {
      parts.push('kaum Bewölkung in Blickrichtung');
    }
    if (result.factors.horizon < 1) {
      parts.push('Sonne nur ' + sunAltitude.toLocaleString('de-DE', { maximumFractionDigits: 1 }) +
        '° über dem Horizont');
    }
    if (result.factors.haze < 0.85) parts.push('Dunst in Horizontnähe');
    if (result.factors.precipitation < 1) parts.push('Niederschlag');

    return 'Ausschlaggebend: ' + parts.join(', ') + '.';
  }

  /* ==================================================================
   * Wetterabruf - der einzige Teil, der Netz braucht
   * ================================================================== */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** Datum als YYYY-MM-DD in UTC. */
  function utcDateString(d) {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  /** Volle Stunde in UTC als ISO-Kurzform, wie Open-Meteo sie in hourly.time nutzt. */
  function utcHourString(d) {
    return utcDateString(d) + 'T' + pad(d.getUTCHours()) + ':00';
  }

  /*
   * Holt die Bewoelkung an den Durchstosspunkten der Sichtlinie.
   *
   * Alle Punkte gehen in *einen* Request - Open-Meteo nimmt mehrere Koordinaten
   * kommagetrennt entgegen und antwortet mit einem Array in derselben
   * Reihenfolge. Der letzte Punkt ist der Beobachterstandort selbst; von dort
   * kommen Niederschlag und Sichtweite, die ja am Auge wirken, nicht an der Wolke.
   *
   * Die Wettermodelle liefern Stundenwerte; genommen wird die naechstliegende
   * volle Stunde zum Maximum.
   */
  function fetchAlongLineOfSight(place, sun, date, opts) {
    opts = opts || {};
    var los = lineOfSight(place, sun);

    var lats = los.map(function (p) { return p.point.lat.toFixed(4); });
    var lons = los.map(function (p) { return p.point.lon.toFixed(4); });
    lats.push(place.lat.toFixed(4));
    lons.push(place.lon.toFixed(4));

    // Auf die naechste volle Stunde runden
    var target = new Date(Math.round(date.getTime() / 3600000) * 3600000);
    var day = utcDateString(target);

    var url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + lats.join(',') +
      '&longitude=' + lons.join(',') +
      '&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation,visibility' +
      '&start_date=' + day + '&end_date=' + day +
      '&timezone=UTC';

    return fetch(url, { signal: opts.signal }).then(function (res) {
      if (!res.ok) throw new Error('Wetterabruf fehlgeschlagen (HTTP ' + res.status + ')');
      return res.json();
    }).then(function (data) {
      var series = Array.isArray(data) ? data : [data];
      if (series.length < los.length + 1) throw new Error('Unerwartete Antwort der Wetter-API');

      var stamp = utcHourString(target);

      function valueAt(entry, variable) {
        var h = entry && entry.hourly;
        if (!h || !h.time) return null;
        var i = h.time.indexOf(stamp);
        if (i < 0) return null;
        var arr = h[variable];
        return arr && arr[i] != null ? arr[i] : null;
      }

      // Jede Schicht bringt ihren Bedeckungsgrad von *ihrem* Durchstosspunkt mit
      var clouds = {};
      for (var i = 0; i < los.length; i++) {
        clouds[los[i].layer.key] = valueAt(series[i], los[i].layer.variable);
        los[i].cover = clouds[los[i].layer.key];
      }

      var here = series[los.length];
      var result = visibilityChance(clouds, {
        sunAltitude: sun.altitudeDeg,
        precipitation: valueAt(here, 'precipitation') || 0,
        visibility: valueAt(here, 'visibility')
      });

      return {
        lineOfSight: los,
        clouds: clouds,
        result: result,
        rating: rating(result.chance),
        explanation: explain(result, sun.altitudeDeg),
        validAt: target,
        precipitation: valueAt(here, 'precipitation'),
        visibility: valueAt(here, 'visibility')
      };
    });
  }

  /* ------------------------------------------------------------------
   * Export
   * ------------------------------------------------------------------ */

  global.Visibility = {
    CLOUD_LAYERS: CLOUD_LAYERS,
    MAX_LINE_OF_SIGHT_KM: MAX_LINE_OF_SIGHT_KM,
    EARTH_RADIUS_KM: EARTH_RADIUS_KM,
    groundDistanceToAltitude: groundDistanceToAltitude,
    destinationPoint: destinationPoint,
    lineOfSight: lineOfSight,
    visibilityChance: visibilityChance,
    dominantLayer: dominantLayer,
    rating: rating,
    explain: explain,
    fetchAlongLineOfSight: fetchAlongLineOfSight
  };
})(typeof window !== 'undefined' ? window : this);
