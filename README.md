# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Backups

The production database is backed up automatically once a day by
[`.github/workflows/backup.yml`](.github/workflows/backup.yml), which runs
`scripts/backup-db.sh` and uploads the resulting dump to a **private** Backblaze B2 bucket
(`cpa-db-backups`). This repo is public, so backups never touch the repo itself or GitHub
Actions artifacts — both are publicly downloadable on a public repo.

**One-time setup**, in the repo's Settings → Secrets and variables → Actions, add:

| Secret | Value |
|---|---|
| `DATABASE_URL` | Same connection string configured in the Render dashboard |
| `B2_KEY_ID` | A Backblaze application key ID, scoped to only the `cpa-db-backups` bucket |
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
