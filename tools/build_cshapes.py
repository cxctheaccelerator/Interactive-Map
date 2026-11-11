#!/usr/bin/env python3
"""Convert the raw CShapes 2.0 GeoJSON into a compact file the app can load.

    python3 tools/build_cshapes.py [--tolerance 0.02]

Input:  data/raw/CShapes-2.0.geojson   (from https://icr.ethz.ch/data/cshapes/)
Output: data/cshapes.js                (sets window.IM_DATA.cshapes)

The output is a .js file rather than .json so that the page also works when
opened straight from disk (file://), where browsers block fetch() of local files.

Each feature keeps: name, area, start/end date (as YYYYMMDD integers, inclusive),
Gleditsch-Ward code, capital, and a label point inside the largest polygon.
Only the Python standard library is used.
"""
import argparse
import heapq
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'raw', 'CShapes-2.0.geojson')
DST = os.path.join(ROOT, 'data', 'cshapes.js')


# ---------------------------------------------------------------- simplify
def simplify_dp(points, tol):
    """Douglas-Peucker simplification of an open polyline (iterative)."""
    n = len(points)
    if n < 3:
        return points[:]
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    tol2 = tol * tol
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            if seg2 == 0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
                d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d2 > best:
                best, idx = d2, i
        if best > tol2:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring, tol):
    """Simplify a closed ring; split at the point farthest from the start so
    the ring's shape is not anchored on a single arbitrary vertex."""
    pts = ring[:-1] if ring[0] == ring[-1] else ring[:]
    if len(pts) < 4:
        return None
    x0, y0 = pts[0]
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - x0) ** 2 + (pts[i][1] - y0) ** 2)
    a = simplify_dp(pts[: far + 1], tol)
    b = simplify_dp(pts[far:] + [pts[0]], tol)
    out = a[:-1] + b[:-1]
    out = [[round(x, 3), round(y, 3)] for x, y in out]
    # drop consecutive duplicates created by rounding
    dedup = [out[0]]
    for p in out[1:]:
        if p != dedup[-1]:
            dedup.append(p)
    if len(dedup) < 3:
        return None
    dedup.append(dedup[0])
    return dedup


def ring_area(ring):
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


# ---------------------------------------------------------------- polylabel
def point_to_polygon_dist(x, y, polygon):
    """Signed distance from point to polygon outline (positive = inside)."""
    inside = False
    min_d2 = math.inf
    for ring in polygon:
        for (ax, ay), (bx, by) in zip(ring, ring[1:]):
            if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                inside = not inside
            dx, dy = bx - ax, by - ay
            seg2 = dx * dx + dy * dy
            t = 0 if seg2 == 0 else max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / seg2))
            d2 = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2
            min_d2 = min(min_d2, d2)
    d = math.sqrt(min_d2)
    return d if inside else -d


def polylabel(polygon, precision=0.05):
    """Pole of inaccessibility (Mapbox polylabel algorithm): the interior point
    farthest from the outline -- a good place for a label."""
    xs = [p[0] for p in polygon[0]]
    ys = [p[1] for p in polygon[0]]
    minx, miny, maxx, maxy = min(xs), min(ys), max(xs), max(ys)
    w, h = maxx - minx, maxy - miny
    size = min(w, h)
    if size == 0:
        return [minx, miny]
    half = size / 2
    heap = []

    def push(cx, cy, hh):
        d = point_to_polygon_dist(cx, cy, polygon)
        mx = d + hh * math.sqrt(2)
        heapq.heappush(heap, (-mx, cx, cy, hh, d))

    x = minx
    while x < maxx:
        y = miny
        while y < maxy:
            push(x + half, y + half, half)
            y += size
        x += size

    # start with the area-weighted centroid as first guess
    a = cx = cy = 0.0
    ring = polygon[0]
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        f = x1 * y2 - x2 * y1
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
        a += f * 3
    best = (minx + w / 2, miny + h / 2) if a == 0 else (cx / a, cy / a)
    best_d = point_to_polygon_dist(best[0], best[1], polygon)
    bbox_c = (minx + w / 2, miny + h / 2)
    d_c = point_to_polygon_dist(*bbox_c, polygon)
    if d_c > best_d:
        best, best_d = bbox_c, d_c

    while heap:
        negmax, cx, cy, hh, d = heapq.heappop(heap)
        if d > best_d:
            best, best_d = (cx, cy), d
        if -negmax - best_d <= precision:
            continue
        hh /= 2
        for ox in (-hh, hh):
            for oy in (-hh, hh):
                push(cx + ox, cy + oy, hh)
    return [round(best[0], 3), round(best[1], 3)]


# ---------------------------------------------------------------- main
def ymd(y, m, d):
    return int(y) * 10000 + int(m) * 100 + int(d)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--tolerance', type=float, default=0.02,
                    help='simplification tolerance in degrees (default 0.02 = about 2 km)')
    args = ap.parse_args()

    with open(SRC, encoding='utf-8') as f:
        src = json.load(f)

    features = []
    n_in = n_out = 0
    for feat in src['features']:
        p = feat['properties']
        g = feat['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        out_polys = []
        for poly in polys:
            n_in += sum(len(r) for r in poly)
            outer = simplify_ring(poly[0], args.tolerance)
            if outer is None:
                continue
            holes = [h for h in (simplify_ring(r, args.tolerance) for r in poly[1:]) if h]
            out_polys.append([outer] + holes)
        if not out_polys:
            # very small country: keep its largest ring unsimplified (rounded)
            largest = max((poly[0] for poly in polys), key=ring_area)
            out_polys = [[[[round(x, 4), round(y, 4)] for x, y in largest]]]
        n_out += sum(len(r) for poly in out_polys for r in poly)

        main_poly = max(out_polys, key=lambda pl: ring_area(pl[0]))
        label = polylabel(main_poly)

        geometry = ({'type': 'Polygon', 'coordinates': out_polys[0]} if len(out_polys) == 1
                    else {'type': 'MultiPolygon', 'coordinates': out_polys})
        features.append({
            'type': 'Feature',
            'geometry': geometry,
            'properties': {
                'name': p['cntry_name'],
                'gw': p['gwcode'],
                'area': p.get('area') or 0,          # km², used to prioritise labels
                'start': ymd(p['gwsyear'], p['gwsmonth'], p['gwsday']),
                'end': ymd(p['gweyear'], p['gwemonth'], p['gweday']),
                'cap': p.get('capname') or '',
                'capLon': round(p['caplong'], 3) if p.get('caplong') is not None else None,
                'capLat': round(p['caplat'], 3) if p.get('caplat') is not None else None,
                'labelLon': label[0],
                'labelLat': label[1],
            },
        })

    fc = {'type': 'FeatureCollection', 'features': features}
    payload = json.dumps(fc, separators=(',', ':'), ensure_ascii=False)
    with open(DST, 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/build_cshapes.py from CShapes 2.0 (Schvitz et al. 2022,\n')
        f.write('// https://icr.ethz.ch/data/cshapes/), licensed CC BY-NC-SA 4.0. Do not edit by hand.\n')
        f.write('window.IM_DATA = window.IM_DATA || {};\n')
        f.write('window.IM_DATA.cshapes = ')
        f.write(payload)
        f.write(';\n')

    print(f'{len(features)} features, {n_in:,} -> {n_out:,} points, '
          f'{os.path.getsize(DST) / 1e6:.1f} MB written to {os.path.relpath(DST, ROOT)}')


if __name__ == '__main__':
    main()
