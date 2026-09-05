# Clinical Pharmacy App

A daily medication administration chart and pills-round form for a hospital ward, in Arabic
(RTL), built for staff using a shared iPad. Staff log doses per patient per medicine on a
scrolling grid; the same data drives a printable A4 chart and a per-patient pills
administration form.

## Stack

- **Frontend:** React 19 + Vite, no router — a handful of screens toggled by state in
  `src/App.jsx`.
- **Backend:** Express 5 + `pg`, session-based auth (`express-session` + `connect-pg-simple`)
  in `server/`.
- **Database:** Postgres. Production uses [Neon](https://neon.tech) — an external database,
  not Render's own Postgres add-on.
- **Hosting:** Render, one web service. Express serves both the API and the built frontend
  from the same origin in production (`server/index.js` serves `dist/`).

## Local setup

Prerequisites: Node 22, and a Postgres database — either a local instance or a free Neon
project both work the same way.

```sh
npm install
cp .env.example .env
# edit .env: point DATABASE_URL at your database, set a real SESSION_SECRET
npm run db:init
npm run create-admin "Your Name" yourusername you@example.com 0700000000 0001 yourpassword
```

`db:init` creates the schema and seeds the starter medicine list (only if the medicines table
is empty); `create-admin` bootstraps your first login. Then run the frontend and backend in
two terminals:

```sh
npm run server:dev   # Express on :3001, restarts on file changes
npm run dev           # Vite on :5173 — open this one in the browser
```

The frontend talks to `http://localhost:3001/api` automatically in dev (see `VITE_API_URL`
below to override it). CORS and the CSRF check are locked to `CLIENT_ORIGIN` in `.env`, so it
has to match whatever origin you actually open in the browser.

To run it the way production does instead — one server, one origin, no separate dev server:

```sh
npm run build && npm run server
```

## Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | server | Postgres connection string. |
| `DATABASE_SSL` | server | `true` in production — Neon requires TLS. Leave `false` for a local Postgres without SSL configured. |
| `DATABASE_POOL_SIZE` | server | Max pooled connections. |
| `PORT` | server | Port Express listens on. |
| `CLIENT_ORIGIN` | server | Exact origin allowed by CORS and the CSRF check — must match where the frontend is actually served from. |
| `SESSION_SECRET` | server | Signs session cookies. **Required in production** — the server refuses to boot without it (a public fallback would let anyone forge a session). Render auto-generates one; set your own locally if you want sessions to survive a server restart. |
| `VITE_API_URL` | frontend, build-time | Overrides the default API base (`http://localhost:3001/api` in dev, `/api` in production). Only needed if frontend and backend won't share the origin the default assumes. |
| `BCRYPT_COST` | `create-admin` / `reset-admin` scripts | Password hashing cost factor. Defaults to 10. |
| `ADMIN_PASSWORD` | `reset-admin` script only | Not read by the server itself — set it in your shell right before running the script. |

## Common tasks

| Task | Command |
|---|---|
| Create the first admin account | `npm run create-admin "Full Name" username email phone fingerprint password` |
| Reset a locked-out admin's password | `ADMIN_PASSWORD=newpass npm run reset-admin username` |
| Apply a schema change | `npm run db:init` — safe to re-run; every statement is additive (`CREATE ... IF NOT EXISTS` / `ALTER ... ADD COLUMN IF NOT EXISTS`), nothing destructive |
| Run the test suite | `npm test` — see **Tests** below for one-time local setup |
| Lint | `npm run lint` |
| Manual, on-demand database backup | `npm run db:backup` — see **Backups** below for the automatic daily one |

## Tests

`server/*.test.js` are two kinds of test in one suite: `validation.test.js` checks pure
functions with no I/O, while `auth.test.js` and `chart.test.js` boot the real Express app on
an ephemeral port and drive it with real HTTP requests (login, save a chart, hit a 409
conflict, etc.) against a real Postgres database — not a mock.

That database must be a **separate, empty-is-fine local database**, never your real dev or
production one — the suite truncates every table before each test. One-time setup:

```bash
createdb -O clinical_pharmacy clinical_pharmacy_test   # run as a Postgres superuser
cp .env.test.example .env.test                          # then fill in your local DB password
```

`npm test` picks up `.env.test` automatically (via `pretest`, which also applies the schema)
and refuses to run against any database whose name doesn't contain `clinical_pharmacy_test`,
as a safety net against a copy-paste mistake pointing it at the wrong `DATABASE_URL`.

CI (`.github/workflows/ci.yml`) doesn't need this file — it starts its own disposable Postgres
container for the same job.

## Deployment

Render auto-deploys every push to `main` (`render.yaml`). `buildCommand` runs `npm ci`,
`vite build`, then `db:init` — a schema change ships in the same deploy that needs it, rather
than on server start, so a migration failure fails the deploy instead of taking a live
instance down (see the comment above `buildCommand` in `render.yaml`).

`.github/workflows/ci.yml` runs lint, a syntax check on the server files, the test suite, and
a production build on every push and PR to `main`. Nothing currently stops Render from
deploying a push whose CI run is red — there's no confirmed GitHub branch protection rule —
so treat a red CI run as a hard stop by convention, not one GitHub enforces yet.

Required in the Render dashboard's environment variables: `DATABASE_URL` (a Neon connection
string, not Render's own Postgres) and `CLIENT_ORIGIN`. `SESSION_SECRET` is generated
automatically by `render.yaml`.

## Backups

The production database is backed up automatically once a day by
[`.github/workflows/backup.yml`](.github/workflows/backup.yml), which runs
`scripts/backup-db.sh` and uploads the resulting dump to a **private** Backblaze B2 bucket
(`clinical-pharmacy-db-backup`). This repo is public, so backups never touch the repo itself
or GitHub Actions artifacts — both are publicly downloadable on a public repo.

**One-time setup**, in the repo's Settings → Secrets and variables → Actions, add:

| Secret | Value |
|---|---|
| `DATABASE_URL` | Same connection string configured in the Render dashboard |
| `B2_KEY_ID` | A Backblaze application key ID, scoped to only the `clinical-pharmacy-db-backup` bucket |
| `B2_APPLICATION_KEY` | The matching application key |

The bucket needs a lifecycle rule (set in Backblaze's bucket settings) to expire files after
30 days — that caps storage growth without any pruning code to maintain. You can also trigger
a backup on demand from the Actions tab ("Backup database" → Run workflow).

**Restoring** a downloaded dump:

```sh
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" cpa-YYYYMMDD.dump
```

For a manual, ad-hoc backup from your own machine instead of waiting for the daily job, see
`npm run db:backup` (`scripts/backup-db.sh`).
