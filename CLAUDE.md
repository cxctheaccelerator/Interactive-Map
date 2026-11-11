# CLAUDE.md — Interactive History Map

> Do not modify this file unless the user explicitly asks. Session-to-session status lives in NOTE.md (updated by the `handoff` skill).

## Goal

The user reads history and social-science books that assume geographic knowledge. This app turns a passage of text into a map: it marks the places that matter for following the text, highlights rivers, mountain ranges and regions, and shows the borders of the period. Long-term: modes for different eras, more languages (Chinese), possibly armies and front lines.

Core idea: the language model returns only a small structured "scene" (places + period, as JSON); the app draws it over a fixed base map. The model never draws maps, which keeps tokens low.

## How it works (pipeline)

1. **LLM extraction** (`js/llm.js`): passage → `{period, places[]}`. Each place has mention, search name, alt names, kind, shape (`point|line|area`), context, rough lat/lon, rough outline. Providers: Anthropic (default), OpenAI, Google Gemini, OpenAI-compatible (OpenRouter, DeepSeek, Groq, Ollama, LM Studio). User's own API key, called directly from the browser.
2. **Validation** (`js/validate.js`): the same checks for every provider. Extracts JSON from surrounding text, drops incomplete or duplicate places, fixes swapped coordinates, infers missing fields.
3. **Wikidata lookup** (`js/wikidata.js`): search names → candidates → coordinates (SPARQL, Earth only) → rank by search rank + distance to the model's estimate. Alt names are searched only if the main name fails or is doubtful.
4. **Shapes** (`js/shapes.js`): lines and areas are matched to Natural Earth by Wikidata ID or name + distance. Otherwise the model's outline is used (dashed, marked approximate). Otherwise a point.
5. **Borders** (`js/borders.js`): the inferred period sets the CShapes date (1886–2019) and switches borders on.
6. **Rendering** (`js/app.js`, `js/basemap.js`): terrain base map (hypsometric colour-relief + hillshade from AWS Terrarium tiles, water/labels from OpenFreeMap vector tiles), numbered markers, highlighted rivers, outlined areas, sidebar list with alternative Wikidata matches.

## Project structure

```
index.html              the app (open directly; no build, no server)
css/style.css
js/config.js            providers, model instructions (systemPrompt), output JSON Schema, settings
js/llm.js               one adapter per provider; same instructions for all
js/validate.js          shared answer checks/repairs
js/wikidata.js          name search, coordinates, ranking, rate-limit retries
js/shapes.js            Natural Earth matching, river label stretch
js/borders.js           CShapes layer, lazy-loaded
js/basemap.js           base map style and layer toggles
js/app.js               UI, settings, pipeline, map layers
data/cshapes.js         generated, ~6 MB (CC BY-NC-SA 4.0, see data/LICENSE-CShapes.txt)
data/naturalearth.js    generated, ~4.6 MB (public domain)
data/raw/               raw downloads, git-ignored
tools/download_data.py  downloads raw data (asks first) and runs both builders
tools/build_cshapes.py, tools/build_naturalearth.py   stdlib-only preprocessors
docs/screenshot.png     README screenshot
```

## Conventions and constraints

- **Must work from `file://`.** Use classic `<script>` tags (no ES modules) and ship data as `.js` files that set `window.IM_DATA.*` (no `fetch` of local JSON). Code is namespaced under `window.IM`.
- **Uniform across LLM providers.** Instructions and output format are defined once in `js/config.js` and sent identically to every provider. Provider-specific code stays inside its adapter in `js/llm.js`. Every answer goes through `js/validate.js`. When the schema changes, update `outputSchema`, `systemPrompt` and `validate.js` together.
- **Model IDs:** only Claude models are hard-coded as suggestions. Other providers' model names come from the user or "List models"; don't hard-code them.
- **External services:** MapLibre GL JS 5.6.0 (jsDelivr, pinned), OpenFreeMap tiles, AWS Terrarium elevation tiles, Wikidata API and SPARQL. All allow browser (CORS) requests. Wikidata: keep ≤ 2 parallel requests and honour `Retry-After` on 429.
- **Data rebuilds:** keep `tools/build_naturalearth.py`'s `normalise()` and `js/shapes.js`'s `normaliseName()` identical. Natural Earth is pinned to v5.1.2.
- **Licences:** code MIT; `data/cshapes.js` stays CC BY-NC-SA 4.0. Keep the credits in the README and the map attribution.
- **No secrets in the repo:** API keys live only in the user's browser.

## Testing (this machine)

- No Node.js. Check JS syntax with `osascript -l JavaScript` (read the file, `new Function(src)`).
- Visual and end-to-end checks: headless Google Chrome with a throwaway `--user-data-dir`, `--use-angle=swiftshader --enable-unsafe-swiftshader`, on a scratch copy of `index.html` with a `<base href>` pointing at the project. Don't use `--virtual-time-budget` (MapLibre worker fetches never finish). Instead keep the page loading with a hidden iframe to a local delay server, then `--screenshot` or `--dump-dom`.
- Mock the LLM (override `IM.llm.extractPlaces`, or point provider `baseUrl`s at a local mock server) to avoid API costs.
- Scripts hitting Wikidata with a non-browser User-Agent get about 10 requests/min. Pace them.

## Working rules (from the user)

- Work freely inside this project folder and Claude's own directories; say what changed.
- Ask before downloading large files or touching anything outside the project that isn't related to it.
- Propose big changes or new features first and wait for a go-ahead.
- Don't commit or push unless asked; the user pushes to GitHub themselves.

## Current status

@NOTE.md
