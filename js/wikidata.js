// Resolves place names to coordinates using Wikidata.
//  1. Search each place's main name with wbsearchentities.
//  2. Fetch coordinates (P625, on Earth) for all candidates with one SPARQL query.
//  3. Rank candidates by search rank and distance from the model's rough estimate.
//  4. Only for places that are still missing or doubtful, also search the
//     mention and alternative names, then re-rank. This keeps request counts low
//     (Wikimedia rate-limits anonymous traffic).
window.IM = window.IM || {};

(function () {
  const cfg = IM.config.wikidata;
  const USER_AGENT = 'InteractiveHistoryMap/0.1 (personal research tool)';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // fetch() that waits and retries when Wikimedia says "too many requests".
  async function fetchJson(url, options, onWait) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, options);
      if ((res.status === 429 || res.status === 503) && attempt < cfg.maxRetries) {
        const retryAfter = parseInt(res.headers.get('retry-after'), 10);
        const waitS = Math.min(Number.isFinite(retryAfter) ? retryAfter : 5 * (attempt + 1), 60);
        if (onWait) onWait(waitS);
        await sleep(waitS * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`Wikidata request failed (HTTP ${res.status})`);
      return res.json();
    }
  }

  async function searchName(name, onWait) {
    const params = new URLSearchParams({
      action: 'wbsearchentities',
      search: name,
      language: cfg.language,
      uselang: cfg.language,
      type: 'item',
      limit: String(cfg.searchLimit),
      format: 'json',
      origin: '*',
    });
    const data = await fetchJson(`${cfg.searchUrl}?${params}`, {}, onWait);
    return (data.search || []).map((r) => ({ id: r.id, label: r.label || r.id, description: r.description || '' }));
  }

  // Returns Map id -> {lat, lon}; ids without Earth coordinates are absent.
  async function fetchCoordinates(ids, onWait) {
    const coords = new Map();
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      const query = `SELECT ?item ?coord WHERE {
        VALUES ?item { ${chunk.map((id) => 'wd:' + id).join(' ')} }
        ?item p:P625 ?st . ?st ps:P625 ?coord ; psv:P625/wikibase:geoGlobe wd:Q2 .
      }`;
      const data = await fetchJson(cfg.sparqlUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/sparql-results+json',
          'api-user-agent': USER_AGENT,
        },
        body: new URLSearchParams({ query, format: 'json' }),
      }, onWait);
      for (const b of data.results.bindings) {
        const id = b.item.value.split('/').pop();
        const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(b.coord.value);
        if (m && !coords.has(id)) coords.set(id, { lon: parseFloat(m[1]), lat: parseFloat(m[2]) });
      }
    }
    return coords;
  }

  function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Run async tasks with limited parallelism, preserving order of results.
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  }

  // How far a match may be from the model's estimate before we flag it.
  function toleranceKm(kind) {
    return ({ settlement: 150, mountain: 150, island: 300, lake: 300, river: 1500, region: 800, country: 1500, sea: 1500 })[kind] || 500;
  }

  function uniqueNames(names) {
    const seen = new Set();
    return names
      .map((n) => (n || '').trim())
      .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
  }

  /**
   * @param places  array from the LLM ({mention, name, alt_names, kind, context, lat, lon})
   * @param hooks   { onProgress(done, total), onWait(seconds) }, both optional
   * @returns array of { place, candidates: [...], chosen: index|-1, uncertain: bool }
   */
  async function resolvePlaces(places, hooks = {}) {
    const { onProgress, onWait } = hooks;
    const perPlace = places.map(() => new Map()); // id -> {id,label,description,rank}
    const coords = new Map();
    let done = 0, total = 0;

    async function runSearches(jobs) {
      total += jobs.length;
      const results = await mapLimit(jobs, cfg.concurrency, async (job) => {
        const hits = await searchName(job.name, onWait).catch(() => []);
        done++;
        if (onProgress) onProgress(done, total);
        return { ...job, hits };
      });
      for (const r of results) {
        r.hits.forEach((hit, pos) => {
          const rank = pos + r.rankOffset;
          const existing = perPlace[r.pi].get(hit.id);
          if (!existing || rank < existing.rank) perPlace[r.pi].set(hit.id, { ...hit, rank });
        });
      }
      const newIds = [...new Set(results.flatMap((r) => r.hits.map((h) => h.id)))].filter((id) => !coords.has(id));
      if (newIds.length) {
        const found = await fetchCoordinates(newIds, onWait);
        newIds.forEach((id) => coords.set(id, found.get(id) || null));
      }
    }

    function rank(pi) {
      const place = places[pi];
      const hasHint = Number.isFinite(place.lat) && Number.isFinite(place.lon);
      const candidates = [...perPlace[pi].values()]
        .filter((c) => coords.get(c.id))
        .map((c) => {
          const { lat, lon } = coords.get(c.id);
          const distKm = hasHint ? distanceKm(place.lat, place.lon, lat, lon) : null;
          const score = (distKm ?? 0) + c.rank * cfg.rankPenaltyKm;
          return { ...c, lat, lon, distKm, score };
        })
        .sort((a, b) => a.score - b.score);
      const chosen = candidates.length ? 0 : -1;
      const uncertain = chosen === 0 && hasHint && candidates[0].distKm > toleranceKm(place.kind);
      return { place, candidates, chosen, uncertain };
    }

    // Pass 1: main names only.
    await runSearches(places.map((p, pi) => ({ pi, name: p.name || p.mention, rankOffset: 0 })));
    let resolved = places.map((_, pi) => rank(pi));

    // Pass 2: other names, only for places that are missing or doubtful.
    const extra = [];
    resolved.forEach((r, pi) => {
      if (r.chosen >= 0 && !r.uncertain) return;
      const p = places[pi];
      uniqueNames([p.name, p.mention, ...(p.alt_names || [])]).slice(1, 4)
        .forEach((name) => extra.push({ pi, name, rankOffset: 1 }));
    });
    if (extra.length) {
      await runSearches(extra);
      resolved = places.map((_, pi) => rank(pi));
    }
    return resolved;
  }

  IM.wikidata = { resolvePlaces, distanceKm, toleranceKm };
})();
