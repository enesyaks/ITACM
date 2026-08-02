const {
  aiFetch, aiStreamLines, resolveLoopbackForContainer, containerDefaultOllamaUrl,
} = require('./http');
const { HttpError } = require('../../utils/httpError');

const PROVIDER_DEFAULTS = {
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen2.5-coder:7b',
    local: true,
    style: 'ollama',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    local: false,
    style: 'openai',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    local: false,
    style: 'openai',
  },
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    local: false,
    style: 'anthropic',
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    local: false,
    style: 'openai',
  },
  mistral: {
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    local: false,
    style: 'openai',
  },
  together: {
    label: 'Together',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    local: false,
    style: 'openai',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    local: false,
    style: 'openai',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    model: '',
    local: false,
    style: 'openai',
  },
};

function defaultBaseUrl(id) {
  const d = PROVIDER_DEFAULTS[id];
  if (!d) return '';
  return id === 'ollama' ? containerDefaultOllamaUrl(d.baseUrl) : d.baseUrl;
}

function listProviders() {
  return Object.entries(PROVIDER_DEFAULTS).map(([id, d]) => ({
    id,
    label: d.label,
    defaultModel: d.model,
    defaultBaseUrl: defaultBaseUrl(id),
    local: !!d.local,
    style: d.style,
  }));
}

function normalizeToolsOpenAI(tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters || { type: 'object', properties: {} },
    },
  }));
}

function normalizeToolsAnthropic(tools) {
  return (tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters || { type: 'object', properties: {} },
  }));
}

function parseOpenAIToolCalls(msg) {
  const calls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
  return calls.map((c, i) => ({
    id: c.id || `call_${i}`,
    name: c.function?.name || c.name || '',
    arguments: safeParseArgs(c.function?.arguments ?? c.arguments),
  })).filter((c) => c.name);
}

function safeParseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try { return JSON.parse(raw); }
  catch { return { _raw: raw }; }
}

const KNOWN_TOOL_NAMES = new Set([
  'search_assets', 'list_licenses', 'find_employees', 'document_summary', 'run_report', 'build_report',
  'handover_history', 'list_contracts', 'query_operations', 'unified_search', 'advanced_query',
]);

function extractEmbeddedToolCalls(content) {
  if (!content || typeof content !== 'string') return [];
  const text = content.trim();
  if (!text) return [];

  const candidates = [];
  candidates.push(text);
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) candidates.push(brace[0]);

  for (const cand of candidates) {
    let obj;
    try { obj = JSON.parse(cand); }
    catch { continue; }
    if (!obj || typeof obj !== 'object') continue;

    const name = obj.name || obj.tool || obj.function?.name;
    if (name && KNOWN_TOOL_NAMES.has(String(name))) {
      const args = obj.arguments ?? obj.parameters ?? obj.args ?? obj.function?.arguments ?? {};
      return [{
        id: `embedded_0`,
        name: String(name),
        arguments: safeParseArgs(args),
      }];
    }

    const list = obj.tool_calls || obj.tools || (Array.isArray(obj) ? obj : null);
    if (Array.isArray(list) && list.length) {
      return list.map((c, i) => {
        const n = c.name || c.tool || c.function?.name;
        const a = c.arguments ?? c.parameters ?? c.args ?? c.function?.arguments ?? {};
        return {
          id: c.id || `embedded_${i}`,
          name: String(n || ''),
          arguments: safeParseArgs(a),
        };
      }).filter((c) => c.name && KNOWN_TOOL_NAMES.has(c.name));
    }
  }
  return [];
}

function mergeToolCalls(structured, content) {
  if (structured && structured.length) return { toolCalls: structured, content: content || '' };
  const embedded = extractEmbeddedToolCalls(content);
  if (embedded.length) return { toolCalls: embedded, content: '' };
  return { toolCalls: [], content: content || '' };
}

