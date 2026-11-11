// UI wiring: settings, running the pipeline, results list, map markers.
window.IM = window.IM || {};

(function () {
  const $ = (id) => document.getElementById(id);
  const KEY_STORE = 'im.apiKey';
  const MODEL_STORE = 'im.model';

  const els = {
    apiKey: $('api-key'), remember: $('remember-key'), model: $('model'),
    passage: $('passage'), run: $('run'), example: $('example'), clear: $('clear'),
    status: $('status'), results: $('results'), layers: $('layers'),
  };

  // ---------- storage helpers (storage can be unavailable in private modes) ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  // ---------- settings ----------
  IM.config.anthropic.models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    els.model.appendChild(opt);
  });
  els.model.value = store.get(MODEL_STORE) || IM.config.anthropic.defaultModel;
  els.model.addEventListener('change', () => store.set(MODEL_STORE, els.model.value));

  const savedKey = store.get(KEY_STORE);
  if (savedKey) { els.apiKey.value = savedKey; els.remember.checked = true; }
  else { $('settings').open = true; }

  function syncKeyStorage() {
    if (els.remember.checked && els.apiKey.value.trim()) store.set(KEY_STORE, els.apiKey.value.trim());
    else store.del(KEY_STORE);
  }
  els.remember.addEventListener('change', syncKeyStorage);
  els.apiKey.addEventListener('change', syncKeyStorage);

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
    map.addSource('river-labels', { type: 'geojson', data: emptyFC() });

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
    const LABEL_TEXT = ['concat', ['to-string', ['get', 'num']], '. ', ['get', 'label']];
    const HALO = { 'text-halo-color': '#ffffff', 'text-halo-width': 1.8 };

    // River names: one label per river, next to the part the passage is about,
    // rotated to follow the river's direction there (see riverLabelFC).
    map.addLayer({
      id: 'river-label', type: 'symbol', source: 'river-labels',
      layout: {
        'text-field': LABEL_TEXT,
        'text-font': ['Noto Sans Italic'],
        'text-size': 14,
        'text-rotation-alignment': 'map',
        'text-rotate': ['get', 'rot'],
        'text-offset': [0, -0.9],
      },
      paint: { 'text-color': '#0b3f7a', ...HALO },
    });
    // Area names in the middle of the area.
    map.addLayer({
      id: 'area-label', type: 'symbol', source: 'places', filter: ['==', ['get', 'shape'], 'area'],
      layout: { 'text-field': LABEL_TEXT, 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-max-width': 10 },
      paint: {
        'text-color': ['match', ['get', 'kind'], ['sea', 'lake', 'strait'], '#174a7a', ['mountain'], '#5a3512', '#6b1d14'],
        ...HALO,
      },
    });
    // Point names next to their dot; may move to another side to avoid overlaps.
    map.addLayer({
      id: 'places-label', type: 'symbol', source: 'places', filter: IS_POINT,
      layout: {
        'text-field': LABEL_TEXT,
        'text-font': ['Noto Sans Bold'],
        'text-size': 13,
        'text-variable-anchor': ['top', 'bottom', 'right', 'left'],
        'text-radial-offset': 0.75,
        'text-justify': 'auto',
        'text-max-width': 10,
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

  // One label point per river: in the middle of a short stretch next to the
  // part the passage is about, rotated along that stretch. The stretch is a
  // fixed number of screen pixels, so this is recomputed when the zoom changes.
  // (Labels placed along the line itself repeat or vanish where the river is
  // cut into map tiles, so a single rotated label is used instead.)
  const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180 / Math.PI;

  function riverLabelFC() {
    const { riverLabelPx, riverLabelGapPx } = IM.config.shapes;
    const features = [];
    resolved.forEach((r, idx) => {
      if (!r.geom || r.place.shape !== 'line' || !r.anchor) return;
      const kmPerPx = 40075 * Math.cos(r.anchor[1] * Math.PI / 180) / (512 * 2 ** map.getZoom());
      const pts = IM.shapes.riverLabelLine(r.geom, r.anchor, riverLabelPx * kmPerPx, riverLabelGapPx * kmPerPx);
      if (!pts) return;
      const a = pts[0], b = pts[pts.length - 1];
      const mid = pts[Math.floor(pts.length / 2)];
      // Screen angle of the stretch (clockwise from east), kept upright.
      let rot = Math.atan2(-(mercY(b[1]) - mercY(a[1])), b[0] - a[0]) * 180 / Math.PI;
      if (rot > 90) rot -= 180;
      if (rot <= -90) rot += 180;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: mid },
        properties: { idx, num: idx + 1, label: r.place.mention, rot },
      });
    });
    return { type: 'FeatureCollection', features };
  }
  map.on('zoomend', () => {
    const src = map.getSource('river-labels');
    if (src && resolved.length) src.setData(riverLabelFC());
  });

  function updateMap({ fit } = { fit: false }) {
    const src = map.getSource('places');
    if (!src) return;
    const labels = labelFC();
    src.setData(labels);
    map.getSource('place-shapes').setData(shapeFC());
    map.getSource('river-labels').setData(riverLabelFC());
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
    const apiKey = els.apiKey.value.trim();
    if (!apiKey) { $('settings').open = true; els.apiKey.focus(); setStatus('Enter your Anthropic API key in Settings first.', true); return; }
    if (!text) { setStatus('Paste a passage first.', true); return; }

    els.run.disabled = true;
    if (popup) popup.remove();
    try {
      setStatus('Reading the passage with Claude…');
      const { places, period, usage } = await IM.llm.extractPlaces(text, { apiKey, model: els.model.value });
      showPeriod(period);
      if (!places.length) {
        resolved = [];
        renderResults(); updateMap();
        setStatus('No places found in this passage.');
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
      if (usage) msg += `\nTokens: ${usage.input_tokens} in, ${usage.output_tokens} out.`;
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
