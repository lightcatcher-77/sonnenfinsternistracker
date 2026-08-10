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
 * Der Rechenteil ist frei von Netz und DOM und damit direkt pruefbar. Nur
 * analyse(), analyseClimatology() und fetchForecast() gehen ins Netz, und die
 * nur auf Knopfdruck - der Rest der App bleibt offline lauffaehig.
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
   * Darauf kommen zwei Daempfungsfaktoren:
   *
   *  - haze: Bodennahe Sichtweite, nur bei tiefer Sonne relevant.
   *  - precipitation: Niederschlag bedeutet in der Praxis dichte Bewoelkung.
   *
   * Bewusst *kein* eigener Abschlag fuer die Hoehe der Sonne. Eine tief
   * stehende Sonne ist bei klarer Luft schlicht sichtbar - nichts anderes ist
   * ein Sonnenuntergang. Was sie tatsaechlich verschwinden laesst, ist Dunst,
   * und der steckt bereits im haze-Faktor. Ein zusaetzlicher Hoehenabschlag
   * waere Doppelzaehlung und obendrein wirkungslos fuer den Ortsvergleich:
   * alle Orte einer Region haben dieselbe Sonnenhoehe, ein solcher Faktor
   * druecke also nur alle Zahlen gleichmaessig nach unten. Verdeckung durch
   * Gelaende, Baeume und Haeuser bleibt ebenfalls draussen - die haengt am
   * konkreten Standort, nicht am Wetter, und wird als Hinweis ausgegeben.
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
        factors: { clouds: 0, haze: 1, precipitation: 1 },
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
      factors.clouds * factors.haze * factors.precipitation, 0, 1
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
    if (result.factors.haze < 0.85) parts.push('Dunst in Horizontnähe');
    if (result.factors.precipitation < 1) parts.push('Niederschlag');

    var text = 'Ausschlaggebend: ' + parts.join(', ') + '.';

    /*
     * Die Sonnenhoehe geht nicht in die Zahl ein (siehe visibilityChance),
     * ist unter ein paar Grad aber die praktisch wichtigste Information:
     * Dann entscheidet die freie Sicht nach Westen, und die sieht kein
     * Wettermodell.
     */
    if (sunAltitude > 0 && sunAltitude < 5) {
      text += ' Die Sonne steht dabei nur ' +
        sunAltitude.toLocaleString('de-DE', { maximumFractionDigits: 1 }) +
        '° über dem Horizont – du brauchst freie Sicht in Blickrichtung. ' +
        'Verdeckung durch Berge, Bäume oder Häuser steckt nicht in dieser Zahl.';
    }

    return text;
  }

  /* ==================================================================
   * Wetterdaten von Open-Meteo (frei, ohne Schluessel)
   *
   * Zwei Quellen: die Vorhersage (bis 16 Tage) fuer die eigentliche Prognose,
   * und das ERA5-Archiv fuer die Klimatologie, wenn die Finsternis noch
   * ausserhalb der Vorhersagereichweite liegt.
   * ================================================================== */

  var FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
  var ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

  /** Maximale Vorhersagereichweite von Open-Meteo in Tagen. */
  var MAX_FORECAST_DAYS = 16;

  var HOURLY_VARIABLES = [
    'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
    'visibility', 'precipitation', 'temperature_2m', 'wind_speed_10m'
  ];

  /*
   * Modelle fuer den Vergleich. best_match ist Open-Meteos Mischung aus dem
   * jeweils besten verfuegbaren Modell und liefert die Hauptzahl; die uebrigen
   * zeigen, wie einig sich die Modelle sind.
   */
  var MODELS = [
    { id: 'best_match', label: 'Beste Mischung', primary: true },
    { id: 'ecmwf_ifs025', label: 'ECMWF IFS' },
    { id: 'icon_seamless', label: 'DWD ICON' },
    { id: 'gfs_seamless', label: 'NOAA GFS' },
    { id: 'meteofrance_seamless', label: 'Météo-France' },
    { id: 'ukmo_seamless', label: 'UK Met Office' }
  ];
  var PRIMARY_MODEL = 'best_match';

  function isoDate(d) { return d.toISOString().slice(0, 10); }

  function fetchJson(url, opts) {
    opts = opts || {};
    var retries = opts.retries === undefined ? 1 : opts.retries;
    function attempt(n) {
      return fetch(url, { signal: opts.signal }).then(function (res) {
        if (!res.ok) throw new Error('Wetterdienst antwortete mit HTTP ' + res.status);
        return res.json();
      }).catch(function (err) {
        if (err.name === 'AbortError' || n >= retries) throw err;
        return new Promise(function (r) { setTimeout(r, 800); }).then(function () {
          return attempt(n + 1);
        });
      });
    }
    return attempt(0);
  }

  /*
   * Bei mehreren Modellen haengt Open-Meteo den Modellnamen an die Variable an
   * (cloud_cover_low_icon_seamless). Das normalisieren wir wieder auf
   * { modelId: { time, cloud_cover_low, ... } }.
   */
  function parseSeries(hourly, modelIds) {
    var time = ((hourly && hourly.time) || []).map(function (t) { return new Date(t + 'Z'); });
    var out = {};
    modelIds.forEach(function (model) {
      var series = { time: time };
      HOURLY_VARIABLES.forEach(function (v) {
        var withModel = hourly && hourly[v + '_' + model];
        series[v] = withModel !== undefined && withModel !== null
          ? withModel
          : (hourly && hourly[v]) || null;
      });
      out[model] = series;
    });
    return out;
  }

  /** Vorhersage fuer viele Punkte und Modelle in einem einzigen Aufruf. */
  function fetchForecast(points, date, opts) {
    opts = opts || {};
    var models = opts.models || MODELS.map(function (m) { return m.id; });
    // Ein Tag Puffer nach beiden Seiten, damit die Interpolation an den Raendern klappt.
    var from = isoDate(new Date(date.getTime() - 86400000));
    var to = isoDate(new Date(date.getTime() + 86400000));

    var url = FORECAST_URL +
      '?latitude=' + points.map(function (p) { return p.lat.toFixed(4); }).join(',') +
      '&longitude=' + points.map(function (p) { return p.lon.toFixed(4); }).join(',') +
      '&hourly=' + HOURLY_VARIABLES.join(',') +
      '&models=' + models.join(',') +
      '&timezone=UTC&start_date=' + from + '&end_date=' + to;

    return fetchJson(url, opts).then(function (data) {
      var list = Array.isArray(data) ? data : [data];
      return list.map(function (entry, i) {
        return {
          latitude: entry.latitude === undefined ? points[i].lat : entry.latitude,
          longitude: entry.longitude === undefined ? points[i].lon : entry.longitude,
          elevation: entry.elevation === undefined ? null : entry.elevation,
          series: parseSeries(entry.hourly, models)
        };
      });
    });
  }

  /*
   * Wert einer stuendlichen Reihe zu einem beliebigen Zeitpunkt, linear
   * interpoliert. null, wenn der Zeitpunkt ausserhalb liegt oder die
   * Nachbarwerte fehlen - nicht jedes Modell liefert jede Variable.
   */
  function sampleAt(series, variable, date) {
    var values = series && series[variable];
    var times = series && series.time;
    if (!values || !times || times.length === 0) return null;
    var t = date.getTime();
    if (t < times[0].getTime() || t > times[times.length - 1].getTime()) return null;

    var step = times.length > 1 ? times[1] - times[0] : 3600000;
    var i = Math.floor((t - times[0].getTime()) / step);
    i = Math.min(Math.max(i, 0), times.length - 2);

    var v0 = values[i], v1 = values[i + 1];
    if (v0 === null || v0 === undefined) return null;
    if (v1 === null || v1 === undefined) return v0;
    var f = (t - times[i].getTime()) / (times[i + 1].getTime() - times[i].getTime());
    return v0 + (v1 - v0) * f;
  }

  /*
   * Fasst die Einzelergebnisse mehrerer Wettermodelle zu Median und Streuung
   * zusammen. Die Streuung ist das ehrlichere Mass fuer die Prognosesicherheit
   * als jede Einzelvorhersage.
   */
  function aggregate(chances) {
    var values = chances.filter(function (c) { return isFinite(c); })
      .sort(function (a, b) { return a - b; });
    if (values.length === 0) return null;
    var mid = Math.floor(values.length / 2);
    var median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    var min = values[0], max = values[values.length - 1];
    var spread = max - min;
    return {
      median: median, min: min, max: max, spread: spread, count: values.length,
      agreement: spread < 0.15 ? 'hoch' : spread < 0.35 ? 'mittel' : 'gering'
    };
  }

  /** Tage bis zur Finsternis (kann negativ sein). */
  function daysUntil(date, now) {
    return (date - (now || new Date())) / 86400000;
  }

  /** Liegt die Finsternis in Reichweite der Wettermodelle? */
  function isForecastable(date, now) {
    var d = daysUntil(date, now);
    return d >= -1 && d <= MAX_FORECAST_DAYS - 1;
  }

  /*
   * Baut die Abfragepunkte auf: der Standort selbst (Index 0) und je Zeitpunkt
   * die drei Durchstosspunkte. Steht die Sonne unter dem Horizont, entfaellt
   * die Sichtlinie - dann ist ohnehin nichts zu sehen.
   */
  function buildSamplePoints(place, steps) {
    var points = [{ lat: place.lat, lon: place.lon }];
    var built = steps.map(function (st) {
      if (st.altitudeDeg <= 0) return { step: st, los: null, indices: null };
      var los = lineOfSight(place, { altitudeDeg: Math.max(st.altitudeDeg, 0), azimuthDeg: st.azimuthDeg });
      var indices = {};
      los.forEach(function (entry) {
        indices[entry.layer.key] = points.length;
        points.push(entry.point);
      });
      return { step: st, los: los, indices: indices };
    });
    return { points: points, built: built };
  }

  function cloudsFor(entry, results, model) {
    var clouds = {};
    CLOUD_LAYERS.forEach(function (layer) {
      var idx = entry.indices ? entry.indices[layer.key] : undefined;
      var series = idx === undefined ? null : (results[idx] && results[idx].series[model]);
      var value = series ? sampleAt(series, layer.variable, entry.step.date) : null;
      clouds[layer.key] = value === null ? 0 : value;
      clouds[layer.key + '_missing'] = value === null;
    });
    return clouds;
  }

  /*
   * Vollstaendige Analyse: Verlauf der Sichtchance ueber die Finsternis,
   * Modellvergleich zum Maximum und die Wetterlage am Standort.
   *
   * steps ist eine Liste { date, altitudeDeg, azimuthDeg, isPeak, label },
   * die der Aufrufer aus der Finsternisgeometrie erzeugt.
   */
  function analyse(place, steps, opts) {
    opts = opts || {};
    var prep = buildSamplePoints(place, steps);

    var peakStep = null;
    for (var k = 0; k < steps.length; k++) if (steps[k].isPeak) peakStep = steps[k];
    var peakDate = (peakStep || steps[0]).date;

    return fetchForecast(prep.points, peakDate, opts).then(function (results) {
      var observer = results[0] && results[0].series[PRIMARY_MODEL];

      function chanceFor(entry, model) {
        var obs = results[0] && results[0].series[model];
        var clouds = cloudsFor(entry, results, model);
        var prec = obs ? sampleAt(obs, 'precipitation', entry.step.date) : null;
        var r = visibilityChance(clouds, {
          sunAltitude: entry.step.altitudeDeg,
          precipitation: prec === null ? 0 : prec,
          visibility: obs ? sampleAt(obs, 'visibility', entry.step.date) : null
        });
        r.clouds = clouds;
        return r;
      }

      // Verlauf nach dem Hauptmodell
      var timeline = prep.built.map(function (entry) {
        var r = chanceFor(entry, PRIMARY_MODEL);
        // Bedeckung an den Punkt haengen, damit die Tabelle sie zeigen kann
        if (entry.los) {
          entry.los.forEach(function (l) { l.cover = r.clouds[l.layer.key]; });
        }
        return {
          date: entry.step.date,
          label: entry.step.label,
          altitudeDeg: entry.step.altitudeDeg,
          azimuthDeg: entry.step.azimuthDeg,
          isPeak: !!entry.step.isPeak,
          los: entry.los,
          chance: r.chance,
          factors: r.factors,
          perLayer: r.perLayer,
          clouds: r.clouds,
          belowHorizon: r.belowHorizon
        };
      });

      var peakEntry = null, peakBuilt = null;
      for (var i = 0; i < timeline.length; i++) {
        if (timeline[i].isPeak) { peakEntry = timeline[i]; peakBuilt = prep.built[i]; }
      }
      if (!peakEntry) { peakEntry = timeline[0]; peakBuilt = prep.built[0]; }

      // Dasselbe je Modell - daraus entsteht das Vertrauensmass
      var perModel = [];
      MODELS.forEach(function (m) {
        var clouds = cloudsFor(peakBuilt, results, m.id);
        var any = CLOUD_LAYERS.some(function (l) { return !clouds[l.key + '_missing']; });
        if (!any) return;
        var r = chanceFor(peakBuilt, m.id);
        perModel.push({ model: m, chance: r.chance, clouds: r.clouds });
      });

      var spread = aggregate(perModel
        .filter(function (m) { return m.model.id !== PRIMARY_MODEL; })
        .map(function (m) { return m.chance; }));

      var conditions = observer ? {
        temperature: sampleAt(observer, 'temperature_2m', peakDate),
        wind: sampleAt(observer, 'wind_speed_10m', peakDate),
        precipitation: sampleAt(observer, 'precipitation', peakDate),
        visibility: sampleAt(observer, 'visibility', peakDate),
        totalCloudCover: sampleAt(observer, 'cloud_cover', peakDate)
      } : null;

      return {
        timeline: timeline,
        peak: peakEntry,
        lineOfSight: peakBuilt.los,
        rating: rating(peakEntry.chance),
        explanation: explain(
          { belowHorizon: peakEntry.belowHorizon, perLayer: peakEntry.perLayer, factors: peakEntry.factors },
          peakEntry.altitudeDeg
        ),
        perModel: perModel,
        spread: spread,
        conditions: conditions,
        validAt: peakDate
      };
    });
  }

  /*
   * Klimatologie aus dem ERA5-Archiv: Wie war die Bewoelkung an diesem Ort, an
   * diesem Kalendertag, zu dieser Tageszeit, in den vergangenen Jahren?
   *
   * Das ist keine Vorhersage, sondern die Haeufigkeitsverteilung der
   * Vergangenheit - die einzig ehrliche Aussage jenseits der Vorhersagegrenze,
   * und auch davor ein nuetzlicher Vergleichsmassstab.
   */
  function analyseClimatology(place, sun, peakDate, opts) {
    opts = opts || {};
    var years = opts.years || 20;
    var windowDays = opts.windowDays || 3;
    var onProgress = opts.onProgress;

    if (sun.altitudeDeg <= 0) return Promise.resolve(null);

    var los = lineOfSight(place, sun);
    var lat = los.map(function (l) { return l.point.lat.toFixed(4); }).join(',');
    var lon = los.map(function (l) { return l.point.lon.toFixed(4); }).join(',');

    var latest = new Date().getUTCFullYear() - 1; // ERA5 hinkt hinterher
    var yearList = [];
    for (var y = latest - years + 1; y <= latest; y++) yearList.push(y);

    var targetHour = peakDate.getUTCHours();
    var vars = ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'precipitation'];
    var done = 0;
    var out = [];

    function oneYear(year) {
      var center = new Date(Date.UTC(year, peakDate.getUTCMonth(), peakDate.getUTCDate(), targetHour));
      var url = ARCHIVE_URL + '?latitude=' + lat + '&longitude=' + lon +
        '&hourly=' + vars.join(',') + '&timezone=UTC' +
        '&start_date=' + isoDate(new Date(center.getTime() - windowDays * 86400000)) +
        '&end_date=' + isoDate(new Date(center.getTime() + windowDays * 86400000));

      return fetchJson(url, { signal: opts.signal, retries: 0 }).then(function (data) {
        var list = Array.isArray(data) ? data : [data];
        var times = ((list[0] && list[0].hourly && list[0].hourly.time) || [])
          .map(function (t) { return new Date(t + 'Z'); });
        var samples = [];
        times.forEach(function (t, idx) {
          if (t.getUTCHours() !== targetHour) return;
          samples.push(list.map(function (entry) {
            var h = entry.hourly || {};
            var pick = function (v) {
              var val = h[v] && h[v][idx];
              return val === null || val === undefined ? null : val;
            };
            return {
              cloud_cover_low: pick('cloud_cover_low'),
              cloud_cover_mid: pick('cloud_cover_mid'),
              cloud_cover_high: pick('cloud_cover_high'),
              precipitation: pick('precipitation')
            };
          }));
        });
        return { year: year, samples: samples };
      }).catch(function () {
        return { year: year, samples: [] };
      }).then(function (r) {
        done++;
        if (onProgress) onProgress(done, yearList.length);
        return r;
      });
    }

    // Sequenziell in kleinen Gruppen, um den freien Dienst nicht zu ueberfahren.
    function runBatch(i) {
      if (i >= yearList.length) return Promise.resolve();
      var batch = yearList.slice(i, i + 4).map(oneYear);
      return Promise.all(batch).then(function (rs) {
        out = out.concat(rs);
        return runBatch(i + 4);
      });
    }

    return runBatch(0).then(function () {
      var chances = [];
      var perYear = [];
      out.sort(function (a, b) { return a.year - b.year; });
      out.forEach(function (yr) {
        var ys = [];
        yr.samples.forEach(function (sample) {
          var clouds = {};
          var usable = true;
          CLOUD_LAYERS.forEach(function (layer, i) {
            var v = sample[i] && sample[i][layer.variable];
            if (v === null || v === undefined) usable = false;
            clouds[layer.key] = v === null || v === undefined ? 0 : v;
          });
          if (!usable) return;
          var prec = (sample[0] && sample[0].precipitation) || 0;
          var r = visibilityChance(clouds, { sunAltitude: sun.altitudeDeg, precipitation: prec });
          ys.push(r.chance);
          chances.push(r.chance);
        });
        if (ys.length) {
          perYear.push({
            year: yr.year,
            mean: ys.reduce(function (a, b) { return a + b; }, 0) / ys.length,
            samples: ys.length
          });
        }
      });

      if (chances.length === 0) return null;
      var sorted = chances.slice().sort(function (a, b) { return a - b; });
      function q(p) { return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]; }
      return {
        samples: chances.length,
        mean: chances.reduce(function (a, b) { return a + b; }, 0) / chances.length,
        median: q(0.5), p25: q(0.25), p75: q(0.75),
        goodShare: chances.filter(function (c) { return c > 0.6; }).length / chances.length,
        perYear: perYear
      };
    });
  }

  /* ------------------------------------------------------------------
   * Export
   * ------------------------------------------------------------------ */

  global.Visibility = {
    CLOUD_LAYERS: CLOUD_LAYERS,
    MODELS: MODELS,
    PRIMARY_MODEL: PRIMARY_MODEL,
    MAX_FORECAST_DAYS: MAX_FORECAST_DAYS,
    MAX_LINE_OF_SIGHT_KM: MAX_LINE_OF_SIGHT_KM,
    EARTH_RADIUS_KM: EARTH_RADIUS_KM,
    groundDistanceToAltitude: groundDistanceToAltitude,
    destinationPoint: destinationPoint,
    lineOfSight: lineOfSight,
    visibilityChance: visibilityChance,
    dominantLayer: dominantLayer,
    rating: rating,
    explain: explain,
    aggregate: aggregate,
    sampleAt: sampleAt,
    fetchForecast: fetchForecast,
    daysUntil: daysUntil,
    isForecastable: isForecastable,
    analyse: analyse,
    analyseClimatology: analyseClimatology
  };
})(typeof window !== 'undefined' ? window : this);
