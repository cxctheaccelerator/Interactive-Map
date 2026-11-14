#!/usr/bin/env python3
"""Convert Natural Earth physical-geography data into a compact file the app
uses to draw rivers, mountain ranges, regions, seas and lakes as shapes.

    python3 tools/build_naturalearth.py [--tolerance 0.01]   # default: full detail

Input:  data/raw/naturalearth/*.geojson  (Natural Earth 1:10m, public domain,
        https://github.com/nvkelso/natural-earth-vector)
Output: data/naturalearth.js             (sets window.IM_DATA.naturalearth)
        data/naturalearth.info.js        (tiny marker: the data has been built)

Each output feature:
  q  Wikidata id or null      k  "line" or "area"     c  Natural Earth class
  n  normalised name keys     b  bbox [w, s, e, n]    l  label point (areas)
  g  GeoJSON geometry
River segments with the same name that touch each other are merged into one
feature. The app matches a place by Wikidata id first, then by name + distance.
"""
import argparse
import datetime
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_cshapes import label_point, ring_area, simplify_line, simplify_ring, write_info  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'raw', 'naturalearth')
DST = os.path.join(ROOT, 'data', 'naturalearth.js')

# (file, kind, classes to skip)
SOURCES = [
    # "Lake Centerline" = a river's course through a lake or reservoir: keep it.
    ('ne_10m_rivers_lake_centerlines.geojson', 'line', set()),
    ('ne_10m_rivers_europe.geojson', 'line', set()),
    ('ne_10m_geography_regions_polys.geojson', 'area', {'Continent'}),
    ('ne_10m_geography_marine_polys.geojson', 'area', {'ocean', 'river'}),
    ('ne_10m_lakes.geojson', 'area', set()),
    ('ne_10m_lakes_europe.geojson', 'area', set()),
]

# Must stay identical to normaliseName() in js/shapes.js.
STOPWORDS = {'the', 'river', 'r', 'mountains', 'mountain', 'mts', 'mt', 'range', 'hills'}


def normalise(name):
    s = unicodedata.normalize('NFD', name or '').lower()
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    words = [w for w in re.split(r'[^a-z0-9]+', s) if w and w not in STOPWORDS]
    return ' '.join(words)


def prop(p, *keys):
    """Read a property regardless of upper/lower case field names."""
    for k in keys:
        for kk in (k, k.upper()):
            if p.get(kk):
                return p[kk]
    return None


def name_keys(p, fields=('name', 'name_en', 'name_alt', 'namealt')):
    keys = set()
    for k in fields:
        v = prop(p, k)
        if v:
            for part in str(v).split(';'):
                n = normalise(part)
                if n:
                    keys.add(n)
    return sorted(keys)


def lines_of(geom):
    if geom['type'] == 'LineString':
        return [geom['coordinates']]
    if geom['type'] == 'MultiLineString':
        return geom['coordinates']
    return []


