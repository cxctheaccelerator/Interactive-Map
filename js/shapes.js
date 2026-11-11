// Finds a drawable shape for places that are lines (rivers) or areas (mountain
// ranges, regions, seas, lakes...).
//  1. Natural Earth (data/naturalearth.js): matched by Wikidata id or by name,
//     but only if the shape lies near where the place is expected.
//  2. Otherwise Claude's rough outline, drawn dashed and marked approximate.
//  3. Otherwise a plain point.
// Sets on each resolved item: geom (GeoJSON geometry or null),
// geomSource ('naturalearth' | 'approximate' | null), anchor ([lon, lat] for
// the label, or null).
window.IM = window.IM || {};

(function () {
  const cfg = IM.config.shapes;
  let index = null;      // { byKey: Map<nameKey, feature[]>, byQid: Map<qid, feature[]> }
  let loading = null;

  // Must stay identical to normalise() in tools/build_naturalearth.py.
  const STOPWORDS = new Set(['the', 'river', 'r', 'mountains', 'mountain', 'mts', 'mt', 'range', 'hills']);
  function normaliseName(name) {
    return (name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .split(/[^a-z0-9]+/).filter((w) => w && !STOPWORDS.has(w)).join(' ');
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Could not load ${src}. Run tools/build_naturalearth.py first.`));
      document.head.appendChild(s);
    });
  }

  async function ensureIndex() {
    if (index) return;
    if (!loading) loading = (window.IM_DATA && IM_DATA.naturalearth) ? Promise.resolve() : loadScript(cfg.dataUrl);
    await loading;
    if (index) return;
    const byKey = new Map(), byQid = new Map();
    for (const f of IM_DATA.naturalearth) {
      for (const k of f.n) {
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(f);
      }
      if (f.q) {
        if (!byQid.has(f.q)) byQid.set(f.q, []);
        byQid.get(f.q).push(f);
      }
    }
    index = { byKey, byQid };
  }

  // ---------- geometry helpers ----------
  const dist = (a, b) => IM.wikidata.distanceKm(a[1], a[0], b[1], b[0]); // [lon, lat] points

  function forEachVertex(geom, fn) {
    const c = geom.coordinates;
    switch (geom.type) {
      case 'LineString': c.forEach(fn); break;
      case 'MultiLineString': c.forEach((l) => l.forEach(fn)); break;
      case 'Polygon': c[0].forEach(fn); break;                      // outer ring only
      case 'MultiPolygon': c.forEach((p) => p[0].forEach(fn)); break;
    }
  }

  // Distance (km) from a point to a feature, and the nearest vertex.
  function distanceToFeature(pt, f) {
    const [w, s, e, n] = f.b;
    if (f.k === 'area' && pt[0] >= w && pt[0] <= e && pt[1] >= s && pt[1] <= n) {
      return { km: 0, nearest: null };
    }
    let best = Infinity, nearest = null;
    forEachVertex(f.g, (v) => {
      const d = dist(pt, v);
      if (d < best) { best = d; nearest = v; }
    });
    return { km: best, nearest };
  }

  function nearestVertex(geom, pt) {
    let best = Infinity, nearest = null;
    forEachVertex(geom, (v) => {
      const d = dist(pt, v);
      if (d < best) { best = d; nearest = v; }
    });
    return nearest;
  }

  // A short piece of river next to `pt`, used to write the river's name once,
  // on the stretch the passage is about. The piece starts a little away from
  // `pt` (often a city whose own label sits there) and runs up- or downstream,
  // whichever way the river is straighter, so the curved label fits.
  function riverLabelLine(geom, pt, lengthKm, gapKm) {
    const lines = geom.type === 'LineString' ? [geom.coordinates]
      : geom.type === 'MultiLineString' ? geom.coordinates : [];
    let best = Infinity, li = -1, vi = -1;
    lines.forEach((l, i) => l.forEach((v, j) => {
      const d = dist(pt, v);
      if (d < best) { best = d; li = i; vi = j; }
    }));
    if (li < 0) return null;
    const l = lines[li];

    function walk(step) {
      const out = [];
      let acc = 0;
      for (let i = vi; i + step >= 0 && i + step < l.length && acc < gapKm + lengthKm; i += step) {
        acc += dist(l[i], l[i + step]);
        if (acc >= gapKm) out.push(l[i + step]);
      }
      if (out.length < 2) return null;
      let path = 0;
      for (let i = 1; i < out.length; i++) path += dist(out[i - 1], out[i]);
      const straightness = dist(out[0], out[out.length - 1]) / (path || 1);
      return { coords: out, score: straightness * Math.min(1, path / lengthKm) };
    }
    const options = [walk(1), walk(-1)].filter(Boolean).sort((a, b) => b.score - a.score);
    return options.length ? options[0].coords : null;
  }

  // ---------- matching ----------
  function findNaturalEarth(r) {
    if (!index) return null;
    const p = r.place;
    const cand = r.chosen >= 0 ? r.candidates[r.chosen] : null;
    const refs = [];
    if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) refs.push([p.lon, p.lat]);
    if (cand) refs.push([cand.lon, cand.lat]);
    if (!refs.length) return null;

    const pool = new Set();
    if (cand && index.byQid.has(cand.id)) index.byQid.get(cand.id).forEach((f) => pool.add(f));
    const names = [cand && cand.label, p.name, p.mention, ...(p.alt_names || [])];
    for (const key of new Set(names.map(normaliseName).filter(Boolean))) {
      (index.byKey.get(key) || []).forEach((f) => pool.add(f));
    }

    let best = null;
    for (const f of pool) {
      if (f.k !== p.shape) continue;
      const km = Math.min(...refs.map((pt) => distanceToFeature(pt, f).km));
      const qidMatch = cand && f.q === cand.id;
      // A matching Wikidata id makes a shape more trustworthy, but distance still
      // decides: some Natural Earth fragments carry the id of the whole river.
      const limit = qidMatch ? cfg.maxDistanceKm[f.k] * 3 : cfg.maxDistanceKm[f.k];
      if (km > limit) continue;
      const score = km - (qidMatch ? 150 : 0);
      if (!best || score < best.score) best = { f, score };
    }
    return best ? best.f : null;
  }

  function claudeOutline(p) {
    const pts = (p.outline || [])
      .filter((q) => Array.isArray(q) && q.length >= 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]))
      .map(([lat, lon]) => [lon, lat]);
    if (p.shape === 'line' && pts.length >= 2) return { type: 'LineString', coordinates: pts };
    if (p.shape === 'area' && pts.length >= 3) return { type: 'Polygon', coordinates: [[...pts, pts[0]]] };
    return null;
  }

  function attach(r) {
    const p = r.place;
    const cand = r.chosen >= 0 ? r.candidates[r.chosen] : null;
    const estimate = Number.isFinite(p.lat) && Number.isFinite(p.lon) ? [p.lon, p.lat] : null;
    r.geom = null;
    r.geomSource = null;
    r.anchor = cand ? [cand.lon, cand.lat] : null;
    if (p.shape !== 'line' && p.shape !== 'area') return r;

    const f = findNaturalEarth(r);
    if (f) {
      r.geom = f.g;
      r.geomSource = 'naturalearth';
      r.uncertain = false;
    } else {
      const g = claudeOutline(p);
      if (g) { r.geom = g; r.geomSource = 'approximate'; }
    }
    if (!r.geom) return r;

    // Label position: for rivers, the point nearest to the stretch the passage
    // is about; for areas, inside the shape.
    if (p.shape === 'line') r.anchor = nearestVertex(r.geom, estimate || r.anchor || r.geom.coordinates[0]);
    else if (f && f.l) r.anchor = f.l;
    else r.anchor = estimate || r.anchor;
    return r;
  }

  async function attachAll(resolved) {
    if (resolved.some((r) => r.place.shape === 'line' || r.place.shape === 'area')) {
      try { await ensureIndex(); } catch (e) { console.warn(e); } // fall back to outlines
    }
    resolved.forEach(attach);
    return resolved;
  }

  IM.shapes = { attachAll, attach, riverLabelLine, normaliseName };
})();
