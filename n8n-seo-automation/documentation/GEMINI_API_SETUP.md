# Gemini API setup

Gemini is the only runtime AI service. It runs four separate calls:

1. prompt creator
2. article writer
3. independent E-E-A-T-oriented evaluator
4. reviser

It also provides embeddings. The Anthropic API is not used at runtime.

## 1. API key → n8n credential

1. Create a key in **Google AI Studio** (`aistudio.google.com` → *Get API key*)
   for a project dedicated to this automation. Enable billing if you need
   paid-tier rate limits.
2. In n8n: *Credentials → New → Header Auth*
   * Name: `x-goog-api-key`
   * Value: the API key
   * Credential name: `Gemini API Key (x-goog-api-key)`
3. Select it in every node whose name starts with `Gemini -`, plus `Generate
   RAG Query Embedding`, `Preflight - Verify Gemini Models` (workflow 02) and
   `Generate Embeddings` (workflow 01).

Header Auth keeps the key out of URLs and logs. The key is never written to a
prompt, the sheet or the execution output.

## 2. Models (verified October 2026, configurable)

| Purpose | Config key | Default | Status when built |
|---|---|---|---|
| Prompt creator | `GEMINI_PROMPT_MODEL` | `gemini-3.8-flash` | GA ("Stable: gemini-3.8-flash", Gemini API model page, Sept 2026) |
| Writer | `GEMINI_WRITER_MODEL` | `gemini-3.8-flash` | same |
| Evaluator | `GEMINI_EVALUATOR_MODEL` | `gemini-3.8-flash` | same |
| Reviser | `GEMINI_REVISER_MODEL` | `gemini-3.8-flash` | same |
| Embeddings | `EMBEDDING_MODEL` | `gemini-embedding-001` @ `768` dims | GA; Google's deprecations page lists the earliest possible shutdown as May 2028, with `gemini-embedding-2` as the successor |

Gemini model IDs change quickly. For example, `gemini-3.5-flash` is now
deprecated and auto-routed, and `gemini-3.6-flash` lists a retirement date of
Nov 19, 2026 on the Agent Platform. For that reason:

* every model ID is a configuration value in `Workflow Configuration`;
* **Preflight - Verify Gemini Models** calls `GET /v1beta/models/{model}` for each
  configured model at the start of every run. An unknown or retired model stops
  the run with a clear `CONFIGURATION` error before any record is claimed.
* Before production, open https://ai.google.dev/gemini-api/docs/models and
  https://ai.google.dev/gemini-api/docs/deprecations and confirm the IDs. A
  Pro-class model can be used for the writer or evaluator by changing one value,
  but check its structured-output support and cost first.

## 3. Request contract used

```
POST {GEMINI_API_BASE}/models/{model}:generateContent
x-goog-api-key: <credential>
{
  "systemInstruction": {"parts": [{"text": "<role prompt + brand context policy>"}]},
  "contents": [{"role": "user", "parts": [{"text": "<data blocks>"}]}],
  "generationConfig": {
    "responseMimeType": "application/json",
    "responseSchema": { ...OpenAPI-subset schema from tools/schemas.js... },
    "maxOutputTokens": 32768
  }
}
```

* **Structured output** (`responseMimeType` + `responseSchema`) constrains the
  shape. Every response is still **re-validated in the workflow** with the same
  schema, plus semantic checks: keyword/URL echo, links, sources, word count
  and so on.
* `finishReason` is checked. `MAX_TOKENS` is treated as truncated output (never
  silently accepted), and safety blocks are reported.
* Text parts flagged `thought: true` are ignored.
* Temperature and thinking level are left at the model defaults, which Google
  recommends for Gemini 3-series models.
* Malformed output gets **one** bounded correction request: the model's
  response plus the exact validation errors. A second failure is recorded as a
  technical error, retried on a later run up to `MAX_TECHNICAL_FAILURES` times.

## 4. Embeddings contract used

```
POST {GEMINI_API_BASE}/models/gemini-embedding-001:embedContent
{"model": "models/gemini-embedding-001",
 "content": {"parts": [{"text": "..."}]},
 "taskType": "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
 "title": "<category>",               // documents only
 "outputDimensionality": 768}
→ {"embedding": {"values": [768 floats]}}
```

The workflows reject any vector whose length is not `EMBEDDING_DIMENSIONS`.
The database rejects it too, because the column is `vector(768)` and
`seo.embedding_config` is checked.

## 5. Rate limits and errors

* HTTP Request nodes retry 3 times with a 5 s wait (`retryOnFail`). That covers
  HTTP 429 `RESOURCE_EXHAUSTED` and transient 5xx errors.
* If retries are exhausted, the keyword is marked for automatic retry on the
  next run (sheet shows `READY` with `Last_Error`), up to
  `MAX_TECHNICAL_FAILURES`, after which it becomes `REVIEW_REQUIRED`.
* 400, 401, 403 and 404 (bad key, unknown model) are **configuration**
  errors: status `ERROR`, no automatic retry.
* Keep `MAX_ARTICLES_PER_RUN` modest on the free tier. Each article uses at
  least 4 generateContent calls, and up to about 2 + 2 × attempts plus
  corrections.

## 6. Prompts

System instructions live in `prompts/*.md`, between the `BEGIN/END SYSTEM
INSTRUCTION` markers, and are embedded into the workflow by
`tools/build_workflows.js`. `prompts/05_Brand_Context_Policy.md` is appended to
every call. It makes retrieved knowledge, page text and model output *data*,
never instructions, and forbids fabricated company facts, sources and
experiences.
