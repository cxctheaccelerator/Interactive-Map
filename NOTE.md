# NOTE.md — status and updates

Maintained by the `handoff` skill (`.claude/skills/handoff`). Target length: about 100 lines. Newest updates first.

Last updated: 2026-11-11

## Current status

- Working app: paste a passage → relevant places marked, rivers/ranges/regions drawn as shapes, period inferred, historical borders shown.
- LLM providers: Anthropic (default, Claude Opus 5.5), OpenAI, Google Gemini, OpenAI-compatible. Only Anthropic has run against the real API (user tested it). The other three were tested against a local mock server only.
- Repository: on GitHub, branch `main`, 2 commits ("project initialized", "Added support for mainstream LLM providers"). The working tree was clean before CLAUDE.md, NOTE.md and the handoff skill were added (not yet committed).
- Data: `data/cshapes.js` and `data/naturalearth.js` are committed; raw data (~50 MB) is git-ignored and rebuilt with `python3 tools/download_data.py`.

## Recent updates

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

- Modern vs historical labels: recommended showing the book's name with the modern name small underneath ("Stalingrad" / "(Volgograd)") and hiding the duplicate base-map label. Currently overlaps are resolved only by MapLibre's collision handling.
- Scene-file workflow + project skill so Claude Code (on a subscription) can write scenes the app opens without an API key.
- Show per-run cost in dollars next to the token counts.
- Highlight countries that are themselves acted on ("invaded Poland") using CShapes polygons for the date.
- Historical city names from Wikidata's dated names; other eras/modes; Chinese language.
- OpenHistoricalMap (CC0) as a fully open alternative to CShapes.

## Known issues and limitations

- CShapes shows state-system borders, not occupation zones or fronts (e.g. Poland exists in 1942). Outlines simplified to ~2 km.
- Wikidata gives one point per river or region; that's why shapes come from Natural Earth. Lesser-known rivers may match oddly.
- A river label is shown only near the relevant stretch; zooming into a distant part of the river shows no name.
- Natural Earth and Wikidata credits show in the attribution even before anything is mapped (harmless).
- When historical borders fail to load, an error flashes briefly in the status line during a run.

## Testing notes

- See CLAUDE.md → Testing. Test scripts are made in the session scratchpad and are not kept; recreate as needed.
