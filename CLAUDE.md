# CLAUDE.md — Scholarship Radar

## What this is

A personal tool for one applicant targeting fully-funded MSc and PhD places for
the **2027/28 cycle**. Two halves in one repo:

- **Radar** (`watcher.py`) — hourly GitHub Actions job. Ingests scholarship and
  PhD-position alerts from a dedicated Gmail inbox (IMAP) and Google Alerts (RSS),
  filters them, pushes hits to Telegram and an email digest.
- **Board** (`web/funding-board.jsx`) — a persistent dashboard for tracking
  applications, referees, documents and credentials.

`PLAN.md` has the ordered task list. Start there.

## Context that should shape your suggestions

The owner has a bachelor's in computer engineering and no master's, works in
Ghana, and is interested in data science, data engineering, ML and networking.

Two constraints follow from that and come up constantly:

- **No master's yet.** Most European salaried PhD posts require one. US PhDs
  accept a bachelor's directly. Don't suggest features premised on holding an MSc.
- **Application fees are the binding constraint.** US applications cost $70–155
  each and most fee waivers are restricted to US citizens. European PhD posts and
  most scholarships are free to apply to. Any feature that helps identify free or
  fee-waived applications is high value.

## Hard constraints — do not violate

1. **No scraping of LinkedIn, X/Twitter, or Instagram.** Not a style preference.
   LinkedIn bans scrapers and has litigated it; X's API is paid. The email-alert
   route gets the same data through the front door. If asked for a scraper for
   these, push back and propose the email path.
2. **Everything stays inside free tiers.** No paid APIs, no always-on server, no
   managed database. GitHub Actions cron plus JSON files committed to the repo is
   the entire persistence layer.
3. **Recall over precision.** A false positive costs four seconds. A missed
   opportunity costs a year. When tuning filters, err toward letting things through.
4. **Never present an auto-extracted date as authoritative.** `sniff_deadline()`
   and `sniff_opens()` are regex over nearby text and are often wrong. Every
   surface showing one carries a visible "unverified" marker, and extracted
   dates never populate a target's `deadline`/`opensDate` field automatically.
   Do not remove these markers to tidy the UI. A tracker that confidently
   displays a wrong deadline is worse than one showing none.
5. **Seed data is unverified by default.** Entries in `data/` carry
   `verified: false` and empty `deadline` on purpose. Do not "helpfully" fill in
   plausible dates. The user flips `verified` to true after checking the official page.

## Architecture

```
watcher.py                  single entry point, runs once per invocation, exits
config.yaml                 all tuning — keywords, feeds, thresholds. Edit this, not the code.
data/seen.json              dedupe fingerprints, committed back by the Action
data/opportunities.json     rolling radar output, newest first
data/tg_offset.json         Telegram getUpdates cursor, committed back by the Action
data/targets.json           MANUAL export/commit from the dashboard's Profile tab — a
                             snapshot of tracked targets, not a live sync. remind() reads this.
data/reminders.json         fired-reminder keys (target id + milestone day), so each fires once
data/source-stats.json      per-source ingested/passed/tracked counts, accumulated across runs
data/seed-scholarships.json 9 hand-researched external scholarships (dashboard seed)
data/seed-us-phd.json       20 researched US PhD departments (dashboard seed)
web/funding-board.jsx       dashboard, persists via window.storage
.github/workflows/watch.yml hourly cron
```

Flow: `apply_telegram_callbacks()` → `ingest_gmail() + ingest_rss()` → `remind()` →
`assess()` → fingerprint dedupe → `telegram()` / `email_digest()` → write JSON.

### Invariants

- `fingerprint()` hashes `canonical(url)` so the same posting arriving via three
  newsletters alerts once.
- `canonical()` strips tracking params **and repairs the query string** when the
  stripped param carried the `?`. There is a fixed bug here; don't regress it.
- Rejected items are added to `seen` too, so they're never re-evaluated.
- `assess()` always requires a level term. A funding term is required too only
  when `require_funding_match: true` in `config.yaml` (default is `false`) —
  so plain "applications open"/deadline postings with no funding language
  still pass, scored lower than funded/fee-waived ones. This is deliberate:
  the owner wants deadlines for postgrad programs generally, not only funded
  ones, even though funded/fee-waived stays the priority.
- Gmail messages are marked `\Seen` after processing — that's the read cursor.
  Never process `ALL`; it will re-alert the entire inbox.
- Every dynamic string going into a `telegram()` call must pass through
  `esc()` first. Telegram's `parse_mode: "HTML"` parses the *entire* message,
  and an email `source` value is built from the raw `From` header — literally
  `Display Name <email@address>` — so an unescaped hit silently 400s on every
  single email-sourced item, forever, with `telegram()`'s own `except` block
  swallowing it unless you check the response status too (it doesn't raise on
  a non-200). This was found live: every test alert failed for this exact
  reason before the `esc()` fix went in.
- Telegram's inline Track/Dismiss buttons have no server to call back to. Each
  run starts with `apply_telegram_callbacks()`, which polls `getUpdates` with
  the offset saved in `data/tg_offset.json` as the read cursor — the same role
  `\Seen` plays for Gmail. A tap is only reflected in `opportunities.json`
  after the *next* scheduled run, not instantly.
- `remind()` only fires off a target's `deadline` when `verified: true`. This
  is the same rule as the auto-extracted-deadline constraint, applied to a
  different source: a target deadline the owner hasn't confirmed on the
  official page is still an unearned claim, and firing an automated Telegram
  countdown against it would be worse than showing nothing. Do not relax this
  to "fire for any date present" — that defeats the point of the `verified`
  field.
- Source stats only count a raw candidate toward `ingested`/`passed` the first
  time its fingerprint is seen (gated on `fp not in seen`, inside the existing
  dedupe loop). RSS feeds keep re-serving the same entries every poll; counting
  every poll would make "ingested" balloon per source with no signal in it.
  The `tracked` count only reflects Telegram Track taps — a target tracked
  from the dashboard's Inbox tab lives in `window.storage`, invisible to this
  process, same limitation as `data/targets.json` above.
- The dashboard persists through `window.storage`, **not** localStorage, which
  does not work in this environment.

## Secrets

`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`DIGEST_TO`. Never hardcode; never print in logs.

## Testing without credentials

`python watcher.py` runs clean with no secrets — Gmail skips, RSS skips empty URLs.

```python
import watcher as w
w.assess("Fully funded PhD in X", "Deadline: 30 September 2026")
    # (True, 8, ['funding: fully funded, funded phd', 'level: phd'], True)
w.assess("Postdoctoral researcher, funded", "")
    # (False, 0, ['excluded: postdoc'], False)
w.assess("PhD in Computer Science", "Applications open 1 September 2026. Deadline: 15 December 2026.")
    # (True, 4, [...'no funding signal (kept...)'...], False) — unfunded, still kept, scored lower
w.sniff_deadline("applications close 6 October 2026")               # '6 October 2026'
w.sniff_opens("applications open 1 September 2026")                 # '1 September 2026'
w.canonical("https://x.com/j/1?utm_source=mail&id=9")               # 'https://x.com/j/1?id=9'
```

Always smoke-test `assess()` against both a should-keep and a should-drop case
after touching the filter.

## Anti-goals

Do not add: a scraper framework, a task queue, Docker, a managed DB, user
accounts, login, multi-user support, or an LLM layer over the hits. This is a
single-user tool. Complexity here is pure cost against a hard deadline.
