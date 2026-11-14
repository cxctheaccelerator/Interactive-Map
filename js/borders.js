// Historical borders layer from CShapes 2.0 (1886-2019), shown for one date.
// The data file (data/cshapes.js, ~26 MB) is loaded the first time the layer is
// switched on.
window.IM = window.IM || {};

(function () {
  const DATA_URL = 'data/cshapes.js';
  const MIN_YEAR = 1886, MAX_YEAR = 2019;
  const LAYERS = ['hist-fill', 'hist-line', 'hist-label', 'hist-capital-dot', 'hist-capital'];
  // Muted fills so terrain stays readable; colour picked from the GW code.
  const PALETTE = ['#c9a27e', '#9fb7c9', '#c7b26b', '#b5a2c8', '#9ec29a', '#d19a9a', '#a9b38a', '#c4a6a0'];

  let map = null;
  let loading = null;
  let date = 19420615;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => {
        const e = new Error(`Could not load ${src}. Run python3 tools/download_data.py first.`);
        e.dataMissing = 'cshapes';
        reject(e);
      };
      document.head.appendChild(s);
    });
  }

  function dateFilter() {
    return ['all', ['<=', ['get', 'start'], date], ['>=', ['get', 'end'], date]];
  }

  function labelPoints(fc, lonKey, latKey) {
    return {
      type: 'FeatureCollection',
      features: fc.features
        .filter((f) => f.properties[lonKey] != null)
        .map((f) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [f.properties[lonKey], f.properties[latKey]] },
          properties: f.properties,
        })),
    };
  }

  async function ensureLayers() {
    await mapReady;
    if (map.getSource('cshapes')) return;
    if (!loading) loading = (window.IM_DATA && IM_DATA.cshapes) ? Promise.resolve() : loadScript(DATA_URL);
    await loading;
    if (map.getSource('cshapes')) return;

    const fc = IM_DATA.cshapes;
    map.addSource('cshapes', {
      type: 'geojson', data: fc, tolerance: 0.5,
      attribution: 'Borders: <a href="https://icr.ethz.ch/data/cshapes/" target="_blank">CShapes 2.0</a> (CC BY-NC-SA 4.0)',
    });
    map.addSource('cshapes-labels', { type: 'geojson', data: labelPoints(fc, 'labelLon', 'labelLat') });
    map.addSource('cshapes-capitals', { type: 'geojson', data: labelPoints(fc, 'capLon', 'capLat') });

    const colour = ['match', ['%', ['get', 'gw'], PALETTE.length], ...PALETTE.flatMap((c, i) => [i, c]), PALETTE[0]];

    // Fill and outline go under the water layer, so coastlines come from the
    // (more detailed) water polygons and only land borders remain visible.
    map.addLayer({
      id: 'hist-fill', type: 'fill', source: 'cshapes', filter: dateFilter(),
      paint: { 'fill-color': colour, 'fill-opacity': 0.28 },
    }, 'water');
    map.addLayer({
      id: 'hist-line', type: 'line', source: 'cshapes', filter: dateFilter(),
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#5b3d58',
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.8, 6, 1.6, 10, 2.4],
      },
    }, 'water');

    const before = map.getLayer('places-dot') ? 'places-dot' : undefined;
    map.addLayer({
      id: 'hist-label', type: 'symbol', source: 'cshapes-labels', filter: dateFilter(),
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 14],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.06,
        'text-max-width': 8,
        'symbol-sort-key': ['-', 0, ['get', 'area']],   // big countries get labelled first
      },
      paint: { 'text-color': '#5b3d58', 'text-halo-color': 'rgba(255,255,255,0.75)', 'text-halo-width': 1.2 },
    }, before);
    map.addLayer({
      id: 'hist-capital-dot', type: 'circle', source: 'cshapes-capitals', filter: dateFilter(), minzoom: 4,
      paint: {
        'circle-radius': 3,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#5b3d58',
        'circle-stroke-width': 1.5,
      },
    }, before);
    map.addLayer({
      id: 'hist-capital', type: 'symbol', source: 'cshapes-capitals', filter: dateFilter(), minzoom: 4,
      layout: {
        'text-field': ['get', 'cap'],
        'text-font': ['Noto Sans Italic'],
        'text-size': 11,
        'text-anchor': 'left',
        'text-offset': [0.5, 0],
        'text-optional': true,
      },
      paint: { 'text-color': '#5b3d58', 'text-halo-color': 'rgba(255,255,255,0.75)', 'text-halo-width': 1 },
    }, before);
  }

  async function setVisible(visible) {
    if (visible) await ensureLayers();
    LAYERS.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    });
  }

  function setDate(year, month) {
    const y = Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.round(year)));
    date = y * 10000 + month * 100 + 15;
    LAYERS.forEach((id) => { if (map.getLayer(id)) map.setFilter(id, dateFilter()); });
    return y;
  }

  let mapReady = null;
  function init(theMap) {
    map = theMap;
    mapReady = new Promise((resolve) => {
      if (map.loaded()) resolve(); else map.once('load', resolve);
    });
  }

  IM.borders = { init, setVisible, setDate, MIN_YEAR, MAX_YEAR };
})();
