// Global configuration: models, prompt, output schema, sample text.
window.IM = window.IM || {};

IM.config = {
  // Language-model providers. Every provider gets the same instructions and
  // output format (systemPrompt + outputSchema below); only the way the
  // request is sent differs (js/llm.js). Answers from all providers go
  // through the same checks (js/validate.js).
  llm: {
    defaultProvider: 'anthropic',
    providers: {
      anthropic: {
        label: 'Anthropic (Claude)',
        baseUrl: 'https://api.anthropic.com/v1',
        keyUrl: 'https://console.anthropic.com/',
        keyPlaceholder: 'sk-ant-...',
        defaultModel: 'claude-opus-5-5',
        // Suggestions in the model field. `fallback` = ask the API to retry on
        // another model if a safety classifier declines; `effort` = model
        // accepts the effort setting.
        models: [
          { id: 'claude-opus-5-5',   label: 'Claude Opus 5.5 (best)',      fallback: true,  effort: true },
          { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster)',  fallback: true,  effort: true },
          { id: 'claude-haiku-5-5',  label: 'Claude Haiku 5.5 (cheapest)', fallback: false, effort: true },
        ],
        version: '2026-10-21',
        effort: 'low',      // place extraction is a simple task
        maxTokens: 16000,
      },
      openai: {
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        keyUrl: 'https://platform.openai.com/api-keys',
        keyPlaceholder: 'sk-...',
        defaultModel: '',
        models: [],
      },
      gemini: {
        label: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        keyUrl: 'https://aistudio.google.com/apikey',
        keyPlaceholder: 'AIza...',
        defaultModel: '',
        models: [],
      },
      compatible: {
        label: 'OpenAI-compatible (custom address)',
        baseUrl: '',          // entered by the user
        keyUrl: '',
        keyPlaceholder: 'API key (leave empty for local models)',
        keyOptional: true,
        defaultModel: '',
        models: [],
        // Shown as suggestions for the address field.
        examples: [
          { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
          { label: 'DeepSeek', url: 'https://api.deepseek.com' },
          { label: 'Groq', url: 'https://api.groq.com/openai/v1' },
          { label: 'Ollama (local)', url: 'http://localhost:11434/v1' },
          { label: 'LM Studio (local)', url: 'http://localhost:1234/v1' },
        ],
      },
    },
  },

  wikidata: {
    searchUrl: 'https://www.wikidata.org/w/api.php',
    sparqlUrl: 'https://query.wikidata.org/sparql',
    language: 'en',
    searchLimit: 7,       // candidates per name searched
    concurrency: 2,       // parallel search requests (Wikimedia asks for <= 3)
    maxRetries: 3,        // retries after "429 too many requests"
    rankPenaltyKm: 250,   // how much one search-rank step "costs" vs distance
  },

  shapes: {
    dataUrl: 'data/naturalearth.js',
    // Max distance between a Natural Earth shape and the expected location
    // (Wikidata coordinate or Claude's estimate) for a name match to count.
    maxDistanceKm: { line: 400, area: 300 },
    // A river's name is written once, along a stretch of river this many screen
    // pixels long, next to the part the passage is about (recomputed on zoom).
    riverLabelPx: 220,
    riverLabelGapPx: 14,
  },

  placeKinds: [
    'settlement', 'region', 'country', 'river', 'lake', 'sea', 'strait',
    'mountain', 'island', 'peninsula', 'forest', 'marsh', 'desert', 'plain', 'other',
  ],
  placeShapes: ['point', 'line', 'area'],
};

IM.config.systemPrompt = `You extract geographic places from a passage of text so they can be plotted on a map that helps the reader follow it. The passage can come from any kind of writing, such as history, economics, politics, geography, travel writing, fiction or news.

Include only places that help a reader understand what the passage describes: where things happen, where journeys, migrations, trade or other movements start, pass through and end, places that are compared or contrasted, and geographic features that matter to the content, such as a river that carries trade, a mountain range that separates two regions, or a sea that people cross. Places can be settlements, regions, rivers, lakes, seas and gulfs, straits, mountains and ranges, islands, peninsulas, passes, forests, marshes, deserts, plains and similar features. Include places that appear inside a longer phrase (for "the Volga trade", include the Volga).

Leave out:
- places that appear only as an adjective or nationality: "Dutch merchants" does not make the Netherlands a place to map, and "French wine" does not make France one;
- countries and broad regions that only set the general scene when the passage names more specific places inside them, such as "northern Italy" when its cities are named; include such an area only when it is itself what the passage is about, as in "the famine struck Ireland" or "cotton was shipped to Britain";
- people, organisations, events (such as wars, treaties or festivals) and vague groupings with no definite location (such as "the West").

For each place give:
- mention: the place exactly as written in the passage (first occurrence).
- name: the name most likely to find the right item on Wikidata in English, which is usually the item's current English name. If the passage uses a historical name that differs (Stalingrad, Königsberg, Leningrad), give the current name (Volgograd, Kaliningrad, Saint Petersburg) and put the historical name in alt_names. For rivers and ranges use the full name, such as "Don River" or "Caucasus Mountains".
- alt_names: other names that might find it: historical names, local-language names, alternative spellings, the short form ("Don", "Caucasus"). May be empty.
- kind: the closest category.
- shape: how it should be drawn. "line" for rivers and canals. "area" for mountain ranges, regions, seas, gulfs, lakes, large islands, peninsulas, forests, marshes, deserts and plains. "point" for settlements, countries, single peaks, passes and other small features.
- context: a short disambiguating description, such as "city on the Volga, southern Russia".
- lat, lon: your best estimate of its coordinates in decimal degrees. These are used to choose between places with the same name and to place the label, so for a line or area give the point most relevant to the passage (for "the upper Don", a point on the upper Don).
- outline: a rough sketch for line and area places, used only if no precise shape is available. For a line, 4 to 10 [lat, lon] points in order along the stretch relevant to the passage. For an area, 5 to 10 [lat, lon] points around its edge. An empty array for points.

Use the passage's period and setting to resolve ambiguity: "Paris" in a passage about Texas is Paris, Texas. Merge repeated mentions of the same place and list places in the order they first appear.

Also give the period the passage describes (when the things it describes happen, not when the text was written), used to show the borders of that time:
- label: a short human-readable description, such as "Spring 1848", "1870s" or "Summer to November 1942".
- year and month: the single moment that best represents what the passage describes; for something that spans a longer time, its central or most important moment. Use month 0 if no month can be inferred.
- known: false if the passage gives no way to infer a time at all, even from context; then set year and month to 0.`;

IM.config.outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['period', 'places'],
  properties: {
    period: {
      type: 'object',
      additionalProperties: false,
      required: ['known', 'label', 'year', 'month'],
      properties: {
        known: { type: 'boolean' },
        label: { type: 'string' },
        year:  { type: 'integer' },
        month: { type: 'integer' },
      },
    },
    places: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['mention', 'name', 'alt_names', 'kind', 'shape', 'context', 'lat', 'lon', 'outline'],
        properties: {
          mention:   { type: 'string' },
          name:      { type: 'string' },
          alt_names: { type: 'array', items: { type: 'string' } },
          kind:      { type: 'string', enum: IM.config.placeKinds },
          shape:     { type: 'string', enum: IM.config.placeShapes },
          context:   { type: 'string' },
          lat:       { type: 'number' },
          lon:       { type: 'number' },
          outline:   { type: 'array', items: { type: 'array', items: { type: 'number' } } },
        },
      },
    },
  },
};

IM.config.exampleText = `In the summer of 1942 the German army renewed its offensive in southern Russia. Starting from positions east of Kursk and Kharkov, its northern wing drove to Voronezh on the upper Don, while the Sixth Army pushed down the Don corridor and across the great bend of the river toward Stalingrad on the Volga. Further south, Army Group A took Rostov at the mouth of the Don and swung into the Kuban, aiming for the oilfields of Maikop and Grozny beyond the Caucasus. By November the Sixth Army was fighting street by street in Stalingrad, its long flanks along the Don held by Romanian armies.`;
