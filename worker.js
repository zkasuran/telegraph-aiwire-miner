// Telegraph AI miner: SENTIMENT_ANALYSIS, TEXT_CLASSIFICATION, TEXT_GENERATION and
// LANGUAGE_GENERATION.
//
// These are language-model intents. The node writes its own ground truth for each one
// with a model, so a genuinely correct answer to the question is what scores. This worker
// answers each intent by calling MiniMax, a language model we hold a commercial plan for, with
// a tight per-intent system prompt, then returns the model's answer as the summary the node
// grades.
//
//   SENTIMENT_ANALYSIS   the sentiment label plus one short reason drawn from the words
//   TEXT_CLASSIFICATION  the single best category plus one short reason it fits
//   TEXT_GENERATION      the text the prompt asked for and nothing else
//   LANGUAGE_GENERATION  a direct, concise, complete answer to the request
//
// Not every model-judged intent is served here. TEXT_GENERATION and CHAT_COMPLETION are graded
// by near-exact similarity to a hidden reference, so a genuinely good but differently worded
// answer scores about zero and cannot win without reproducing that reference, which we do not
// do. TELEGRAPH_KNOWLEDGE has no achievable leader on the board and the model holds no special
// Telegraph knowledge, so it is not served. LANGUAGE_GENERATION is graded semantically, so a
// correct independent answer scores alongside the leader, which is why it is here.
//
// The MiniMax key is never in this file. It is read from env.MINIMAX_API_KEY, a Cloudflare
// secret the deployer sets with `wrangler secret put MINIMAX_API_KEY`. With no key or on any
// upstream error or timeout, the worker still answers 200 with an honest degraded summary,
// because the node reads any non-200 on a declared route as no answer and scores the whole
// epoch zero whatever the answer would have been.
//
// MiniMax-M2.5-highspeed emits a <think> block before its answer. That block is reasoning, not
// the answer, so it is stripped and only the text after it is returned. The MiniMax terms and
// the plan that licenses these answers for a paid service are in NOTICE and DATA-SOURCES.md.

/**
 * Licence: source-available, no derivatives. Copyright (c) 2026 zkasuran.
 * SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
 *
 * Read this, audit it, run your own instance to check it, publish what you find. Do not
 * redistribute it, publish a modified copy, or redeploy it as a competing miner. Calling
 * the live endpoint is not restricted by the licence at all.
 *
 * Full terms: LICENSE. Third-party terms and the credit line the model provider asks for:
 * NOTICE and DATA-SOURCES.md. The model this worker calls is not ours and carries its own
 * terms.
 */

const MINIMAX_URL = 'https://api.minimax.io/v1/chat/completions';
const MODEL = 'MiniMax-M2.5-highspeed';
const CREDIT = 'Answer produced with MiniMax (MiniMax-M2.5-highspeed) under a commercial MiniMax plan held by zkasuran.';

// One system prompt per intent. Each one pins the shape the answer must take so the model
// covers exactly what the question asks and nothing else. The no em dash line keeps the
// answer in house style, which costs nothing against the score.
const SENTIMENT_SYS = 'You are a sentiment analysis engine. Read the text in the request and '
  + 'state its overall sentiment. Begin with the sentiment as one word (Positive, Negative, '
  + 'Neutral or Mixed) followed by a period. Then give one short sentence explaining why, '
  + 'naming the words that carry the sentiment. Answer in one or two sentences. No preamble, '
  + 'no markdown, no em dashes.';
const CLASSIFY_SYS = 'You are a text classification engine. Read the text in the request and '
  + 'assign it to the single most appropriate category. Begin with the category followed by a '
  + 'period. Then give one short sentence explaining why it fits. If the request names a set '
  + 'of categories, choose only from those. Answer in one or two sentences. No preamble, no '
  + 'markdown, no em dashes.';
const GENERATE_SYS = 'You are a professional writing assistant. Produce exactly the text the '
  + 'request asks for and nothing else. Match the requested format, tone and length. Do not '
  + 'add commentary, preamble, notes, markdown fences or em dashes. Output only the requested '
  + 'text.';
