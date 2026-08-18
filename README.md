# Funding Radar

Hourly watcher for fully-funded MSc and PhD opportunities. Runs on GitHub Actions.
No server, no hosting bill, nothing to keep alive.

```
Gmail alerts (IMAP) ─┐
                     ├─► filter ─► dedupe ─► Telegram push
Google Alerts (RSS) ─┘                   └─► email digest
                                         └─► data/opportunities.json
```

## Why email is the primary source

Euraxess, jobs.ac.uk, FindAPhD, Nature Careers and LinkedIn all removed or never had
usable public feeds — but every one of them will **email** you. You subscribe once,
then read your own inbox over IMAP. Nothing is scraped, nothing violates ToS, and
nothing breaks when a site redesigns its HTML.

Google Alerts covers the rest of the open web. You are renting Google's crawler.

---

## Setup — about 40 minutes, once

### 1. Dedicated Gmail

Make a fresh account (`yourname.radar@gmail.com`). Keeping alerts out of your real
inbox is what makes the IMAP read safe — the watcher marks messages as read.

Turn on 2-Step Verification, then create an **App Password**
(Google Account → Security → App passwords). That 16-character string is
`GMAIL_APP_PASSWORD`. Your normal password will not work over IMAP.

Enable IMAP: Gmail → Settings → Forwarding and POP/IMAP → Enable IMAP.

### 2. Telegram bot

1. Message **@BotFather**, send `/newbot`, follow prompts → you get a token.
2. Send any message to your new bot.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `result[0].message.chat.id`.

Token → `TELEGRAM_BOT_TOKEN`. Chat id → `TELEGRAM_CHAT_ID`.

### 3. Google Alerts → RSS

At [google.com/alerts](https://www.google.com/alerts), create alerts and set
**Deliver to: RSS feed**. Copy each feed URL into `config.yaml`.

Query patterns that work well:

```
"fully funded" PhD 2027 <your subfield>
"fully funded" masters scholarship 2027 international students
PhD position <your subfield> stipend site:.edu
scholarship 2027 <your subfield> deadline
```

### 4. Subscribe to the email sources

Log in to each and create a saved-search alert delivered to the radar Gmail.
The checklist is at the bottom of `config.yaml`. **Euraxess and FindAPhD are the
two that matter most** — do those first.

### 5. Deploy

```bash
git init && git add . && git commit -m "funding radar"
gh repo create funding-radar --private --source=. --push
```

Then Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `GMAIL_USER` | radar gmail address |
| `GMAIL_APP_PASSWORD` | the 16-char app password |
| `TELEGRAM_BOT_TOKEN` | from BotFather |
| `TELEGRAM_CHAT_ID` | from getUpdates |
| `DIGEST_TO` | where digests land — your *real* email |

Actions tab → **Funding Radar** → *Run workflow* to test immediately.

### 6. Tune

Edit `field_terms` in `config.yaml` to your actual subfield. This is the single
highest-leverage change in the repo. Run for a few days with
`require_field_match: false`, see what noise arrives, then tighten.

---

## Free-tier notes

- **Private repo:** 2,000 Action minutes/month free. Hourly ≈ 720 runs ≈ 720 min. Fits.
- **Public repo:** unlimited minutes. Secrets stay encrypted either way, but
  `data/opportunities.json` becomes public. Harmless, and it removes the minute ceiling.
- **The 60-day rule:** GitHub disables scheduled workflows on repos with no activity
  for 60 days. The watcher's own commits generally keep it alive, but check the Actions
  tab monthly.
- Cron on Actions is best-effort. Runs can drift 5–20 minutes under load. Irrelevant
  for deadlines measured in weeks.

## Honest limits

- **Auto-extracted deadlines are frequently wrong.** They're a prompt to go look,
  never a source of truth. Confirm every one on the official page.
- **No LinkedIn, X, or Instagram scraping.** LinkedIn bans scrapers and has litigated
  it; X's API now costs real money. LinkedIn *job alert emails* give you the same data
  through the front door.
- **Recall beats precision here.** Better to see 30 items and dismiss 25 than to miss
  the one that mattered. Loosen the filters if the flow ever goes quiet.
- **This finds openings. It does not write applications.** Guard that distinction —
  the tool is only worth it if it buys you drafting time rather than eating it.
