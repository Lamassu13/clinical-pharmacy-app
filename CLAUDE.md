# Model roles
- Build (Opus): does all the work and edits code. When the session itself runs on another model, hand every build to an Opus agent (`general-purpose`, `model: opus`).
- Plan (Opus): plans and writes instructions before a build starts.
- Advisor (Fable, `advisor` subagent): consult before risky changes and for review of finished non-trivial changes.
- `scraper` subagent (Sonnet 5.5): delegate web scraping, doc lookups and broad searches to it.
