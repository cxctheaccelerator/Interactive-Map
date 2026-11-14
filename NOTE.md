# NOTE.md — status and updates

Maintained by the `handoff` skill (`.claude/skills/handoff`). Target length: about 100 lines. Newest updates first.

Last updated: 2026-11-13

## Current status

- Version 1.0.3 (README top line + "Versions" section).
- Working app: paste a passage → relevant places marked, rivers/ranges/regions drawn as shapes, period inferred, historical borders shown. All our names are always shown, without overlaps; names that sit away from their dot or shape are connected to it by a short line.
- LLM providers: Anthropic (default, Claude Opus 5.5), OpenAI, Google Gemini, OpenAI-compatible. Only Anthropic has run against the real API (user tested it). The other three were tested against a local mock server only. The generalised prompt (1.0.1) has not been run against a real model yet.
- Repository: on GitHub, branch `main`; 1.0.2 is committed and pushed. The 1.0.3 changes (build scripts + marker files, data-missing note in `index.html`/`css`/`js/app.js`, `.gitignore` + data files removed from git, messages in `js/borders.js`/`js/shapes.js`, `tools/download_data.py` help, README, NOTE.md, CLAUDE.md, screenshot) are uncommitted; the user commits and pushes by hand.
- Data: `data/cshapes.js` (~26 MB) and `data/naturalearth.js` (~14 MB), full detail, and the raw data (~50 MB) are all git-ignored; users download and build them with `python3 tools/download_data.py`. The built files were removed from the git index (`git rm --cached`, staged), so the next commit deletes them from GitHub; older copies remain in history.

## Recent updates

### 2026-11-13 — version 1.0.3
- User found the simplified borders too coarse. Both builders now keep the original data by default (`--tolerance 0`: every point, full precision, only exact repeats dropped); `--tolerance` still simplifies on request. Label points are computed on a lightly simplified copy for speed (`label_point` in `tools/build_cshapes.py`, shared helpers `simplify_line`/`simplify_ring`).
- Sizes: cshapes.js 6.4 → 25.9 MB (1.17 M points), naturalearth.js 4.6 → 14.4 MB.
- Measured in headless Chrome: borders on ≈1.2 → 1.55 s (once); date change, pan, zoom unchanged; Natural Earth load ≈0.05 → 0.1 s; label layout 1–2 ms per move; JS memory ≈155 → 310 MB. Rivers follow their bends; borders smoother but limited by CShapes' own detail.
- User's decision: built data files are no longer in the repository (git-ignored, `git rm --cached`); users build them. README Quick start gains a build step, "Rebuilding the data (optional)" became "Getting the data", licence section says the data isn't part of the repo. Missing-data messages now say `Run python3 tools/download_data.py first.`
- "Map data not built yet" note at the top of the sidebar: builders write tiny markers `data/cshapes.info.js` / `data/naturalearth.info.js` (git-ignored) that `index.html` loads; a missing marker shows the note at start-up, before any API cost. A data file that fails to load adds to the note (`e.dataMissing` in `js/borders.js`, `IM.shapes.dataFailed()`); one that loads although its marker is missing clears it. The period box then says "Borders not shown: the border data has not been built". Tested in headless Chrome: built / nothing / markers only / data without markers.
- Explained to the user why a build step is still needed: `file://` blocks fetch of local JSON (so data must be `.js`), plus CShapes date fields/label points/capitals and Natural Earth merging, river joining and name keys done once instead of on every load.

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

- CShapes shows state-system borders, not occupation zones or fronts (e.g. Poland exists in 1942). Its own detail is limited: zoomed in close, a border may run beside the river or ridge it follows.
- Wikidata gives one point per river or region; that's why shapes come from Natural Earth. Lesser-known rivers may match oddly.
- Labels: the layout uses estimated text widths, so a very long name might touch a neighbour. At very low zoom (≈2) names may sit far from their area. Names are recomputed only when a pan/zoom/rotation ends; not tested with a rotated or tilted map.
- Natural Earth and Wikidata credits show in the attribution even before anything is mapped (harmless).
- When historical borders fail to load, the error still flashes briefly in the status line during a run (the sidebar note and period box now explain it when the data isn't built). A missing marker file in index.html logs a "file not found" error in the browser console (harmless).

## Testing notes

- See CLAUDE.md → Testing. Test scripts are made in the session scratchpad and are not kept; recreate as needed.
