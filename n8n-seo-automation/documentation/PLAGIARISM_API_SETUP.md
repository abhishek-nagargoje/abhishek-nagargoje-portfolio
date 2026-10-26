# Plagiarism checking (DupliChecker, modular)

## What was verified, and what was not

The official page `https://www.duplichecker.com/api-documentation` could not
be opened from the build environment (network policy). Its content was
checked through search-engine extracts of that page. **Verify each point below
on the page itself, while logged in, before production.**

Verified from DupliChecker's own documentation (via extracts):

* API access requires a **paid plan that includes "API Available"**. A
  website subscription alone does not give API access. The **token** is shown
  on your profile page after purchasing such a plan.
* Endpoints: *Get API token*, *Check Account Status*
  (`POST https://www.duplichecker.com/api/info`, field `token`), *Check
  Plagiarism* (`POST https://www.duplichecker.com/api/checkplag`, fields
  `token`, `data` = text, optional `rephrased=true`), and a *CallBack Url*
  section.
* With `rephrased=true` the response includes `exactMatchedPercent` and
  `rephrasedPercent`. Without it, only exact matches are detected.
* The response has a `details` array, one entry per sentence, each with a
  `unique` flag; `unique: false` means the sentence matched a source.

**Not verified** (so the workflow does not assume it):

* The name of a single "overall percent" field. A third-party wrapper uses
  `plagPercent`, which is unconfirmed.
* Whether `checkplag` is synchronous, and the exact callback/poll contract.
  The sister site plagiarismchecker.co documents
  `/api/query-footprint/{hash}/{key}`; this is unconfirmed for DupliChecker.
* Whether the token may be sent as a query parameter (see *Authentication*).
* Per-request word limits for your plan.

## How the workflow uses it

1. **Preflight** (`Preflight - Verify Plagiarism Account`): `POST /api/info`
   once per run. An authentication/plan error or an unavailable service stops
   the run before any article is generated.
2. **Submission** (`Submit Plagiarism Scan`) runs only after the editorial
   evaluation **passed** for that exact attempt. The article's plain text is
   split into ≤ `PLAGIARISM_MAX_WORDS_PER_REQUEST` (default 1,000) word chunks,
   sent one per 2 s, with `rephrased=true`.
3. **Normalisation** (`lib/plagiarism.js`):
   * similarity per chunk = max(words in sentences with `unique=false` ÷ words
     sent, `exactMatchedPercent + rephrasedPercent`, or your configured
     `PLAGIARISM_PERCENT_FIELD`);
   * matched passages and any source URLs found in `details` are captured for
     the reviser;
   * HTTP 401/403, invalid-token or plan messages → `CONFIGURATION`; 429/5xx/no
     response → transient; **any unrecognised response → `REPORT_UNPARSEABLE`,
     never PASS**.
4. **Asynchronous reports.** If the response contains a job reference
   (`query_footprint`, `hash`, `key`, `id`…) instead of results, the workflow
   polls `PLAGIARISM_POLL_URL_TEMPLATE` with a Wait node every
   `PLAGIARISM_POLL_INTERVAL_SECONDS`, at most `PLAGIARISM_MAX_POLLS` times,
   then fails closed (`PLAGIARISM_POLL_TIMEOUT`). The template is empty by
   default. If DupliChecker answers asynchronously and no template is
   configured, the article is **not approved**
   (`PLAGIARISM_ASYNC_NOT_CONFIGURED`). Set the template from your account's
   documentation, e.g.
   `https://www.duplichecker.com/api/query-footprint/{query_footprint}/{key}`.
   `{name}` placeholders are filled from the job reference fields.
5. **Policy** (`decidePlagiarism`): word-weighted similarity across chunks must
   be ≤ `PLAGIARISM_THRESHOLD_PERCENT` (default **10%**). There must also be no
   unquoted matched passage of ≥ `PLAGIARISM_MAX_MATCHED_PASSAGE_WORDS` (40)
   words. Otherwise → revision with the matched passages, and a **new** scan
   of the revised text.
6. Each scan is stored against the sha256 of the exact text scanned.
   PostgreSQL refuses a report for any other version
   (`PLAGIARISM_REPORT_STALE`).

The 10% threshold is a project policy, not a universal definition of
plagiarism. Common phrases, legitimate quotations and the provider's
measurement method are why matched passages are passed to the reviser and
kept for human review. The reviser is instructed to rewrite the substance
with proper attribution, never to disguise copied text.

## Authentication

The token is stored in the n8n credential **Query Auth**
(`name = token`, `value = <your token>`, credential name `DupliChecker API
Token`). It is sent as `?token=…` on the three DupliChecker requests and is
never placed in the sheet, prompts, logs or workflow JSON.

The documentation shows `token` as a request field. Many frameworks (e.g.
Laravel `input()`) accept the field from the query string or the form body
alike, but this is **unverified for DupliChecker**. The preflight check proves
it on the first run.

### Authentication fallbacks

If the preflight fails with an authentication error although the token is
correct:

1. **JSON body via Custom Auth.** Create a *Custom Auth* credential with
   `{"body": {"token": "<token>"}}`. In `Submit Plagiarism Scan` and the
   preflight node, set *Authentication → Generic → Custom Auth*, and change
   *Body Content Type* from *Form Urlencoded* to **JSON** with fields `data` and
   `rephrased`. Custom Auth body values are merged into JSON bodies, but **not**
   into form-urlencoded bodies in n8n's HTTP Request node.
2. **Bearer header.** If DupliChecker confirms bearer tokens (the sister site's
   examples use `Authorization: Bearer`), use a *Bearer Auth* credential.
3. **Environment variable (last resort).** Set
   `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` and `DUPLICHECKER_TOKEN=…` on the n8n
   container, and add a form field `token = {{ $env.DUPLICHECKER_TOKEN }}`.
   Security implication: every workflow and every user who can edit workflows
   on that instance can then read all environment variables. Prefer options 1
   and 2.

## Switching to another provider

Do not silently substitute a provider: the workflow names DupliChecker in the
Docs header and logs (`PLAGIARISM_PROVIDER`). To switch:

1. Change `PLAGIARISM_PROVIDER`, `PLAGIARISM_CHECK_URL`, `PLAGIARISM_INFO_URL`,
   and the credential type on the three plagiarism HTTP nodes.
2. Adapt `normalizePlagiarismResponse()` in `tools/code/lib/plagiarism.js` to
   the provider's documented response, keeping the fail-closed rules. Add unit
   tests, then run `node tools/build_workflows.js`.
3. Re-run the test suite (`tests/e2e`), extending the mock with the new
   provider's documented contract.
