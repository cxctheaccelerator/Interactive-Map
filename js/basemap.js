// Base map: terrain (elevation colours + hillshade) with water from OpenFreeMap
// vector tiles, plus optional modern labels and borders.
window.IM = window.IM || {};

(function () {
  const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const TERRAIN_ATTRIB = 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">Mapzen Terrain Tiles &amp; data sources</a>';
  const NAME_EN = ['coalesce', ['get', 'name:en'], ['get', 'name']];

  // Layer ids belonging to each toggle in the "Layers" panel.
  const GROUPS = {
    relief:    ['relief'],
    hillshade: ['hillshade'],
    labels:    ['label-water', 'label-country', 'label-city'],
    borders:   ['border-country'],
  };

  function demSource() {
    return {
      type: 'raster-dem',
      tiles: [TERRARIUM],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      attribution: TERRAIN_ATTRIB,
    };
  }

  function style() {
    return {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {
        dem: demSource(),
        terrain3d: demSource(),   // separate copy for 3D terrain (MapLibre recommends this)
        omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#dfe6cf' } },

        // Hypsometric tint (classic atlas colours: green lowlands to brown/white peaks).
        {
          id: 'relief', type: 'color-relief', source: 'dem',
          paint: {
            'color-relief-color': [
              'interpolate', ['linear'], ['elevation'],
              -500, '#a6c99a',
              0,    '#acd0a5',
              50,   '#94bf8b',
              200,  '#a8c68f',
              400,  '#bdcc96',
              600,  '#d1d7ab',
              800,  '#e1e4b5',
              1000, '#efebc0',
              1200, '#e8e1b6',
              1500, '#ded6a3',
              1800, '#d3ca9d',
              2100, '#cab982',
              2400, '#c3a76b',
              2700, '#b9985a',
              3000, '#aa8753',
              3500, '#ac9a7c',
              4000, '#baae9a',
              4500, '#cac3b8',
              5000, '#e0ded8',
              6000, '#f5f4f2',
            ],
          },
        },

        {
          id: 'hillshade', type: 'hillshade', source: 'dem',
          paint: {
            'hillshade-exaggeration': 0.4,
            'hillshade-shadow-color': '#473b24',
            'hillshade-highlight-color': '#ffffff',
          },
        },

        // Water bodies (oceans, seas, lakes) and rivers.
        {
          id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water',
          filter: ['!=', ['get', 'brunnel'], 'tunnel'],
          paint: { 'fill-color': '#a9cbe0' },
        },
        {
          id: 'river', type: 'line', source: 'omt', 'source-layer': 'waterway',
          filter: ['all', ['==', ['get', 'class'], 'river'], ['!=', ['get', 'brunnel'], 'tunnel']],
          paint: {
            'line-color': '#7fb0d2',
            'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 4, 0.6, 8, 1.4, 12, 3, 16, 6],
          },
        },
        {
          id: 'stream', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 11,
          filter: ['all', ['in', ['get', 'class'], ['literal', ['stream', 'canal']]], ['!=', ['get', 'brunnel'], 'tunnel']],
          paint: { 'line-color': '#8dbad8', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 16, 2] },
        },

        // Modern borders (off by default; modern borders mislead for historical maps).
        {
          id: 'border-country', type: 'line', source: 'omt', 'source-layer': 'boundary',
          filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
          layout: { visibility: 'none', 'line-join': 'round' },
          paint: {
            'line-color': '#7a6e86',
            'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 8, 1.6],
            'line-dasharray': [3, 2],
          },
        },

        // Modern labels, kept muted so the passage's places stand out.
        {
          id: 'label-water', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
          layout: {
            'text-field': NAME_EN,
            'text-font': ['Noto Sans Italic'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 8, 13],
            'text-max-width': 8,
          },
          paint: { 'text-color': '#4f7a99', 'text-halo-color': 'rgba(255,255,255,0.6)', 'text-halo-width': 1 },
        },
        {
          id: 'label-country', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['==', ['get', 'class'], 'country'],
          layout: {
            'text-field': NAME_EN,
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 14],
            'text-transform': 'uppercase',
            'text-letter-spacing': 0.08,
            'text-max-width': 7,
          },
          paint: { 'text-color': '#857c6c', 'text-halo-color': 'rgba(255,255,255,0.6)', 'text-halo-width': 1 },
        },
        {
          id: 'label-city', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
          minzoom: 4,
          layout: {
            'text-field': NAME_EN,
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 13],
            'text-max-width': 8,
          },
          paint: { 'text-color': '#6f6a5e', 'text-halo-color': 'rgba(255,255,255,0.7)', 'text-halo-width': 1 },
        },
      ],
    };
  }

  function createMap(container) {
    const map = new maplibregl.Map({
      container,
      style: style(),
      center: [30, 48],
      zoom: 3.2,
      maxPitch: 75,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.TerrainControl({ source: 'terrain3d', exaggeration: 1.5 }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    return map;
  }

  function setGroupVisible(map, group, visible) {
    (GROUPS[group] || []).forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    });
  }

  IM.basemap = { createMap, setGroupVisible };
})();
