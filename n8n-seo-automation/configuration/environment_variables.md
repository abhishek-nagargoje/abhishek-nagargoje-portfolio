# Environment variables

The workflows do **not** read secrets from environment variables (`$env` is
blocked by default in n8n 2.x and is not used anywhere). The variables below
configure the **n8n instance** on the Hostinger VPS.

## n8n instance (docker-compose `environment:` or systemd unit)

| Variable | Recommended value | Why |
|---|---|---|
| `GENERIC_TIMEZONE` | `Asia/Kolkata` | Default timezone for Schedule triggers (each workflow also sets `settings.timezone = Asia/Kolkata`) |
| `TZ` | `Asia/Kolkata` | Container/system clock for logs |
| `N8N_ENCRYPTION_KEY` | long random string, **backed up** | Encrypts stored credentials. Losing it makes credentials unreadable |
| `DB_TYPE` / `DB_POSTGRESDB_*` | your n8n metadata DB | n8n's own database. It may be the same PostgreSQL server as the `seo` schema, but use a different database or role |
| `N8N_PROTOCOL`, `N8N_HOST`, `WEBHOOK_URL` | your HTTPS domain | Needed for the Google OAuth redirect URL |
| `N8N_RUNNERS_ENABLED` | default (`true` in 2.x) | Code nodes run in task runners; no special builtins are required |
| `EXECUTIONS_DATA_PRUNE` | `true` | Keeps execution history bounded |
| `EXECUTIONS_DATA_MAX_AGE` | `336` (hours) | Execution data retention |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `true` (default) | Keep `true`; nothing in these workflows needs `$env` |

No `NODE_FUNCTION_ALLOW_BUILTIN` / `NODE_FUNCTION_ALLOW_EXTERNAL` is needed. The
Code nodes do not `require()` anything; hashing uses the native Crypto node
and PostgreSQL `sha256()`.

## PostgreSQL network exposure

* Do **not** publish port 5432 to the internet. If n8n and PostgreSQL run in
  Docker on the same VPS, put both on a private Docker network and connect
  with the service name, for example `postgres`.
* If PostgreSQL runs on the host, bind it to `127.0.0.1` / the Docker bridge
  only (`listen_addresses`). Restrict `pg_hba.conf` to the n8n container
  network and use `scram-sha-256`.

## Example docker-compose fragment (no secrets inline)

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: seo
      POSTGRES_USER: seo_admin
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_admin_password
    volumes: [pgdata:/var/lib/postgresql/data]
    networks: [internal]          # no "ports:" -> not exposed publicly
    secrets: [pg_admin_password]
  n8n:
    image: docker.n8n.io/n8nio/n8n:2.44.6   # or the version you run; see N8N_IMPORT_GUIDE.md
    environment:
      GENERIC_TIMEZONE: Asia/Kolkata
      TZ: Asia/Kolkata
      N8N_ENCRYPTION_KEY_FILE: /run/secrets/n8n_encryption_key
    networks: [internal, web]
    secrets: [n8n_encryption_key]
networks: { internal: { internal: true }, web: {} }
secrets:
  pg_admin_password: { file: ./secrets/pg_admin_password }
  n8n_encryption_key: { file: ./secrets/n8n_encryption_key }
volumes: { pgdata: {} }
```

Keep `./secrets/` out of Git (add it to `.gitignore`).
