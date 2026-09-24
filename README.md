# AIWire language miner for Telegraph

One Cloudflare Worker that answers three model-judged Telegraph intents by calling a language
model at request time and returning its answer as the graded summary.

| Intent | Endpoint | Descriptor id | The answer is |
| --- | --- | --- | --- |
| SENTIMENT_ANALYSIS | `/sentiment` | 7410 | the sentiment (positive, negative, neutral or mixed) plus one short reason |
| TEXT_CLASSIFICATION | `/classify` | 7411 | the single best category plus one short reason it fits |
| TEXT_GENERATION | `/generate` | 7412 | the text the prompt asked for and nothing else |

These three are the model-judged tier of the network. The node writes its own ground truth for
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
`work/telegraph/minerlab/rank.py`, against the current leader's live answer as the ground-truth
proxy. A real MiniMax answer to a representative probe question scored:

| Intent | MiniMax answer | Leader (self) | Verdict |
| --- | --- | --- | --- |
| SENTIMENT_ANALYSIS | 1.0000 | 1.0000 | matches the leader |
| TEXT_CLASSIFICATION | 1.0000 | 0.9922 | matches the leader |
| TEXT_GENERATION | 0.0000 | 0.9999 | does not match |

Sentiment and classification are model-judged on the label plus a short reason, so an
independent correct answer lands on the leader. Text generation is graded by near-exact
similarity to the node's own hidden reference, so two well-written but differently worded
outputs score apart. An independent generation answer does not match and this miner does not
try to reproduce a hidden reference. The generation route is served and honest, but it is not
expected to score on open prompts.

## Licence and data terms

- `LICENSE`: Source-Available No-Derivatives 1.0. Read it, audit it, run your own instance,
  publish what you find. Do not redistribute it or redeploy it as a competing miner. Calling
  the live endpoint is not restricted.
- `NOTICE` and `DATA-SOURCES.md`: the MiniMax terms, the paid plan, the credit line carried in
  every answer and the one open item (the paid Open Platform output-ownership clause could not
  be read from the client-rendered terms page, so it is recorded as unverified).

AI note: the answers this miner serves are produced by MiniMax. That is the whole design and it
is stated in every response, in `NOTICE` and here.