def polys_of(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return geom['coordinates']
    return []


def bbox_of(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return [round(min(xs), 3), round(min(ys), 3), round(max(xs), 3), round(max(ys), 3)]


def merge_lines(lines, eps=1e-4):
    """Join line pieces that touch end-to-end into longer lines, so labels
    written along a river have room to fit."""
    def close(a, b):
        return abs(a[0] - b[0]) < eps and abs(a[1] - b[1]) < eps

    lines = [list(l) for l in lines if len(l) >= 2]
    merged = True
    while merged:
        merged = False
        for i in range(len(lines)):
            if lines[i] is None:
                continue
            for j in range(len(lines)):
                if i == j or lines[j] is None or lines[i] is None:
                    continue
                a, b = lines[i], lines[j]
                if close(a[-1], b[0]):
                    lines[i] = a + b[1:]
                elif close(a[-1], b[-1]):
                    lines[i] = a + b[::-1][1:]
                elif close(a[0], b[-1]):
                    lines[i] = b + a[1:]
                elif close(a[0], b[0]):
                    lines[i] = b[::-1] + a[1:]
                else:
                    continue
                lines[j] = None
                merged = True
        lines = [l for l in lines if l]
    return lines


def merge_river_segments(items, join_deg=0.6):
    """Union-find over segments with the same name whose endpoints touch."""
    parent = list(range(len(items)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    ends = []
    for it in items:
        pts = [l[0] for l in it['lines']] + [l[-1] for l in it['lines']]
        ends.append(pts)
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if find(i) == find(j):
                continue
            if any(abs(a[0] - b[0]) < join_deg and abs(a[1] - b[1]) < join_deg
                   for a in ends[i] for b in ends[j]):
                parent[find(i)] = find(j)
    groups = {}
    for i, it in enumerate(items):
        groups.setdefault(find(i), []).append(it)
    return list(groups.values())


def load(fname):
    with open(os.path.join(SRC, fname), encoding='utf-8') as f:
        return json.load(f)['features']


def build_rivers(tol):
    """Rivers from all line files, grouped by name together so supplement
    pieces join the main river. name_alt is ignored for rivers: it is noisy
    (some Oka segments list "Volga")."""
    by_name = {}
    for fname, kind, skip in SOURCES:
        if kind != 'line':
            continue
        for ft in load(fname):
            p = ft['properties']
            if prop(p, 'featurecla') in skip or not ft['geometry']:
                continue
            keys = name_keys(p, ('name', 'name_en'))
            if not keys:
                continue
            cla = str(prop(p, 'featurecla'))
            by_name.setdefault(normalise(prop(p, 'name_en', 'name')), []).append({
                'keys': keys, 'q': prop(p, 'wikidataid'),
                'c': 'River' if 'centerline' in cla.lower() else cla,
                'lines': lines_of(ft['geometry']),
            })

    out = []
    for items in by_name.values():
        for group in merge_river_segments(items):
            lines = []
            for line in merge_lines([l for it in group for l in it['lines']]):
                s = simplify_line(line, tol)
                if len(s) >= 2:
                    lines.append(s)
            if not lines:
                continue
            out.append({
                'q': next((it['q'] for it in group if it['q']), None),
                'k': 'line', 'c': group[0]['c'],
                'n': sorted({k for it in group for k in it['keys']}),
                'b': bbox_of([pt for line in lines for pt in line]),
                'g': ({'type': 'LineString', 'coordinates': lines[0]} if len(lines) == 1
                      else {'type': 'MultiLineString', 'coordinates': lines}),
            })
    return out


def build_areas(tol):
    out = []
    for fname, kind, skip in SOURCES:
        if kind != 'area':
            continue
        for ft in load(fname):
            p = ft['properties']
            if prop(p, 'featurecla') in skip or not ft['geometry']:
                continue
            keys = name_keys(p)
            if not keys:
                continue
            polys = []
            for poly in polys_of(ft['geometry']):
                outer = simplify_ring(poly[0], tol)
                if outer:
                    polys.append([outer] + [h for h in (simplify_ring(r, tol) for r in poly[1:]) if h])
            if not polys:
                continue
            main_poly = max(polys, key=lambda pl: ring_area(pl[0]))
            out.append({
                'q': prop(p, 'wikidataid'), 'k': 'area', 'c': prop(p, 'featurecla'), 'n': keys,
                'b': bbox_of([pt for pl in polys for pt in pl[0]]),
                'l': label_point(main_poly),
                'g': ({'type': 'Polygon', 'coordinates': polys[0]} if len(polys) == 1
                      else {'type': 'MultiPolygon', 'coordinates': polys}),
            })
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--tolerance', type=float, default=0,
                    help='simplification tolerance in degrees, e.g. 0.01 = about 1 km '
                         '(default 0: keep the original shapes at full detail)')
    args = ap.parse_args()
    tol = args.tolerance

    out = build_rivers(tol) + build_areas(tol)

    payload = json.dumps(out, separators=(',', ':'), ensure_ascii=False)
    with open(DST, 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/build_naturalearth.py from Natural Earth 1:10m physical data\n')
        f.write('// (public domain, https://www.naturalearthdata.com/). Do not edit by hand.\n')
        f.write('window.IM_DATA = window.IM_DATA || {};\n')
        f.write('window.IM_DATA.naturalearth = ')
        f.write(payload)
        f.write(';\n')
    write_info('naturalearth', built=datetime.date.today().isoformat(), tolerance=tol,
               features=len(out))
    n_q = sum(1 for o in out if o['q'])
    print(f"{len(out)} features ({sum(o['k'] == 'line' for o in out)} lines, "
          f"{sum(o['k'] == 'area' for o in out)} areas, {n_q} with Wikidata id), "
          f"{os.path.getsize(DST) / 1e6:.1f} MB written to {os.path.relpath(DST, ROOT)}")


if __name__ == '__main__':
    main()
