// UI wiring: settings, running the pipeline, results list, map markers.
window.IM = window.IM || {};

(function () {
  const $ = (id) => document.getElementById(id);

  const els = {
    provider: $('provider'), baseUrl: $('base-url'), baseUrlRow: $('base-url-row'), baseUrlOptions: $('base-url-options'),
    apiKey: $('api-key'), remember: $('remember-key'), keyHint: $('key-hint'),
    model: $('model'), modelOptions: $('model-options'), listModels: $('list-models'),
    passage: $('passage'), run: $('run'), example: $('example'), clear: $('clear'),
    status: $('status'), results: $('results'), layers: $('layers'),
  };

  // ---------- storage helpers (storage can be unavailable in private modes) ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  // ---------- settings: provider, address, key, model ----------
  // Keys are kept per provider: in memory for this tab, and in local storage
  // only if "Remember on this device" is ticked.
  const PROVIDERS = IM.config.llm.providers;
  const keyStore = (p) => `im.key.${p}`;
  const modelStore = (p) => `im.model.${p}`;
  const sessionKeys = {};

  // Settings saved by the earlier, Claude-only version.
  if (store.get('im.apiKey') && !store.get(keyStore('anthropic'))) store.set(keyStore('anthropic'), store.get('im.apiKey'));
  if (store.get('im.model') && !store.get(modelStore('anthropic'))) store.set(modelStore('anthropic'), store.get('im.model'));
  store.del('im.apiKey');
  store.del('im.model');

  Object.entries(PROVIDERS).forEach(([id, cfg]) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = cfg.label;
    els.provider.appendChild(opt);
  });
  PROVIDERS.compatible.examples.forEach((ex) => {
    const opt = document.createElement('option');
    opt.value = ex.url;
    opt.label = ex.label;
    els.baseUrlOptions.appendChild(opt);
  });

  const provider = () => els.provider.value;
  function settings() {
    return { provider: provider(), apiKey: els.apiKey.value.trim(), model: els.model.value.trim(), baseUrl: els.baseUrl.value.trim() };
  }

  function setModelOptions(items) {
    els.modelOptions.innerHTML = '';
    items.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      if (label) opt.label = label;
      els.modelOptions.appendChild(opt);
    });
  }

  function renderKeyHint() {
    const p = provider(), cfg = PROVIDERS[p];
    let host = 'the address above';
    try { host = new URL(p === 'compatible' ? els.baseUrl.value : cfg.baseUrl).host || host; } catch (e) { /* not a URL yet */ }
    els.keyHint.textContent = `The key is sent only to ${host}. `;
    if (cfg.keyUrl) {
      els.keyHint.append('Get one at ');
      const a = document.createElement('a');
      a.href = cfg.keyUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = new URL(cfg.keyUrl).host;
      els.keyHint.append(a, '. ');
    } else if (cfg.keyOptional) {
      els.keyHint.append('Local servers usually need no key. ');
    }
    els.keyHint.append("If remembered, it is stored in this browser's local storage in plain text.");
  }

  function loadProvider() {
    const p = provider(), cfg = PROVIDERS[p];
    els.baseUrlRow.hidden = p !== 'compatible';
    const saved = store.get(keyStore(p));
    els.apiKey.value = saved || sessionKeys[p] || '';
    els.remember.checked = !!saved;
    els.apiKey.placeholder = cfg.keyPlaceholder || '';
    els.model.value = store.get(modelStore(p)) || cfg.defaultModel || '';
    els.model.placeholder = cfg.models.length ? 'model name' : 'model name, or click "List models"';
    setModelOptions(cfg.models.map((m) => ({ value: m.id, label: m.label })));
    renderKeyHint();
  }

  els.provider.value = PROVIDERS[store.get('im.provider')] ? store.get('im.provider') : IM.config.llm.defaultProvider;
  els.baseUrl.value = store.get('im.baseUrl') || '';
  loadProvider();
  if (!els.apiKey.value && !PROVIDERS[provider()].keyOptional) $('settings').open = true;

  function syncKeyStorage() {
    const p = provider(), key = els.apiKey.value.trim();
    sessionKeys[p] = key;
    if (els.remember.checked && key) store.set(keyStore(p), key);
    else store.del(keyStore(p));
  }
  els.provider.addEventListener('change', () => { store.set('im.provider', provider()); loadProvider(); });
  els.remember.addEventListener('change', syncKeyStorage);
  els.apiKey.addEventListener('input', syncKeyStorage);
  els.model.addEventListener('change', () => store.set(modelStore(provider()), els.model.value.trim()));
  els.baseUrl.addEventListener('change', () => { store.set('im.baseUrl', els.baseUrl.value.trim()); renderKeyHint(); });

  els.listModels.addEventListener('click', async () => {
    els.listModels.disabled = true;
    setStatus('Asking the provider which models this key can use…');
    try {
      const ids = await IM.llm.listModels(settings());
      const known = new Map(PROVIDERS[provider()].models.map((m) => [m.id, m.label]));
      setModelOptions(ids.sort().map((id) => ({ value: id, label: known.get(id) })));
      setStatus(ids.length
        ? `Found ${ids.length} models. Click the model field (or clear it) to choose from the list.`
        : 'The provider returned no models for this key.');
      els.model.focus();
    } catch (e) {
      setStatus(e.message || String(e), true);
    } finally {
      els.listModels.disabled = false;
    }
  });

  // ---------- map ----------
  const map = IM.basemap.createMap('map');
  let resolved = [];   // results of the last run
  let popup = null;

  // Colours for highlighted shapes: water features blue, mountains brown, others red.
  const SHAPE_COLOUR = ['match', ['get', 'kind'], ['sea', 'lake', 'strait'], '#1f5f99', ['mountain'], '#7a4a1c', '#9b2c1f'];
  const IS_AREA = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
  const IS_LINE = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
  const IS_POINT = ['==', ['get', 'shape'], 'point'];
  const CLICKABLE = ['places-dot', 'places-label', 'area-label', 'river-label', 'shape-fill', 'shape-river-glow'];

  map.on('load', () => {
    map.addSource('place-shapes', {
      type: 'geojson', data: emptyFC(),
      attribution: 'Rivers &amp; regions: <a href="https://www.naturalearthdata.com/" target="_blank">Natural Earth</a>',
    });
    map.addSource('places', {
      type: 'geojson', data: emptyFC(),
      attribution: 'Places: <a href="https://www.wikidata.org/" target="_blank">Wikidata</a>',
    });
    // Our names, positioned by js/labels.js, and lines joining a name to its
    // dot when the name had to move away from it.
    map.addSource('labels', { type: 'geojson', data: emptyFC() });
    map.addSource('label-leaders', { type: 'geojson', data: emptyFC() });

    // Areas (mountain ranges, regions, seas...): light fill + outline,
    // dashed when the outline is only Claude's approximate sketch.
    map.addLayer({
      id: 'shape-fill', type: 'fill', source: 'place-shapes', filter: IS_AREA,
      paint: { 'fill-color': SHAPE_COLOUR, 'fill-opacity': 0.16 },
    });
    map.addLayer({
      id: 'shape-outline', type: 'line', source: 'place-shapes',
      filter: ['all', IS_AREA, ['!', ['get', 'approx']]],
      paint: { 'line-color': SHAPE_COLOUR, 'line-width': 1.6, 'line-opacity': 0.85 },
    });
    map.addLayer({
      id: 'shape-outline-approx', type: 'line', source: 'place-shapes',
      filter: ['all', IS_AREA, ['get', 'approx']],
      paint: { 'line-color': SHAPE_COLOUR, 'line-width': 1.6, 'line-opacity': 0.85, 'line-dasharray': [3, 2] },
    });

    // Rivers: a soft glow plus a solid (or dashed, if approximate) core line.
    map.addLayer({
      id: 'shape-river-glow', type: 'line', source: 'place-shapes', filter: IS_LINE,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#2b8be6',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 6, 7, 10, 11, 16],
        'line-opacity': 0.35,
        'line-blur': 1.5,
      },
    });
    const riverCore = {
      'line-color': '#0b4f9c',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 10, 3],
    };
    map.addLayer({
      id: 'shape-river', type: 'line', source: 'place-shapes',
      filter: ['all', IS_LINE, ['!', ['get', 'approx']]],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: riverCore,
    });
    map.addLayer({
      id: 'shape-river-approx', type: 'line', source: 'place-shapes',
      filter: ['all', IS_LINE, ['get', 'approx']],
      paint: { ...riverCore, 'line-dasharray': [2, 1.5] },
    });

    map.addLayer({
      id: 'label-leader', type: 'line', source: 'label-leaders',
      paint: { 'line-color': '#5c4a42', 'line-width': 1, 'line-opacity': 0.75 },
    });

    // Points get a dot; lines and areas only a label.
    map.addLayer({
      id: 'places-dot', type: 'circle', source: 'places', filter: IS_POINT,
      paint: {
        'circle-radius': 6,
        'circle-color': ['case', ['get', 'uncertain'], '#b26a00', '#9b2c1f'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });
    // Names. Their positions are worked out by js/labels.js so that all of them
    // show and none overlap; here they are drawn exactly there. "Allow overlap"
    // stops MapLibre from hiding any of them; the base map's labels (lower in
    // the stack) still avoid them. Fonts and sizes must match STYLE in labels.js.
    const LABEL_TEXT = ['concat', ['to-string', ['get', 'num']], '. ', ['get', 'label']];
    const HALO = { 'text-halo-color': '#ffffff', 'text-halo-width': 1.8 };
    const PLACED = { 'text-allow-overlap': true, 'text-ignore-placement': false, 'text-max-width': 100 };

    // River names: rotated along the river, beside the line.
    map.addLayer({
      id: 'river-label', type: 'symbol', source: 'labels', filter: ['==', ['get', 'style'], 'river'],
      layout: {
        ...PLACED,
        'text-field': LABEL_TEXT,
        'text-font': ['Noto Sans Italic'],
        'text-size': 14,
        'text-rotation-alignment': 'viewport',
        'text-rotate': ['get', 'rot'],
        'text-offset': ['case', ['==', ['get', 'side'], 1], ['literal', [0, 0.9]], ['literal', [0, -0.9]]],
      },
      paint: { 'text-color': '#0b3f7a', ...HALO },
    });
    // Area names inside the area.
    map.addLayer({
      id: 'area-label', type: 'symbol', source: 'labels', filter: ['==', ['get', 'style'], 'area'],
      layout: { ...PLACED, 'text-field': LABEL_TEXT, 'text-font': ['Noto Sans Bold'], 'text-size': 14 },
      paint: {
        'text-color': ['match', ['get', 'kind'], ['sea', 'lake', 'strait'], '#174a7a', ['mountain'], '#5a3512', '#6b1d14'],
        ...HALO,
      },
    });
    // Point names next to their dot, on the side chosen by labels.js.
    map.addLayer({
      id: 'places-label', type: 'symbol', source: 'labels', filter: ['==', ['get', 'style'], 'point'],
      layout: {
        ...PLACED,
        'text-field': LABEL_TEXT,
        'text-font': ['Noto Sans Bold'],
        'text-size': 13,
        'text-anchor': ['get', 'anchor'],
        'text-radial-offset': ['get', 'radial'],
      },
      paint: { 'text-color': '#3a1a14', ...HALO },
    });

    CLICKABLE.forEach((id) => {
      map.on('click', id, (e) => showPopup(e.features[0].properties.idx));
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    });

    if (resolved.length) updateMap({ fit: true }); // results arrived before the map loaded
  });

  els.layers.addEventListener('change', (e) => {
    const group = e.target.dataset.group;
    if (group) IM.basemap.setGroupVisible(map, group, e.target.checked);
    syncCountryLabels();
  });

  // Modern country names would clash with historical ones, so hide them while
  // historical borders are shown.
  function syncCountryLabels() {
    const labelsOn = els.layers.querySelector('[data-group="labels"]').checked;
    if (map.getLayer('label-country')) {
      map.setLayoutProperty('label-country', 'visibility', labelsOn && !hist.on.checked ? 'visible' : 'none');
    }
  }

  // ---------- historical borders ----------
  IM.borders.init(map);
  const hist = {
    on: $('hist-on'), controls: $('hist-controls'),
    year: $('hist-year'), yearNum: $('hist-year-num'), month: $('hist-month'),
  };
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = i + 1;
    opt.textContent = m;
    hist.month.appendChild(opt);
  });
  hist.month.value = 6;

  function applyHistDate(year) {
    const y = IM.borders.setDate(Number(year) || 1942, Number(hist.month.value));
    hist.year.value = y;
    hist.yearNum.value = y;
  }
  hist.year.addEventListener('input', () => applyHistDate(hist.year.value));
  hist.yearNum.addEventListener('change', () => applyHistDate(hist.yearNum.value));
  hist.month.addEventListener('change', () => applyHistDate(hist.year.value));
  async function setHistOn(on) {
    hist.on.checked = on;
    hist.controls.hidden = !on;
    syncCountryLabels();
    try {
      applyHistDate(hist.year.value);
      await IM.borders.setVisible(on);
    } catch (e) {
      hist.on.checked = false;
      hist.controls.hidden = true;
      syncCountryLabels();
      setStatus(e.message, true);
    }
  }
  hist.on.addEventListener('change', () => setHistOn(hist.on.checked));

  // ---------- period inferred from the passage ----------
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function showPeriod(period) {
    const box = $('period');
    const note = $('hist-inferred');
    box.innerHTML = '';
    if (!period) {
      box.hidden = true;
      note.hidden = true;
      return;
    }
    const month = period.month >= 1 && period.month <= 12 ? period.month : 0;
    const when = (month ? MONTHS[month - 1] + ' ' : '') + period.year;
    const inRange = period.year >= IM.borders.MIN_YEAR && period.year <= IM.borders.MAX_YEAR;

    const label = document.createElement('div');
    label.className = 'p-label';
    label.textContent = `Period: ${period.label}`;
    const sub = document.createElement('div');
    sub.className = 'p-note';
    sub.textContent = inRange
      ? `Borders shown for ${when}. Change the date in the Layers panel.`
      : `Borders not shown: ${period.year} is outside the CShapes range (${IM.borders.MIN_YEAR}–${IM.borders.MAX_YEAR}).`;
    box.append(label, sub);
    box.hidden = false;

    note.textContent = `From passage: ${period.label}`;
    note.hidden = false;

    if (inRange) {
      hist.month.value = month || 7;   // no month given: use mid-year
      applyHistDate(period.year);
      setHistOn(true);
    }
  }

  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  // Label points (one per place that could be located).
  function labelFC() {
    const features = [];
    resolved.forEach((r, idx) => {
      if (!r.anchor) return;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: r.anchor },
        properties: {
          idx, num: idx + 1, label: r.place.mention, kind: r.place.kind,
          shape: r.geom ? r.place.shape : 'point', uncertain: !!r.uncertain,
        },
      });
    });
    return { type: 'FeatureCollection', features };
  }

  // Line and area shapes (rivers, ranges, regions...).
  function shapeFC() {
    const features = [];
    resolved.forEach((r, idx) => {
      if (!r.geom) return;
      features.push({
        type: 'Feature',
        geometry: r.geom,
        properties: { idx, num: idx + 1, label: r.place.mention, kind: r.place.kind, approx: r.geomSource === 'approximate' },
      });
    });
    return { type: 'FeatureCollection', features };
  }

  // Names: positioned by js/labels.js for the current view, so they are
  // recomputed after every pan and zoom. (A single rotated name per river is
  // used because names placed along the line itself repeat or vanish where the
  // river is cut into map tiles.)
  function layoutLabels() {
    const src = map.getSource('labels');
    if (!src) return;
    const items = [];
    resolved.forEach((r, idx) => {
      if (!r.anchor) return;
      const shape = r.geom ? r.place.shape : 'point';
      items.push({
        idx, num: idx + 1, label: r.place.mention, kind: r.place.kind,
        style: shape === 'line' ? 'river' : shape,
        text: `${idx + 1}. ${r.place.mention}`,
        anchor: r.anchor, geom: r.geom,
      });
    });
    // Names must not hide under the Layers panel or the map's buttons and
    // attribution line.
    const mapRect = map.getContainer().getBoundingClientRect();
    const obstacles = [els.layers, ...map.getContainer().querySelectorAll('.maplibregl-ctrl')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width && r.height)
      .map((r) => ({ x0: r.left - mapRect.left, y0: r.top - mapRect.top, x1: r.right - mapRect.left, y1: r.bottom - mapRect.top }));
    const { labels, leaders } = IM.labels.layout(map, items, obstacles);
    src.setData(labels);
    map.getSource('label-leaders').setData(leaders);
  }
  map.on('moveend', layoutLabels);
  map.on('resize', layoutLabels);

  function updateMap({ fit } = { fit: false }) {
    const src = map.getSource('places');
    if (!src) return;
    const labels = labelFC();
    src.setData(labels);
    map.getSource('place-shapes').setData(shapeFC());
    layoutLabels();
    if (fit && labels.features.length) {
      // Fit to label points, not whole shapes: a river like the Volga would
      // otherwise zoom the map out to half a continent.
      const b = new maplibregl.LngLatBounds();
      labels.features.forEach((f) => b.extend(f.geometry.coordinates));
      map.fitBounds(b, { padding: 80, maxZoom: 8, duration: 800 });
    }
  }

  function geomBounds(geom) {
    const b = new maplibregl.LngLatBounds();
    const walk = (c) => (typeof c[0] === 'number' ? b.extend(c) : c.forEach(walk));
    walk(geom.coordinates);
    return b;
  }

  function addLink(parent, href, text) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = text;
    a.addEventListener('click', (e) => e.stopPropagation());
    parent.appendChild(a);
    return a;
  }

  function shapeNote(r) {
    if (r.geomSource === 'naturalearth') return 'Shape from Natural Earth';
    if (r.geomSource === 'approximate') return 'Approximate outline sketched by Claude (dashed)';
    return '';
  }

  function showPopup(idx) {
    const r = resolved[idx];
    if (!r || !r.anchor) return;
    const c = r.chosen >= 0 ? r.candidates[r.chosen] : null;
    const div = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'p-title';
    title.textContent = `${idx + 1}. ${r.place.mention}`;
    div.appendChild(title);
    const desc = document.createElement('div');
    desc.className = 'p-desc';
    desc.textContent = c ? c.label + (c.description ? ` — ${c.description}` : '') : r.place.context;
    div.appendChild(desc);
    if (shapeNote(r)) {
      const note = document.createElement('div');
      note.className = 'p-desc';
      note.textContent = shapeNote(r);
      div.appendChild(note);
    }
    if (c) addLink(div, `https://www.wikidata.org/wiki/${c.id}`, `Wikidata ${c.id}`);

    if (popup) popup.remove();
    popup = new maplibregl.Popup({ offset: 10 }).setLngLat(r.anchor).setDOMContent(div).addTo(map);
  }

  function flyTo(idx) {
    const r = resolved[idx];
    if (!r || !r.anchor) return;
    if (r.geom && r.place.shape === 'area') {
      map.fitBounds(geomBounds(r.geom), { padding: 60, maxZoom: 7, duration: 900 });
    } else {
      const zoom = r.geom ? 6 : ({ settlement: 9, mountain: 9, island: 8, lake: 8 }[r.place.kind] || 6);
      map.flyTo({ center: r.anchor, zoom: Math.max(map.getZoom(), zoom), duration: 900 });
    }
    showPopup(idx);
  }

  // ---------- results list ----------
  function addLine(li, className, text) {
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text;
    li.appendChild(div);
    return div;
  }

  function renderResults() {
    els.results.innerHTML = '';
    resolved.forEach((r, idx) => {
      const li = document.createElement('li');
      const c = r.chosen >= 0 ? r.candidates[r.chosen] : null;
      if (!r.anchor) li.classList.add('missing');
      else {
        li.classList.add('clickable');
        if (r.uncertain || r.geomSource === 'approximate') li.classList.add('uncertain');
      }

      const head = document.createElement('div');
      head.className = 'head';
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = idx + 1;
      const mention = document.createElement('span');
      mention.className = 'mention';
      mention.textContent = r.place.mention;
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = r.place.kind;
      head.append(num, mention, kind);
      li.appendChild(head);

      if (c) {
        const match = addLine(li, 'match', '');
        addLink(match, `https://www.wikidata.org/wiki/${c.id}`, c.label);
        match.appendChild(document.createTextNode(c.description ? ` — ${c.description}` : ''));
      } else {
        addLine(li, 'flag', `Not found on Wikidata (searched "${r.place.name}")`);
      }
      if (r.geomSource === 'naturalearth') addLine(li, 'match', shapeNote(r));
      if (r.geomSource === 'approximate') addLine(li, 'flag', shapeNote(r));
      if (c && r.uncertain) {
        addLine(li, 'flag', `Uncertain: ${Math.round(c.distKm)} km from where the model expected it. Check the match.`);
      }

      if (r.candidates.length > 1) {
        const sel = document.createElement('select');
        r.candidates.slice(0, 8).forEach((cand, ci) => {
          const opt = document.createElement('option');
          opt.value = ci;
          const dist = cand.distKm != null ? ` (${Math.round(cand.distKm)} km off)` : '';
          opt.textContent = `${cand.label}${cand.description ? ' — ' + cand.description : ''}${dist}`;
          sel.appendChild(opt);
        });
        sel.value = Math.max(r.chosen, 0);
        sel.addEventListener('click', (e) => e.stopPropagation());
        sel.addEventListener('change', () => {
          r.chosen = Number(sel.value);
          const chosen = r.candidates[r.chosen];
          r.uncertain = chosen.distKm != null && chosen.distKm > IM.wikidata.toleranceKm(r.place.kind);
          IM.shapes.attach(r);
          renderResults();
          updateMap();
          flyTo(idx);
        });
        li.appendChild(sel);
      }
      if (r.anchor) li.addEventListener('click', () => flyTo(idx));
      els.results.appendChild(li);
    });
  }

  // ---------- status ----------
  function setStatus(msg, isError) {
    els.status.textContent = msg;
    els.status.classList.toggle('error', !!isError);
  }

  // ---------- main pipeline ----------
  async function run() {
    const text = els.passage.value.trim();
    const s = settings();
    const cfg = PROVIDERS[s.provider];
    const needs = (msg, field) => { $('settings').open = true; field.focus(); setStatus(msg, true); };
    if (s.provider === 'compatible' && !s.baseUrl) return needs('Enter the service address in Settings first.', els.baseUrl);
    if (!s.apiKey && !cfg.keyOptional) return needs(`Enter your ${cfg.label} API key in Settings first.`, els.apiKey);
    if (!s.model) return needs('Enter a model name in Settings first (or click "List models").', els.model);
    if (!text) { setStatus('Paste a passage first.', true); return; }

    els.run.disabled = true;
    if (popup) popup.remove();
    try {
      setStatus(`Reading the passage with ${s.model}…`);
      const { places, period, usage, model, formatLabel, fixes } = await IM.llm.extractPlaces(text, s);
      showPeriod(period);
      if (!places.length) {
        resolved = [];
        renderResults(); updateMap();
        setStatus(`No places found in this passage (model: ${model}).`);
        return;
      }

      setStatus(`Found ${places.length} places. Looking them up on Wikidata…`);
      resolved = await IM.wikidata.resolvePlaces(places, {
        onProgress: (done, total) =>
          setStatus(`Found ${places.length} places. Looking them up on Wikidata… (${done}/${total})`),
        onWait: (s) =>
          setStatus(`Wikidata asked us to slow down. Retrying in ${s} s…`),
      });

      setStatus('Finding shapes for rivers, mountains and regions…');
      await IM.shapes.attachAll(resolved);

      renderResults();
      updateMap({ fit: true });

      const found = resolved.filter((r) => r.anchor).length;
      const unsure = resolved.filter((r) => r.uncertain || r.geomSource === 'approximate').length;
      let msg = `Mapped ${found} of ${places.length} places.`;
      if (unsure) msg += ` ${unsure} uncertain (orange).`;
      msg += `\nModel: ${model} (${formatLabel}).`;
      if (fixes) msg += ` ${fixes} ${fixes === 1 ? 'entry' : 'entries'} in its answer had to be repaired or dropped.`;
      if (usage) msg += `\nTokens: ${usage.input} in, ${usage.output} out.`;
      setStatus(msg);
    } catch (e) {
      console.error(e);
      setStatus(e.message || String(e), true);
    } finally {
      els.run.disabled = false;
    }
  }

  els.run.addEventListener('click', run);
  els.passage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run();
  });
  els.example.addEventListener('click', () => { els.passage.value = IM.config.exampleText; });
  els.clear.addEventListener('click', () => {
    els.passage.value = '';
    showPeriod(null);
    resolved = [];
    renderResults(); updateMap();
    if (popup) popup.remove();
    setStatus('');
  });
})();
