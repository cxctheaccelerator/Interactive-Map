// Sends a passage to the chosen language model, directly from the browser with
// the user's own key, and returns the places and period it found.
//
// Uniform across providers:
//   - the same instructions: IM.config.systemPrompt plus the output format
//     (IM.config.outputSchema) written out in the instructions;
//   - the same checks on the answer: IM.validate.
// Per provider, only the request format differs. Where a provider can enforce
// the output format it is asked to; if it rejects that, the request is retried
// with "JSON only", then with no format option, relying on the instructions.
window.IM = window.IM || {};

(function () {
  const llm = IM.config.llm;
  const FORMAT_LABEL = {
    schema: 'output format enforced by the provider',
    json: 'JSON enforced, format checked by the app',
    none: 'format checked by the app',
  };

  function instructions() {
    return `${IM.config.systemPrompt}

Return only a JSON object, with no other text, that matches this JSON Schema:
${JSON.stringify(IM.config.outputSchema)}`;
  }
  const userMessage = (text) => `<passage>\n${text}\n</passage>`;

  // ---------- HTTP helpers ----------
  async function postJson(url, headers, body, label) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error(`Could not reach ${label}. Check the internet connection${label.includes('local') ? ' and that the local server is running and allows browser access (see README)' : ''}.`);
    }
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }

  function apiError(status, data, label) {
    const msg = (data && (data.error && (data.error.message || data.error)) ) || (data && data.message) || `HTTP ${status}`;
    if (status === 401 || status === 403) return new Error(`${label} rejected the API key (${status}). Check it in Settings.`);
    if (status === 429) return new Error(`${label} rate limit or quota reached (429). Wait a moment, or check your account's credit.`);
    if (status === 404) return new Error(`${label}: model or address not found (404). Check the model name${label === 'the custom address' ? ' and address' : ''}. ${typeof msg === 'string' ? msg : ''}`);
    return new Error(`${label} error: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }

  // A 400 that complains about the requested output format: try a simpler format.
  const formatRejected = (r) => r.status === 400 &&
    /response_format|json_schema|json_object|schema|structured|responseMimeType|response_mime_type|generationConfig/i
      .test(JSON.stringify(r.data || ''));

  const trimSlash = (u) => String(u || '').trim().replace(/\/+$/, '');

  // ---------- Anthropic ----------
  const anthropic = {
    async call(text, { apiKey, model }) {
      const cfg = llm.providers.anthropic;
      const info = cfg.models.find((m) => m.id === model) || {};
      const headers = {
        'x-api-key': apiKey,
        'anthropic-version': cfg.version,
        'anthropic-dangerous-direct-browser-access': 'true', // required for calls from a web page
      };
      const body = {
        model,
        max_tokens: cfg.maxTokens,
        system: instructions(),
        messages: [{ role: 'user', content: userMessage(text) }],
        output_config: { format: { type: 'json_schema', schema: IM.config.outputSchema } },
      };
      if (info.effort) body.output_config.effort = cfg.effort;
      if (info.fallback) {
        // If a safety classifier declines, the API retries on a suitable model.
        headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
        body.fallbacks = 'default';
      }
      const r = await postJson(`${cfg.baseUrl}/messages`, headers, body, 'Anthropic');
      if (!r.ok) throw apiError(r.status, r.data, 'Anthropic');
      const d = r.data;
      if (d.stop_reason === 'refusal') throw new Error('The model declined to process this passage.');
      if (d.stop_reason === 'max_tokens') throw new Error('The answer was cut off (passage too long?). Try a shorter passage.');
      return {
        text: (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''),
        usage: d.usage ? { input: d.usage.input_tokens, output: d.usage.output_tokens } : null,
        model: d.model || model,
        format: 'schema',
      };
    },
    async listModels({ apiKey }) {
      const cfg = llm.providers.anthropic;
      const res = await fetch(`${cfg.baseUrl}/models?limit=100`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': cfg.version, 'anthropic-dangerous-direct-browser-access': 'true' },
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw apiError(res.status, d, 'Anthropic');
      return (d.data || []).map((m) => m.id);
    },
  };

  // ---------- OpenAI and OpenAI-compatible (Chat Completions) ----------
  function openaiLike(providerId) {
    const label = providerId === 'openai' ? 'OpenAI' : 'the custom address';
    const base = (baseUrl) => (providerId === 'openai' ? llm.providers.openai.baseUrl : trimSlash(baseUrl));
    const auth = (apiKey) => (apiKey ? { authorization: `Bearer ${apiKey}` } : {});
    const FORMATS = {
      schema: { type: 'json_schema', json_schema: { name: 'map_scene', strict: true, schema: IM.config.outputSchema } },
      json: { type: 'json_object' },
      none: null,
    };
    return {
      async call(text, { apiKey, model, baseUrl }) {
        if (!base(baseUrl)) throw new Error('Enter the address of the OpenAI-compatible service in Settings.');
        const isLocal = /localhost|127\.0\.0\.1/.test(base(baseUrl));
        const where = isLocal ? 'the local server' : label;
        let r, format;
        for (format of ['schema', 'json', 'none']) {
          const body = {
            model,
            messages: [
              { role: 'system', content: instructions() },
              { role: 'user', content: userMessage(text) },
            ],
          };
          if (FORMATS[format]) body.response_format = FORMATS[format];
          r = await postJson(`${base(baseUrl)}/chat/completions`, auth(apiKey), body, where);
          if (r.ok || !formatRejected(r)) break;
        }
        if (!r.ok) throw apiError(r.status, r.data, where);
        const choice = (r.data.choices || [])[0] || {};
        const msg = choice.message || {};
        if (msg.refusal) throw new Error(`The model declined: ${msg.refusal}`);
        if (choice.finish_reason === 'length') throw new Error('The answer was cut off (passage too long?). Try a shorter passage.');
        const u = r.data.usage;
        return {
          text: typeof msg.content === 'string' ? msg.content
            : Array.isArray(msg.content) ? msg.content.map((c) => c.text || '').join('') : '',
          usage: u ? { input: u.prompt_tokens, output: u.completion_tokens } : null,
          model: r.data.model || model,
          format,
        };
      },
      async listModels({ apiKey, baseUrl }) {
        if (!base(baseUrl)) throw new Error('Enter the address of the service first.');
        const res = await fetch(`${base(baseUrl)}/models`, { headers: auth(apiKey) });
        const d = await res.json().catch(() => null);
        if (!res.ok) throw apiError(res.status, d, label);
        const ids = (d.data || d.models || []).map((m) => m.id || m.name).filter(Boolean);
        // OpenAI also lists image, audio and embedding models; hide those.
        return providerId === 'openai'
          ? ids.filter((id) => !/embedding|tts|whisper|dall-e|davinci|babbage|moderation|image|audio|realtime|transcribe|search|computer-use/i.test(id))
          : ids;
      },
    };
  }

  // ---------- Google Gemini ----------
  // Gemini's format option accepts a subset of JSON Schema without
  // additionalProperties, so that keyword is removed.
  function geminiSchema(s) {
    if (Array.isArray(s)) return s.map(geminiSchema);
    if (!s || typeof s !== 'object') return s;
    const out = {};
    for (const [k, v] of Object.entries(s)) if (k !== 'additionalProperties') out[k] = geminiSchema(v);
    return out;
  }

  const gemini = {
    async call(text, { apiKey, model }) {
      const cfg = llm.providers.gemini;
      const name = model.replace(/^models\//, '');
      const configs = {
        schema: { responseMimeType: 'application/json', responseSchema: geminiSchema(IM.config.outputSchema) },
        json: { responseMimeType: 'application/json' },
        none: null,
      };
      let r, format;
      for (format of ['schema', 'json', 'none']) {
        const body = {
          systemInstruction: { parts: [{ text: instructions() }] },
          contents: [{ role: 'user', parts: [{ text: userMessage(text) }] }],
        };
        if (configs[format]) body.generationConfig = configs[format];
        r = await postJson(`${cfg.baseUrl}/models/${encodeURIComponent(name)}:generateContent`,
          { 'x-goog-api-key': apiKey }, body, 'Google Gemini');
        if (r.ok || !formatRejected(r)) break;
      }
      if (!r.ok) throw apiError(r.status, r.data, 'Google Gemini');
      const d = r.data;
      if (d.promptFeedback && d.promptFeedback.blockReason) throw new Error(`The model declined this passage (${d.promptFeedback.blockReason}).`);
      const cand = (d.candidates || [])[0] || {};
      if (cand.finishReason === 'MAX_TOKENS') throw new Error('The answer was cut off (passage too long?). Try a shorter passage.');
      if (cand.finishReason === 'SAFETY') throw new Error('The model declined this passage (safety filter).');
      const parts = (cand.content && cand.content.parts) || [];
      const u = d.usageMetadata;
      return {
        text: parts.filter((p) => !p.thought).map((p) => p.text || '').join(''),
        usage: u ? { input: u.promptTokenCount, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) } : null,
        model: d.modelVersion || name,
        format,
      };
    },
    async listModels({ apiKey }) {
      const cfg = llm.providers.gemini;
      const res = await fetch(`${cfg.baseUrl}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw apiError(res.status, d, 'Google Gemini');
      return (d.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''))
        .filter((id) => !/embedding|imagen|tts|aqa/i.test(id));
    },
  };

  const ADAPTERS = { anthropic, openai: openaiLike('openai'), gemini, compatible: openaiLike('compatible') };

  /**
   * @param text      the passage
   * @param settings  { provider, apiKey, model, baseUrl }
   * @returns { places, period, usage: {input, output} | null, model, format, formatLabel, fixes }
   */
  async function extractPlaces(text, settings) {
    const adapter = ADAPTERS[settings.provider];
    if (!adapter) throw new Error(`Unknown provider: ${settings.provider}`);
    if (!settings.model) throw new Error('Enter a model name in Settings (or use "List models").');
    const answer = await adapter.call(text, settings);
    const { places, period, fixes } = IM.validate.normalise(IM.validate.parseJson(answer.text));
    return { places, period, fixes, usage: answer.usage, model: answer.model, format: answer.format, formatLabel: FORMAT_LABEL[answer.format] };
  }

  async function listModels(settings) {
    const adapter = ADAPTERS[settings.provider];
    return adapter ? adapter.listModels(settings) : [];
  }

  IM.llm = { extractPlaces, listModels };
})();
