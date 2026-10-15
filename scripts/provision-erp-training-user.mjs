#!/usr/bin/env node
// Creates (or updates) the SAP Finance Training Simulator account in Supabase
// Auth. Only needed when public/erp-finance-simulator/config.js points the
// simulator at a Supabase project. Run from your own machine only:
//
//   node --env-file-if-exists=.env.local scripts/provision-erp-training-user.mjs
//
// - The service-role key is read from a hidden prompt (or the
//   SUPABASE_SERVICE_ROLE_KEY env var for this one process). It is never
//   written anywhere and must never be shipped to the browser.
// - The password is read from a hidden prompt (or ERP_TRAINING_PASSWORD for
//   this one process). It is not stored in this repository.
// - Training personas are written to app_metadata, which users cannot change
//   themselves; the simulator authorises personas from it, never from the email.

import { createClient } from "@supabase/supabase-js";
import readline from "node:readline";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const EMAIL = (process.env.ERP_TRAINING_EMAIL || "training@hrremedyindia.com").trim().toLowerCase();
const PERSONAS = ["asha", "ravi", "meera"]; // Student, Instructor, Administrator

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

if (!url) fail("NEXT_PUBLIC_SUPABASE_URL not set. Run with --env-file-if-exists=.env.local");

const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  (await ask("Supabase service-role key (input hidden): ", { hidden: true })).trim();
if (!serviceKey) fail("No service-role key provided.");

const password = process.env.ERP_TRAINING_PASSWORD || (await ask(`Password for ${EMAIL} (input hidden): `, { hidden: true }));
if (!password) fail("No password provided.");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

let user = null;
for (let page = 1; !user; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) fail(`Could not list users: ${error.message}`);
  user = data.users.find((u) => (u.email || "").toLowerCase() === EMAIL) || null;
  if (data.users.length < 200) break;
}

const attrs = {
  password,
  email_confirm: true,
  app_metadata: { erp_personas: PERSONAS },
  user_metadata: { name: "Finance Training" },
};

if (user) {
  const { error } = await admin.auth.admin.updateUserById(user.id, attrs);
  if (error) fail(`Could not update ${EMAIL}: ${error.message}`);
  console.log(`✔ Updated ${EMAIL} (personas: ${PERSONAS.join(", ")}).`);
} else {
  const { error } = await admin.auth.admin.createUser({ email: EMAIL, ...attrs });
  if (error) fail(`Could not create ${EMAIL}: ${error.message}`);
  console.log(`✔ Created ${EMAIL} (personas: ${PERSONAS.join(", ")}).`);
}
