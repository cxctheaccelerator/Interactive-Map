// Calls the Claude API directly from the browser with the user's own key and
// returns the structured list of places found in a passage.
window.IM = window.IM || {};

(function () {
  const cfg = IM.config.anthropic;

  async function extractPlaces(text, { apiKey, model }) {
    const modelInfo = cfg.models.find((m) => m.id === model) || { id: model, fallback: false };

    const headers = {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': cfg.version,
      // Required by the API for requests made straight from a web page.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const body = {
      model: modelInfo.id,
      max_tokens: cfg.maxTokens,
      system: IM.config.systemPrompt,
      messages: [{ role: 'user', content: `<passage>\n${text}\n</passage>` }],
      output_config: {
        effort: cfg.effort,
        format: { type: 'json_schema', schema: IM.config.outputSchema },
      },
    };
    if (modelInfo.fallback) {
      // If a safety classifier declines, retry on a suitable model automatically.
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }

    let res;
    try {
      res = await fetch(cfg.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error('Could not reach the Anthropic API. Check your internet connection.');
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : `HTTP ${res.status}`;
      if (res.status === 401) throw new Error('The API key was rejected (401). Check it in Settings.');
      if (res.status === 429) throw new Error('Rate limited by the API (429). Wait a moment and try again.');
      throw new Error(`API error: ${msg}`);
    }

    if (data.stop_reason === 'refusal') {
      throw new Error('The model declined to process this passage.');
    }
    if (data.stop_reason === 'max_tokens') {
      throw new Error('The response was cut off (passage too long?). Try a shorter passage.');
    }

    const json = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      throw new Error('Could not read the model\'s answer as JSON.');
    }

    const period = parsed.period && parsed.period.known ? parsed.period : null;
    return { places: parsed.places || [], period, usage: data.usage || null, model: data.model || modelInfo.id };
  }

  IM.llm = { extractPlaces };
})();
