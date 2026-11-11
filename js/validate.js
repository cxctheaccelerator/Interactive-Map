// Checks and cleans a model's answer before it is used, whichever provider
// produced it. Providers that enforce the output format (Claude, OpenAI,
// Gemini) rarely need this; models that only promise "some JSON" often do.
//
//   IM.validate.parseJson(text)  -> object (tolerates ```json fences and
//                                   text around the JSON)
//   IM.validate.normalise(obj)   -> { places, period, fixes }
//      fixes = number of entries that had to be repaired or were dropped.
window.IM = window.IM || {};

(function () {
  const KINDS = new Set(IM.config.placeKinds);
  const SHAPES = new Set(IM.config.placeShapes);
  const LINE_KINDS = new Set(['river']);
  const AREA_KINDS = new Set(['region', 'sea', 'lake', 'strait', 'island', 'peninsula', 'forest', 'marsh', 'desert', 'plain']);

  function parseJson(text) {
    const t = String(text || '').trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(t); } catch (e) { /* try harder below */ }
    const start = t.indexOf('{'), end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { /* fall through */ }
    }
    throw new Error('Could not read the model\'s answer as JSON.');
  }

  const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : NaN;
  }
  const validLatLon = (lat, lon) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  // Outline points should be [lat, lon]. Some models send [lon, lat]; pick
  // whichever reading lies closer to the place's own estimated position.
  function cleanOutline(raw, lat, lon) {
    if (!Array.isArray(raw)) return [];
    const pts = raw
      .map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])]
        : p && typeof p === 'object' ? [num(p.lat), num(p.lon ?? p.lng)] : [NaN, NaN]))
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    if (!pts.length) return [];
    const asIs = pts.every(([a, b]) => validLatLon(a, b));
    const swapped = pts.every(([a, b]) => validLatLon(b, a));
    let useSwapped = !asIs && swapped;
    if (asIs && swapped && Number.isFinite(lat) && Number.isFinite(lon)) {
      const d = (ps) => ps.reduce((s, [a, b]) => s + Math.abs(a - lat) + Math.abs(b - lon), 0);
      useSwapped = d(pts.map(([a, b]) => [b, a])) < d(pts);
    }
    if (!asIs && !swapped) return [];
    return useSwapped ? pts.map(([a, b]) => [b, a]) : pts;
  }

  function normalisePlace(p) {
    let fixed = false;
    if (!p || typeof p !== 'object') return null;
    const mention = str(p.mention) || str(p.name);
    if (!mention) return null;
    if (!str(p.mention)) fixed = true;

    const name = str(p.name) || mention;
    let alt = p.alt_names;
    if (typeof alt === 'string') { alt = alt ? [alt] : []; fixed = true; }
    if (!Array.isArray(alt)) { alt = []; fixed = fixed || p.alt_names != null; }
    alt = alt.map(str).filter(Boolean);

    let kind = str(p.kind).toLowerCase();
    if (!KINDS.has(kind)) { kind = 'other'; fixed = true; }

    let shape = str(p.shape).toLowerCase();
    if (!SHAPES.has(shape)) {
      shape = LINE_KINDS.has(kind) ? 'line' : AREA_KINDS.has(kind) ? 'area' : 'point';
      fixed = true;
    }

    let lat = num(p.lat), lon = num(p.lon ?? p.lng);
    if (Number.isFinite(lat) && Number.isFinite(lon) && !validLatLon(lat, lon)) {
      if (validLatLon(lon, lat)) [lat, lon] = [lon, lat];
      else { lat = NaN; lon = NaN; }
      fixed = true;
    }

    const outline = shape === 'point' ? [] : cleanOutline(p.outline, lat, lon);

    return {
      place: { mention, name, alt_names: alt, kind, shape, context: str(p.context), lat, lon, outline },
      fixed,
    };
  }

  function normalisePeriod(p) {
    if (!p || typeof p !== 'object') return null;
    const known = p.known === true || p.known === 'true';
    const year = Math.round(num(p.year));
    let month = Math.round(num(p.month));
    if (!Number.isFinite(month) || month < 1 || month > 12) month = 0;
    if (!known || !Number.isFinite(year) || year === 0) return null;
    return { known: true, label: str(p.label) || String(year), year, month };
  }

  function normalise(obj) {
    // Some models wrap the answer, e.g. {"result": {...}}.
    if (obj && !Array.isArray(obj.places) && typeof obj === 'object') {
      const inner = Object.values(obj).find((v) => v && typeof v === 'object' && Array.isArray(v.places));
      if (inner) obj = inner;
    }
    let fixes = 0;
    const seen = new Set();
    const places = [];
    for (const raw of (obj && Array.isArray(obj.places) ? obj.places : [])) {
      const r = normalisePlace(raw);
      if (!r) { fixes++; continue; }
      const key = r.place.mention.toLowerCase();
      if (seen.has(key)) { fixes++; continue; }  // repeated place
      seen.add(key);
      if (r.fixed) fixes++;
      places.push(r.place);
    }
    return { places, period: normalisePeriod(obj && obj.period), fixes };
  }

  IM.validate = { parseJson, normalise };
})();
