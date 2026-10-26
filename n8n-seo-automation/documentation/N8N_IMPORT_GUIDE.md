# n8n import guide

## Version compatibility

| Item | Value |
|---|---|
| Built and import-tested on | **n8n 2.44.6** (current stable, Oct 2026; Node 24) |
| Node typeVersions used | Code 2, If 2.2, Switch 3.2, Set 3.4, Postgres 2.5, HTTP Request 4.2, Google Sheets 4.5, HTML 1.2, Crypto 1, Wait 1.1, Execute Workflow 1.2, Execute Workflow Trigger 1.1, Schedule Trigger 1.2, Manual Trigger 1, Error Trigger 1, NoOp 1, Sticky Note 1 |
| Expected minimum | n8n 1.80+ for these typeVersions. Only **2.44.6** was actually tested. On 1.x, Code nodes run without task runners. Behaviour is the same, but test first |

Check your version: *Settings → About n8n*, or `docker exec <n8n> n8n --version`.
If yours is older than 1.80, upgrade n8n first.

> n8n 2.x specifics already handled in the workflows:
> * Code nodes do not use `$env`, `require()`, `URL` or `URLSearchParams`. None
>   of these are available in the 2.x task-runner sandbox.
> * Node data is always read with an explicit output index (`$('Node').first(0)`).
>   Without it, n8n can resolve an empty error branch.
> * `fullResponse` + text bodies are read from `data`.

## 1. Import (UI)

For each file in `workflows/` (01, 02, 03): *Workflows → Add workflow → ⋯ →
Import from File…* → select the file → **Save**. All three import **inactive**.

CLI alternative (inside the n8n container):

```bash
n8n import:workflow --input=/files/01_Brand_RAG_Ingestion.json
n8n import:workflow --input=/files/02_SEO_Article_Automation.json
n8n import:workflow --input=/files/03_Error_Recovery.json
```

Tested: all three imported successfully with `n8n import:workflow` on 2.44.6.

## 2. Credentials

Create the five credentials in `configuration/required_credentials.md`. Then
open each workflow and fix the nodes showing a red credential warning. The
exports reference placeholder IDs (`REPLACE_..._CREDENTIAL_ID`). Selecting
the real credential in one node of a type usually prompts n8n to apply it to
the others.

Node → credential map:

| Workflow | Nodes | Credential |
|---|---|---|
| 01 | Start Ingestion Run, Fetch Existing Hashes, Upsert Brand Chunk, Mark Unchanged Chunks Seen, Record Ingestion Error, Deactivate Unapproved Knowledge, Finalize Ingestion Run | Postgres |
| 01 | Generate Embeddings | Header Auth (Gemini) |
| 01 | Read Brand Knowledge | Google Sheets OAuth2 |
| 02 | every Postgres node (Claim, Record…, Ledger…, Finalize…, Mark…, Preflight - Check Database…) | Postgres |
| 02 | Preflight - Verify Gemini Models, Generate RAG Query Embedding, Gemini - Create Article Prompt / Generate Article / Evaluate Editorial Quality / Revise Article | Header Auth (Gemini) |
| 02 | Preflight - Verify Plagiarism Account, Submit Plagiarism Scan, Retrieve Plagiarism Report | Query Auth (DupliChecker) |
| 02 | Get Master Doc, Append Article to Master Google Doc, Read Master Doc For Verification | Google Docs OAuth2 |
| 02 | Read Keywords and every `Sheet - …`, `Mark …`, `Update Keyword APPROVED`, `Log …` Sheets node | Google Sheets OAuth2 |
| 03 | all Postgres nodes | Postgres |
| 03 | Read Master Doc | Google Docs OAuth2 |
| 03 | Requeue…, Sync… Sheets nodes | Google Sheets OAuth2 |

## 3. Configuration values

Edit the Code nodes (non-secret values only):

* **02 → Workflow Configuration**: `SPREADSHEET_ID`, `MASTER_DOC_ID`,
  `BRAND_ID`, `BRAND_NAMES`, models, thresholds. The node refuses to run while
  an ID still says `REPLACE_WITH_…`.
* **01 → Ingestion Configuration**: `SPREADSHEET_ID`, `BRAND_ID`, embedding
  model/dims (must match 02 and the DB).
* **03 → Recovery Configuration** and **Recovery Configuration (Error Path)**:
  `SPREADSHEET_ID`, `MASTER_DOC_ID`.

The full list of keys is in `configuration/config.example.json`.

## 4. Error workflow wiring

Open 01 and 02 → *Settings* (⋯ → Settings) → **Error workflow** = `03 Error
Recovery` → Save. Tested: an unhandled failure in a workflow 02 sub-execution
triggered workflow 03 (`T15`).

## 5. Self-call check (workflow 02)

`Process Keyword (Sub-Execution)` calls **the same workflow** with
`workflowId = {{ $workflow.id }}`. Nothing needs to be changed after import,
because the ID is resolved at runtime. Keep *Settings → This workflow can be
called by* at its default (workflows from the same owner) or broader.

## 6. Timezone and schedules

Each workflow has `settings.timezone = Asia/Kolkata`. Schedules:

| Workflow | Schedule |
|---|---|
| 01 | `30 7 * * *` → 07:30 IST |
| 02 | `0 8 * * *` → 08:00 IST |
| 03 | every 30 minutes |

Edit the Schedule Trigger nodes to change them.

## 7. First runs (all from the editor, workflows still inactive)

1. Run **01** with *Execute workflow*. Check the last node's output
   (`status: SUCCESS`) and `SELECT count(*) FROM seo.brand_knowledge_chunks`.
2. Put **one** test row in `Keywords` with `Status = READY`, then run **02** with
   *Execute workflow* from **Manual Test Trigger**. Check the sheet,
   `Article_Log`, the master doc and `SELECT * FROM seo.v_review_queue`.
3. Run **03** with its Manual Recovery Trigger. It should complete with nothing
   to do.
4. Only after reviewing the test articles: activate **03**, then **01**, then
   **02** (toggle *Active* / *Publish*).

## 8. Updating later

The JSON files are generated from `tools/`. After editing sources:

```bash
node tools/build_workflows.js && node tools/validate_workflows.js
```

Re-import. Importing a file whose `id` matches an existing workflow replaces
it, so re-select credentials if prompted. If you prefer editing in the n8n UI,
export your edited workflow and treat that export as the new source.
