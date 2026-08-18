#!/usr/bin/env python3
"""
Funding Radar — ingest, filter, notify.

Sources:
  1. Gmail inbox (IMAP)  -> the alert emails you subscribed to
  2. RSS feeds          -> Google Alerts + any real feed you find

Outputs:
  - Telegram push for each new hit
  - Email digest of the run
  - data/opportunities.json (feeds the dashboard)
  - data/seen.json (dedupe state, committed back by the Action)
"""

import os
import re
import json
import time
import email
import imaplib
import smtplib
import hashlib
import pathlib
from email.header import decode_header, make_header
from email.mime.text import MIMEText
from datetime import datetime, timezone

import yaml
import requests
import feedparser

ROOT = pathlib.Path(__file__).parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
SEEN_PATH = DATA / "seen.json"
OPPS_PATH = DATA / "opportunities.json"
TARGETS_PATH = DATA / "targets.json"
REMINDERS_PATH = DATA / "reminders.json"
SOURCE_STATS_PATH = DATA / "source-stats.json"

CFG = yaml.safe_load((ROOT / "config.yaml").read_text())

GMAIL_USER = os.environ.get("GMAIL_USER", "")
GMAIL_PASS = os.environ.get("GMAIL_APP_PASSWORD", "")
TG_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT = os.environ.get("TELEGRAM_CHAT_ID", "")
DIGEST_TO = os.environ.get("DIGEST_TO", GMAIL_USER)

MAX_TELEGRAM_PER_RUN = int(CFG.get("max_telegram_per_run", 12))
KEEP_OPPS = int(CFG.get("keep_opportunities", 400))


# ----------------------------------------------------------------- utilities

def log(msg):
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def load_seen():
    if SEEN_PATH.exists():
        try:
            return set(json.loads(SEEN_PATH.read_text()))
        except Exception:
            return set()
    return set()


def save_seen(seen):
    # keep the file from growing forever
    trimmed = list(seen)[-8000:]
    SEEN_PATH.write_text(json.dumps(trimmed, indent=0))


def load_source_stats():
    if SOURCE_STATS_PATH.exists():
        try:
            return json.loads(SOURCE_STATS_PATH.read_text())
        except Exception:
            return {}
    return {}


def save_source_stats(stats):
    SOURCE_STATS_PATH.write_text(json.dumps(stats, indent=1, sort_keys=True))


def bump_stat(stats, source, field):
    row = stats.setdefault(source, {"ingested": 0, "passed": 0, "tracked": 0})
    row[field] = row.get(field, 0) + 1


def fingerprint(url, title):
    """Dedupe on the destination, falling back to the title."""
    basis = (canonical(url) or title or "").strip().lower()
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:16]


def canonical(url):
    """Strip tracking junk so the same posting doesn't alert twice."""
    if not url:
        return ""
    url = re.sub(r"[?&](utm_[^=]+|mc_cid|mc_eid|ref|source|fbclid|gclid)=[^&]*", "", url)
    # If we removed the param that carried the "?", promote the next "&".
    if "?" not in url and "&" in url:
        url = url.replace("&", "?", 1)
    return url.rstrip("?&/")


