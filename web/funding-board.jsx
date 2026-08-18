import React, { useState, useEffect, useMemo } from "react";

/* ============================================================
   FUNDING BOARD — a departures board for grad school money.
   Persists via window.storage. Single user, single key.
   ============================================================ */

const KEY = "fundingboard:v1";

const STATUSES = [
  "Watching",
  "Researching",
  "Supervisor contacted",
  "Drafting",
  "Ready",
  "Submitted",
  "Interview",
  "Accepted",
  "Rejected",
];

const LIVE_STATUSES = ["Watching", "Researching", "Supervisor contacted", "Drafting", "Ready"];

const DOC_TYPES = [
  "SOP / Motivation letter",
  "Research proposal",
  "CV",
  "Transcripts",
  "Letters of recommendation",
  "English test",
  "GRE",
  "Portfolio / Publications",
];

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const daysUntil = (iso) => {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return null;
  return Math.round((d - today()) / 86400000);
};

const fmt = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- seed ---------- */

const SEED = {
  profile: {
    name: "",
    citizenship: "",
    workExpYears: 0,
    hasMsc: false,
    englishTestValid: false,
  },
  recommenders: [],
  triagedHits: {},
  docs: [
    { id: uid(), title: "Master SOP", type: "SOP / Motivation letter", status: "Not started", note: "Write one strong master version, then tailor. Never write from scratch per application." },
    { id: uid(), title: "Master CV (academic, 2 pages)", type: "CV", status: "Not started", note: "" },
  ],
  credentials: [
    { id: uid(), name: "IELTS / TOEFL", status: "Not started", date: "", expiry: "", note: "CRITICAL PATH. Test slots often 3–6 weeks out, results 5–13 days after. Book before you do anything else." },
    { id: uid(), name: "Official transcripts", status: "Not started", date: "", expiry: "", note: "Registrar turnaround can be weeks. Order several sealed copies." },
    { id: uid(), name: "Passport", status: "Not started", date: "", expiry: "", note: "Must be valid well beyond intended travel." },
    { id: uid(), name: "Degree certificate", status: "Not started", date: "", expiry: "", note: "" },
  ],
};

/* ---------- storage ---------- */

async function loadSeedTargets() {
  try {
    const [scholarships, usPhd] = await Promise.all([
      fetch("data/seed-scholarships.json").then((r) => r.json()),
      fetch("data/seed-us-phd.json").then((r) => r.json()),
    ]);
    return [...scholarships, ...usPhd];
  } catch (e) {
    console.error("seed load failed", e);
    return [];
  }
}

async function loadState() {
  if (!window.storage) {
    return { ...SEED, targets: await loadSeedTargets(), _nostore: true };
  }
  try {
    const r = await window.storage.get(KEY);
    if (r && r.value) return JSON.parse(r.value);
  } catch (e) {
    // no saved data yet
  }
  return { ...SEED, targets: await loadSeedTargets() };
}

async function saveState(s) {
  if (!window.storage) return;
  try {
    await window.storage.set(KEY, JSON.stringify(s));
  } catch (e) {
    console.error("save failed", e);
  }
}

/* ---------- small pieces ---------- */

function Field({ label, children, wide }) {
  return (
    <label className={wide ? "fb-field fb-field-wide" : "fb-field"}>
      <span className="fb-label">{label}</span>
      {children}
    </label>
  );
}

function urgency(days, rolling) {
  if (rolling) return "roll";
  if (days === null) return "unset";
  if (days < 0) return "gone";
  if (days <= 14) return "hot";
  if (days <= 45) return "soon";
  return "far";
}

/* ---------- app ---------- */

