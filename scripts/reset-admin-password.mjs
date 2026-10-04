#!/usr/bin/env node
// Local, one-off admin password reset for when the emailed reset link can't
// be used. Run from your own machine only:
//
//   node --env-file-if-exists=.env.local scripts/reset-admin-password.mjs
//
// - The Supabase service-role key is read from a hidden prompt (or the
//   SUPABASE_SERVICE_ROLE_KEY env var for this one process). It is never
//   written anywhere. Never put it in .env files that ship to the browser.
// - A strong password is generated and printed once to this terminal.
// - All existing sessions for the account are revoked afterwards.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import readline from "node:readline";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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
      resolve(answer.trim());
    });
  });
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

if (!url || !publishableKey) {
  fail("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY not set. Run with --env-file-if-exists=.env.local");
}

const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  (await ask("Supabase service-role key (Dashboard → Project Settings → API Keys; input hidden): ", { hidden: true }));
if (!serviceKey) fail("No service-role key provided.");

const email = (await ask("Admin account email: ")).toLowerCase();
if (!email) fail("No email provided.");

const noPersist = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, serviceKey, noPersist);

// Locate exactly one user with this email.
let user = null;
for (let page = 1; !user; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) fail(`Could not list users: ${error.message}`);
  user = data.users.find((u) => u.email?.toLowerCase() === email) || null;
  if (data.users.length < 200) break;
}
if (!user) fail(`No auth user with email ${email}.`);

const confirm = await ask(`Reset password for ${user.email} (id ${user.id})? Type "yes": `);
if (confirm !== "yes") fail("Aborted. Nothing was changed.");

// Either a password typed at a hidden prompt, or a generated one.
let newPassword = await ask("New password (input hidden; leave blank to generate a strong one): ", { hidden: true });
const generated = !newPassword;
if (generated) {
  newPassword = randomBytes(18).toString("base64url"); // 24 chars, ~144 bits
} else {
  if (newPassword.length < 12) fail("Use at least 12 characters. Nothing was changed.");
  const again = await ask("Repeat new password: ", { hidden: true });
  if (again !== newPassword) fail("Passwords don't match. Nothing was changed.");
}

const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
if (updateError) fail(`Password update failed: ${updateError.message}`);

// Verify the new credentials and the admin check using the normal public
// client, exactly like the login page does — then revoke every session
// (including this one) so anything signed in with the old password is out.
const pub = createClient(url, publishableKey, noPersist);
const { error: signInError } = await pub.auth.signInWithPassword({ email: user.email, password: newPassword });
if (signInError) fail(`Password was updated but test sign-in failed: ${signInError.message}`);

const { data: isAdmin, error: rpcError } = await pub.rpc("am_i_admin");
const adminCheck = rpcError ? `could not verify (${rpcError.message})` : isAdmin ? "yes" : "NO — this account is not an admin";

const { error: revokeError } = await pub.auth.signOut({ scope: "global" });

console.log("\n✔ Password updated.");
console.log(`  Admin check (am_i_admin): ${adminCheck}`);
console.log(`  Existing sessions revoked: ${revokeError ? `failed (${revokeError.message})` : "yes"}`);
if (generated) {
  console.log("\n  New password (shown once — store it in your password manager now):\n");
  console.log(`    ${newPassword}\n`);
  console.log("  Then clear this terminal (cls / clear).");
} else {
  console.log("\n  Your chosen password is now set (not echoed).");
}
