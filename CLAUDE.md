# Model roles
- Lead (main session, Opus): plans, writes the contract (endpoints, schema, who owns which files), hands work to the agents below one after another, runs the final checks, opens the PR, merges on green. Small one-layer changes it may do itself.
- `database` subagent (Opus): `server/schema.sql`, `server/migrate.js`, SQL/indexes, purge + test TRUNCATE, Neon cost.
- `backend` subagent (Sonnet 5.5): `server/**` (not the schema), `shared/**`, node:test tests.
- `frontend` subagent (Sonnet 5.5): `src/**`, `App.css` (never the chart print CSS), `public/sw.js`, impeccable design, headless probes.
- `advisor` subagent (Fable, read-only): reviews every non-trivial branch diff BEFORE the merge.
- `scraper` subagent (Sonnet 5.5, read-only): web scraping, doc lookups and broad searches.

Flow: lead contract → database (if the schema changes) → backend → frontend → lead checks (lint, tests, build, scratchpad/regress.sh) → advisor → PR → merge. Subagents never merge and cannot ask the user; only the lead does both.
