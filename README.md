# AIWire language miner for Telegraph

One Cloudflare Worker that answers model-judged Telegraph intents by calling a language
model at request time and returning its answer as the graded summary.

| Intent | Endpoint | Descriptor id | The answer is |
| --- | --- | --- | --- |
| SENTIMENT_ANALYSIS | `/sentiment` | 7410 | the sentiment (positive, negative, neutral or mixed) plus one short reason |
| TEXT_CLASSIFICATION | `/classify` | 7411 | the single best category plus one short reason it fits |
| TEXT_GENERATION | `/generate` | 7412 | the text the prompt asked for and nothing else |
| LANGUAGE_GENERATION | `/language-generation` | 7413 | a direct, concise, complete answer to the request |

These are the model-judged tier of the network. The node writes its own ground truth for
each one with a model, so a genuinely correct answer to the question is what scores. This miner
produces that answer with MiniMax rather than guessing a shape.

## The model source

Every answer is one call to `MiniMax-M2.5-highspeed` on the MiniMax API. This miner is **not
keyless**, which is the one deliberate exception to the rule the other wire miners follow. It
runs under a paid commercial MiniMax plan held by the operator. The key is a Cloudflare
secret:

- the worker reads it as `env.MINIMAX_API_KEY`
- it is never written into `worker.js`, `wrangler.toml`, a descriptor, the README or any other
  file in this repo

The model terms, the plan and the one open licensing item are in `NOTICE` and `DATA-SOURCES.md`.

## Endpoints

Each route takes the text or the whole question on the query string. The bare route is
declared, never a template, so the node's exact-path match always lands.

```
GET /sentiment?text=<the text or the whole question>
GET /classify?text=<the text or the whole question>
GET /generate?prompt=<the writing task or the whole question>
GET /language-generation?prompt=<the request or the whole question>
```

The text is read from the first non-empty of `text`, `question`, `query`, `q`, `input`,
`content` and a few intent-specific names (`review`, `ticket` for classification, `prompt`,
`task` for generation), so passing the whole question works as well as passing the text alone.

```
GET /health     the intents served and whether the key is configured
GET /__last      the last few requests, for diagnostics
GET /            a usage summary
```

## The response

```json
{
  "intent": "SENTIMENT_ANALYSIS",
  "sentiment": "Positive",
  "summary": "Positive. The words \"absolutely love\" and \"exceeded all my expectations\" convey strong satisfaction.",
  "confidence": 0.96,
  "model": "MiniMax-M2.5-highspeed",
  "source": "MiniMax language model",
  "attribution": "Answer produced with MiniMax (MiniMax-M2.5-highspeed) under a commercial MiniMax plan held by zkasuran.",
  "as_of": "2026-09-25T00:00:00.000Z"
}
```

The node grades the `summary` field, so the descriptors set `label_field: summary`. The
`sentiment` and `category` fields are convenience siblings for a reader.

## Never a non-200 on a declared route

The node reads any 4xx or 5xx on a declared route as no answer and zeroes the whole epoch. So
every path answers 200: a missing input returns an honest note at confidence 0.2. A missing
key, a model error or a timeout returns a plain statement that the reading could not be produced,
also at low confidence. Only an undeclared path returns 404.

## Deploy

The worker itself needs no build. Two steps:

```bash
wrangler deploy
wrangler secret put MINIMAX_API_KEY      # paste the key when prompted, once
```

The secret is set on the deployed worker, not in this repo. `GET /health` reports
`key_configured` so you can confirm it landed without exposing the value.

## Verified before ship

Scored offline under each intent's own live scoring module with
`work/telegraph/minerlab/rank.py`, against the current live leader's answer as the ground-truth
proxy. A real MiniMax answer to a representative probe question scored:

| Intent | MiniMax answer | Leader (self) | Verdict |
| --- | --- | --- | --- |
| LANGUAGE_GENERATION | 0.9984 | 0.9998 | matches the leader, built |
| CHAT_COMPLETION | 0.0000 | 1.0000 | does not match, not built |
| TELEGRAPH_KNOWLEDGE | 0.0000 | 1.0000 | does not match, not built |
| TEXT_GENERATION | 0.0000 | 0.9999 | does not match, served but not registered |

LANGUAGE_GENERATION is graded semantically. Its answers are longer informational paragraphs
where the shared facts dominate the embedding, so an independent MiniMax answer converges with
the leader and scores 0.998. The live board carries six independent miners at 0.998 to
0.999. That is why it is registered and built here.

TEXT_GENERATION, CHAT_COMPLETION and TELEGRAPH_KNOWLEDGE are not. Text generation and chat
completion are graded by near-exact similarity to the node's own hidden reference, so two
well-written but differently worded outputs score apart and a genuinely good independent answer
scores about zero. Telegraph knowledge has no achievable leader on the board (every miner scores
about 1e-11) and the model holds no special Telegraph knowledge. These routes are not chased,
because reproducing a hidden reference is not honest independent work.

Note on the short-answer routes: SENTIMENT_ANALYSIS and TEXT_CLASSIFICATION answers are a single
label plus one short reason, where wording dominates the embedding for such short text. Measured
2026-09-25, an independent MiniMax answer scored 0.0 against the current live winner frame on both,
and the miner has no live score rows for either yet. Confirm they score on the live board before
relying on them, the same near-exact sensitivity that rules out chat completion applies to short
answers.

## Licence and data terms

- `LICENSE`: Source-Available No-Derivatives 1.0. Read it, audit it, run your own instance,
  publish what you find. Do not redistribute it or redeploy it as a competing miner. Calling
  the live endpoint is not restricted.
- `NOTICE` and `DATA-SOURCES.md`: the MiniMax terms, the paid plan, the credit line carried in
  every answer and the one open item (the paid Open Platform output-ownership clause could not
  be read from the client-rendered terms page, so it is recorded as unverified).

AI note: the answers this miner serves are produced by MiniMax. That is the whole design and it
is stated in every response, in `NOTICE` and here.

