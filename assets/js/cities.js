/*
 * cities.js - Offline-Ortsdatenbank.
 * [Name, Land, Breite, Laenge, Hoehe(m), IANA-Zeitzone]
 * Bewusst offline gehalten, damit die App ohne Netz funktioniert.
 */
(function (global) {
  'use strict';

  var DE = 'Europe/Berlin', AT = 'Europe/Vienna', CH = 'Europe/Zurich';
  var ES = 'Europe/Madrid', IS = 'Atlantic/Reykjavik', PT = 'Europe/Lisbon';

  var raw = [
    // --- Deutschland ---
    ['Berlin', 'DE', 52.5200, 13.4050, 34, DE],
    ['Hamburg', 'DE', 53.5511, 9.9937, 6, DE],
    ['München', 'DE', 48.1372, 11.5755, 519, DE],
    ['Köln', 'DE', 50.9375, 6.9603, 53, DE],
    ['Frankfurt am Main', 'DE', 50.1109, 8.6821, 112, DE],
    ['Stuttgart', 'DE', 48.7758, 9.1829, 245, DE],
    ['Düsseldorf', 'DE', 51.2277, 6.7735, 38, DE],
    ['Leipzig', 'DE', 51.3397, 12.3731, 113, DE],
    ['Dortmund', 'DE', 51.5136, 7.4653, 86, DE],
    ['Essen', 'DE', 51.4556, 7.0116, 116, DE],
    ['Bremen', 'DE', 53.0793, 8.8017, 11, DE],
    ['Dresden', 'DE', 51.0504, 13.7373, 113, DE],
    ['Hannover', 'DE', 52.3759, 9.7320, 55, DE],
    ['Nürnberg', 'DE', 49.4521, 11.0767, 309, DE],
    ['Duisburg', 'DE', 51.4344, 6.7623, 33, DE],
    ['Bochum', 'DE', 51.4818, 7.2162, 100, DE],
    ['Wuppertal', 'DE', 51.2562, 7.1508, 175, DE],
    ['Bielefeld', 'DE', 52.0302, 8.5325, 118, DE],
    ['Bonn', 'DE', 50.7374, 7.0982, 60, DE],
    ['Münster', 'DE', 51.9607, 7.6261, 60, DE],
    ['Karlsruhe', 'DE', 49.0069, 8.4037, 115, DE],
    ['Mannheim', 'DE', 49.4875, 8.4660, 97, DE],
    ['Augsburg', 'DE', 48.3705, 10.8978, 494, DE],
    ['Wiesbaden', 'DE', 50.0782, 8.2398, 115, DE],
    ['Mönchengladbach', 'DE', 51.1805, 6.4428, 70, DE],
    ['Gelsenkirchen', 'DE', 51.5177, 7.0857, 51, DE],
    ['Braunschweig', 'DE', 52.2689, 10.5268, 75, DE],
    ['Chemnitz', 'DE', 50.8278, 12.9214, 300, DE],
    ['Kiel', 'DE', 54.3233, 10.1228, 20, DE],
    ['Aachen', 'DE', 50.7753, 6.0839, 173, DE],
    ['Halle (Saale)', 'DE', 51.4826, 11.9700, 87, DE],
    ['Magdeburg', 'DE', 52.1205, 11.6276, 55, DE],
    ['Freiburg im Breisgau', 'DE', 47.9990, 7.8421, 278, DE],
    ['Krefeld', 'DE', 51.3388, 6.5853, 39, DE],
    ['Mainz', 'DE', 49.9929, 8.2473, 89, DE],
    ['Lübeck', 'DE', 53.8655, 10.6866, 13, DE],
    ['Erfurt', 'DE', 50.9848, 11.0299, 194, DE],
    ['Rostock', 'DE', 54.0924, 12.0991, 13, DE],
    ['Kassel', 'DE', 51.3127, 9.4797, 167, DE],
    ['Potsdam', 'DE', 52.3906, 13.0645, 32, DE],
    ['Saarbrücken', 'DE', 49.2402, 6.9969, 230, DE],
    ['Osnabrück', 'DE', 52.2799, 8.0472, 63, DE],
    ['Oldenburg', 'DE', 53.1435, 8.2146, 4, DE],
    ['Heidelberg', 'DE', 49.3988, 8.6724, 114, DE],
    ['Regensburg', 'DE', 49.0134, 12.1016, 337, DE],
    ['Ingolstadt', 'DE', 48.7665, 11.4258, 374, DE],
    ['Würzburg', 'DE', 49.7913, 9.9534, 177, DE],
    ['Ulm', 'DE', 48.4011, 9.9876, 478, DE],
    ['Trier', 'DE', 49.7490, 6.6371, 137, DE],
    ['Konstanz', 'DE', 47.6603, 9.1758, 405, DE],
    ['Flensburg', 'DE', 54.7937, 9.4469, 18, DE],
    ['Garmisch-Partenkirchen', 'DE', 47.4917, 11.0955, 708, DE],
    ['Sylt (List)', 'DE', 55.0180, 8.4390, 5, DE],
    ['Norderney', 'DE', 53.7080, 7.1550, 4, DE],
    ['Helgoland', 'DE', 54.1810, 7.8850, 30, DE],
    ['Kleve', 'DE', 51.7880, 6.1390, 46, DE],
    ['Zugspitze', 'DE', 47.4211, 10.9853, 2962, DE],
    ['Brocken', 'DE', 51.7994, 10.6156, 1141, DE],
    ['Feldberg (Schwarzwald)', 'DE', 47.8736, 8.0044, 1493, DE],

    // --- Österreich ---
    ['Wien', 'AT', 48.2082, 16.3738, 171, AT],
    ['Graz', 'AT', 47.0707, 15.4395, 353, AT],
    ['Linz', 'AT', 48.3069, 14.2858, 266, AT],
    ['Salzburg', 'AT', 47.8095, 13.0550, 424, AT],
    ['Innsbruck', 'AT', 47.2692, 11.4041, 574, AT],
    ['Klagenfurt', 'AT', 46.6247, 14.3050, 446, AT],
    ['Bregenz', 'AT', 47.5031, 9.7471, 427, AT],

    // --- Schweiz ---
    ['Zürich', 'CH', 47.3769, 8.5417, 408, CH],
    ['Genf', 'CH', 46.2044, 6.1432, 375, CH],
    ['Basel', 'CH', 47.5596, 7.5886, 260, CH],
    ['Bern', 'CH', 46.9480, 7.4474, 542, CH],
    ['Luzern', 'CH', 47.0502, 8.3093, 435, CH],
    ['St. Moritz', 'CH', 46.4908, 9.8355, 1822, CH],
    ['Jungfraujoch', 'CH', 46.5475, 7.9856, 3454, CH],

    // --- Totalitätszone: Island ---
    ['Reykjavík', 'IS', 64.1466, -21.9426, 15, IS],
    ['Keflavík', 'IS', 63.9800, -22.5600, 10, IS],
    ['Grundarfjörður', 'IS', 64.9214, -23.2564, 10, IS],
    ['Ísafjörður', 'IS', 66.0749, -23.1355, 5, IS],
    ['Akureyri', 'IS', 65.6835, -18.1262, 20, IS],

    // --- Totalitätszone: Spanien ---
    ['Madrid', 'ES', 40.4168, -3.7038, 667, ES],
    ['Barcelona', 'ES', 41.3874, 2.1686, 12, ES],
    ['Valencia', 'ES', 39.4699, -0.3763, 15, ES],
    ['Bilbao', 'ES', 43.2630, -2.9350, 19, ES],
    ['Zaragoza', 'ES', 41.6488, -0.8891, 208, ES],
    ['Burgos', 'ES', 42.3439, -3.6969, 861, ES],
    ['Oviedo', 'ES', 43.3619, -5.8494, 232, ES],
    ['Santander', 'ES', 43.4623, -3.8100, 15, ES],
    ['Valladolid', 'ES', 41.6523, -4.7245, 698, ES],
    ['Palma de Mallorca', 'ES', 39.5696, 2.6502, 13, ES],
    ['Tarragona', 'ES', 41.1189, 1.2445, 68, ES],
    ['Castellón de la Plana', 'ES', 39.9864, -0.0513, 30, ES],
    ['Lissabon', 'PT', 38.7223, -9.1393, 100, PT],

    // --- Weitere Städte Europas ---
    ['Paris', 'FR', 48.8566, 2.3522, 35, 'Europe/Paris'],
    ['Amsterdam', 'NL', 52.3676, 4.9041, 2, 'Europe/Amsterdam'],
    ['Brüssel', 'BE', 50.8503, 4.3517, 13, 'Europe/Brussels'],
    ['Luxemburg', 'LU', 49.6116, 6.1319, 300, 'Europe/Luxembourg'],
    ['London', 'GB', 51.5074, -0.1278, 11, 'Europe/London'],
    ['Kopenhagen', 'DK', 55.6761, 12.5683, 5, 'Europe/Copenhagen'],
    ['Prag', 'CZ', 50.0755, 14.4378, 200, 'Europe/Prague'],
    ['Warschau', 'PL', 52.2297, 21.0122, 113, 'Europe/Warsaw'],
    ['Mailand', 'IT', 45.4642, 9.1900, 120, 'Europe/Rome'],
    ['Rom', 'IT', 41.9028, 12.4964, 21, 'Europe/Rome'],
    ['Oslo', 'NO', 59.9139, 10.7522, 23, 'Europe/Oslo'],
    ['Stockholm', 'SE', 59.3293, 18.0686, 28, 'Europe/Stockholm']
  ];

  var LAND_NAMEN = {
    DE: 'Deutschland', AT: 'Österreich', CH: 'Schweiz', ES: 'Spanien',
    IS: 'Island', PT: 'Portugal', FR: 'Frankreich', NL: 'Niederlande',
    BE: 'Belgien', LU: 'Luxemburg', GB: 'Großbritannien', DK: 'Dänemark',
    CZ: 'Tschechien', PL: 'Polen', IT: 'Italien', NO: 'Norwegen', SE: 'Schweden'
  };

  var cities = raw.map(function (r) {
    return {
      name: r[0], country: r[1], lat: r[2], lon: r[3],
      height: r[4], tz: r[5],
      countryName: LAND_NAMEN[r[1]] || r[1],
      search: (r[0] + ' ' + (LAND_NAMEN[r[1]] || '') + ' ' + r[1])
        .toLowerCase()
        .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
        .replace(/ß/g, 'ss').replace(/í/g, 'i').replace(/ó/g, 'o')
        .replace(/é/g, 'e').replace(/ð/g, 'd').replace(/þ/g, 'th')
    };
  });

  function normalize(s) {
    return (s || '').toLowerCase().trim()
      .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
      .replace(/ß/g, 'ss').replace(/í/g, 'i').replace(/ó/g, 'o')
      .replace(/é/g, 'e').replace(/ð/g, 'd').replace(/þ/g, 'th');
  }

  /** Volltextsuche mit Praeferenz fuer Treffer am Wortanfang. */
  function search(query, limit) {
    var q = normalize(query);
    if (!q) return [];
    var starts = [], contains = [];
    for (var i = 0; i < cities.length; i++) {
      var idx = cities[i].search.indexOf(q);
      if (idx === 0) starts.push(cities[i]);
      else if (idx > 0) contains.push(cities[i]);
    }
    return starts.concat(contains).slice(0, limit || 8);
  }

  /** Naechstgelegene Stadt zu gegebenen Koordinaten (fuer GPS-Anzeige). */
  function nearest(lat, lon) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < cities.length; i++) {
      var dLat = (cities[i].lat - lat) * 111.32;
      var dLon = (cities[i].lon - lon) * 111.32 * Math.cos(lat * Math.PI / 180);
      var d = Math.sqrt(dLat * dLat + dLon * dLon);
      if (d < bestD) { bestD = d; best = cities[i]; }
    }
    return { city: best, distanceKm: bestD };
  }

  global.Cities = { all: cities, search: search, nearest: nearest };
})(typeof window !== 'undefined' ? window : this);
