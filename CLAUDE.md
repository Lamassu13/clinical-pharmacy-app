# Model roles
- Build (Sonnet 5.5): does all the work and edits code.
- Plan (Opus): plans and writes instructions before a build starts.
- Advisor (Fable, `advisor` subagent): consult before risky changes and for review of finished non-trivial changes.
- `scraper` subagent (Haiku 5.5): delegate web scraping, doc lookups and broad searches to it.
