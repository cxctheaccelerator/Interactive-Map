// Places the names of the passage's places on the map so that every name is
// shown and no two overlap.
//
// MapLibre's own label placement hides a label that collides with another one.
// Instead, this file decides where each of our names goes: it tries several
// candidate positions per name, in order of preference, and takes the first one
// that touches no other name, no place dot and no panel. If none is free, it
// takes the one with the least overlap, so a name is never dropped. The map
// then draws our names with overlap allowed (they are already laid out), and
// the base map's own labels make way for them.
//
// Positions are recomputed after every pan and zoom (app.js, on 'moveend'), so
// names also follow the part of a river or area that is on screen.
window.IM = window.IM || {};

(function () {
  // Must match the label layers in app.js.
  const STYLE = {
    point: { size: 13, font: 'bold 13px "Noto Sans", Arial, sans-serif' },
    area:  { size: 14, font: 'bold 14px "Noto Sans", Arial, sans-serif' },
    river: { size: 14, font: 'italic 14px "Noto Sans", Arial, sans-serif' },
  };
  const WIDTH_FACTOR = 1.1;   // the map's font runs a little wider than the fallback used for measuring
  const PAD = 2;              // free space around each name (px); also covers the white halo
  const DOT_R = 8;            // place dot radius including its white ring (px)
  const RADII = [0.75, 1.9, 3.1, 4.3];   // distance of a name from its dot (em); further rings get a leader line
  // MapLibre text-anchor names the side of the text that touches the point:
  // 'top' puts the name below the dot, 'left' puts it to the right.
  const ANCHORS = ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const BASELINE = 7 / 24;    // MapLibre's vertical shift for radially offset text (em)
  const RIVER_OFFSET = 0.9;   // river names sit this far beside the line (em); see 'text-offset' in app.js

  // ---------- measuring and boxes (screen pixels) ----------
  const ctx = document.createElement('canvas').getContext('2d');
  function measure(text, style) {
    const st = STYLE[style];
    ctx.font = st.font;
    return { w: ctx.measureText(text).width * WIDTH_FACTOR, h: st.size * 1.2, s: st.size };
  }

  const box = (x0, y0, x1, y1) => ({ x0: x0 - PAD, y0: y0 - PAD, x1: x1 + PAD, y1: y1 + PAD });

  function overlapArea(a, b) {
    const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function outsideArea(b, W, H) {
    const full = (b.x1 - b.x0) * (b.y1 - b.y0);
    return full - overlapArea(b, { x0: 0, y0: 0, x1: W, y1: H });
  }

  const inView = (p, W, H, margin = 0) =>
    p.x >= margin && p.y >= margin && p.x <= W - margin && p.y <= H - margin;

  // First candidate that is free and fully on screen; otherwise the one with
  // the least overlap (going off screen counts as overlap).
  function choose(cands, taken, W, H) {
    let best = null;
    for (const c of cands) {
      let cost = 0;
      for (const b of c.boxes) {
        cost += outsideArea(b, W, H);
        for (const t of taken) cost += overlapArea(b, t);
      }
      if (cost === 0) return c;
      if (!best || cost < best.cost) best = { ...c, cost };
    }
    return best;
  }

  // ---------- geometry helpers ----------
  function forEachVertex(geom, fn) {
    const c = geom.coordinates;
    switch (geom.type) {
      case 'LineString': c.forEach(fn); break;
      case 'MultiLineString': c.forEach((l) => l.forEach(fn)); break;
      case 'Polygon': c[0].forEach(fn); break;
      case 'MultiPolygon': c.forEach((p) => p[0].forEach(fn)); break;
    }
  }

  function outerRings(geom) {
    if (geom.type === 'Polygon') return [geom.coordinates[0]];
    if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p[0]);
    return [];
  }

  function pointInRing(p, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function distToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  // The on-screen vertex of a line nearest the middle of the screen.
  function visibleVertex(geom, map, W, H) {
    let best = null, bestD = Infinity;
    forEachVertex(geom, (v) => {
      const p = map.project(v);
      if (!inView(p, W, H)) return;
      const d = (p.x - W / 2) ** 2 + (p.y - H / 2) ** 2;
      if (d < bestD) { bestD = d; best = v; }
    });
    return best;
  }

  // An on-screen point inside an area, as far from its edges as possible.
  function visibleInside(rings, W, H) {
    let best = null, bestScore = -1;
    const cols = 14, rows = 9;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const p = { x: W * (i + 0.5) / cols, y: H * (j + 0.5) / rows };
        if (!rings.some((r) => pointInRing(p, r))) continue;
        let score = Infinity;
        for (const r of rings) {
          for (let k = 1; k < r.length; k++) score = Math.min(score, distToSegment(p, r[k - 1], r[k]));
        }
        if (score > bestScore) { bestScore = score; best = p; }
      }
    }
    return best;
  }

  // ---------- candidate positions ----------
  // Box of a name placed with MapLibre's text-anchor + text-radial-offset.
  function pointBox(D, anchor, r, m) {
    const off = r * m.s, hyp = off / Math.SQRT2, base = BASELINE * m.s;
    let x, y; // top-left corner of the text
    switch (anchor) {
      case 'top':          x = D.x - m.w / 2;   y = D.y + off - base; break;
      case 'bottom':       x = D.x - m.w / 2;   y = D.y - off + base - m.h; break;
      case 'left':         x = D.x + off;       y = D.y - m.h / 2; break;
      case 'right':        x = D.x - off - m.w; y = D.y - m.h / 2; break;
      case 'top-left':     x = D.x + hyp;       y = D.y + hyp - base; break;
      case 'top-right':    x = D.x - hyp - m.w; y = D.y + hyp - base; break;
      case 'bottom-left':  x = D.x + hyp;       y = D.y - hyp + base - m.h; break;
      case 'bottom-right': x = D.x - hyp - m.w; y = D.y - hyp + base - m.h; break;
    }
    return box(x, y, x + m.w, y + m.h);
  }

  function pointCandidates(D, m) {
    const out = [];
    RADII.forEach((r, ring) => ANCHORS.forEach((anchor) => out.push({ boxes: [pointBox(D, anchor, r, m)], anchor, radial: r, ring })));
    return out;
  }

  // A rotated name is approximated by a row of squares along its direction.
  function rotatedBoxes(C, th, m) {
    const n = Math.max(1, Math.ceil(m.w / m.h));
    const step = m.w / n, half = Math.max(step, m.h) / 2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = -m.w / 2 + (i + 0.5) * step;
      const x = C.x + Math.cos(th) * t, y = C.y + Math.sin(th) * t;
      out.push(box(x - half, y - half, x + half, y + half));
    }
    return out;
  }

  function riverCandidates(item, map, m, W, H) {
    // The stretch the passage is about if it is on screen, otherwise the
    // visible part of the river nearest the middle of the screen.
    let pt = item.anchor;
    if (!inView(map.project(pt), W, H, 20)) pt = visibleVertex(item.geom, map, W, H);
    if (!pt) return [];

    const { riverLabelPx, riverLabelGapPx } = IM.config.shapes;
    const kmPerPx = 40075 * Math.cos(pt[1] * Math.PI / 180) / (512 * 2 ** map.getZoom());
    const lengthPx = Math.max(riverLabelPx, m.w);
    const stretches = IM.shapes.riverLabelStretches(item.geom, pt, lengthPx * kmPerPx, riverLabelGapPx * kmPerPx);

    const out = [];
    for (const s of stretches) {
      const P = s.map((c) => map.project(c));
      const seg = [];
      let total = 0;
      for (let i = 1; i < P.length; i++) { seg.push(Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y)); total += seg[i - 1]; }
      if (!total) continue;
      // Midpoint along the stretch.
      let M = P[0], acc = 0;
      for (let i = 0; i < seg.length; i++) {
        if (acc + seg[i] >= total / 2) {
          const t = seg[i] ? (total / 2 - acc) / seg[i] : 0;
          M = { x: P[i].x + (P[i + 1].x - P[i].x) * t, y: P[i].y + (P[i + 1].y - P[i].y) * t };
          break;
        }
        acc += seg[i];
      }
      // Screen direction of the stretch, kept upright.
      const a = P[0], b = P[P.length - 1];
      let rot = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if (rot > 90) rot -= 180;
      if (rot < -90) rot += 180;
      const th = rot * Math.PI / 180;
      for (const side of [-1, 1]) { // -1: beside the line on one side, 1: the other
        const off = side * RIVER_OFFSET * m.s;
        const C = { x: M.x - Math.sin(th) * off, y: M.y + Math.cos(th) * off };
        out.push({ boxes: rotatedBoxes(C, th, m), at: M, rot, side });
      }
    }
    return out;
  }

  function areaCandidates(item, map, m, W, H) {
    let P = map.project(item.anchor);
    if (!inView(P, W, H, 10)) {
      P = visibleInside(outerRings(item.geom).map((r) => r.map((c) => map.project(c))), W, H);
      if (!P) return [];
    }
    const offsets = [[0, 0]];
    for (let k = 1; k <= 4; k++) {
      const dx = k * m.w * 0.35, dy = k * m.h * 0.9;
      offsets.push([0, -dy], [0, dy], [dx, 0], [-dx, 0], [dx, -dy], [-dx, -dy], [dx, dy], [-dx, dy]);
    }
    return offsets.map(([dx, dy]) => {
      const x = P.x + dx, y = P.y + dy;
      return { boxes: [box(x - m.w / 2, y - m.h / 2, x + m.w / 2, y + m.h / 2)], at: { x, y } };
    });
  }

  // ---------- layout ----------
  // items: [{ idx, num, label, kind, style: 'point'|'river'|'area', text, anchor, geom }]
  // obstacles: screen boxes names must avoid (e.g. the Layers panel).
  // Returns GeoJSON for the 'labels' and 'label-leaders' sources.
  function layout(map, items, obstacles = []) {
    const W = map.getContainer().clientWidth, H = map.getContainer().clientHeight;
    const taken = obstacles.map((o) => ({ ...o }));
    const dots = new Map();
    items.filter((it) => it.style === 'point').forEach((it) => dots.set(it.idx, map.project(it.anchor)));
    const dotBoxes = (except) => [...dots].filter(([i]) => i !== except)
      .map(([, D]) => box(D.x - DOT_R, D.y - DOT_R, D.x + DOT_R, D.y + DOT_R));

    const labels = [], leaders = [];
    const lngLat = (p) => { const ll = map.unproject([p.x, p.y]); return [ll.lng, ll.lat]; };

    // Points first (their names must stay near the dot), then rivers, then
    // areas (which have the most room to move).
    for (const style of ['point', 'river', 'area']) {
      for (const it of items) {
        if (it.style !== style) continue;
        const m = measure(it.text, style);
        let cands;
        if (style === 'point') {
          if (!inView(dots.get(it.idx), W, H)) continue; // dot off screen: no name needed
          cands = pointCandidates(dots.get(it.idx), m);
        } else if (style === 'river') {
          cands = riverCandidates(it, map, m, W, H);
        } else {
          cands = areaCandidates(it, map, m, W, H);
        }
        if (!cands.length) continue;

        const c = choose(cands, taken.concat(dotBoxes(it.idx)), W, H);
        taken.push(...c.boxes);
        const props = { idx: it.idx, num: it.num, label: it.label, kind: it.kind, style };

        if (style === 'point') {
          labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: it.anchor },
            properties: { ...props, anchor: c.anchor, radial: c.radial } });
          if (c.ring > 0) {
            // Name pushed away from its dot: connect them with a thin line.
            const D = dots.get(it.idx), b = c.boxes[0];
            const Q = { x: Math.max(b.x0 + PAD, Math.min(D.x, b.x1 - PAD)), y: Math.max(b.y0 + PAD, Math.min(D.y, b.y1 - PAD)) };
            const len = Math.hypot(Q.x - D.x, Q.y - D.y);
            if (len > DOT_R + 2) {
              const S = { x: D.x + (Q.x - D.x) / len * DOT_R, y: D.y + (Q.y - D.y) / len * DOT_R };
              leaders.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [lngLat(S), lngLat(Q)] }, properties: { idx: it.idx } });
            }
          }
        } else if (style === 'river') {
          labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: lngLat(c.at) },
            properties: { ...props, rot: c.rot, side: c.side } });
        } else {
          labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: lngLat(c.at) }, properties: props });
        }
      }
    }
    return {
      labels: { type: 'FeatureCollection', features: labels },
      leaders: { type: 'FeatureCollection', features: leaders },
    };
  }

  IM.labels = { layout };
})();
