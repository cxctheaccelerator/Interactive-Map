# NOTE.md — status and updates

Maintained by the `handoff` skill (`.claude/skills/handoff`). Target length: about 100 lines. Newest updates first.

Last updated: 2026-11-12

## Current status

- Version 1.0.2 (README top line + "Versions" section).
- Working app: paste a passage → relevant places marked, rivers/ranges/regions drawn as shapes, period inferred, historical borders shown. All our names are always shown, without overlaps; names that sit away from their dot or shape are connected to it by a short line.
- LLM providers: Anthropic (default, Claude Opus 5.5), OpenAI, Google Gemini, OpenAI-compatible. Only Anthropic has run against the real API (user tested it). The other three were tested against a local mock server only. The generalised prompt (1.0.1) has not been run against a real model yet.
- Repository: on GitHub, branch `main`; 1.0.1 is committed and pushed (two commits, "v1.0.1 …" and "1.0.1"). The 1.0.2 changes (`js/labels.js`, README, NOTE.md, CLAUDE.md, screenshot) are uncommitted; the user commits and pushes by hand.
- Data: `data/cshapes.js` and `data/naturalearth.js` are committed; raw data (~50 MB) is git-ignored and rebuilt with `python3 tools/download_data.py`.

## Recent updates

### 2026-11-12 — version 1.0.2
- New feature: river and area names (regions, ranges, seas…) that sit away from their shape get a small line to the nearest point of the shape, like city names to their dot. Area names inside their area and river names right beside the river get none. (`shapeLeader` in `js/labels.js`.)
- Tested with a mock LLM, zoom 2–9: lines only where names had to move away (Kuban, Caucasus at zoom 2); none elsewhere.
- Version rule set by the user: PATCH = fixes and small improvements, MINOR = larger additions (new things drawn, more maps), MAJOR = much larger changes (other platforms). Recorded in README and CLAUDE.md.

### 2026-11-12 — version 1.0.1
- Prompt (`js/config.js`): no longer about history books or wars; examples changed to trade, migration, famine etc. Output format unchanged.
- New `js/labels.js`: our names are laid out on every pan/zoom. Each name tries candidate positions and takes the first that collides with nothing (other names, dots, Layers panel, map controls), else the least-overlapping one. Drawn with `text-allow-overlap`, so none are hidden; base-map labels yield. Names pushed away from their dot get a thin leader line.
- River and area names follow the visible part when the relevant stretch or centre is off screen. Short rivers fall back to the whole river (`riverLabelStretches` in `js/shapes.js` replaces `riverLabelLine`).
- Tested with a mock LLM at zoom 2–9: all names drawn in every view, no overlaps seen in screenshots. Before, Don/Caucasus/Kuban names vanished at some zooms.
- Version numbers introduced (1.0.0, then 1.0.1). README screenshot is retaken whenever the README changes (rule in CLAUDE.md). CLAUDE.md: goal generalised, labels step and conventions added.
- Explainer page "Inside the History Map" published as a private claude.ai artifact (not in the repo).

### 2026-11-11
- Added CLAUDE.md (project basics), this NOTE.md, and the project skill `.claude/skills/handoff`.

### 2026-11-10 — multi-provider support
- Settings: provider choice, service address (compatible only), one key per provider (saved only if "Remember" is ticked), model text field with suggestions and a "List models" button.
- `js/llm.js` rewritten as per-provider adapters. Identical instructions for all; the output schema is also written into the instructions. Format enforcement steps down schema → JSON-only → none if the provider rejects it.
- New `js/validate.js`: shared parsing and repair of answers. The status line reports model, format handling, number of repaired entries and tokens.
- README: "Language models" section (providers, consistency, keys/cost, Ollama `OLLAMA_ORIGINS="*"`, LM Studio CORS).

### 2026-11-10 — sharing and licence
- `tools/download_data.py` (lists files and sizes, asks before downloading, pins Natural Earth v5.1.2, then rebuilds). README, `.gitignore`, credits in the map attribution line.
- Licence: code MIT ("The Interactive History Map contributors"); `data/cshapes.js` stays CC BY-NC-SA 4.0 (`data/LICENSE-CShapes.txt`).

### 2026-11-10 — shapes and relevance
- Prompt: only places needed to follow the text (no nationality adjectives like "Romanian armies", no background regions unless acted on). Added `shape` and `outline` fields.
- Natural Earth (rivers, ranges, regions, seas, lakes) → `data/naturalearth.js`. River segments merged by name and joined end-to-end; noisy `name_alt` ignored for rivers.
- Rivers: glow + core line. Areas: fill + outline (dashed when approximate).
- River names: one label per river, rotated along a ~220 px stretch next to the relevant point, recomputed on zoom. (Curved line labels repeated or vanished at tile edges.)

### 2026-11-10 — first version
- MapLibre terrain base map, Claude extraction, Wikidata lookup with candidate dropdown, CShapes borders with year/month control, inferred period sets the borders automatically, modern country labels hidden while historical borders are on.

## Open ideas (offered, not decided)

- Modern vs historical labels: recommended showing the book's name with the modern name small underneath ("Stalingrad" / "(Volgograd)") and hiding the duplicate base-map label. Currently base-map labels simply give way to ours where they collide.
- Scene-file workflow + project skill so Claude Code (on a subscription) can write scenes the app opens without an API key.
- Show per-run cost in dollars next to the token counts.
- Highlight countries that are themselves acted on ("invaded Poland") using CShapes polygons for the date.
- Historical city names from Wikidata's dated names; other eras/modes; Chinese language.
- OpenHistoricalMap (CC0) as a fully open alternative to CShapes.
- Drawing movements: arrows (curved line + head, coloured by side, dated), later atlas-style wide arrows, front lines, hatched zones. The model would return `movements` referring to listed places; the app computes the geometry. User: "might add in future".
- Smaller or fine-tuned models: first a test set + scoring script, then try small models, then possibly distil into a local model (Ollama).
- Replace the war-themed "Load example" passage and generalise the README intro (still says history and social-science books).
- Show the version number in the app.

## Known issues and limitations

- CShapes shows state-system borders, not occupation zones or fronts (e.g. Poland exists in 1942). Outlines simplified to ~2 km.
- Wikidata gives one point per river or region; that's why shapes come from Natural Earth. Lesser-known rivers may match oddly.
- Labels: the layout uses estimated text widths, so a very long name might touch a neighbour. At very low zoom (≈2) names may sit far from their area. Names are recomputed only when a pan/zoom/rotation ends; not tested with a rotated or tilted map.
- Natural Earth and Wikidata credits show in the attribution even before anything is mapped (harmless).
- When historical borders fail to load, an error flashes briefly in the status line during a run.

## Testing notes

- See CLAUDE.md → Testing. Test scripts are made in the session scratchpad and are not kept; recreate as needed.
