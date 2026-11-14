#!/usr/bin/env python3
"""Download the raw geographic data and rebuild the app's data files.

    python3 tools/download_data.py            # ask, download what is missing, rebuild
    python3 tools/download_data.py --yes      # don't ask
    python3 tools/download_data.py --force    # download again even if files exist
    python3 tools/download_data.py --no-build # download only

Run this once after getting the code. It builds data/cshapes.js and
data/naturalearth.js, which are not in the repository (git ignores them).
Without them the app has no historical borders and no Natural Earth shapes.

Downloads (about 50 MB in total) go to data/raw/, which git ignores:
  - CShapes 2.0 historical borders (CC BY-NC-SA 4.0), https://icr.ethz.ch/data/cshapes/
  - Natural Earth 1:10m physical data v5.1.2 (public domain),
    https://github.com/nvkelso/natural-earth-vector
Then runs tools/build_cshapes.py and tools/build_naturalearth.py.
Only the Python standard library is used.
"""
import argparse
import os
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw')
USER_AGENT = 'InteractiveHistoryMap-data-downloader/1.0'

NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/'
FILES = [
    # (path under data/raw, URL)
    ('CShapes-2.0.geojson', 'https://icr.ethz.ch/data/cshapes/CShapes-2.0.geojson'),
    ('CShapes-2.0_Codebook.pdf', 'https://icr.ethz.ch/data/cshapes/CShapes-2.0_Codebook.pdf'),
    ('naturalearth/ne_10m_rivers_lake_centerlines.geojson', NE + 'ne_10m_rivers_lake_centerlines.geojson'),
    ('naturalearth/ne_10m_rivers_europe.geojson', NE + 'ne_10m_rivers_europe.geojson'),
    ('naturalearth/ne_10m_geography_regions_polys.geojson', NE + 'ne_10m_geography_regions_polys.geojson'),
    ('naturalearth/ne_10m_geography_marine_polys.geojson', NE + 'ne_10m_geography_marine_polys.geojson'),
    ('naturalearth/ne_10m_lakes.geojson', NE + 'ne_10m_lakes.geojson'),
    ('naturalearth/ne_10m_lakes_europe.geojson', NE + 'ne_10m_lakes_europe.geojson'),
]
BUILD_SCRIPTS = ['build_cshapes.py', 'build_naturalearth.py']


def remote_size(url):
    """Size in bytes from a HEAD request, or None if the server doesn't say."""
    req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            n = res.headers.get('Content-Length')
            return int(n) if n else None
    except Exception:
        return None


def download(url, dest):
    tmp = dest + '.part'
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as res, open(tmp, 'wb') as out:
        total = int(res.headers.get('Content-Length') or 0)
        done = 0
        while True:
            chunk = res.read(1 << 16)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total:
                print(f'\r    {done / 1e6:5.1f} / {total / 1e6:.1f} MB', end='', flush=True)
    print()
    os.replace(tmp, dest)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--yes', '-y', action='store_true', help="don't ask for confirmation")
    ap.add_argument('--force', action='store_true', help='download again even if files exist')
    ap.add_argument('--no-build', action='store_true', help="download only, don't rebuild data files")
    args = ap.parse_args()

    todo = [(p, u) for p, u in FILES if args.force or not os.path.exists(os.path.join(RAW, p))]
    if todo:
        print('Checking file sizes...')
        sizes = [remote_size(u) for _, u in todo]
        print(f'\nFiles to download into {os.path.relpath(RAW, ROOT)}/:')
        for (p, _), s in zip(todo, sizes):
            print(f'  {p:<55} {s / 1e6:6.1f} MB' if s else f'  {p:<55}   size unknown')
        known = sum(s for s in sizes if s)
        print(f'  {"total":<55} {known / 1e6:6.1f} MB\n')

        if not args.yes:
            try:
                answer = input('Download these files? [y/N] ').strip().lower()
            except EOFError:
                answer = ''
            if answer not in ('y', 'yes'):
                print('Cancelled. Nothing was downloaded.')
                return 1

        for p, u in todo:
            dest = os.path.join(RAW, p)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            print(f'  {p}')
            try:
                download(u, dest)
            except Exception as e:
                print(f'\nDownload failed for {u}: {e}')
                return 1
    else:
        print('All raw files are already present (use --force to download again).')

    if args.no_build:
        return 0
    for script in BUILD_SCRIPTS:
        print(f'\nRunning tools/{script} ...', flush=True)
        result = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', script)])
        if result.returncode != 0:
            print(f'tools/{script} failed.')
            return result.returncode
    print('\nDone. data/cshapes.js and data/naturalearth.js are up to date.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
