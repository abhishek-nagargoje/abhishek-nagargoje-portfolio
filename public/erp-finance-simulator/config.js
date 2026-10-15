// Finance ERP Training Simulator — runtime configuration.
//
// Leave both values empty to run in DEMO mode: the training account is checked
// in the browser and all data stays in the visitor's own browser storage.
//
// To use Supabase Authentication instead, fill in your project URL and its
// public anon/publishable key (both are safe to expose in a browser), then
// provision the training account with:
//   node --env-file-if-exists=.env.local scripts/provision-erp-training-user.mjs
//
// NEVER put a service-role / secret key in this file.
window.ERP_SIM_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
};