def clean(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = re.sub(r"&[a-z]+;", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def decode_subject(raw):
    try:
        return str(make_header(decode_header(raw or "")))
    except Exception:
        return raw or ""


# ------------------------------------------------------------------ scoring

def norm_terms(key):
    return [t.lower() for t in CFG.get(key, [])]


FUNDING = norm_terms("funding_terms")
LEVEL = norm_terms("level_terms")
FIELD = norm_terms("field_terms")
BLOCK = norm_terms("exclude_terms")


def assess(title, body):
    """Return (keep: bool, score: int, reasons: list[str], funded: bool).

    Level is always a hard gate. Funding is a hard gate only when
    require_funding_match is set in config.yaml (default off) — otherwise
    unfunded postgrad postings pass through too, just scored lower than
    funded ones, per the recall-over-precision rule in CLAUDE.md.
    """
    blob = f"{title} {body}".lower()

    for bad in BLOCK:
        if bad in blob:
            return False, 0, [f"excluded: {bad}"], False

    hits_funding = [t for t in FUNDING if t in blob]
    hits_level = [t for t in LEVEL if t in blob]
    hits_field = [t for t in FIELD if t in blob]
    funded = bool(hits_funding)

    if not hits_level:
        return False, 0, ["no level signal"], False
    if CFG.get("require_funding_match", False) and not funded:
        return False, 0, ["no funding signal"], False

    if CFG.get("require_field_match", False) and not hits_field:
        return False, 0, ["no field signal"], False

    score = len(hits_funding) * 2 + len(hits_field) * 3 + len(hits_level)
    if funded:
        score += 3  # keep funded/fee-waived postings sorting above equivalent unfunded ones
    reasons = []
    if hits_funding:
        reasons.append("funding: " + ", ".join(hits_funding[:3]))
    else:
        reasons.append("no funding signal (kept — funding not required)")
    if hits_field:
        reasons.append("field: " + ", ".join(hits_field[:3]))
    if hits_level:
        reasons.append("level: " + ", ".join(hits_level[:2]))
    return True, score, reasons, funded


DATE_PAT = re.compile(
    r"\b(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+20\d{2}"
    r"|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2}"
    r"|\d{4}-\d{2}-\d{2}"
    r"|\d{1,2}/\d{1,2}/20\d{2})\b",
    re.I,
)


def sniff_deadline(text):
    """Best-effort deadline pull. Advisory only — always verify on the page."""
    lowered = (text or "").lower()
    for cue in ("deadline", "closes", "closing date", "apply by", "applications close"):
        i = lowered.find(cue)
        if i == -1:
            continue
        window = text[i : i + 160]
        m = DATE_PAT.search(window)
        if m:
            return m.group(0)
    return ""


def sniff_opens(text):
    """Best-effort application-open-date pull. Advisory only — always verify on the page."""
    lowered = (text or "").lower()
    for cue in (
        "applications open",
        "application opens",
        "opens on",
        "opening date",
        "now accepting applications",
        "accepting applications from",
    ):
        i = lowered.find(cue)
        if i == -1:
            continue
        window = text[i : i + 160]
        m = DATE_PAT.search(window)
        if m:
            return m.group(0)
    return ""


# ------------------------------------------------------------------- ingest

HREF = re.compile(r'href=["\'](https?://[^"\'>]+)["\']', re.I)
JUNK_LINK = re.compile(
    r"(unsubscribe|preferences|privacy|facebook|twitter|x\.com|instagram|linkedin\.com/help"
    r"|\.png|\.jpg|\.gif|mailto:|googleusercontent|list-manage\.com/track)",
    re.I,
)


def body_of(msg):
    parts = []
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            if ctype in ("text/plain", "text/html"):
                try:
                    payload = part.get_payload(decode=True) or b""
                    parts.append(payload.decode(part.get_content_charset() or "utf-8", "ignore"))
                except Exception:
                    continue
    else:
        try:
            payload = msg.get_payload(decode=True) or b""
            parts.append(payload.decode(msg.get_content_charset() or "utf-8", "ignore"))
        except Exception:
            pass
    return "\n".join(parts)


def ingest_gmail():
    """Read unseen mail from the alerts folder. Each email may hold many postings."""
    items = []
    if not (GMAIL_USER and GMAIL_PASS):
        log("gmail: no credentials, skipping")
        return items

    folder = CFG.get("gmail_folder", "INBOX")
    try:
        M = imaplib.IMAP4_SSL("imap.gmail.com")
        M.login(GMAIL_USER, GMAIL_PASS)
        M.select(f'"{folder}"')
        typ, nums = M.search(None, "UNSEEN")
        ids = nums[0].split()
        log(f"gmail: {len(ids)} unread in {folder}")

        for num in ids[-60:]:
            typ, data = M.fetch(num, "(RFC822)")
            if typ != "OK" or not data or not data[0]:
                continue
            msg = email.message_from_bytes(data[0][1])
            subject = decode_subject(msg.get("Subject"))
            sender = decode_subject(msg.get("From"))
            raw = body_of(msg)
            text = clean(raw)

            links = []
            for u in HREF.findall(raw):
                if JUNK_LINK.search(u):
                    continue
                u = canonical(u)
                if u and u not in links:
                    links.append(u)

            # One alert email usually bundles several postings. Emit each link
            # as a candidate, carrying the surrounding text for scoring.
            if links:
                for u in links[: CFG.get("max_links_per_email", 15)]:
                    items.append(
                        {
                            "title": subject,
                            "url": u,
                            "source": f"email · {sender[:60]}",
                            "body": text[:1200],
                        }
                    )
            else:
                items.append(
                    {"title": subject, "url": "", "source": f"email · {sender[:60]}", "body": text[:1200]}
                )
            M.store(num, "+FLAGS", "\\Seen")

        M.close()
        M.logout()
    except Exception as e:
        log(f"gmail error: {e}")
    return items


def ingest_rss():
    items = []
    for feed in CFG.get("rss_feeds", []):
        url = feed.get("url") if isinstance(feed, dict) else feed
        name = feed.get("name", url) if isinstance(feed, dict) else url
        if not url or url.startswith("PASTE"):
            continue
        try:
            parsed = feedparser.parse(url)
            log(f"rss: {name} -> {len(parsed.entries)} entries")
            for e in parsed.entries[:60]:
                items.append(
                    {
                        "title": clean(getattr(e, "title", "")),
                        "url": canonical(getattr(e, "link", "")),
                        "source": f"rss · {name}",
                        "body": clean(getattr(e, "summary", "")),
                    }
                )
        except Exception as ex:
            log(f"rss error {name}: {ex}")
        time.sleep(0.5)
    return items


# ---------------------------------------------------------------- notifying

TG_OFFSET_PATH = DATA / "tg_offset.json"


def telegram(text, reply_markup=None):
    if not (TG_TOKEN and TG_CHAT):
        return
    payload = {
        "chat_id": TG_CHAT,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": False,
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup
    try:
        requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json=payload,
            timeout=20,
        )
    except Exception as e:
        log(f"telegram error: {e}")


def track_dismiss_keyboard(fingerprint):
    return {
        "inline_keyboard": [
            [
                {"text": "✅ Track", "callback_data": f"t:{fingerprint}"},
                {"text": "✖ Dismiss", "callback_data": f"d:{fingerprint}"},
            ]
        ]
    }


def apply_telegram_callbacks():
    """Poll queued Track/Dismiss button taps and apply them to opportunities.json.

    No server: this cron run IS the callback receiver. The offset file is the
    read cursor, same role \\Seen plays for Gmail — advancing it is what stops
    Telegram from redelivering an update we already saw.
    """
    if not (TG_TOKEN and TG_CHAT):
        return

    offset = 0
    if TG_OFFSET_PATH.exists():
        try:
            offset = json.loads(TG_OFFSET_PATH.read_text()).get("offset", 0)
        except Exception:
            offset = 0

    try:
        r = requests.get(
            f"https://api.telegram.org/bot{TG_TOKEN}/getUpdates",
            params={"offset": offset, "timeout": 0},
            timeout=20,
        )
        updates = r.json().get("result", [])
    except Exception as e:
        log(f"telegram getUpdates error: {e}")
        return

    if not updates:
        return

    decisions = {}  # fingerprint -> "t" | "d"
    max_id = offset - 1
    for u in updates:
        max_id = max(max_id, u["update_id"])
        cq = u.get("callback_query")
        if not cq:
            continue
        data = cq.get("data", "")
        if ":" not in data:
            continue
        action, fp = data.split(":", 1)
        if action in ("t", "d"):
            decisions[fp] = action
        try:
            requests.post(
                f"https://api.telegram.org/bot{TG_TOKEN}/answerCallbackQuery",
                json={"callback_query_id": cq["id"]},
                timeout=10,
            )
        except Exception:
            pass

    if decisions and OPPS_PATH.exists():
        try:
            opps = json.loads(OPPS_PATH.read_text())
        except Exception:
            opps = []
        stats = load_source_stats()
        changed = False
        for o in opps:
            action = decisions.get(o.get("id"))
            if action == "t":
                o["status"] = "Tracked"
                bump_stat(stats, o.get("source", "unknown"), "tracked")
                changed = True
            elif action == "d":
                o["status"] = "Dismissed"
                changed = True
        if changed:
            OPPS_PATH.write_text(json.dumps(opps, indent=1))
            save_source_stats(stats)
        log(f"telegram: applied {len(decisions)} triage decision(s)")

    TG_OFFSET_PATH.write_text(json.dumps({"offset": max_id + 1}))


def email_digest(hits):
    if not hits or not (GMAIL_USER and GMAIL_PASS and DIGEST_TO):
        return
    rows = []
    for h in hits:
        dl = f"<br><b>Deadline seen:</b> {h['deadline']} (unverified)" if h["deadline"] else ""
        op = f"<br><b>Opens seen:</b> {h['opens']} (unverified)" if h.get("opens") else ""
        tag = " · 💰 funded" if h.get("funded") else " · no funding signal"
        rows.append(
            f"<li style='margin-bottom:14px'>"
            f"<a href='{h['url']}'>{h['title']}</a><br>"
            f"<span style='color:#666;font-size:12px'>{h['source']} · score {h['score']}{tag}</span>"
            f"{dl}{op}</li>"
        )
    html = (
        f"<h2>Funding Radar — {len(hits)} new</h2>"
        f"<ul style='font-family:sans-serif;font-size:14px'>{''.join(rows)}</ul>"
        f"<p style='color:#888;font-size:12px'>Dates are auto-extracted and often wrong. "
        f"Always confirm on the official page.</p>"
    )
    msg = MIMEText(html, "html", "utf-8")
    msg["Subject"] = f"Funding Radar: {len(hits)} new opportunit{'y' if len(hits)==1 else 'ies'}"
    msg["From"] = GMAIL_USER
    msg["To"] = DIGEST_TO
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
            s.login(GMAIL_USER, GMAIL_PASS)
            s.send_message(msg)
        log("digest sent")
    except Exception as e:
        log(f"digest error: {e}")


# --------------------------------------------------------------- reminders

MILESTONE_DAYS = (30, 14, 7, 3, 1)
REMIND_SKIP_STATUSES = {"Submitted", "Accepted", "Rejected"}


def load_reminders():
    if REMINDERS_PATH.exists():
        try:
            return set(json.loads(REMINDERS_PATH.read_text()))
        except Exception:
            return set()
    return set()


def save_reminders(fired):
    REMINDERS_PATH.write_text(json.dumps(sorted(fired), indent=0))


def remind():
    """Remind about deadlines on tracked targets, not just new discoveries.

    Targets live in the dashboard's window.storage, which this process can't
    reach — data/targets.json is a manual export/commit from the dashboard's
    Profile tab, a snapshot rather than a live sync. Only a target with
    verified: true ever fires: an unconfirmed deadline is exactly the false
    confidence the deadline constraint in CLAUDE.md exists to prevent, and
    that applies just as much to a reminder as to a display marker.
    """
    if not TARGETS_PATH.exists():
        log("remind: no data/targets.json yet, skipping")
        return

    try:
        targets = json.loads(TARGETS_PATH.read_text())
    except Exception as e:
        log(f"remind: bad targets.json: {e}")
        return

    fired = load_reminders()
    today = datetime.now(timezone.utc).date()
    new_fires = []

    for t in targets:
        if t.get("status") in REMIND_SKIP_STATUSES:
            continue
        if t.get("rolling") or not t.get("verified") or not t.get("deadline"):
            continue
        try:
            deadline = datetime.strptime(t["deadline"], "%Y-%m-%d").date()
        except ValueError:
            continue

        days = (deadline - today).days
        if days not in MILESTONE_DAYS:
            continue

        key = f"{t.get('id', t.get('name'))}:{days}"
        if key in fired:
            continue

        telegram(
            f"⏰ <b>{days} day{'s' if days != 1 else ''} left</b> — {t.get('name', '(untitled target)')}\n"
            f"Deadline: {t['deadline']} · {t.get('institution', '')}"
        )
        new_fires.append(key)

    if new_fires:
        save_reminders(fired | set(new_fires))
        log(f"remind: fired {len(new_fires)} reminder(s)")


# -------------------------------------------------------------------- main

def main():
    apply_telegram_callbacks()

    seen = load_seen()
    raw = ingest_gmail() + ingest_rss()
    log(f"ingested {len(raw)} raw candidates")

    remind()

    stats = load_source_stats()
    hits, fresh_ids = [], []
    for it in raw:
        fp = fingerprint(it["url"], it["title"])
        if fp in seen:
            continue  # already counted on a prior run — don't inflate stats via re-polling
        bump_stat(stats, it["source"], "ingested")
        keep, score, reasons, funded = assess(it["title"], it["body"])
        if not keep:
            seen.add(fp)  # never reconsider a rejected item
            continue
        bump_stat(stats, it["source"], "passed")
        hits.append(
            {
                "id": fp,
                "title": it["title"][:200] or "(no subject)",
                "url": it["url"],
                "source": it["source"],
                "score": score,
                "reasons": reasons,
                "funded": funded,
                "deadline": sniff_deadline(it["body"]),
                "opens": sniff_opens(it["body"]),
                "found": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "status": "New",
            }
        )
        fresh_ids.append(fp)

    save_source_stats(stats)
    hits.sort(key=lambda h: -h["score"])
    log(f"{len(hits)} passed the filter")

    for h in hits[:MAX_TELEGRAM_PER_RUN]:
        dl = f"\n<b>Deadline seen:</b> {h['deadline']} (unverified)" if h["deadline"] else ""
        op = f"\n<b>Opens seen:</b> {h['opens']} (unverified)" if h.get("opens") else ""
        tag = " · 💰 funded" if h.get("funded") else " · no funding signal"
        telegram(
            f"<b>{h['title'][:120]}</b>\n"
            f"<i>{h['source'][:70]}</i> · score {h['score']}{tag}{dl}{op}\n"
            f"{h['url']}",
            reply_markup=track_dismiss_keyboard(h["id"]),
        )
        time.sleep(0.4)

    if len(hits) > MAX_TELEGRAM_PER_RUN:
        telegram(f"…and {len(hits) - MAX_TELEGRAM_PER_RUN} more in the email digest.")

    email_digest(hits)

    existing = []
    if OPPS_PATH.exists():
        try:
            existing = json.loads(OPPS_PATH.read_text())
        except Exception:
            existing = []
    OPPS_PATH.write_text(json.dumps((hits + existing)[:KEEP_OPPS], indent=1))

    seen.update(fresh_ids)
    save_seen(seen)
    log(f"done — {len(hits)} new, {len(seen)} fingerprints tracked")


if __name__ == "__main__":
    main()