export default function FundingBoard() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("board");
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("live");

  useEffect(() => {
    loadState().then(setState);
  }, []);

  useEffect(() => {
    if (state) saveState(state);
  }, [state]);

  const update = (patch) => setState((s) => ({ ...s, ...patch }));

  const targets = state?.targets ?? [];

  const sorted = useMemo(() => {
    return [...targets].sort((a, b) => {
      if (a.rolling && !b.rolling) return 1;
      if (b.rolling && !a.rolling) return -1;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
  }, [targets]);

  const shown = useMemo(() => {
    if (filter === "all") return sorted;
    if (filter === "live") return sorted.filter((t) => LIVE_STATUSES.includes(t.status));
    if (filter === "msc") return sorted.filter((t) => t.level === "MSc");
    if (filter === "phd") return sorted.filter((t) => t.level === "PhD");
    return sorted;
  }, [sorted, filter]);

  if (!state) {
    return (
      <div className="fb-root">
        <Styles />
        <div className="fb-loading">Loading your board…</div>
      </div>
    );
  }

  const p = state.profile;

  /* gates: what is this person actually locked out of right now */
  const gated = targets.filter(
    (t) =>
      LIVE_STATUSES.includes(t.status) &&
      ((t.reqWorkExpYears > (p.workExpYears || 0)) || (t.reqMsc && !p.hasMsc))
  );

  const noEnglish = state.credentials.find(
    (c) => /IELTS|TOEFL|English/i.test(c.name) && c.status !== "Obtained"
  );

  const imminent = sorted.filter((t) => {
    const d = daysUntil(t.deadline);
    return !t.rolling && d !== null && d >= 0 && d <= 60 && LIVE_STATUSES.includes(t.status);
  });

  const counts = STATUSES.map((s) => ({ s, n: targets.filter((t) => t.status === s).length }));

  return (
    <div className="fb-root">
      <Styles />

      <header className="fb-head">
        <div>
          <div className="fb-eyebrow">2027 / 28 cycle</div>
          <h1 className="fb-title">Funding Board</h1>
        </div>
        <nav className="fb-tabs">
          {[
            ["board", "Board"],
            ["inbox", "Inbox"],
            ["targets", "Targets"],
            ["refs", "Referees"],
            ["docs", "Documents"],
            ["creds", "Credentials"],
            ["me", "Profile"],
          ].map(([k, l]) => (
            <button
              key={k}
              className={tab === k ? "fb-tab fb-tab-on" : "fb-tab"}
              onClick={() => setTab(k)}
            >
              {l}
            </button>
          ))}
        </nav>
      </header>

      {state._nostore && (
        <div className="fb-warn">
          Storage is unavailable here, so nothing will be saved between sessions.
        </div>
      )}

      {/* ---------------- BOARD ---------------- */}
      {tab === "board" && (
        <section>
          {(noEnglish || gated.length > 0) && (
            <div className="fb-critical">
              <div className="fb-critical-head">Critical path</div>
              {noEnglish && (
                <div className="fb-critical-row">
                  <strong>{noEnglish.name} — {noEnglish.status.toLowerCase()}.</strong> Test slots run
                  3–6 weeks out and results take another 1–2 weeks. Every deadline below depends on
                  this. Book it this week.
                </div>
              )}
              {gated.length > 0 && (
                <div className="fb-critical-row">
                  <strong>{gated.length} target{gated.length > 1 ? "s" : ""} you may not clear yet.</strong>{" "}
                  {gated.map((g) => g.name).join(" · ")} — blocked by a work-experience or prior-degree
                  requirement. Confirm before spending a week on the essays.
                </div>
              )}
            </div>
          )}

          <h2 className="fb-h2">Departures</h2>
          <p className="fb-sub">
            Live targets with a deadline inside 60 days. {imminent.length === 0 && "Nothing boarding yet."}
          </p>

          <div className="fb-departures">
            {imminent.map((t) => {
              const d = daysUntil(t.deadline);
              return (
                <div key={t.id} className={"fb-dep fb-u-" + urgency(d, t.rolling)}>
                  <div className="fb-dep-days">
                    <span className="fb-dep-num">{d}</span>
                    <span className="fb-dep-unit">days</span>
                  </div>
                  <div className="fb-dep-body">
                    <div className="fb-dep-name">{t.name}</div>
                    <div className="fb-dep-meta">
                      {fmt(t.deadline)} · {t.level} · {t.country}
                      {!t.verified && <span className="fb-unver">unverified date</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <h2 className="fb-h2">Pipeline</h2>
          <div className="fb-counts">
            {counts.filter((c) => c.n > 0).map((c) => (
              <div key={c.s} className="fb-count">
                <span className="fb-count-n">{c.n}</span>
                <span className="fb-count-l">{c.s}</span>
              </div>
            ))}
          </div>

          <h2 className="fb-h2">Standing watch</h2>
          <p className="fb-sub">
            Rolling sources with no fixed deadline. Register keyword email alerts on each one — that is
            your alert engine.
          </p>
          <div className="fb-watchlist">
            {["Euraxess", "jobs.ac.uk", "FindAPhD", "Nature Careers", "AcademicPositions"].map((s) => (
              <span key={s} className="fb-chip">{s}</span>
            ))}
          </div>
        </section>
      )}

      {/* ---------------- INBOX ---------------- */}
      {tab === "inbox" && (
        <InboxTab triaged={state.triagedHits || {}} targets={targets} update={update} />
      )}

      {/* ---------------- TARGETS ---------------- */}
      {tab === "targets" && (
        <section>
          <div className="fb-bar">
            <div className="fb-filters">
              {[["live", "Live"], ["all", "All"], ["msc", "MSc"], ["phd", "PhD"]].map(([k, l]) => (
                <button
                  key={k}
                  className={filter === k ? "fb-f fb-f-on" : "fb-f"}
                  onClick={() => setFilter(k)}
                >
                  {l}
                </button>
              ))}
            </div>
            <button className="fb-btn" onClick={() => setEditing({ id: null })}>
              Add target
            </button>
          </div>

          <div className="fb-cards">
            {shown.map((t) => {
              const d = daysUntil(t.deadline);
              const blocked =
                t.reqWorkExpYears > (p.workExpYears || 0) || (t.reqMsc && !p.hasMsc);
              return (
                <article key={t.id} className={"fb-card fb-u-" + urgency(d, t.rolling)}>
                  <div className="fb-card-top">
                    <div>
                      <h3 className="fb-card-name">{t.name}</h3>
                      <div className="fb-card-inst">{t.institution}</div>
                    </div>
                    <span className="fb-status">{t.status}</span>
                  </div>

                  <div className="fb-card-line">
                    <span className="fb-mono">
                      {t.rolling ? "ROLLING" : d === null ? "NO DATE" : d < 0 ? "CLOSED" : d + "d"}
                    </span>
                    <span>{t.rolling ? "no fixed deadline" : fmt(t.deadline)}</span>
                    {!t.verified && <span className="fb-unver">unverified</span>}
                  </div>

                  <div className="fb-tags">
                    <span className="fb-tag">{t.level}</span>
                    <span className="fb-tag">{t.country}</span>
                    <span className="fb-tag">{t.fundingSource}</span>
                    {t.numLoR > 0 && <span className="fb-tag">{t.numLoR} referees</span>}
                    {t.reqWorkExpYears > 0 && (
                      <span className={blocked ? "fb-tag fb-tag-block" : "fb-tag"}>
                        {t.reqWorkExpYears}y work exp
                      </span>
                    )}
                    {t.reqMsc && (
                      <span className={blocked ? "fb-tag fb-tag-block" : "fb-tag"}>MSc required</span>
                    )}
                  </div>

                  {t.stipend && <div className="fb-money">{t.fundingType} · {t.stipend}</div>}
                  {t.docs?.length > 0 && (
                    <div className="fb-docs">{t.docs.join(" · ")}</div>
                  )}
                  {t.notes && <p className="fb-notes">{t.notes}</p>}

                  <div className="fb-card-actions">
                    <select
                      className="fb-select-sm"
                      value={t.status}
                      onChange={(e) =>
                        update({
                          targets: targets.map((x) =>
                            x.id === t.id ? { ...x, status: e.target.value } : x
                          ),
                        })
                      }
                    >
                      {STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    {t.url && (
                      <a className="fb-link" href={t.url} target="_blank" rel="noreferrer">
                        Official page
                      </a>
                    )}
                    <button className="fb-ghost" onClick={() => setEditing(t)}>
                      Edit
                    </button>
                    <button
                      className="fb-ghost fb-danger"
                      onClick={() =>
                        update({ targets: targets.filter((x) => x.id !== t.id) })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
            {shown.length === 0 && (
              <div className="fb-empty">
                Nothing here yet. Add a target to start tracking it.
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---------------- REFEREES ---------------- */}
      {tab === "refs" && (
        <RefsTab state={state} update={update} targets={targets} />
      )}

      {/* ---------------- DOCS ---------------- */}
      {tab === "docs" && <DocsTab state={state} update={update} />}

      {/* ---------------- CREDENTIALS ---------------- */}
      {tab === "creds" && <CredsTab state={state} update={update} />}

      {/* ---------------- PROFILE ---------------- */}
      {tab === "me" && (
        <section className="fb-panel">
          <h2 className="fb-h2">Your gates</h2>
          <p className="fb-sub">
            These two numbers decide which scholarships you can even enter. Keep them honest.
          </p>
          <div className="fb-form">
            <Field label="Name">
              <input
                className="fb-input"
                value={p.name}
                onChange={(e) => update({ profile: { ...p, name: e.target.value } })}
              />
            </Field>
            <Field label="Citizenship">
              <input
                className="fb-input"
                value={p.citizenship}
                onChange={(e) => update({ profile: { ...p, citizenship: e.target.value } })}
              />
            </Field>
            <Field label="Years of work experience">
              <input
                className="fb-input"
                type="number"
                step="0.5"
                min="0"
                value={p.workExpYears}
                onChange={(e) =>
                  update({ profile: { ...p, workExpYears: parseFloat(e.target.value) || 0 } })
                }
              />
            </Field>
            <Field label="Do you already hold an MSc?">
              <select
                className="fb-input"
                value={p.hasMsc ? "yes" : "no"}
                onChange={(e) => update({ profile: { ...p, hasMsc: e.target.value === "yes" } })}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </Field>
          </div>
          <button
            className="fb-ghost"
            onClick={() => {
              const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "funding-board.json";
              a.click();
            }}
          >
            Export everything as JSON
          </button>

          <h2 className="fb-h2">Radar reminders</h2>
          <p className="fb-sub">
            The watcher can't read this browser's storage — it has no idea what you're tracking.
            To get deadline reminders on Telegram, export your targets below, then drop the file in
            as <code>data/targets.json</code> and commit + push it. This is a snapshot, not a live
            sync: re-export whenever you add a target or confirm a deadline. Only targets with{" "}
            <strong>Dates verified on official site</strong> set to "Verified" ever fire a reminder —
            an unconfirmed deadline is exactly the kind of false confidence this tool is built to avoid.
          </p>
          <button
            className="fb-ghost"
            onClick={() => {
              const blob = new Blob([JSON.stringify(targets, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "targets.json";
              a.click();
            }}
          >
            Export targets for radar (data/targets.json)
          </button>
        </section>
      )}

      {editing && (
        <TargetForm
          target={editing.id ? editing : null}
          onCancel={() => setEditing(null)}
          onSave={(t) => {
            if (t.id) {
              update({ targets: targets.map((x) => (x.id === t.id ? t : x)) });
            } else {
              update({ targets: [...targets, { ...t, id: uid() }] });
            }
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------- target form ---------- */

function TargetForm({ target, onSave, onCancel }) {
  const [t, setT] = useState(
    target || {
      id: null, name: "", institution: "", country: "", level: "MSc",
      fundingSource: "External scholarship", fundingType: "", stipend: "",
      opensDate: "", deadline: "", rolling: false, reqWorkExpYears: 0, reqMsc: false,
      numLoR: 2, docs: [], url: "", supervisor: "", tier: "Match",
      status: "Watching", verified: false, notes: "",
    }
  );
  const set = (k, v) => setT((s) => ({ ...s, [k]: v }));

  return (
    <div className="fb-modal-wrap" onClick={onCancel}>
      <div className="fb-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="fb-h2">{target ? "Edit target" : "New target"}</h2>
        <div className="fb-form">
          <Field label="Programme or scholarship name" wide>
            <input className="fb-input" value={t.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Institution / host" wide>
            <input className="fb-input" value={t.institution} onChange={(e) => set("institution", e.target.value)} />
          </Field>
          <Field label="Country">
            <input className="fb-input" value={t.country} onChange={(e) => set("country", e.target.value)} />
          </Field>
          <Field label="Level">
            <select className="fb-input" value={t.level} onChange={(e) => set("level", e.target.value)}>
              <option>MSc</option><option>PhD</option><option>MPhil</option><option>Fellowship</option>
            </select>
          </Field>
          <Field label="Funding comes from">
            <select className="fb-input" value={t.fundingSource} onChange={(e) => set("fundingSource", e.target.value)}>
              <option>External scholarship</option>
              <option>Internal / departmental</option>
              <option>Employment contract</option>
            </select>
          </Field>
          <Field label="What it covers">
            <input className="fb-input" value={t.fundingType} onChange={(e) => set("fundingType", e.target.value)} placeholder="Tuition + stipend + travel" />
          </Field>
          <Field label="Stipend">
            <input className="fb-input" value={t.stipend} onChange={(e) => set("stipend", e.target.value)} />
          </Field>
          <Field label="Supervisor / PI (Europe PhD)">
            <input className="fb-input" value={t.supervisor} onChange={(e) => set("supervisor", e.target.value)} />
          </Field>
          <Field label="Opens">
            <input className="fb-input" type="date" value={t.opensDate} onChange={(e) => set("opensDate", e.target.value)} />
          </Field>
          <Field label="Deadline">
            <input className="fb-input" type="date" value={t.deadline} onChange={(e) => set("deadline", e.target.value)} />
          </Field>
          <Field label="Rolling (no fixed deadline)">
            <select className="fb-input" value={t.rolling ? "yes" : "no"} onChange={(e) => set("rolling", e.target.value === "yes")}>
              <option value="no">No</option><option value="yes">Yes</option>
            </select>
          </Field>
          <Field label="Dates verified on official site">
            <select className="fb-input" value={t.verified ? "yes" : "no"} onChange={(e) => set("verified", e.target.value === "yes")}>
              <option value="no">Not yet</option><option value="yes">Verified</option>
            </select>
          </Field>
          <Field label="Work experience required (years)">
            <input className="fb-input" type="number" step="0.5" min="0" value={t.reqWorkExpYears} onChange={(e) => set("reqWorkExpYears", parseFloat(e.target.value) || 0)} />
          </Field>
          <Field label="Requires an MSc already">
            <select className="fb-input" value={t.reqMsc ? "yes" : "no"} onChange={(e) => set("reqMsc", e.target.value === "yes")}>
              <option value="no">No</option><option value="yes">Yes</option>
            </select>
          </Field>
          <Field label="Number of referees">
            <input className="fb-input" type="number" min="0" value={t.numLoR} onChange={(e) => set("numLoR", parseInt(e.target.value) || 0)} />
          </Field>
          <Field label="Tier">
            <select className="fb-input" value={t.tier} onChange={(e) => set("tier", e.target.value)}>
              <option>Reach</option><option>Match</option><option>Likely</option>
            </select>
          </Field>
          <Field label="Status">
            <select className="fb-input" value={t.status} onChange={(e) => set("status", e.target.value)}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Official URL" wide>
            <input className="fb-input" value={t.url} onChange={(e) => set("url", e.target.value)} />
          </Field>
          <Field label="Documents required" wide>
            <div className="fb-checks">
              {DOC_TYPES.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={t.docs.includes(d) ? "fb-check fb-check-on" : "fb-check"}
                  onClick={() =>
                    set("docs", t.docs.includes(d) ? t.docs.filter((x) => x !== d) : [...t.docs, d])
                  }
                >
                  {d}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Notes" wide>
            <textarea className="fb-input fb-area" rows="3" value={t.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
        <div className="fb-modal-actions">
          <button className="fb-ghost" onClick={onCancel}>Cancel</button>
          <button className="fb-btn" onClick={() => onSave(t)}>Save target</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- inbox ---------- */

function hitToTarget(hit) {
  const level = /phd|doctoral|doctorate|dphil/i.test(hit.title) ? "PhD" : "MSc";
  const notes = [
    hit.deadline ? `radar saw: ${hit.deadline} (unverified)` : "",
    hit.opens ? `radar saw opens: ${hit.opens} (unverified)` : "",
    `via ${hit.source}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: uid(),
    name: hit.title,
    institution: "",
    country: "",
    level,
    fundingSource: "External scholarship",
    fundingType: "",
    stipend: "",
    opensDate: "",
    deadline: "",
    rolling: false,
    reqWorkExpYears: 0,
    reqMsc: false,
    numLoR: 2,
    docs: [],
    url: hit.url || "",
    supervisor: "",
    tier: "Match",
    status: "Watching",
    verified: false,
    notes,
  };
}

function SourceStats() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch("data/source-stats.json")
      .then((r) => (r.ok ? r.json() : {}))
      .then(setStats)
      .catch(() => setStats({}));
  }, []);

  const rows = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats)
      .map(([source, s]) => ({
        source,
        ingested: s.ingested || 0,
        passed: s.passed || 0,
        tracked: s.tracked || 0,
      }))
      .sort((a, b) => b.ingested - a.ingested);
  }, [stats]);

  if (!rows.length) return null;

  return (
    <>
      <h2 className="fb-h2">Source performance</h2>
      <p className="fb-sub">
        Ingested vs. kept vs. tracked, per source, since the radar started keeping count — so you
        know which feeds to tighten or retire. Only Telegram Track taps count toward "tracked"
        here; targets tracked from this Inbox tab live in browser storage the watcher can't see.
      </p>
      <div className="fb-table-wrap">
        <table className="fb-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Ingested</th>
              <th>Passed filter</th>
              <th>Tracked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source}>
                <td>{r.source}</td>
                <td>{r.ingested}</td>
                <td>{r.passed}</td>
                <td>{r.tracked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function InboxTab({ triaged, targets, update }) {
  const [items, setItems] = useState(null); // null = loading

  useEffect(() => {
    fetch("data/opportunities.json")
      .then((r) => (r.ok ? r.json() : []))
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  const sorted = useMemo(() => {
    if (!items) return [];
    return [...items]
      .filter((h) => !triaged[h.id])
      .sort((a, b) => (b.found || "").localeCompare(a.found || ""));
  }, [items, triaged]);

  const track = (hit) => {
    update({
      targets: [...targets, hitToTarget(hit)],
      triagedHits: { ...triaged, [hit.id]: "tracked" },
    });
  };

  const dismiss = (hit) => {
    update({ triagedHits: { ...triaged, [hit.id]: "dismissed" } });
  };

  return (
    <section>
      <h2 className="fb-h2">Inbox</h2>
      <p className="fb-sub">
        Raw hits from the hourly radar, newest first. Nothing here is verified — every date is a
        regex guess, confirm it on the official page before you act on it. Track promotes a hit to
        a target with an empty deadline — the extracted date only ever lands in its notes.
      </p>

      <SourceStats />

      {items === null && <div className="fb-empty">Loading radar hits…</div>}

      {items !== null && sorted.length === 0 && (
        <div className="fb-empty">
          The radar hasn't found anything yet. If you've just deployed, open the{" "}
          <strong>Actions</strong> tab in your GitHub repository and confirm the hourly workflow
          has run at least once — this list fills in from{" "}
          <code>data/opportunities.json</code> once it has.
        </div>
      )}

      {items !== null && sorted.length > 0 && (
        <div className="fb-cards">
          {sorted.map((h) => (
            <article key={h.id} className="fb-card">
              <div className="fb-card-top">
                <div>
                  <h3 className="fb-card-name">
                    {h.url ? (
                      <a href={h.url} target="_blank" rel="noreferrer">{h.title}</a>
                    ) : (
                      h.title
                    )}
                  </h3>
                  <div className="fb-card-inst">{h.source}</div>
                </div>
                <span className="fb-status">score {h.score}</span>
              </div>

              <div className="fb-tags">
                <span className="fb-tag">{h.funded ? "funded" : "no funding signal"}</span>
                {h.deadline && (
                  <span className="fb-tag">
                    deadline seen: {h.deadline} <span className="fb-unver">unverified</span>
                  </span>
                )}
                {h.opens && (
                  <span className="fb-tag">
                    opens seen: {h.opens} <span className="fb-unver">unverified</span>
                  </span>
                )}
              </div>

              <div className="fb-card-actions">
                <button className="fb-btn" onClick={() => track(h)}>Track</button>
                <button className="fb-ghost fb-danger" onClick={() => dismiss(h)}>Dismiss</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- referees ---------- */

function RefsTab({ state, update, targets }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const refs = state.recommenders;

  const addRef = () => {
    if (!name.trim()) return;
    update({ recommenders: [...refs, { id: uid(), name, email, role: "", requests: [] }] });
    setName(""); setEmail("");
  };

  const patch = (id, fn) =>
    update({ recommenders: refs.map((r) => (r.id === id ? fn(r) : r)) });

  return (
    <section>
      <h2 className="fb-h2">Referees</h2>
      <p className="fb-sub">
        Three letters across twenty applications is sixty separate requests, each with its own portal
        and its own deadline. This is what actually breaks a high-volume season.
      </p>

      <div className="fb-inline-form">
        <input className="fb-input" placeholder="Referee name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="fb-input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="fb-btn" onClick={addRef}>Add referee</button>
      </div>

      <div className="fb-cards">
        {refs.map((r) => (
          <article key={r.id} className="fb-card">
            <div className="fb-card-top">
              <div>
                <h3 className="fb-card-name">{r.name}</h3>
                <div className="fb-card-inst">{r.email}</div>
              </div>
              <button className="fb-ghost fb-danger" onClick={() => update({ recommenders: refs.filter((x) => x.id !== r.id) })}>
                Remove
              </button>
            </div>

            {r.requests.map((q, i) => {
              const t = targets.find((x) => x.id === q.targetId);
              return (
                <div key={i} className="fb-req">
                  <span className={q.submitted ? "fb-req-name fb-done" : "fb-req-name"}>
                    {t ? t.name : "removed target"}
                  </span>
                  <span className="fb-mono fb-req-date">{t?.deadline ? fmt(t.deadline) : "—"}</span>
                  <button
                    className={q.submitted ? "fb-pill fb-pill-on" : "fb-pill"}
                    onClick={() =>
                      patch(r.id, (x) => ({
                        ...x,
                        requests: x.requests.map((y, j) => (j === i ? { ...y, submitted: !y.submitted } : y)),
                      }))
                    }
                  >
                    {q.submitted ? "Submitted" : "Mark submitted"}
                  </button>
                  <button
                    className="fb-ghost fb-danger"
                    onClick={() =>
                      patch(r.id, (x) => ({ ...x, requests: x.requests.filter((_, j) => j !== i) }))
                    }
                  >
                    ×
                  </button>
                </div>
              );
            })}

            <select
              className="fb-select-sm"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                patch(r.id, (x) => ({
                  ...x,
                  requests: [...x.requests, { targetId: e.target.value, submitted: false }],
                }));
              }}
            >
              <option value="">Assign to a target…</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </article>
        ))}
        {refs.length === 0 && <div className="fb-empty">No referees yet. Add the people who will write for you.</div>}
      </div>
    </section>
  );
}

/* ---------- documents ---------- */

function DocsTab({ state, update }) {
  const [title, setTitle] = useState("");
  const docs = state.docs;
  const STAGES = ["Not started", "Drafting", "In review", "Final"];

  return (
    <section>
      <h2 className="fb-h2">Documents</h2>
      <p className="fb-sub">
        One master version of each, then tailored variants. Rewriting from scratch every time is how
        twenty applications becomes four.
      </p>
      <div className="fb-inline-form">
        <input className="fb-input" placeholder="Document title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button
          className="fb-btn"
          onClick={() => {
            if (!title.trim()) return;
            update({ docs: [...docs, { id: uid(), title, type: "SOP / Motivation letter", status: "Not started", note: "" }] });
            setTitle("");
          }}
        >
          Add document
        </button>
      </div>
      <div className="fb-cards">
        {docs.map((d) => (
          <article key={d.id} className="fb-card">
            <div className="fb-card-top">
              <h3 className="fb-card-name">{d.title}</h3>
              <button className="fb-ghost fb-danger" onClick={() => update({ docs: docs.filter((x) => x.id !== d.id) })}>Remove</button>
            </div>
            <div className="fb-card-actions">
              <select className="fb-select-sm" value={d.type} onChange={(e) => update({ docs: docs.map((x) => x.id === d.id ? { ...x, type: e.target.value } : x) })}>
                {DOC_TYPES.map((x) => <option key={x}>{x}</option>)}
              </select>
              <select className="fb-select-sm" value={d.status} onChange={(e) => update({ docs: docs.map((x) => x.id === d.id ? { ...x, status: e.target.value } : x) })}>
                {STAGES.map((x) => <option key={x}>{x}</option>)}
              </select>
            </div>
            {d.note && <p className="fb-notes">{d.note}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

/* ---------- credentials ---------- */

function CredsTab({ state, update }) {
  const creds = state.credentials;
  const STAGES = ["Not started", "Booked", "In progress", "Obtained"];
  const [name, setName] = useState("");

  return (
    <section>
      <h2 className="fb-h2">Credentials</h2>
      <p className="fb-sub">
        The slow, boring things with real lead times. These block every application at once, so they
        outrank essay writing.
      </p>
      <div className="fb-inline-form">
        <input className="fb-input" placeholder="Credential name" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="fb-btn"
          onClick={() => {
            if (!name.trim()) return;
            update({ credentials: [...creds, { id: uid(), name, status: "Not started", date: "", expiry: "", note: "" }] });
            setName("");
          }}
        >
          Add
        </button>
      </div>
      <div className="fb-cards">
        {creds.map((c) => (
          <article key={c.id} className={c.status === "Obtained" ? "fb-card" : "fb-card fb-u-hot"}>
            <div className="fb-card-top">
              <h3 className="fb-card-name">{c.name}</h3>
              <span className="fb-status">{c.status}</span>
            </div>
            <div className="fb-card-actions">
              <select className="fb-select-sm" value={c.status} onChange={(e) => update({ credentials: creds.map((x) => x.id === c.id ? { ...x, status: e.target.value } : x) })}>
                {STAGES.map((x) => <option key={x}>{x}</option>)}
              </select>
              <input className="fb-input fb-input-sm" type="date" value={c.expiry} onChange={(e) => update({ credentials: creds.map((x) => x.id === c.id ? { ...x, expiry: e.target.value } : x) })} />
              <span className="fb-label">expires</span>
              <button className="fb-ghost fb-danger" onClick={() => update({ credentials: creds.filter((x) => x.id !== c.id) })}>Remove</button>
            </div>
            {c.note && <p className="fb-notes">{c.note}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

/* ---------- styles ---------- */

function Styles() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,700;12..96,800&family=Public+Sans:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');

.fb-root{--paper:#F1F3EF;--ink:#12211C;--pine:#1E5B4E;--ox:#8A2418;--brass:#9A7420;--mist:#D9DED6;--dim:#5C6B63;
background:var(--paper);color:var(--ink);font-family:'Public Sans',system-ui,sans-serif;
padding:20px;min-height:100%;line-height:1.5;}
.fb-root *{box-sizing:border-box;}
.fb-loading{padding:60px 0;text-align:center;color:var(--dim);}

.fb-head{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:flex-end;
border-bottom:2px solid var(--ink);padding-bottom:14px;margin-bottom:22px;}
.fb-eyebrow{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--pine);}
.fb-title{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:38px;line-height:1;margin:4px 0 0;letter-spacing:-.02em;}
.fb-tabs{display:flex;flex-wrap:wrap;gap:2px;}
.fb-tab{font-family:'Public Sans';font-size:13px;padding:7px 13px;border:1px solid var(--mist);background:transparent;
color:var(--dim);cursor:pointer;border-radius:2px;}
.fb-tab-on{background:var(--ink);color:var(--paper);border-color:var(--ink);}

.fb-h2{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:19px;margin:26px 0 4px;letter-spacing:-.01em;}
.fb-sub{color:var(--dim);font-size:13.5px;margin:0 0 14px;max-width:62ch;}
.fb-label{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);}
.fb-mono{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.04em;}

.fb-warn{background:#FDF6E3;border-left:3px solid var(--brass);padding:10px 14px;font-size:13px;margin-bottom:16px;}

.fb-critical{border:2px solid var(--ox);background:#FBF0EE;padding:14px 16px;margin-bottom:8px;}
.fb-critical-head{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ox);margin-bottom:8px;}
.fb-critical-row{font-size:13.5px;margin-bottom:8px;}
.fb-critical-row:last-child{margin-bottom:0;}

.fb-departures{display:flex;flex-direction:column;gap:1px;background:var(--mist);border:1px solid var(--mist);}
.fb-dep{display:flex;gap:16px;align-items:center;background:var(--paper);padding:12px 14px;border-left:4px solid var(--dim);}
.fb-dep-days{min-width:62px;text-align:right;font-family:'JetBrains Mono',monospace;}
.fb-dep-num{display:block;font-size:26px;font-weight:700;line-height:1;}
.fb-dep-unit{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);}
.fb-dep-name{font-weight:600;font-size:14.5px;}
.fb-dep-meta{font-size:12px;color:var(--dim);display:flex;gap:8px;flex-wrap:wrap;align-items:center;}

.fb-u-hot{border-left-color:var(--ox);}
.fb-u-hot .fb-dep-num{color:var(--ox);}
.fb-u-soon{border-left-color:var(--brass);}
.fb-u-soon .fb-dep-num{color:var(--brass);}
.fb-u-far{border-left-color:var(--pine);}
.fb-u-gone{border-left-color:var(--mist);opacity:.55;}

.fb-unver{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;
color:var(--brass);border:1px solid var(--brass);padding:1px 5px;}

.fb-counts{display:flex;flex-wrap:wrap;gap:8px;}
.fb-count{border:1px solid var(--mist);padding:8px 12px;min-width:86px;}
.fb-count-n{display:block;font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:700;}
.fb-count-l{font-size:11px;color:var(--dim);}

.fb-watchlist{display:flex;flex-wrap:wrap;gap:6px;}
.fb-chip{font-size:12px;border:1px solid var(--pine);color:var(--pine);padding:3px 9px;border-radius:99px;}

.fb-bar{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;margin-bottom:14px;}
.fb-filters{display:flex;gap:2px;}
.fb-f{font-size:12px;padding:6px 12px;border:1px solid var(--mist);background:transparent;color:var(--dim);cursor:pointer;}
.fb-f-on{background:var(--pine);color:var(--paper);border-color:var(--pine);}

.fb-btn{background:var(--ink);color:var(--paper);border:none;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;border-radius:2px;font-family:'Public Sans';}
.fb-ghost{background:transparent;border:1px solid var(--mist);color:var(--dim);padding:6px 11px;font-size:12px;cursor:pointer;border-radius:2px;font-family:'Public Sans';}
.fb-danger:hover{color:var(--ox);border-color:var(--ox);}
.fb-link{font-size:12px;color:var(--pine);text-decoration:underline;align-self:center;}

.fb-cards{display:flex;flex-direction:column;gap:12px;}
.fb-card{border:1px solid var(--mist);border-left:4px solid var(--dim);background:#fff;padding:14px 16px;}
.fb-card-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;}
.fb-card-name{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:16px;margin:0;letter-spacing:-.01em;}
.fb-card-inst{font-size:12.5px;color:var(--dim);}
.fb-status{font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;
background:var(--ink);color:var(--paper);padding:3px 7px;white-space:nowrap;}
.fb-card-line{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:9px 0;font-size:12.5px;color:var(--dim);}
.fb-tags{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;}
.fb-tag{font-size:11px;border:1px solid var(--mist);padding:2px 7px;color:var(--dim);}
.fb-tag-block{border-color:var(--ox);color:var(--ox);}
.fb-money{font-size:12.5px;color:var(--pine);font-weight:500;margin-bottom:6px;}
.fb-docs{font-size:11.5px;color:var(--dim);border-top:1px dotted var(--mist);padding-top:7px;margin-bottom:6px;}
.fb-notes{font-size:12.5px;color:var(--ink);opacity:.8;margin:6px 0;}
.fb-card-actions{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-top:10px;}
.fb-select-sm{font-size:12px;padding:5px 8px;border:1px solid var(--mist);background:var(--paper);font-family:'Public Sans';}
.fb-empty{border:1px dashed var(--mist);padding:26px;text-align:center;color:var(--dim);font-size:13px;}

.fb-table-wrap{overflow-x:auto;margin-bottom:20px;}
.fb-table{width:100%;border-collapse:collapse;font-size:12.5px;}
.fb-table th{text-align:left;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.08em;
text-transform:uppercase;color:var(--dim);padding:6px 10px 8px;border-bottom:1px solid var(--ink);white-space:nowrap;}
.fb-table td{padding:8px 10px;border-bottom:1px solid var(--mist);white-space:nowrap;}
.fb-table tr:last-child td{border-bottom:none;}

.fb-inline-form{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;}
.fb-input{font-family:'Public Sans';font-size:13.5px;padding:8px 10px;border:1px solid var(--mist);background:#fff;color:var(--ink);width:100%;}
.fb-input-sm{width:auto;font-size:12px;padding:5px 8px;}
.fb-inline-form .fb-input{width:auto;flex:1 1 180px;}
.fb-area{resize:vertical;font-family:'Public Sans';}

.fb-req{display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px dotted var(--mist);padding:7px 0;font-size:12.5px;}
.fb-req-name{flex:1 1 150px;}
.fb-done{text-decoration:line-through;color:var(--dim);}
.fb-req-date{color:var(--dim);}
.fb-pill{font-size:11px;border:1px solid var(--mist);background:transparent;padding:3px 9px;cursor:pointer;border-radius:99px;color:var(--dim);}
.fb-pill-on{background:var(--pine);color:var(--paper);border-color:var(--pine);}

.fb-panel{max-width:640px;}
.fb-form{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;}
.fb-field{display:flex;flex-direction:column;gap:4px;}
.fb-field-wide{grid-column:1 / -1;}
.fb-checks{display:flex;flex-wrap:wrap;gap:5px;}
.fb-check{font-size:11.5px;border:1px solid var(--mist);background:transparent;padding:4px 9px;cursor:pointer;color:var(--dim);}
.fb-check-on{background:var(--pine);color:var(--paper);border-color:var(--pine);}

.fb-modal-wrap{position:fixed;inset:0;background:rgba(18,33,28,.5);display:flex;align-items:flex-start;
justify-content:center;padding:24px 14px;overflow-y:auto;z-index:50;}
.fb-modal{background:var(--paper);border:2px solid var(--ink);padding:20px;max-width:720px;width:100%;}
.fb-modal-actions{display:flex;gap:8px;justify-content:flex-end;}

button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--pine);outline-offset:1px;}

@media(max-width:640px){
.fb-root{padding:14px;}
.fb-title{font-size:29px;}
.fb-form{grid-template-columns:1fr;}
.fb-head{align-items:flex-start;}
.fb-dep{gap:11px;padding:11px;}
.fb-dep-days{min-width:50px;}
.fb-dep-num{font-size:22px;}
}
`}</style>
  );
}
