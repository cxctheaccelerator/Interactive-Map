# Interactive History Map

History and social-science books often assume you know the geography they discuss. This app turns a passage of text into a map: paste a paragraph, and it marks the places the passage mentions, highlights the rivers, mountain ranges and regions involved, and shows the borders of the time.

![Screenshot: a passage about the 1942 German summer offensive mapped over terrain, with cities marked, the Don and Volga highlighted and the Caucasus outlined](docs/screenshot.png)

## What it does

- **Finds the places that matter.** Claude reads the passage and picks out the places a reader needs to follow the events, leaving out background mentions such as "the Romanian armies".
- **Locates them on Wikidata.** Historical names work: *Stalingrad* is found as Volgograd but labelled as the book calls it.
- **Draws extended features as shapes.** Rivers are highlighted along their course; mountain ranges, regions, seas and lakes are outlined. Shapes come from Natural Earth. Where none exists, Claude's rough sketch is drawn dashed and marked approximate.
- **Shows the borders of the period.** The date of the events is inferred from the passage and the historical borders for that date (1886–2019) are switched on. You can change the date with the slider.
- **Terrain base map.** Elevation colours and hillshading, optional 3D terrain, and switchable modern place names and borders.

## Quick start

1. **Get the code:** clone or download this repository.
2. **Open `index.html`** in a recent browser (Chrome, Edge, Firefox or Safari). No installation, build step or server is needed. An internet connection is needed for the map tiles, Wikidata and Claude.
3. **Add an Anthropic API key:** open **Settings** in the sidebar and paste your key. You can create one at [console.anthropic.com](https://console.anthropic.com/). The API is billed separately from a Claude.ai subscription.
4. **Try it:** click **Load example**, then **Map places**.

### About the API key and cost

- The key is sent only to `api.anthropic.com`, directly from your browser. It is never written into the project files.
- By default the key is forgotten when you close the tab. If you tick **Remember on this device**, it is stored in your browser's local storage, in plain text.
- Each passage costs roughly 2–5 US cents with Claude Opus 5.5 (the default), about 1–2 cents with Sonnet 5.5, and a fraction of a cent with Haiku 5.5. You can switch models in Settings. The token count of each run is shown after it finishes.
- Tip: set a monthly spend limit in the Anthropic Console and use a key dedicated to this app.

## Using the map

| Control | What it does |
|---|---|
| Sidebar list | Click a place to zoom to it. The dropdown lets you pick a different Wikidata match if the first guess is wrong. |
| Orange markers or entries | The match is uncertain, or the shape is only Claude's approximate sketch. |
| **Layers** panel | Toggle elevation colours, hillshading, modern place names, modern borders and historical borders. Change the date of the historical borders. |
| Mountain button (top right) | 3D terrain. Hold right-click or Ctrl and drag to tilt. |

## Project structure

```
index.html            the app: open this
css/style.css         styling
js/config.js          settings, Claude's instructions and output format
js/basemap.js         terrain base map and layer switches
js/llm.js             Claude API call (user's own key)
js/wikidata.js        place-name search and coordinates via Wikidata
js/shapes.js          matching rivers, ranges and regions to Natural Earth shapes
js/borders.js         historical borders layer (CShapes)
js/app.js             user interface and map drawing
data/cshapes.js       processed CShapes borders (generated)
data/naturalearth.js  processed Natural Earth shapes (generated)
tools/                scripts to download and rebuild the data files
```

## Rebuilding the data (optional)

The processed data files in `data/` are included, so **you don't need this to use the app**. Only do it if you want to change how the data is processed, or update it.

Requirements: Python 3.8 or newer. No extra packages are needed.

```sh
python3 tools/download_data.py
```

This script:

1. Lists the raw files it will download (about 50 MB in total) and asks for confirmation. Nothing is downloaded before you answer `y`.
2. Downloads them into `data/raw/`, which is excluded from git. It only downloads files that are missing.
3. Runs `tools/build_cshapes.py` and `tools/build_naturalearth.py`, which simplify the raw data and write `data/cshapes.js` and `data/naturalearth.js`.

Options: `--yes` skips the question, `--force` downloads again, `--no-build` only downloads. The build scripts can also be run on their own, for example `python3 tools/build_cshapes.py --tolerance 0.01` for more detailed borders (and a larger file).

The data files are `.js` rather than `.json` so that the app also works when `index.html` is opened directly from disk, where browsers block loading local JSON files.

## Known limitations

- Historical borders follow the CShapes state system. They show recognised states and colonies, not wartime occupation zones or front lines. For example, Poland still appears in 1942.
- Borders are simplified to about 2 km, which is coarse when zoomed in on a single battlefield.
- Modern place names come from today's maps, for example "Volgograd" near the book's "Stalingrad". You can switch them off in the Layers panel.
- Wikidata limits how many requests anonymous users can make. Very long passages may pause briefly while the app waits and retries.

## Credits and data sources

This project builds on the following data and software. Please keep these credits when sharing or reusing it.

- **Historical borders:** CShapes 2.0, by Guy Schvitz, Seraina Rüegger, Luc Girardin, Lars-Erik Cederman, Nils Weidmann and Kristian Skrede Gleditsch, licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). <https://icr.ethz.ch/data/cshapes/>
  Citation: Schvitz, Guy, Seraina Rüegger, Luc Girardin, Lars-Erik Cederman, Nils Weidmann, and Kristian Skrede Gleditsch. 2022. "Mapping The International System, 1886–2017: The CShapes 2.0 Dataset." *Journal of Conflict Resolution* 66(1): 144–61.
- **Rivers, mountain ranges, regions, seas and lakes:** [Natural Earth](https://www.naturalearthdata.com/) 1:10m physical data, v5.1.2. Public domain.
- **Place names and coordinates:** [Wikidata](https://www.wikidata.org/). CC0.
- **Water, rivers and modern labels on the base map:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL), via [OpenMapTiles](https://openmaptiles.org/) and [OpenFreeMap](https://openfreemap.org/).
- **Terrain (elevation):** [Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) on AWS Open Data. Elevation data from several sources, including SRTM, GMTED2010 and ETOPO1; see [the full attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
- **Map engine:** [MapLibre GL JS](https://maplibre.org/) (BSD 3-Clause).
- **Text analysis:** [Claude](https://www.anthropic.com/claude) by Anthropic, via each user's own API key.

The map shows these credits in its attribution line (bottom right). Each credit appears while its data is visible.

## License

The code in this project is released under the **MIT License**. See [LICENSE](LICENSE). You can use, change and share it freely, including commercially, as long as you keep the copyright notice.

**One exception:** `data/cshapes.js` is derived from the CShapes 2.0 dataset and stays under its original license, **CC BY-NC-SA 4.0**: non-commercial use only, credit the CShapes authors, and share adaptations under the same license. See [data/LICENSE-CShapes.txt](data/LICENSE-CShapes.txt). If you need the project without that restriction, delete `data/cshapes.js`. Everything else still works; only the historical borders become unavailable.

`data/naturalearth.js` comes from Natural Earth and is public domain. Other third-party data and software keep their own licenses, listed under [Credits and data sources](#credits-and-data-sources).
