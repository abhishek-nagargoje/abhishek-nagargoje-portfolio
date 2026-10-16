# Meridian ALM

A database-backed application-lifecycle and ERP-operations workspace. It replaces the earlier single-file
“SAP Cloud ALM – Practice Simulator” (an HTML page that kept everything in browser `localStorage` and let anyone
switch roles from a dropdown) with real authentication, a PostgreSQL database, server-enforced permissions and
business rules, and a React interface modelled on the Fiori-style reference screenshots.

Meridian ALM is an independent application. It is **not** an SAP product and is **not connected to any SAP tenant**:
promotions, monitoring KPIs and ERP documents are records in this application's own database.

---

## Contents

1. [What is implemented](#what-is-implemented)
2. [Architecture and folder structure](#architecture)
3. [Setup](#setup) – install, PostgreSQL, environment, migrations, seed, initial account
4. [Running](#running) – development and production
5. [Testing](#testing)
6. [Users, roles and permissions](#users-roles-and-permissions)
7. [Business rules](#business-rules)
8. [Security](#security)
9. [API](#api)
10. [Changes from the original simulator](#changes-from-the-original-simulator)
11. [Not implemented / integrations](#not-implemented--integrations)

---

## What is implemented

| Area | Functionality |
| --- | --- |
| **Sign-in & shell** | Login page (validation, loading/error states, password visibility toggle, safe post-login redirect), cookie sessions that survive reloads, logout, forced change of temporary passwords, account settings, shell bar with global search, notifications popover and user menu, collapsible side navigation (overlay on phones), breadcrumbs. |
| **Launchpad** (reference 1) | Tile groups per area, personal to-dos (assigned work + purchase orders awaiting your approval) and KPI tiles. |
| **Overview** (references 3 & 5) | Project card (status, task progress, current phase, remaining days), phase timeline, Today (failed test runs, blocked/overdue/unassigned tasks), upcoming tasks, task/requirement/test/defect charts, procurement and sales KPIs, unread notifications, recent activity – all computed from the database. |
| **Business processes** | Source to Pay, Plan to Produce, Lead to Cash with each step linked to the records that evidence it (or marked *not tracked*), and the requirements per process. |
| **Requirements** | Create/edit/search/filter/sort/paginate, assignment, priority, fit-to-standard decision, validated status transitions, business sign-off, linked tasks/tests/defects, comments, promotion history and audit history; “generate standard tasks” template. |
| **Tasks** | Create/assign/prioritise, due dates, linked requirement, validated transitions (Open/In Progress/Blocked/Done), owner/status/overdue filters, comments and history. |
| **Test management** | Test cases with ordered steps and expected results, executions with actual results, per-step pass/fail, server-derived test status, execution history, automatic defect on failed step, requirement traceability. |
| **Defects** | Severity, priority, reproduction steps, expected/actual result, resolution, workflow New → In Process → Fixed → Retest → Closed (or Rejected), links to test case/requirement/incident, comments, history. |
| **Landscape & deployment** (reference 2) | DEV/QA/PROD landscape cards, gate checks per promotion, recorded promotion history. |
| **Operations monitoring** (reference 4) | KPIs computed from stored documents (POs pending/stuck, deliveries awaiting goods issue or billing, stock-outs with demand), document-volume chart, incidents with investigation notes, resolution, reopening, defect creation; demonstration incidents are flagged. |
| **Procurement** | Purchase requisitions, multi-line purchase orders (from scratch, from a requisition or for a sales order), configurable approval threshold, approve/reject, partial and full goods receipts, quick PR + PO for a customer, document view with GST totals. |
| **Inventory** | Stock overview for 540 materials × 6 plants with ATP, category/plant summaries, material detail, stock transfers, reasoned stock adjustments, movement history. |
| **MRP** | Net requirements per plant (demand − stock − incoming) and conversion of shortages into requisitions. |
| **Sales & delivery** | Multi-line sales orders with availability check, outbound deliveries, pick & pack, goods issue, invoicing with GST, cancellation of undelivered orders, document flow. |
| **Customers & vendors** | Search/filter/paginate, detail page with recent documents, create/edit with GSTIN/PIN/email validation; contact data, tax IDs and credit limits shown only to authorised roles. |
| **Notifications & activity** | Per-user persisted notifications (read/unread, mark all), team workload, business activity log, security audit log. |
| **Administration** | Create users with temporary passwords, assign roles, deactivate, unlock, reset passwords, role/permission matrix, business configuration (approval threshold, GST rate, self-approval, stuck-PO hours). |

## Architecture

```
alm-erp/
├── package.json            workspace scripts (pnpm workspaces)
├── .env.example            placeholder configuration (copy to server/.env)
├── eslint.config.js
├── server/                 Node.js 20+ · TypeScript · Express 5 · PostgreSQL (pg) · zod
│   ├── migrations/         001 schema · 002 reference data (roles, permissions, plants, processes, settings) · 003 views
│   ├── openapi.yaml        API description (served at /api/openapi.yaml)
│   ├── src/
│   │   ├── app.ts          Express app: security headers, sessions, CSRF, routers, error handler, SPA hosting
│   │   ├── auth/           session store and middleware (authentication, CSRF/origin checks, permission checks)
│   │   ├── db/             pool + transactions, migration runner, sample data
│   │   ├── lib/            money (integer paise), password hashing (scrypt), validation helpers, rate limiter, logger
│   │   ├── services/       activity/notifications, workflow rules, inventory postings, idempotency, settings
│   │   ├── routes/         one router per module
│   │   └── scripts/        migrate · seed · create-admin · e2e-reset
│   └── test/               integration tests (vitest + supertest against a real PostgreSQL database)
└── web/                    React 18 · TypeScript · Vite · React Router · lucide icons (no UI framework)
    ├── src/
    │   ├── app/            routes and guards
    │   ├── auth/           session context
    │   ├── components/     layout (shell, navigation, page header), common (table, dialog, fields, pickers…), charts (SVG)
    │   ├── features/       one folder per module (pages + dialogs)
    │   ├── hooks/ services/ types/ utils/
    │   └── styles/         design tokens (measured from the reference screenshots) and component styles
    └── e2e/                Playwright browser tests
```

In production the API server also serves the built frontend (`SERVE_WEB=true`), so the browser talks to a single
origin. In development Vite proxies `/api` to the API server, which keeps cookie and CSRF behaviour identical.

## Setup

### Prerequisites

- Node.js ≥ 20.11 (22 recommended) and pnpm ≥ 9 (`corepack enable`)
- PostgreSQL ≥ 14

### 1. Install dependencies

```bash
cd alm-erp
pnpm install
```

### 2. Create the PostgreSQL databases

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE alm_app LOGIN PASSWORD 'choose-a-strong-password';
CREATE DATABASE alm      OWNER alm_app;   -- application data
CREATE DATABASE alm_test OWNER alm_app;   -- wiped by the integration tests
CREATE DATABASE alm_e2e  OWNER alm_app;   -- wiped by the browser tests
SQL
```

### 3. Configure the environment

```bash
cp .env.example server/.env
# edit server/.env: DATABASE_URL, TEST_DATABASE_URL, E2E_DATABASE_URL (optional), PORT, ALLOWED_ORIGINS …
```

`server/.env` is git-ignored. Never commit real credentials.

### 4. Run migrations and (optionally) load sample data

```bash
pnpm db:migrate     # applies pending migrations; also runs automatically when the server starts
pnpm db:seed        # optional, idempotent: sample project, 27 sample team members, 540 materials, 120 companies, opening stock
```

Migrations never delete data. The seed only inserts records that are missing and marks them `is_sample`; the UI
labels them “Sample”. Sample companies have fictitious names, `.example` email addresses, and no tax IDs or phone numbers.

### 5. Create the initial account

The password is passed through the environment for this one command only. It is hashed with scrypt and never written
to the repository, to disk or to the logs. Use **single quotes** so the shell does not expand characters such as `$`:

```bash
INITIAL_ADMIN_EMAIL='training@hrremedyindia.com' INITIAL_ADMIN_PASSWORD='<the agreed initial password>' pnpm create-admin
```

Running it again only verifies the account and Administrator role. To replace the password, use account settings
in the app or run the command with `-- --reset-password`. **Change the initial password after the first sign-in**
(Account settings → Change password).

## Running

### Development

```bash
pnpm dev            # API on http://localhost:4000 (watch mode) and the UI on http://localhost:5173
```

### Production

```bash
pnpm build                                        # type-checks and builds server (server/dist) and web (web/dist)
NODE_ENV=production SERVE_WEB=true PORT=4000 pnpm start
```

Run it behind an HTTPS reverse proxy (set `TRUST_PROXY=true` there). With `NODE_ENV=production`, the session cookie
becomes `__Host-alm_sid` with `Secure`, and HSTS is enabled. Expired sessions are purged hourly.

## Testing

```bash
pnpm typecheck      # TypeScript (server + web)
pnpm lint           # ESLint, zero warnings allowed
pnpm test           # server integration tests (TEST_DATABASE_URL) + web unit tests
pnpm test:e2e       # Playwright browser tests (E2E_DATABASE_URL; starts its own API on :4100)
```

- **Server integration tests** (`server/test`, 36 tests) cover these areas:
  - authentication: login, bad credentials, lockout, CSRF, cross-origin rejection, logout, expired sessions, forced password change
  - authorisation and admin user management
  - notification privacy and sensitive-field redaction
  - requirement/task transitions and permissions
  - the full test → defect → retest → sign-off → promotion workflow
  - procurement: threshold, approver rules, no self-approval, PR conversion, partial/over receipts, idempotent replays, configurable threshold
  - inventory: transfers, concurrency (never negative), adjustments
  - order to cash: MRP shortage, goods issue blocked without stock, single billing, document flow
  - decimal-safe money calculations

  The test database is dropped and rebuilt at the start of every run.
- **Browser tests** (`web/e2e`, 16 tests at 1920×1067 plus a phone viewport) cover these areas:
  - login: validation, wrong password, password visibility, session restore, logout, open-redirect protection
  - every page rendering without console errors, keyboard and dialog focus behaviour, server-side pagination and filtering
  - the PO approval and goods-receipt flow across three roles
  - stock transfer validation
  - the requirement → test → defect flow
  - order to cash
  - the responsive layout

  Each run creates its users with a random password. Set `PW_CHROMIUM_PATH` to use a pre-installed Chromium.

## Users, roles and permissions

Administrators create users under **Administration → Users & Roles**. They set a temporary password, which the user
must change at first sign-in, and assign roles. Sample team members from the seed have no password and cannot sign in
until an administrator uses **Set password**. Role changes and deactivation end the user's sessions immediately.

Roles: Administrator (all permissions), Project Manager, Procurement Head, Procurement Consultant, Solution Architect,
OSCM Consultant, MRP Planner, Warehouse Consultant, Sales Consultant, Finance Consultant, Business User, Tester,
Technical Team, Basis & Security Admin, Change & Training Manager. The full permission matrix is visible in
the app (Users & Roles → Roles & Permissions) and defined in `server/migrations/002_reference_data.sql`.

Every authenticated user can read project and ERP data. Each change requires a specific permission, which the server
checks on every request; the UI only hides actions the user cannot perform.

## Business rules

All rules are enforced on the server (the UI mirrors them for guidance only):

- **PO approval:** a purchase order whose **net** value is above the configured threshold (default ₹10,00,000) is
  created as *Pending Approval*, and approvers are notified. Only roles with `po.approve` (the Procurement Head) can
  approve or reject it. The creator cannot approve their own order unless *allow self-approval* is switched on.
  Goods cannot be received before approval.
- **Requirement sign-off** (*Approved*) needs a signing role (Business User, Project Manager or Procurement Head) and at
  least one linked test case, with all linked test cases *Passed*.
- **Test status** is derived from executions. A test passes only when every active step passed in the same
  execution, and clients cannot set it directly. A failed step raises a defect, or adds a comment to the open defect
  for that step instead of duplicating it.
- **Defect closure** needs `defect.close` and, if a test case is linked, a passing retest. *Fixed* and *Rejected* need
  resolution details.
- **Promotion:** DEV → QA needs status *In Test* or *Approved*. QA → PROD needs sign-off, all linked tests passed and
  no open defects. Each promotion is stored with its gate results.
- **Inventory:** stock can never go negative (database CHECK plus row locks). A transfer posts both plants in one
  transaction. Adjustments need a reason. Every change writes a movement record.
- **Goods receipt and goods issue** update stock exactly once. Over-receipt is rejected, and a goods issue posts
  all lines or none.
- **A delivery is billed exactly once** (unique invoice per delivery). Invoices can only be posted after goods issue.
- **Money:** all money is computed in integer paise and stored as `numeric(15,2)`. GST is rounded half-up per
  document.
- **Transaction endpoints accept an `Idempotency-Key`**, and the UI sends one per form submission, so a double click
  or a network retry never creates a second document.
- Status changes follow explicit transition tables (`server/src/services/workflow.ts`).

## Security

- **Passwords:** hashed with scrypt (N=2¹⁵, r=8, p=1, per-user salt). Policy: at least 10 characters with three
  character classes. A dummy hash equalises login timing for unknown accounts.
- **Sessions:** random 256-bit tokens, stored server-side only as a SHA-256 hash. The cookie is HttpOnly and
  SameSite=Lax, plus Secure and `__Host-` in production. Idle timeout is 8 h and absolute timeout 7 days. Sessions
  rotate on login and password change.
- **CSRF and cross-origin requests:** each session has a token that must be sent as `X-CSRF-Token`. State-changing
  requests must be JSON, and an `Origin` header must be same-origin or listed in `ALLOWED_ORIGINS`. No CORS headers
  are sent.
- **Brute force:** login is rate-limited per IP and per account, and the account locks for 15 minutes after 5
  failures. Error messages are generic.
- **Headers:** Helmet sets a strict Content-Security-Policy (no inline scripts), frame-ancestors none, HSTS in production
  and no-store for API responses.
- **Queries and errors:** all SQL is parameterised, with allow-listed sort columns and escaped LIKE patterns. Inputs
  are validated with zod. Errors return a code, a message and a request ID; internals are logged only on the server.
- **Audit:** sign-ins, failures, lockouts, password changes, user/role and configuration changes are recorded in the
  security audit log. Business changes go to the activity log.
- **Secrets:** no secrets are stored in the repository; `.env.example` contains placeholders only. `pnpm audit`
  reports no known vulnerabilities at the time of writing.

## API

The JSON API lives under `/api`. It is documented in [`server/openapi.yaml`](server/openapi.yaml), which is also served at
`/api/openapi.yaml`. Lists are paginated (`page`, `pageSize` ≤ 200) and filtered on the server.

## Changes from the original simulator

**Preserved**
- the team and its roles (now real roles and permissions)
- the REQ/TSK/TC/DEF workflows, including the five standard tasks and the PO-approval requirement with its three-step test case
- automatic defects from failed steps, sign-off rules, and DEV → QA → PROD gates
- monitoring with incident → defect
- the S/4 transactions: PR, PO, approval above ₹10 lakh, goods receipt, sales orders, delivery, pick, goods issue, invoice with 18% GST, stock transfer, MRP, all documents and document views
- the quick PR + PO for a client
- the 540-material catalogue and 6 plants, with the same opening stock (including the Echo Dot scenario: 20 in Pune and 60 in Mumbai)
- 120 sample companies

**Changed**
- **Roles:** the "Acting as" role switcher is replaced by real sign-in, and authorisation is enforced on the server.
- **Data storage:** `localStorage` is replaced by PostgreSQL.
- **Monitoring:** the simulated incident numbers ("250 POs stuck") are replaced by KPIs computed from real documents. Demonstration incidents can still be recorded and are flagged as such.
- **Sample companies:** real retailer and manufacturer names, randomly generated GSTINs and phone numbers were removed from the sample data.
- **Branding:** "Practice Simulator" branding was replaced by the Meridian ALM identity.

**Removed:** the nine-step *Case Study* checklist (a training aid). The Business Processes page now shows each
process step's progress from the actual documents.

## Not implemented / integrations

- No connection to SAP Cloud ALM, S/4HANA, Ariba or any external system. Promotions are workflow records, not transports, and monitoring KPIs come from this database only.
- Notifications are in-app only; no e-mail or SMS delivery is configured.
- There is no self-service password reset (it needs an e-mail provider); administrators reset passwords instead.
- Not modelled: supplier invoices, payments, production orders, stock reservations or credit checks. ATP is on-hand + incoming − open demand.
- The login rate limiter is in-memory and per process. For several instances, put a shared limiter (e.g. at the proxy or in Redis) in front.
- GSTINs are validated for format only, not against the GST portal.
- A single project is seeded; the schema and APIs are project-scoped, but there is no project-creation screen yet.
