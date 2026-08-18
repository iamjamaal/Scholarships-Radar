# BUILD PLAN

Work through these in order. Each task is self-contained and has an acceptance
check. Do not start a task until the one before it passes.

**Read `CLAUDE.md` first.** It contains constraints that are not negotiable.

---

## Status

| # | Task | State |
|---|---|---|
| 0 | Watcher pipeline (`watcher.py`) | ✅ done, tested |
| 1 | GitHub Actions schedule | ✅ done, untested live |
| 2 | Dashboard shell (`web/funding-board.jsx`) | ✅ done |
| 3 | Deploy + secrets | ⬜ human, not Claude Code |
| 4 | Extract seed data from the component | ✅ done |
| 5 | Wire dashboard to radar output | ✅ done |
| 6 | Triage: promote a hit into a tracked target | ✅ done |
| 7 | Telegram inline triage buttons | ✅ done |
| 8 | Deadline reminder pass | ✅ done |
| 9 | Source hit-rate stats | ✅ done |

---

## Task 3 — Deploy (human, do this first)

Not a coding task, but nothing downstream is testable until it's done.
Follow `README.md`: dedicated Gmail + app password, Telegram bot, Google Alerts
RSS URLs into `config.yaml`, push to GitHub, add the five secrets, run the
workflow manually once.

**Accept when:** a manual workflow run completes green and a Telegram message
arrives.

---

## Task 4 — Extract seed data from the component

`web/funding-board.jsx` currently hardcodes a `SEED` object with ~10 scholarship
entries. `data/seed-us-phd.json` holds 20 more (US PhD departments), already in
the same schema.

- Move the inline `SEED.targets` array out to `data/seed-scholarships.json`.
- Have the component load both JSON files on first run when storage is empty.
- Keep `profile`, `docs` and `credentials` seeds inline — they're small.
- Do not change the target schema. Both files already match it.

**Accept when:** a first-load with empty storage shows ~30 targets, and
`git diff` on the component shows no schema changes.

---

## Task 5 — Wire dashboard to radar output

The watcher writes `data/opportunities.json`. The dashboard doesn't read it yet.

- Add an **Inbox** tab that fetches `data/opportunities.json`.
- Show newest first: title, source, score, extracted deadline, link.
- Every extracted deadline must render with a visible "unverified" marker.
  See constraint 4 in `CLAUDE.md` — do not remove this to tidy the UI.
- Empty state: explain that the radar hasn't found anything yet and link to the
  Actions tab, rather than showing a bare "no results".

**Accept when:** dropping a hand-written `opportunities.json` with 3 fake entries
renders 3 inbox rows, each showing its unverified marker.

---

## Task 6 — Triage: promote a hit into a tracked target

The join between the two halves. Currently the radar finds things and the tracker
tracks things, with a human retyping in between.

- On each inbox row: **Track** and **Dismiss**.
- **Track** creates a target from the hit — prefill name, url, source. Leave
  `deadline` EMPTY and `verified: false`; the user types the real deadline after
  checking the official page. Do not auto-fill the extracted deadline into the
  target's deadline field. Put it in `notes` as "radar saw: <date> (unverified)".
- **Dismiss** hides the row locally. It does not need to reach the backend.
- Store triage state in the same `window.storage` key as everything else.

**Accept when:** tracking a hit produces a target with an empty deadline and the
extracted date visible only in notes.

---

## Task 7 — Telegram inline triage buttons

Reduce phone-to-laptop friction.

- Add `reply_markup` inline keyboard to `telegram()`: **Track** / **Dismiss**.
- Callback data: `t:<fingerprint>` / `d:<fingerprint>`.
- Requires a callback receiver. **Do not stand up a server for this** —
  poll `getUpdates` at the start of each watcher run and apply queued decisions
  to `data/opportunities.json`. Stateless, fits the existing cron model.

**Accept when:** tapping Track on a phone marks that item tracked in the JSON
after the next scheduled run.

---

## Task 8 — Deadline reminder pass

The radar only alerts on *discovery*. It never reminds you about a deadline you
already know about — which is the more likely way to lose a scholarship.

- New function `remind()` in `watcher.py`, running after ingest.
- Read tracked targets, compute days remaining.
- Fire Telegram at 30, 14, 7, 3 and 1 days out.
- Record fired reminders in `data/reminders.json` so each fires once.
- Skip targets with `status` of Submitted, Accepted or Rejected.

**Resolved design note:** targets live in the dashboard's `window.storage`,
which the watcher process can't reach — there's no server bridging the two
halves, by design. `data/targets.json` is a manual export (Profile tab →
"Export targets for radar") that the owner commits whenever targets or
deadlines change; it's a snapshot, not a live sync. `remind()` additionally
only fires for `verified: true` targets — an unconfirmed deadline is the same
false-confidence risk the auto-extracted-deadline constraint already guards
against.

**Accept when:** a target dated 7 days out fires exactly one reminder across two
consecutive runs.

---

## Task 9 — Source hit-rate stats

So you can retire feeds that only produce noise.

- Track per-source counts: ingested, passed filter, tracked by the user.
- Write `data/source-stats.json`; surface a small table in the dashboard.

**Resolved design note:** "ingested" and "passed" only count a fingerprint the
first time it's seen, so RSS feeds re-serving the same entries every poll
don't inflate the numbers. "Tracked" only reflects Telegram Track taps —
tracking from the dashboard's Inbox tab happens in `window.storage`, which
this process can't see, same limitation noted on Task 8.

**Accept when:** stats show non-zero counts for at least two distinct sources.

---

## Deliberately not building

Recorded so they don't get proposed again: LinkedIn/X/Instagram scrapers, user
accounts, a hosted backend, Docker, a managed database, a mobile app, multi-user
support, an LLM summarisation layer over the hits.

## When to stop

This tool exists to buy time for applications, not to consume it. Tasks 4–6 are
the ones that matter. Tasks 7–9 are optional polish. **If US PhD deadlines are
under six weeks away and 7–9 aren't done, leave them undone.**