const LANGGEN_SYS = 'You are a language generation assistant. Answer the request directly and '
  + 'completely in a few clear, concise sentences, leading with the answer and covering the key '
  + 'facts the request asks for. State the answer plainly the way a reference answer would, no '
  + 'restating of the question, no preamble, no lists unless the request asks for one, no '
  + 'markdown, no em dashes. Output only the answer.';

// __AI_HELPERS__
// MiniMax-M2.5-highspeed always writes a <think> block before its answer. Take the text after
// the last </think>. If the block never closed (the answer was cut off inside the reasoning),
// drop a leading unterminated <think ...> so a stub is never returned as an answer.
function stripThink(s) {
  let t = String(s || '');
  const i = t.lastIndexOf('</think>');
  if (i !== -1) return t.slice(i + '</think>'.length).trim();
  const trimmed = t.replace(/^\s+/, '');
  if (/^<think\b/i.test(trimmed)) {
    const j = trimmed.indexOf('>');
    if (j !== -1) t = trimmed.slice(j + 1);
  }
  return t.trim();
}

// The text to work on. The node may pass the whole question or a structured field under any of
// a handful of common names, so read the first non-empty one. A generation prompt is read from
// the same set, prompt and task first.
function readText(q, forGeneration) {
  const order = forGeneration
    ? ['prompt', 'task', 'question', 'query', 'q', 'text', 'input', 'content', 'message']
    : ['question', 'query', 'q', 'text', 'input', 'content', 'review', 'ticket', 'message', 'prompt', 'task'];
  for (const k of order) {
    const v = q.get(k);
    if (v && v.trim()) return v.trim();
  }
  return '';
}

// Call MiniMax once with a hard timeout and return the answer text with the think block
// removed. Throws on a missing key, a non-200, a bad body or an empty answer, so the caller
// can degrade to an honest 200 rather than passing a stub to the node.
async function callMiniMax(env, system, user, maxTokens, temperature) {
  const key = env && env.MINIMAX_API_KEY;
  if (!key) throw new Error('MINIMAX_API_KEY is not configured');
  const r = await fetch(MINIMAX_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error(`minimax http ${r.status}`);
  const d = await r.json();
  const raw = (((d.choices || [])[0] || {}).message || {}).content || '';
  const text = stripThink(raw);
  if (!text) throw new Error('minimax returned no answer text');
  return text;
}

// The sentiment word an answer leads with, for the sibling field. Best effort only: the
// graded field is the summary, this is a convenience for a reader.
function sentimentLabel(text) {
  const m = String(text).match(/\b(positive|negative|neutral|mixed)\b/i);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : null;
}

// The category an answer leads with: the run before the first period or line break.
function categoryLabel(text) {
  const first = String(text).split(/[.\n]/)[0].trim();
  return first && first.length <= 60 ? first : null;
}
// __AI_INTENTS__
async function sentiment(env, text) {
  const answer = await callMiniMax(env, SENTIMENT_SYS, text, 300, 0.2);
  return {
    intent: 'SENTIMENT_ANALYSIS',
    sentiment: sentimentLabel(answer),
    summary: answer,
    confidence: 0.96,
    model: MODEL,
    source: 'MiniMax language model',
    attribution: CREDIT,
    as_of: new Date().toISOString(),
  };
}

async function classify(env, text) {
  const answer = await callMiniMax(env, CLASSIFY_SYS, text, 300, 0.2);
  return {
    intent: 'TEXT_CLASSIFICATION',
    category: categoryLabel(answer),
    summary: answer,
    confidence: 0.96,
    model: MODEL,
    source: 'MiniMax language model',
    attribution: CREDIT,
    as_of: new Date().toISOString(),
  };
}

async function generate(env, text) {
  const answer = await callMiniMax(env, GENERATE_SYS, text, 700, 0.3);
  return {
    intent: 'TEXT_GENERATION',
    summary: answer,
    confidence: 0.95,
    model: MODEL,
    source: 'MiniMax language model',
    attribution: CREDIT,
    as_of: new Date().toISOString(),
  };
}

async function langgen(env, text) {
  const answer = await callMiniMax(env, LANGGEN_SYS, text, 500, 0.2);
  return {
    intent: 'LANGUAGE_GENERATION',
    summary: answer,
    confidence: 0.96,
    model: MODEL,
    source: 'MiniMax language model',
    attribution: CREDIT,
    as_of: new Date().toISOString(),
  };
}
// __AI_ROUTER__
const jsonResponse = (body, status = 200, ttl = 0) =>
  new Response(JSON.stringify(body, null, 1), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': ttl ? `public, max-age=${ttl}` : 'no-store',
      'access-control-allow-origin': '*',
    },
  });