function toOllamaMessages(messages) {
  return (messages || []).map((m) => {
    if (!m || typeof m !== 'object') return { role: 'user', content: String(m || '') };

    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_name: m.name || m.tool_name || 'tool',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? {}),
      };
    }

    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      return {
        role: 'assistant',
        content: m.content == null ? '' : String(m.content),
        tool_calls: m.tool_calls.map((tc) => {
          const name = tc.function?.name || tc.name || '';
          const rawArgs = tc.function?.arguments ?? tc.arguments ?? {};
          const args = typeof rawArgs === 'string' ? safeParseArgs(rawArgs) : (rawArgs && typeof rawArgs === 'object' ? rawArgs : {});
          const clean = { ...args };
          delete clean._raw;
          return {
            type: 'function',
            function: { name, arguments: clean },
          };
        }).filter((tc) => tc.function.name),
      };
    }

    return {
      role: m.role === 'assistant' || m.role === 'system' ? m.role : 'user',
      content: m.content == null ? '' : String(m.content),
    };
  });
}

async function chatOpenAI(cfg, { messages, tools, signal }) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const body = {
    model: cfg.model,
    messages,
    temperature: 0.2,
    stream: false,
  };
  if (tools?.length) {
    body.tools = normalizeToolsOpenAI(tools);
    body.tool_choice = 'auto';
  }
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const res = await aiFetch({
    url,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    allowPrivate: !!cfg.local,
    signal,
    timeoutMs: 180000,
  });
  if (res.status >= 400) {
    throw HttpError.badGateway(`AI provider HTTP ${res.status}: ${res.text().slice(0, 400)}`);
  }
  const data = res.json();
  if (data.error) {
    throw HttpError.badGateway(`AI provider: ${String(data.error.message || data.error).slice(0, 400)}`);
  }
  const msg = data.choices?.[0]?.message || {};
  const content = typeof msg.content === 'string' ? msg.content : '';
  const merged = mergeToolCalls(parseOpenAIToolCalls(msg), content);
  return {
    content: merged.content,
    toolCalls: merged.toolCalls,
    raw: msg,
  };
}

async function* chatStreamOpenAI(cfg, { messages, tools, signal }) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const body = {
    model: cfg.model,
    messages,
    temperature: 0.2,
    stream: true,
  };
  if (tools?.length) {
    body.tools = normalizeToolsOpenAI(tools);
    body.tool_choice = 'auto';
  }
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const toolCallBuffers = {};

  for await (const line of aiStreamLines({
    url,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    allowPrivate: !!cfg.local,
    signal,
    timeoutMs: 180000,
  })) {
    if (!line || line === 'data: [DONE]') {
      if (line === 'data: [DONE]') {
        const toolCalls = Object.values(toolCallBuffers)
          .filter((tc) => tc.name)
          .map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: safeParseArgs(tc.argumentsBuf || '{}'),
          }));
        yield { done: true, toolCalls, content: '' };
      }
      continue;
    }
    const raw = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
    if (!raw) continue;
    let chunk;
    try { chunk = JSON.parse(raw); } catch { continue; }
    if (chunk.error) throw HttpError.badGateway(`AI provider: ${String(chunk.error.message || chunk.error).slice(0, 400)}`);
    const delta = chunk.choices?.[0]?.delta || {};
    if (delta.content) yield { delta: delta.content, done: false };
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const key = `${tc.index ?? 0}`;
        if (!toolCallBuffers[key]) {
          toolCallBuffers[key] = { id: tc.id || `call_${key}`, name: '', argumentsBuf: '' };
        }
        if (tc.id) toolCallBuffers[key].id = tc.id;
        if (tc.function?.name) toolCallBuffers[key].name += tc.function.name;
        if (tc.function?.arguments) toolCallBuffers[key].argumentsBuf += tc.function.arguments;
      }
    }
    const finishReason = chunk.choices?.[0]?.finish_reason;
    if (finishReason === 'tool_calls') {
      const toolCalls = Object.values(toolCallBuffers)
        .filter((tc) => tc.name)
        .map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: safeParseArgs(tc.argumentsBuf || '{}'),
        }));
      yield { done: true, toolCalls, content: '' };
    } else if (finishReason === 'stop') {
      yield { done: true, toolCalls: [], content: '' };
    }
  }
}

function ollamaUnreachable(err, url) {
  const msg = String(err?.message || err || '');
  if (!/unreachable|ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|timed out/i.test(msg)) return err;
  return HttpError.badGateway(
    `Ollama is unreachable at ${url}. When ITACM runs in Docker the base URL must be `
    + `http://host.docker.internal:11434 (not 127.0.0.1), and Ollama must be running on the host.`,
  );
}

