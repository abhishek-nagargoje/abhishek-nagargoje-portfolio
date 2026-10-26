#!/usr/bin/env bash
# Rebuilds the workflows, validates them, and packages the final deliverables
# into dist/n8n-seo-automation.zip (no secrets, no node_modules, no local state).
set -euo pipefail
cd "$(dirname "$0")/.."

node tools/build_workflows.js
node tools/validate_workflows.js > /dev/null

mkdir -p dist
rm -f dist/n8n-seo-automation.zip
zip -q -r -X dist/n8n-seo-automation.zip \
  README.md IMPLEMENTATION_REPORT.md package.json \
  workflows prompts database configuration documentation templates tools tests \
  -x '*/node_modules/*' -x '*.DS_Store' -x 'dist/*'

# refuse to ship anything that looks like a credential
# (count instead of grep -q: with pipefail, grep -q's early exit would SIGPIPE
#  unzip and turn a match into a false "clean" result)
hits=$(unzip -p dist/n8n-seo-automation.zip | grep -aEc 'AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z_-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----' || true)
if [ "${hits:-0}" -gt 0 ]; then
  echo "ERROR: possible secret found in package" >&2
  rm -f dist/n8n-seo-automation.zip
  exit 1
fi
unzip -l dist/n8n-seo-automation.zip | tail -1
echo "dist/n8n-seo-automation.zip"