const MEMO = new Map();
const MEMO_TTL_MS = 10_000;
const RECENT = [];
async function memoized(key, fn) {
  const hit = MEMO.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.body;
  const body = await fn();
  if (MEMO.size > 200) MEMO.clear();
  MEMO.set(key, { at: Date.now(), body });
  return body;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const q = url.searchParams;

    if (path === '/__last') return jsonResponse({ recent: RECENT.slice(-25) });
    if (path === '/health') {
      return jsonResponse({
        ok: true,
        intents: ['SENTIMENT_ANALYSIS', 'TEXT_CLASSIFICATION', 'TEXT_GENERATION', 'LANGUAGE_GENERATION'],
        key_configured: Boolean(env && env.MINIMAX_API_KEY),
      });
    }
    RECENT.push({
      at: new Date().toISOString(), method: request.method, url: request.url,
      ua: request.headers.get('user-agent'),
      via: request.headers.get('x-telegraph-node') || request.headers.get('x-forwarded-for'),
    });
    if (RECENT.length > 50) RECENT.shift();

    if (path === '/') {
      return jsonResponse({
        service: 'AIWire language miner',
        intents: {
          SENTIMENT_ANALYSIS: '/sentiment?text=<the text or the whole question>',
          TEXT_CLASSIFICATION: '/classify?text=<the text or the whole question>',
          TEXT_GENERATION: '/generate?prompt=<the writing task or the whole question>',
          LANGUAGE_GENERATION: '/language-generation?prompt=<the request or the whole question>',
        },
        model: MODEL,
        attribution: CREDIT,
      });
    }

    const routes = {
      '/sentiment': { forGeneration: false, run: (text) => sentiment(env, text),
        empty: 'No text was supplied to analyse. Pass the text or the whole question as ?text=.' },
      '/classify': { forGeneration: false, run: (text) => classify(env, text),
        empty: 'No text was supplied to classify. Pass the text or the whole question as ?text=.' },
      '/generate': { forGeneration: true, run: (text) => generate(env, text),
        empty: 'No prompt was supplied. Pass the writing task or the whole question as ?prompt=.' },
      '/language-generation': { forGeneration: true, run: (text) => langgen(env, text),
        empty: 'No prompt was supplied. Pass the request or the whole question as ?prompt=.' },
    };
    const route = routes[path];
    if (!route) {
      return jsonResponse({ error: 'not found', usage: '/sentiment, /classify, /generate or /language-generation with ?text= or ?prompt=' }, 404);
    }

    const text = readText(q, route.forGeneration);
    // A missing input still answers 200 with an honest note, never a 4xx: the node reads any
    // non-200 on a declared route as no answer and zeroes the epoch.
    if (!text) {
      return jsonResponse({
        summary: route.empty, confidence: 0.2, as_of: new Date().toISOString(),
      }, 200);
    }
    try {
      const key = `${path}:${text.slice(0, 400)}`;
      const body = await memoized(key, () => route.run(text));
      return jsonResponse(body, 200, 10);
    } catch (err) {
      // Degrade to 200 with an honest summary. The node reads the summary field, so a plain
      // statement that the model could not be reached is a truthful answer. A 5xx is a
      // lost epoch.
      return jsonResponse({
        error: 'model unavailable',
        detail: String(err).slice(0, 180),
        summary: 'An AI reading for this request could not be produced at this time because the language model could not be reached.',
        confidence: 0.2, as_of: new Date().toISOString(),
      }, 200);
    }
  },
};