async function chatOllama(cfg, { messages, tools, signal }) {
  const base = String(cfg.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const url = await resolveLoopbackForContainer(`${base}/api/chat`);
  const body = {
    model: cfg.model || 'qwen2.5-coder:7b',
    messages: toOllamaMessages(messages),
    stream: false,
    options: { temperature: 0.2 },
  };
  if (tools?.length) {
    body.tools = normalizeToolsOpenAI(tools);
  }
  let res;
  try {
    res = await aiFetch({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      allowPrivate: true,
      signal,
      timeoutMs: 180000,
    });
  } catch (err) {
    throw ollamaUnreachable(err, url);
  }
  if (res.status >= 400) {
    throw HttpError.badGateway(`Ollama HTTP ${res.status}: ${res.text().slice(0, 400)}`);
  }
  const data = res.json();
  if (data.error) {
    throw HttpError.badGateway(`Ollama: ${String(data.error).slice(0, 400)}`);
  }
  const msg = data.message || {};
  const structured = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.map((c, i) => ({
      id: c.id || `ollama_${i}`,
      name: c.function?.name || '',
      arguments: safeParseArgs(c.function?.arguments),
    })).filter((c) => c.name)
    : [];
  const content = typeof msg.content === 'string' ? msg.content : '';
  const merged = mergeToolCalls(structured, content);
  return {
    content: merged.content,
    toolCalls: merged.toolCalls,
    raw: msg,
  };
}

async function* chatStreamOllama(cfg, { messages, tools, signal }) {
  const base = String(cfg.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const url = await resolveLoopbackForContainer(`${base}/api/chat`);
  const body = {
    model: cfg.model || 'qwen2.5-coder:7b',
    messages: toOllamaMessages(messages),
    stream: true,
    options: { temperature: 0.2 },
  };
  if (tools?.length) body.tools = normalizeToolsOpenAI(tools);

  let accContent = '';
  let toolCalls = [];

  const source = aiStreamLines({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    allowPrivate: true,
    signal,
    timeoutMs: 180000,
  })[Symbol.asyncIterator]();

  for (;;) {
    let step;
    try { step = await source.next(); }
    catch (err) { throw ollamaUnreachable(err, url); }
    if (step.done) break;
    const line = step.value;
    let chunk;
    try { chunk = JSON.parse(line); } catch { continue; }
    if (chunk.error) throw HttpError.badGateway(`Ollama: ${String(chunk.error).slice(0, 400)}`);
    const msg = chunk.message || {};
    if (msg.content) {
      accContent += msg.content;
      yield { delta: msg.content, done: false };
    }
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      toolCalls = msg.tool_calls.map((c, i) => ({
        id: c.id || `ollama_${i}`,
        name: c.function?.name || '',
        arguments: safeParseArgs(c.function?.arguments),
      })).filter((c) => c.name);
    }
    if (chunk.done) {
      if (!toolCalls.length && accContent) {
        const embedded = extractEmbeddedToolCalls(accContent);
        if (embedded.length) toolCalls = embedded;
      }
      yield { done: true, toolCalls, content: toolCalls.length ? '' : accContent };
    }
  }
}

function toAnthropicMessages(messages) {
  let system = '';
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + String(m.content || '');
      continue;
    }
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.tool_call_id || m.name,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? {}),
        }],
      });
      continue;
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: String(m.content) });
      for (const tc of m.tool_calls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name || tc.name,
          input: safeParseArgs(tc.function?.arguments ?? tc.arguments),
        });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    out.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || ''),
    });
  }
  const merged = [];
  for (const m of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role && Array.isArray(prev.content) && Array.isArray(m.content)) {
      prev.content = prev.content.concat(m.content);
    } else {
      merged.push(m);
    }
  }
  return { system, messages: merged };
}

