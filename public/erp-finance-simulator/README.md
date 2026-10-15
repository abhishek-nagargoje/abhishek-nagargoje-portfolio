# SAP Finance Training Simulator

A self-contained training app (`index.html` + `config.js`) that simulates cloud ERP
finance processes on one double-entry ledger. It is an independent training
simulator with fictional data — **not an SAP product and not connected to any SAP
system.**

Open `index.html` directly, or via the deployed portfolio at
`/erp-finance-simulator/index.html`.

## Sign-in

- The sign-in screen is always shown first. Sessions live in memory only, so a
  refresh, a new tab or **Sign out** returns to the sign-in screen.
- Training account: `training@hrremedyindia.com` (email is trimmed and
  case-insensitive; the password is case-sensitive). The password is issued by
  the project owner and is intentionally **not** stored in this repository.
- Empty fields, malformed emails and wrong credentials are rejected with a
  message; five failures lock sign-in for 30 seconds.

### Demo mode (default)

With empty values in `config.js`, the password is checked in the browser against
a salted SHA-256 hash. Anyone can read the page source, so this keeps casual
visitors out but is **not production-grade security**. Do not use it to protect
real data.

### Supabase mode (optional)

1. Put the project URL and the public anon/publishable key in `config.js`
   (never a service-role key).
2. Provision the account from your own machine:
   `node --env-file-if-exists=.env.local scripts/provision-erp-training-user.mjs`
3. The simulator then signs in through Supabase Auth and reads the allowed
   training personas from the user's `app_metadata.erp_personas`.

Only authentication moves to Supabase. Finance data still lives in each
browser (see below).

## Authorisation

After sign-in the account works as one of three training personas, switchable
from the top bar. Permissions come from the persona role, not from the email:

| User | Role | Can |
| --- | --- | --- |
| Priya Sharma | Accountant | prepare journals, invoices, POs, assets, plan inputs |
| Rahul Mehta | Finance Manager | approve/post, payments, depreciation, close |
| Anita Desai | Finance Controller | everything, incl. periods, tax codes, FX, reset |

Separation of duties: a preparer cannot approve their own document (the
Administrator may override; overrides are flagged in Compliance controls).

## Data and persistence

- Data is stored in `localStorage` (key `erpfin.v3`) in the visitor's browser.
- Records **do not** appear on other devices or for other users, and there is no
  real-time sharing. Multi-user shared data would need a database (for example
  Supabase Postgres with Row Level Security and Realtime) — not implemented.
- Settings › Reset training data (Administrator) restores the fictional company.

## Modules

Planning and analysis (value driver tree, named scenarios, plan versions, budget
vs actuals, version comparison, planning calendar) · Journal entries · General
ledger · Fixed assets (straight-line and declining-balance per ledger,
controlled depreciation runs) · Financial close checklist · Financial reports
(trial balance, P&L, balance sheet, ledger comparison, AR/AP ageing) · Accounts
payable (payment run, partial payments) · Accounts receivable (receipt
allocation) · Procurement and GR/IR reconciliation · Approvals · Tax management
(GST return, settlement, compliance controls) · Audit trail · Treasury (cash
position, liquidity forecast, transfers, FX) · Bank reconciliation · Settings.