async function chatAnthropic(cfg, { messages, tools, signal }) {
  if (!cfg.apiKey) throw HttpError.badRequest('Anthropic API key is required');
  const base = String(cfg.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const url = `${base}/v1/messages`;
  const { system, messages: anthMsgs } = toAnthropicMessages(messages);
  const body = {
    model: cfg.model,
    max_tokens: 4096,
    temperature: 0.2,
    messages: anthMsgs,
  };
  if (system) body.system = system;
  if (tools?.length) body.tools = normalizeToolsAnthropic(tools);

  const res = await aiFetch({
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    allowPrivate: false,
    signal,
    timeoutMs: 180000,
  });
  if (res.status >= 400) {
    throw HttpError.badGateway(`Anthropic HTTP ${res.status}: ${res.text().slice(0, 400)}`);
  }
  const data = res.json();
  const blocks = Array.isArray(data.content) ? data.content : [];
  let content = '';
  const toolCalls = [];
  for (const b of blocks) {
    if (b.type === 'text') content += b.text || '';
    if (b.type === 'tool_use') {
      toolCalls.push({
        id: b.id,
        name: b.name,
        arguments: b.input && typeof b.input === 'object' ? b.input : {},
      });
    }
  }
  return { content, toolCalls, raw: data };
}

async function* chatStreamAnthropic(cfg, { messages, tools, signal }) {
  if (!cfg.apiKey) throw HttpError.badRequest('Anthropic API key is required');
  const base = String(cfg.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const url = `${base}/v1/messages`;
  const { system, messages: anthMsgs } = toAnthropicMessages(messages);
  const body = {
    model: cfg.model,
    max_tokens: 4096,
    temperature: 0.2,
    stream: true,
    messages: anthMsgs,
  };
  if (system) body.system = system;
  if (tools?.length) body.tools = normalizeToolsAnthropic(tools);

  const toolInputBuffers = {}; // index → { id, name, inputBuf }
  let toolCalls = [];

  for await (const line of aiStreamLines({
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    allowPrivate: false,
    signal,
    timeoutMs: 180000,
  })) {
    const raw = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
    if (!raw) continue;
    let evt;
    try { evt = JSON.parse(raw); } catch { continue; }
    if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
      const idx = evt.index ?? 0;
      toolInputBuffers[idx] = { id: evt.content_block.id, name: evt.content_block.name, inputBuf: '' };
    }
    if (evt.type === 'content_block_delta') {
      const delta = evt.delta || {};
      if (delta.type === 'text_delta' && delta.text) yield { delta: delta.text, done: false };
      if (delta.type === 'input_json_delta' && delta.partial_json) {
        const buf = toolInputBuffers[evt.index ?? 0];
        if (buf) buf.inputBuf += delta.partial_json;
      }
    }
    if (evt.type === 'message_stop' || evt.type === 'message_delta') {
      if (evt.type === 'message_stop') {
        toolCalls = Object.values(toolInputBuffers).map((b) => ({
          id: b.id,
          name: b.name,
          arguments: safeParseArgs(b.inputBuf || '{}'),
        })).filter((c) => c.name);
        yield { done: true, toolCalls, content: '' };
      }
    }
  }
}

function resolveStyle(providerId, explicit) {
  if (explicit) return explicit;
  return PROVIDER_DEFAULTS[providerId]?.style || 'openai';
}

function createProvider(cfg) {
  const id = String(cfg.provider || 'ollama').toLowerCase();
  const defaults = PROVIDER_DEFAULTS[id] || PROVIDER_DEFAULTS.custom;
  const style = resolveStyle(id, cfg.style);
  const runtime = {
    id,
    label: defaults.label || id,
    model: cfg.model || defaults.model,
    baseUrl: (cfg.baseUrl || defaultBaseUrl(id) || '').replace(/\/+$/, ''),
    apiKey: cfg.apiKey || '',
    local: cfg.local != null ? !!cfg.local : !!defaults.local,
    style,
  };

  if (!runtime.baseUrl && style !== 'ollama') {
    throw HttpError.badRequest(`AI base URL is required for provider "${id}"`);
  }
  if (!runtime.model) {
    throw HttpError.badRequest('AI model is required');
  }

  async function chatOnce(args) {
    if (style === 'ollama') return chatOllama(runtime, args);
    if (style === 'anthropic') return chatAnthropic(runtime, args);
    return chatOpenAI(runtime, args);
  }

  function chatStream(args) {
    if (style === 'ollama') return chatStreamOllama(runtime, args);
    if (style === 'anthropic') return chatStreamAnthropic(runtime, args);
    return chatStreamOpenAI(runtime, args);
  }

  return {
    id: runtime.id,
    label: runtime.label,
    model: runtime.model,
    local: runtime.local,
    style: runtime.style,
    chatOnce,
    chatStream,
  };
}

module.exports = {
  PROVIDER_DEFAULTS,
  defaultBaseUrl,
  listProviders,
  createProvider,
  safeParseArgs,
  extractEmbeddedToolCalls,
  mergeToolCalls,
  toOllamaMessages,
};
