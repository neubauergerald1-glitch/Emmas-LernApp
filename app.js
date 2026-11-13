/* =========================================================
   Emmas Turnhalle – Lernapp (GitHub Pages)
   Fest eingebaute Fächer stehen in content.js, weitere legt man in der App an.
   Fortschritt bleibt im Browser des Geräts; Eltern bekommen Meldungen über ntfy (eltern.html).
   ========================================================= */
const $ = s => document.querySelector(s);
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const slug = s => (String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fach").slice(0, 30);
const hash = s => { let h = 5381; for (const ch of String(s)) h = ((h << 5) + h + ch.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const de = n => n.toFixed(1).replace(".", ",");

/* ========================= Zustand ========================= */
const DEFAULT_STATE = { v: 1, rev: 0, player: "Emma", stars: 0, kueren: 0, perfect: 0, wkBest: 0, written: 0, medals: { gold: 0, silber: 0, bronze: 0 }, topics: {}, cards: {}, miss: {}, badges: [], last: 0 };
const fresh = () => JSON.parse(JSON.stringify(DEFAULT_STATE));
let S = Object.assign(fresh(), lsGet("emma_state", {}));
let custom = lsGet("emma_subjects", []);
const syncLabel = "Fortschritt und eigene Fächer sind auf diesem Gerät gespeichert.";
let view = { name: "home" };
let saveTimer = null;

function save() {
  S.rev = (S.rev || 0) + 1; S.last = Date.now();
  lsSet("emma_state", S);
}
const subjects = () => [...(window.BUILTIN || []), ...custom];
const getSubj = id => subjects().find(s => s.id === id);
const getTopic = (s, id) => s.topics.find(t => t.id === id);
const tKey = (s, t) => s.id + "|" + t.id;

/* ========================= Eltern-Benachrichtigung (ntfy) =========================
   Der Eltern-Code steht NICHT im Code, sondern nur im Browser des Geräts.
   Einrichten per Link: …/?eltern=CODE  oder in der App unter Pokalvitrine. */
const NTFY_KEY = "emma_ntfy", NTFY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ntfyTopic = () => { const t = lsGet(NTFY_KEY, null); return t && NTFY_RE.test(t) ? t : null; };
let parentJustLinked = false;
try {
  const u = new URL(location.href), t = u.searchParams.get("eltern");
  if (t && NTFY_RE.test(t)) { lsSet(NTFY_KEY, t); parentJustLinked = true; u.searchParams.delete("eltern"); history.replaceState(null, "", u.pathname + u.search + u.hash); }
} catch {}
const knownCount = () => Object.values(S.cards).filter(Boolean).length;
const standLine = () => `Sterne: ${S.stars} · Medaillen: ${S.medals.gold || 0}/${S.medals.silber || 0}/${S.medals.bronze || 0} · Karten gekonnt: ${knownCount()}`;
function notifyParent(title, message, tags, priority) {
  const topic = ntfyTopic();
  if (!topic) return Promise.resolve(false);
  try {
    return fetch("https://ntfy.sh/", { method: "POST", keepalive: true,
      body: JSON.stringify({ topic, title, message: message + "\n" + standLine(), tags: tags || [], priority: priority || 3 }) })
      .then(r => r.ok).catch(() => false);
  } catch { return Promise.resolve(false); }
}
/* Stiller Stand-Bericht (ohne Ton), damit die Elternansicht den aktuellen Stand kennt */
const STATUS_KEY = "emma_ntfy_status";
function sendStatus(reason) { if (!ntfyTopic()) return; lsSet(STATUS_KEY, Date.now()); notifyParent(`Stand: ${S.player}`, reason, ["bar_chart"], 1); }
function maybeSendStatus() { if (ntfyTopic() && Date.now() - (lsGet(STATUS_KEY, 0) || 0) > 3 * 3600e3) sendStatus("Lernapp geöffnet."); }
const MEDAL_TAG = { gold: "1st_place_medal", silber: "2nd_place_medal", bronze: "3rd_place_medal" };
const missLine = list => list && list.length ? `\nFalsch: ${[...new Set(list)].join(", ")}` : "";
function logActivity(e) {
  const p = S.player;
  if (e.kind === "kuer") notifyParent(`${MEDAL_NAME[e.medal]} für ${p}!`, `${e.subj} · ${e.topic} (${e.mode === "write" ? "Schreiben" : "Turnen"}): ${MEDAL_NAME[e.medal]}, Wertung ${de(e.score)} – ${e.total} Elemente, ${e.wobbles} Wackler.` + missLine(e.missed), [MEDAL_TAG[e.medal]]);
  if (e.kind === "warm") notifyParent(`Aufwärmen: ${p}`, `${e.subj} · ${e.topic} (Aufwärmen): ${e.known} von ${e.total} Karten gekonnt.`, ["books"]);
  if (e.kind === "wk") notifyParent(`Wettkampf-Runde: ${p}`, `${e.subj} (Wettkampf-Runde): ${e.kueren} Übung${e.kueren === 1 ? "" : "en"} geschafft, ${e.correct} richtig, ${e.wobbles} Wackler.` + missLine(e.missed), ["stopwatch"]);
  if (e.kind === "abort") notifyParent(`${p} hat abgebrochen`, `${e.subj} · ${e.topic} (${e.mode}) abgebrochen: ${e.correct} richtig, ${e.wobbles} Wackler.` + missLine(e.missed), ["warning"]);
}

/* ========================= Fragen ========================= */
/* kind: undefined/"mix" = eine Aufgabe je Karte (gemischt), "write" = nur Schreibaufgaben, "all" = alle Varianten */
function gapItem(c) {
  const m = c.ex && c.ex.match(/\[([^\]]+)\]/);
  if (!m) return null;
  return { type: "write", gap: true, q: "Lückensatz: " + c.ex.replace(m[0], "___"), sentence: c.ex.replace(m[0], "\u0000"), prompt: c.q, a: m[1] };
}
function pool(subj, topic, kind) {
  const tag = q => Object.assign(q, { key: tKey(subj, topic) + "|" + hash(q.q), tname: topic.name });
  if (topic.quiz && topic.quiz.length) return topic.quiz.map(q => tag(Object.assign({}, q)));
  const all = subj.topics.flatMap(t => (t.cards || []).map(c => c.a));
  const sets = (topic.cards || []).map(c => {
    const wrong = (c.wrong && c.wrong.length) ? c.wrong.slice(0, 3) : shuffle([...new Set(all.filter(a => a !== c.a))]).slice(0, 3);
    const mc = wrong.length ? { type: "mc", q: c.q, options: [c.a, ...wrong], correct: 0 } : { type: "self", q: c.q, a: c.a };
    if (!subj.write) return [mc];
    const w = { type: "write", q: "Auf Englisch: " + c.q, prompt: c.q, a: c.a };
    return [mc, w, gapItem(c)].filter(Boolean);
  });
  if (kind === "all") return sets.flat().map(tag);
  if (!subj.write) return sets.map(v => tag(v[0]));
  if (kind === "write") return sets.map(v => tag(pick(v.slice(1))));
  return sets.map(v => tag(Math.random() < .3 ? v[0] : pick(v)));
}
const subjectPool = subj => subj.topics.flatMap(t => pool(subj, t));

/* Schreibaufgaben prüfen */
const normW = s => String(s).toLowerCase().replace(/[’‘`´]/g, "'").replace(/[.?!,;:]/g, " ").replace(/\s+/g, " ").trim();
function variantsW(a) {
  const out = new Set();
  String(a).split(/\s*[\/;]\s*/).forEach(p => {
    if (/\(.*\)/.test(p)) { out.add(p.replace(/[()]/g, "")); out.add(p.replace(/\([^)]*\)/g, "")); } else out.add(p);
  });
  return [...out].map(normW).filter(Boolean);
}
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // vertauschte Buchstaben
  }
  return d[a.length][b.length];
}
function checkWrite(val, a) {
  const n = normW(val), vs = variantsW(a);
  if (vs.includes(n)) return { ok: true };
  if (vs.some(v => v.startsWith("to ") && v.slice(3) === n)) return { ok: true, noTo: true };
  return { ok: false, near: vs.some(v => v.length >= 4 && (lev(n, v) === 1 || (v.startsWith("to ") && lev(n, v.slice(3)) === 1))) };
}
const hintText = a => String(a).split(/\s*[\/;]\s*/)[0].replace(/[()]/g, "").split(" ").map(w => w.split("").map((ch, i) => i === 0 || /[^a-zäöüß]/i.test(ch) ? ch : "_").join(" ")).join("   ");
function focusWrite() { setTimeout(() => { const el = $("#w-in"); if (el && !el.disabled) el.focus(); }, 40); }

/* ========================= Medaillen & Wertung ========================= */
const MEDAL_RANK = { bronze: 1, silber: 2, gold: 3 };
const MEDAL_NAME = { gold: "Gold", silber: "Silber", bronze: "Bronze" };
const medalFor = w => w <= 1 ? "gold" : w <= 3 ? "silber" : "bronze";
function judgeScores(w) {
  if (w === 0) return [10, 10, 10];
  const base = Math.max(6, 10 - 0.4 * w);
  return [0, -0.1, 0.1].map(o => Math.min(9.9, Math.max(6, Math.round((base + o) * 10) / 10)));
}
function medalSVG(m) {
  const col = { gold: "var(--gold)", silber: "var(--silver)", bronze: "var(--bronze)" }[m];
  return `<svg class="medal" viewBox="0 0 86 110" aria-label="${MEDAL_NAME[m]}-Medaille" role="img">
    <path d="M22 0h16l12 40H34z" fill="var(--berry)"/><path d="M64 0H48L36 40h16z" fill="var(--mat)"/>
    <circle cx="43" cy="70" r="34" fill="${col}"/><circle cx="43" cy="70" r="25" fill="none" stroke="var(--surface)" stroke-width="3" opacity=".55"/>
    <path d="M43 52l5.3 10.8 11.9 1.7-8.6 8.4 2 11.8L43 79.1l-10.6 5.6 2-11.8-8.6-8.4 11.9-1.7z" fill="var(--surface)" opacity=".85"/></svg>`;
}

/* ========================= Abzeichen ========================= */
const BADGES = [
  { id: "first", ic: "1.", name: "Erste Medaille", desc: "Die erste Übung bis zur Landung geturnt.", ok: s => s.kueren >= 1 },
  { id: "ten", ic: "10,0", name: "Perfekte 10", desc: "Eine Übung ganz ohne Wackler.", ok: s => s.perfect >= 1 },
  { id: "gold5", ic: "Au", name: "Goldsammlerin", desc: "5 Goldmedaillen gewonnen.", ok: s => (s.medals?.gold || 0) >= 5 },
  { id: "five", ic: "5×", name: "Fleißige Turnerin", desc: "5 Übungen fertig geturnt.", ok: s => s.kueren >= 5 },
  { id: "warm", ic: "30", name: "Aufwärm-Profi", desc: "30 Karteikarten als „kann ich“ markiert.", ok: s => Object.values(s.cards).filter(Boolean).length >= 30 },
  { id: "write", ic: "abc", name: "Schreib-Ass", desc: "25 Wörter richtig geschrieben.", ok: s => (s.written || 0) >= 25 },
  { id: "wk", ic: "2:00", name: "Wettkampf-Star", desc: "2 Übungen in einer Wettkampf-Runde.", ok: s => s.wkBest >= 2 },
  { id: "allgold", ic: "AA", name: "Mehrkampf-Siegerin", desc: "In einem Fach bei jeder Übung Gold.", ok: s => subjects().some(sj => sj.topics.length && sj.topics.every(t => s.topics[tKey(sj, t)]?.medal === "gold")) },
  { id: "star", ic: "100", name: "Turnstar", desc: "100 Sterne gesammelt.", ok: s => s.stars >= 100 }
];
function checkBadges() {
  const got = [];
  for (const b of BADGES) if (!S.badges.includes(b.id) && b.ok(S)) { S.badges.push(b.id); got.push(b); }
  return got;
}

/* ========================= Bausteine ========================= */
function daysTo(test) {
  if (!test) return null;
  const t = new Date(test + "T00:00:00"), n = new Date(); n.setHours(0, 0, 0, 0);
  return Math.round((t - n) / 864e5);
}
function countdown(test) {
  const d = daysTo(test);
  if (d == null || d < 0) return "";
  if (d === 0) return "Heute ist Test – du schaffst das!";
  if (d === 1) return "Morgen ist Test!";
  return `Noch ${d} Tage bis zum Test`;
}
const fmtDate = s => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${+d}.${+m}.${y}`; };
const fmtTs = ts => { const d = new Date(ts); return d.toLocaleDateString("de-AT", { weekday: "short", day: "numeric", month: "numeric" }) + ", " + d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" }); };
const medalCount = () => (S.medals.gold || 0) + (S.medals.silber || 0) + (S.medals.bronze || 0);

function board(extra) {
  const next = subjects().filter(s => countdown(s.test)).sort((a, b) => a.test.localeCompare(b.test))[0];
  const tick = extra || (next ? `<b>${esc(next.name)}</b> · ${countdown(next.test)} (${fmtDate(next.test)})` : "Such dir ein Fach aus und turn deine erste Übung.");
  return `<section class="board" aria-label="Wertungstafel">
    <div class="who"><small>Turnerin</small>${esc(S.player)}</div>
    <div class="digit">${S.stars}<small>Sterne</small></div>
    <div class="digit">${medalCount()}<small>Medaillen</small></div>
    <div class="ticker">${tick}</div>
  </section>`;
}
function subjProgress(s) {
  const cards = s.topics.reduce((n, t) => n + (t.cards || []).length, 0);
  const known = s.topics.reduce((n, t) => n + (t.cards || []).filter((_, i) => S.cards[tKey(s, t) + "|" + i]).length, 0);
  const medals = s.topics.map(t => S.topics[tKey(s, t)]?.medal || "");
  return { cards, known, medals, done: medals.filter(Boolean).length, topics: s.topics.length };
}
const FIG = `<svg viewBox="0 0 30 40" aria-hidden="true"><circle cx="15" cy="6" r="4.2" fill="var(--skin)"/><circle cx="18.6" cy="2.6" r="2.3" fill="var(--hair)"/><path d="M15 12 L6 3 M15 12 L24 3" stroke="var(--skin)" stroke-width="2.6" stroke-linecap="round"/><path d="M10.5 11h9l-1.6 13h-5.8z" fill="var(--berry)"/><path d="M13 24 L10.5 38 M17 24 L19.5 38" stroke="var(--skin)" stroke-width="2.8" stroke-linecap="round"/></svg>`;
const posOnBeam = p => 8 + Math.max(0, Math.min(1, p)) * 76;
function gym(progress, opts = {}) {
  const n = opts.ticks || 0;
  const ticks = Array.from({ length: n }, (_, i) => `<span class="tick ${i < opts.done ? "done" : ""}" style="left:${posOnBeam((i + 1) / n)}%"></span>`).join("");
  let to = posOnBeam(progress), from = opts.from != null ? posOnBeam(opts.from) : to, cls = "";
  if (opts.anim === "hop" && !reduceMotion) cls = "hop";
  if (opts.anim === "wobble" && !reduceMotion) cls = "wobble";
  if (opts.landed) { to = 93; cls = (opts.anim === "dismount" && !reduceMotion) ? "dismount on-mat" : "on-mat"; from = posOnBeam(1); }
  return `<div class="gym" role="img" aria-label="${opts.landed ? "Gelandet auf der Matte" : `Schwebebalken: ${Math.round(progress * 100)} Prozent geschafft`}">
    <span class="floor"></span><span class="leg" style="left:14%"></span><span class="leg" style="left:78%"></span>
    <span class="beam"></span>${ticks}<span class="matte"></span>
    <div class="fig ${cls}" style="left:${to}%;--from:${from}%;--to:${to}%">${FIG}</div>
  </div>`;
}

/* ========================= Navigation ========================= */
function go(name, params = {}) {
  if (D && D.timer) { clearInterval(D.timer); D.timer = null; }
  if (view.name === "kuer" && name !== "kuer" && D && D.phase === "play" && (D.correct || D.wobbles))
    logActivity({ kind: "abort", subj: D.s.name, topic: D.mode === "wk" ? "Wettkampf-Runde" : D.t.name, mode: D.mode === "wk" ? "Wettkampf" : D.kind === "write" ? "Schreiben" : "Turnen", correct: D.correct, wobbles: D.wobbles, missed: D.missed });
  view = Object.assign({ name }, params);
  render();
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}
function render() {
  const v = view.name;
  if (v === "home") return renderHome();
  if (v === "subject") return renderSubject();
  if (v === "warm") return renderWarm();
  if (v === "kuer") return renderKuer();
  if (v === "add") return renderEditor();
  if (v === "vitrine") return renderVitrine();
  renderHome();
}

/* ========================= Emma: Start ========================= */
function renderHome() {
  const list = subjects();
  const cards = list.map(s => {
    const p = subjProgress(s);
    const pct = p.cards ? Math.round(p.known / p.cards * 100) : 0;
    return `<button class="subj" data-act="subject" data-s="${esc(s.id)}">
      <span class="eyebrow">${s.test ? "Test am " + fmtDate(s.test) : "Fach"}</span>
      <h2>${esc(s.name)}</h2>
      <span class="medals" aria-label="${p.done} von ${p.topics} Übungen mit Medaille">${p.medals.map(m => `<i class="m ${m}"></i>`).join("")}</span>
      <span class="meta">${p.topics} Übung${p.topics === 1 ? "" : "en"} · ${p.done} mit Medaille</span>
      <span class="bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
      <span class="meta">${p.known}/${p.cards} Karten gekonnt</span>
    </button>`;
  }).join("");
  app.innerHTML = `${board()}
    <div class="spread"><h1>Deine Turnhalle</h1><button class="btn small ghost" data-act="vitrine">Pokalvitrine</button></div>
    ${list.length ? "" : `<div class="empty"><span class="eyebrow">Noch leer</span><h2>Hier kommen deine Fächer hin</h2>
      <p class="muted">Jedes Fach bekommt seine Übungen: Aufwärmen mit Karteikarten und Turnen am Schwebebalken mit Quizfragen. Leg mit „Fach hinzufügen“ ein neues Fach an.</p></div>`}
    <div class="grid">${cards}
      <button class="subj add" data-act="add"><span class="plus">+</span><span class="eyebrow">Fach hinzufügen</span></button>
    </div>
    <div class="foot"><p class="sync">${esc(syncLabel)}</p><a class="linkbtn" href="eltern.html">Für Eltern</a></div>`;
}

function renderSubject() {
  const s = getSubj(view.s); if (!s) return go("home");
  const p = subjProgress(s);
  const rows = s.topics.map((t, i) => {
    const st = S.topics[tKey(s, t)] || {};
    const known = (t.cards || []).filter((_, k) => S.cards[tKey(s, t) + "|" + k]).length;
    const nq = pool(s, t).length;
    return `<div class="play">
      <span class="no">${i + 1}</span>
      <div class="info"><h3>${esc(t.name)}</h3>
        <div class="chips">
          <span class="chip ${known && known === (t.cards || []).length ? "ok" : ""}">Karten ${known}/${(t.cards || []).length}</span>
          <span class="chip">${nq} Fragen</span>
          ${st.medal ? `<span class="chip ${st.medal}">${MEDAL_NAME[st.medal]} · ${de(st.best || 0)}</span>` : ""}
          ${st.perfect ? `<span class="chip gold">Perfekte 10</span>` : ""}
        </div></div>
      <div class="actions">
        ${(t.cards || []).length ? `<button class="btn small" data-act="warm" data-s="${esc(s.id)}" data-t="${esc(t.id)}">Aufwärmen</button>` : ""}
        ${s.write && nq ? `<button class="btn small mat" data-act="kuer" data-k="write" data-s="${esc(s.id)}" data-t="${esc(t.id)}">Schreiben</button>` : ""}
        ${nq ? `<button class="btn small primary" data-act="kuer" data-s="${esc(s.id)}" data-t="${esc(t.id)}">Turnen</button>` : ""}
      </div></div>`;
  }).join("");
  app.innerHTML = `${board(s.test && countdown(s.test) ? `<b>${esc(s.name)}</b> · ${countdown(s.test)} (${fmtDate(s.test)})` : `<b>${esc(s.name)}</b> · ${p.done}/${p.topics} Übungen mit Medaille`)}
    <button class="back" data-act="home">← Alle Fächer</button>
    <div class="spread"><h1>${esc(s.name)}</h1>
      ${s.builtin ? "" : `<div class="row"><button class="btn small ghost" data-act="edit" data-s="${esc(s.id)}">Bearbeiten</button><button class="btn small danger" data-act="askdel">Löschen</button></div>`}
    </div>
    ${view.confirmDel ? `<div class="confirm"><span>„${esc(s.name)}“ wirklich löschen? Medaillen und Sterne bleiben.</span><div class="row"><button class="btn small ghost" data-act="canceldel">Abbrechen</button><button class="btn small danger" data-act="del" data-s="${esc(s.id)}">Ja, löschen</button></div></div>` : ""}
    <p class="muted"><b>Aufwärmen</b> = Karteikarten lernen.${s.write ? ` <b>Schreiben</b> = jedes Wort selbst eintippen, auch in Lückensätzen.` : ""} <b>Turnen</b> = Quiz am Schwebebalken${s.write ? " (gemischt: auswählen und schreiben)" : ""}: Jede richtige Antwort ist ein Element, du turnst ein Stück weiter. Am Ende landest du auf der Matte und die Kampfrichterinnen geben dir eine Wertung.</p>
    <div class="plays">${rows}</div>
    ${subjectPool(s).length >= 4 ? `<section class="wk">
      <div><span class="eyebrow">Generalprobe</span><h2>Wettkampf-Runde</h2>
      <p>2 Minuten, Fragen aus allen Übungen gemischt. 10 richtige Antworten sind eine ganze Übung. Wie viele schaffst du?</p></div>
      <button class="btn" data-act="wk" data-s="${esc(s.id)}">Los geht's!</button>
    </section>` : ""}`;
}

/* ---------- Aufwärmen (Karteikarten) ---------- */
let H = null;
function startWarm(sid, tid) {
  const s = getSubj(sid), t = getTopic(s, tid);
  H = { s, t, queue: shuffle(t.cards.map((c, i) => i)), flip: false, gained: 0, again: 0 };
  go("warm");
}
function renderWarm() {
  const { s, t } = H;
  if (!H.queue.length) {
    const known = t.cards.filter((_, i) => S.cards[tKey(s, t) + "|" + i]).length;
    app.innerHTML = `${board()}
      <section class="card finale"><span class="eyebrow">Aufwärmen fertig</span><h2>Gut aufgewärmt! Alle Karten durch.</h2>
        <p class="pts">${known} von ${t.cards.length} Karten kannst du${H.gained ? ` · <b>+${H.gained}</b> Sterne` : ""}</p>
        <div class="row" style="justify-content:center">
          <button class="btn" data-act="warm" data-s="${esc(s.id)}" data-t="${esc(t.id)}">Nochmal</button>
          <button class="btn primary" data-act="kuer" data-s="${esc(s.id)}" data-t="${esc(t.id)}">Jetzt turnen</button>
        </div>
        <button class="back" data-act="subject" data-s="${esc(s.id)}" style="align-self:center">← Zu den Übungen</button>
      </section>`;
    return;
  }
  const i = H.queue[0], c = t.cards[i];
  app.innerHTML = `${board(`<b>Aufwärmen</b> · ${esc(t.name)} · noch ${H.queue.length} Karte${H.queue.length === 1 ? "" : "n"}`)}
    <button class="back" data-act="subject" data-s="${esc(s.id)}">← ${esc(s.name)}</button>
    <button class="flash ${H.flip ? "flip" : ""}" data-act="flip" aria-label="Karte umdrehen">
      <div class="flash-in">
        <div class="face"><span class="hint">Frage · tippen zum Umdrehen</span><p class="big">${esc(c.q)}</p></div>
        <div class="face ans"><span class="hint">Antwort</span><p class="big">${esc(c.a)}</p>${c.ex ? `<p class="muted"><i>${esc(c.ex.replace(/[\[\]]/g, ""))}</i></p>` : ""}</div>
      </div>
    </button>
    ${H.flip ? `<div class="row" style="justify-content:center">
      <button class="btn" data-act="hagain">Nochmal üben</button>
      <button class="btn primary" data-act="hknow">Kann ich</button></div>`
      : `<div class="row" style="justify-content:center"><button class="btn primary" data-act="flip">Antwort zeigen</button></div>`}`;
}
function endWarm() {
  const { s, t } = H;
  const known = t.cards.filter((_, i) => S.cards[tKey(s, t) + "|" + i]).length;
  logActivity({ kind: "warm", subj: s.name, topic: t.name, known, total: t.cards.length, again: H.again, stars: H.gained });
}

/* ---------- Turnen (Quiz am Balken) ---------- */
let D = null;
const ELEMENTS = ["Rad geschlagen!", "Handstand – gestreckt!", "Spagatsprung!", "Pirouette!", "Strecksprung!", "Brücke!", "Radwende!", "Hocksprung!", "Standwaage!"];
const ELEMENTS_BIG = ["Flickflack!", "Salto – wow!", "Schraube – was für ein Element!", "Ganz sicher auf dem Balken!"];
const WOBBLES = ["Kleiner Wackler!", "Arme ausbreiten, Balance halten!", "Fast gefallen – weiter geht's!", "Uups, Wackler!"];

function startKuer(sid, tid, kind) {
  const s = getSubj(sid), t = getTopic(s, tid);
  const qs = shuffle(pool(s, t, kind)).slice(0, s.write ? 20 : 12);
  D = { mode: "kuer", kind: kind || "mix", s, t, queue: qs, total: qs.length, prog: 0, prev: 0, wobbles: 0, streak: 0, correct: 0, fb: null, cur: null, anim: null, phase: "play", missed: [] };
  nextQ(); go("kuer"); focusWrite();
}
function startWK(sid) {
  const s = getSubj(sid);
  D = { mode: "wk", s, t: null, src: shuffle(subjectPool(s)), queue: [], prog: 0, prev: 0, wobbles: 0, streak: 0, correct: 0, kCount: 0, time: 120, fb: null, cur: null, anim: null, phase: "play", missed: [] };
  D.queue = D.src.slice();
  nextQ(); go("kuer");
  D.timer = setInterval(tick, 1000);
}
function tick() {
  if (!D || D.mode !== "wk" || D.phase !== "play") return;
  if (D.fb && !D.fb.ok) return; // pausiert, solange die Auflösung gelesen wird
  D.time--;
  const el = $("#timer");
  if (el) { el.textContent = fmtTime(D.time); el.classList.toggle("low", D.time <= 15); }
  if (D.time <= 0) { clearInterval(D.timer); D.timer = null; endWK(); }
}
const fmtTime = s => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

function nextQ() {
  if (D.mode === "wk" && !D.queue.length) D.queue = shuffle(D.src);
  const item = D.queue.shift();
  D.fb = null; D.anim = null;
  if (!item) { D.cur = null; return; }
  D.cur = prepare(item);
}
function prepare(item) {
  const cur = { item };
  if (item.type === "mc") cur.opts = shuffle(item.options.map((o, i) => ({ text: o, ok: i === item.correct })));
  if (item.type === "order") { cur.pool = shuffle(item.items.map((x, i) => ({ text: x, i }))); cur.ans = []; if (cur.pool.every((p, k) => p.i === k)) cur.pool.reverse(); }
  return cur;
}
function noteMiss(item, ok) {
  if (!item.key) return;
  if (!ok) S.miss[item.key] = (S.miss[item.key] || 0) + 1;
}

function answer(ok, solution) {
  const item = D.cur.item;
  D.cur.done = true;
  noteMiss(item, ok);
  D.prev = D.prog;
  if (ok) {
    D.correct++; D.streak++;
    D.prog = D.mode === "wk" ? D.prog + 0.1 : D.correct / D.total;
    D.anim = "hop";
    D.fb = { ok: true, call: D.streak >= 3 ? pick(ELEMENTS_BIG) : pick(ELEMENTS), text: D.streak >= 3 ? `${D.streak} richtige in Folge!` : "", explain: item.explain };
    if (item.type === "write") { S.written = (S.written || 0) + 1; if (D.cur.noTo) D.fb.text = `Richtig! Im Test schreibst du am besten „${item.a}“ – mit „to“.`; }
  } else {
    D.wobbles++; D.streak = 0; D.anim = "wobble"; D.missed.push(solution);
    if (D.mode === "kuer") D.queue.push(item); // Frage kommt später nochmal
    D.fb = { ok: false, call: item.type === "write" && D.cur.near ? "Fast! Nur ein Buchstabe falsch." : pick(WOBBLES), text: item.type === "write" && D.cur.typed ? `Du hast geschrieben: „${D.cur.typed}“` : "", solution, explain: item.explain };
  }
  if (D.mode === "wk" && D.prog >= 0.999) {
    D.kCount++; S.stars += 6; S.kueren++; D.fb.call = "Übung geschafft! +6 Sterne"; D.prog = 0; D.prev = 0; D.anim = null; burst(); save();
  }
  render(); D.anim = null;
  if (D.mode === "wk" && ok) setTimeout(() => { if (D && D.fb && D.fb.ok && D.phase === "play") { nextQ(); render(); focusWrite(); } }, 800);
  else setTimeout(() => $("#next")?.focus(), 30);
}
function cont() {
  if (D.mode === "kuer" && !D.queue.length && D.fb?.ok) { landing(); return; }
  nextQ(); render(); focusWrite();
}

function landing() {
  D.phase = "landed";
  const k = tKey(D.s, D.t);
  const st = S.topics[k] || {};
  const medal = medalFor(D.wobbles), scores = judgeScores(D.wobbles);
  const score = Math.round(scores.reduce((a, b) => a + b, 0) / 3 * 10) / 10;
  D.medal = medal; D.scores = scores; D.score = score;
  D.earned = 6; S.stars += 6; S.kueren++;
  S.medals[medal] = (S.medals[medal] || 0) + 1;
  if (!st.medal || MEDAL_RANK[medal] > MEDAL_RANK[st.medal]) st.medal = medal;
  st.best = Math.max(st.best || 0, score); st.plays = (st.plays || 0) + 1;
  if (D.wobbles === 0) { st.perfect = true; S.perfect++; D.earned += 2; S.stars += 2; D.bonus = "ten"; }
  else D.bonus = "extra";
  S.topics[k] = st;
  D.newBadges = checkBadges();
  logActivity({ kind: "kuer", mode: D.kind, subj: D.s.name, topic: D.t.name, total: D.total, wobbles: D.wobbles, medal, score, stars: D.earned, missed: D.missed });
  save(); D.anim = "dismount"; render(); D.anim = null;
  setTimeout(burst, reduceMotion ? 0 : 700);
}
function startExtra() {
  const pl = shuffle(subjectPool(D.s));
  D.phase = "extra"; D.queue = []; D.cur = prepare(pl[0]); D.fb = null; render(); focusWrite();
}
function extraAnswer(ok, solution) {
  D.cur.done = true; noteMiss(D.cur.item, ok);
  if (ok && D.cur.item.type === "write") S.written = (S.written || 0) + 1;
  if (ok) { D.earned++; S.stars++; D.fb = { ok: true, call: "Zusatzelement gestanden!", text: "+1 Stern", explain: D.cur.item.explain }; }
  else D.fb = { ok: false, call: "Knapp daneben!", text: "Kein Zusatzstern, aber deine Medaille hast du sicher.", solution, explain: D.cur.item.explain };
  D.newBadges = (D.newBadges || []).concat(checkBadges());
  save(); render();
}
function endWK() {
  D.phase = "wkend";
  S.wkBest = Math.max(S.wkBest, D.kCount);
  S.stars += D.correct; // 1 Stern je richtige Antwort
  D.newBadges = checkBadges();
  logActivity({ kind: "wk", subj: D.s.name, topic: "Wettkampf-Runde (alle Übungen)", correct: D.correct, wobbles: D.wobbles, kueren: D.kCount, stars: D.kCount * 6 + D.correct, missed: D.missed });
  save(); if (D.kCount) burst(); render();
}

function questionHTML() {
  const { item, opts } = D.cur, done = D.cur.done;
  const tag = item.type === "write" ? (item.gap ? "Lückensatz · Schreib das fehlende Wort" : "Schreibsprung · Tippe das englische Wort")
    : { mc: "Element · Wähle die richtige Antwort", tf: "Sprung · Stimmt das?", order: "Choreografie · Tippe in der richtigen Reihenfolge", self: "Selbstcheck" }[item.type];
  let body = "", qtext = `<p class="q">${esc(item.q)}</p>`;
  if (item.type === "write") {
    const c = D.cur;
    qtext = item.gap
      ? `<p class="q">${esc(item.sentence).replace("\u0000", `<span class="gap">${done ? esc(item.a) : "&nbsp;"}</span>`)}</p><p class="muted">Deutsch: <b>${esc(item.prompt)}</b></p>`
      : `<p class="q">Wie heißt das auf Englisch?</p><p class="vocab">${esc(item.prompt)}</p>`;
    body = `<form id="wform" class="wform">
      <label for="w-in" class="sr">Deine Antwort</label>
      <input id="w-in" class="${done ? (D.fb?.ok ? "right" : "wrong") : ""}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="Hier schreiben …" value="${esc(c.typed || "")}" ${done ? "disabled" : ""}>
      ${c.hint && !done ? `<p class="hintline">Tipp: <b>${esc(hintText(item.a))}</b></p>` : ""}
      ${done ? "" : `<div class="row"><button class="btn primary" type="submit">Prüfen</button>${c.hint ? "" : `<button class="btn ghost small" type="button" data-act="whint">Tipp zeigen</button>`}</div>`}
    </form>`;
  } else if (item.type === "mc") {
    body = `<div class="opts">${opts.map((o, i) => `<button class="opt ${done ? (o.ok ? "right" : (D.cur.pickedI === i ? "wrong" : "")) : ""}" data-act="mc" data-i="${i}" ${done ? "disabled" : ""}><span class="k">${i + 1}</span><span>${esc(o.text)}</span></button>`).join("")}</div>`;
  } else if (item.type === "tf") {
    const cls = v => done ? (v === item.answer ? "right" : (D.cur.picked === v ? "wrong" : "")) : "";
    body = `<div class="tf"><button class="opt ${cls(true)}" data-act="tf" data-v="1" ${done ? "disabled" : ""}>Stimmt</button><button class="opt ${cls(false)}" data-act="tf" data-v="0" ${done ? "disabled" : ""}>Stimmt nicht</button></div>`;
  } else if (item.type === "order") {
    const c = D.cur;
    body = `<div class="order-ans" aria-label="Deine Reihenfolge">${c.ans.map((p, k) => `<button class="tok ${done ? (p.i === k ? "right" : "wrong") : ""}" data-act="ounpick" data-k="${k}" ${done ? "disabled" : ""}>${esc(p.text)}</button>`).join("") || `<span class="muted" style="padding:8px">Tippe unten die Begriffe in der richtigen Reihenfolge an.</span>`}</div>
      ${done ? "" : `<div class="order-pool">${c.pool.map((p, k) => `<button class="tok" data-act="opick" data-k="${k}">${esc(p.text)}</button>`).join("")}</div>
      <div class="row"><button class="btn primary" data-act="ocheck" ${c.pool.length ? "disabled" : ""}>Prüfen</button><button class="btn ghost small" data-act="oreset">Zurücksetzen</button></div>`}`;
  } else if (item.type === "self") {
    body = D.cur.shown ? `<p class="sol">${esc(item.a)}</p>${done ? "" : `<div class="row"><button class="btn" data-act="selfno">Nicht gewusst</button><button class="btn primary" data-act="selfyes">Gewusst</button></div>`}`
      : `<button class="btn primary" data-act="selfshow">Antwort zeigen</button>`;
  }
  let fb = "";
  if (D.fb) {
    const f = D.fb;
    const last = D.phase === "extra" || (D.mode === "kuer" && !D.queue.length && f.ok);
    fb = `<div class="feedback ${f.ok ? "good" : "bad"}"><span class="call">${esc(f.call)}</span>
      ${f.text ? `<span>${esc(f.text)}</span>` : ""}
      ${!f.ok && f.solution ? `<span class="sol">Richtig ist: ${esc(f.solution)}</span>` : ""}
      ${f.explain ? `<span class="muted">${esc(f.explain)}</span>` : ""}
      ${!f.ok && D.mode === "kuer" && D.phase === "play" ? `<span class="muted">Diese Frage kommt in der Übung nochmal.</span>` : ""}
      ${D.mode === "wk" && f.ok ? "" : `<div class="row"><button class="btn primary" id="next" data-act="${D.phase === "extra" ? "extradone" : "next"}">${D.phase === "extra" ? "Weiter" : last ? "Abgang und Landung!" : "Nächstes Element"}</button></div>`}
    </div>`;
  }
  return `<section class="card"><span class="qtag">${tag}</span>${qtext}${body}${fb}</section>`;
}

function renderKuer() {
  const d = D, s = d.s;
  if (d.phase === "landed") {
    app.innerHTML = `${board()}${gym(1, { landed: true, anim: d.anim })}
      <section class="card finale"><span class="eyebrow">${esc(d.t.name)}${d.kind === "write" ? " · Schreiben" : ""}</span><h1>Gestanden!</h1>
        ${medalSVG(d.medal)}
        <p class="pts">${MEDAL_NAME[d.medal]}-Medaille · Wertung <b>${de(d.score)}</b></p>
        <div class="judges">${d.scores.map((x, i) => `<div class="judge"><b>${de(x)}</b><span>Richterin ${i + 1}</span></div>`).join("")}</div>
        <p class="pts"><b>+6</b> Sterne${d.bonus === "ten" ? ` · Perfekte 10: <b>+2</b> Bonus` : ""}</p>
        <div class="statgrid"><div class="stat"><b>${d.total}</b><span>Elemente</span></div><div class="stat"><b>${d.wobbles}</b><span>Wackler</span></div><div class="stat"><b>${S.stars}</b><span>Sterne gesamt</span></div></div>
        ${badgeNote(d.newBadges)}
        <div class="row" style="justify-content:center">
          ${d.bonus === "extra" ? `<button class="btn primary" data-act="extra">Zusatzelement versuchen (+1)</button>` : ""}
          <button class="btn ${d.bonus === "extra" ? "" : "primary"}" data-act="kuer" data-k="${d.kind}" data-s="${esc(s.id)}" data-t="${esc(d.t.id)}">Nochmal turnen</button>
          <button class="btn ghost" data-act="subject" data-s="${esc(s.id)}">Zu den Übungen</button>
        </div></section>`;
    return;
  }
  if (d.phase === "extra") {
    app.innerHTML = `${board(`<b>Zusatzelement</b> · Eine Bonusfrage aus ganz ${esc(s.name)}`)}${questionHTML()}`;
    return;
  }
  if (d.phase === "extradone") {
    app.innerHTML = `${board()}<section class="card finale"><h2>Übung beendet – toll geturnt!</h2>
      <p class="pts">Diese Übung: <b>+${d.earned}</b> Sterne</p>${badgeNote(d.newBadges)}
      <div class="row" style="justify-content:center"><button class="btn primary" data-act="subject" data-s="${esc(s.id)}">Zu den Übungen</button>
      <button class="btn" data-act="kuer" data-k="${d.kind}" data-s="${esc(s.id)}" data-t="${esc(d.t.id)}">Nochmal turnen</button></div></section>`;
    return;
  }
  if (d.phase === "wkend") {
    app.innerHTML = `${board()}<section class="card finale"><span class="eyebrow">Wettkampf-Runde · ${esc(s.name)}</span>
      <h1>${d.kCount ? (d.kCount === 1 ? "1 Übung geschafft!" : d.kCount + " Übungen geschafft!") : "Zeit um!"}</h1>
      <div class="statgrid"><div class="stat"><b>${d.correct}</b><span>Richtig</span></div><div class="stat"><b>${d.wobbles}</b><span>Wackler</span></div><div class="stat"><b>${d.kCount * 6 + d.correct}</b><span>Sterne</span></div><div class="stat"><b>${S.wkBest}</b><span>Rekord</span></div></div>
      ${badgeNote(d.newBadges)}
      <div class="row" style="justify-content:center"><button class="btn primary" data-act="wk" data-s="${esc(s.id)}">Nochmal 2 Minuten</button>
      <button class="btn ghost" data-act="subject" data-s="${esc(s.id)}">Zu den Übungen</button></div></section>`;
    return;
  }
  const combo = `<span class="combo" aria-label="${d.streak} richtige in Folge">${[0, 1, 2].map(i => `<i class="${d.streak > i ? "on" : ""}"></i>`).join("")}</span>`;
  const st = d.mode === "kuer"
    ? `<span>Element ${Math.min(d.correct + 1, d.total)} von ${d.total}</span><span>Serie ${combo}</span><span>Wackler: <b>${d.wobbles}</b></span>`
    : `<span>Übungen: <b>${d.kCount}</b></span><span>Serie ${combo}</span><span id="timer" class="timer ${d.time <= 15 ? "low" : ""}">${fmtTime(d.time)}</span>`;
  app.innerHTML = `${board(`<b>${d.mode === "wk" ? "Wettkampf-Runde" : esc(d.t.name) + (d.kind === "write" ? " · Schreiben" : "")}</b> · ${esc(s.name)}`)}
    <div class="spread"><button class="back" data-act="subject" data-s="${esc(s.id)}">← Übung abbrechen</button></div>
    ${gym(d.prog, { from: d.prev, anim: d.anim, ticks: d.mode === "kuer" ? d.total : 10, done: d.mode === "kuer" ? d.correct : Math.round(d.prog * 10) })}
    <div class="status">${st}</div>
    ${d.cur ? questionHTML() : ""}`;
}
function badgeNote(list) {
  if (!list || !list.length) return "";
  return `<p class="okmsg">Neues Abzeichen: ${list.map(b => esc(b.name)).join(", ")}</p>`;
}
function solutionText(item) {
  if (item.type === "mc") return item.options[item.correct];
  if (item.type === "tf") return item.answer ? "Stimmt" : "Stimmt nicht";
  if (item.type === "order") return item.items.join(" → ");
  if (item.type === "self" || item.type === "write") return item.a;
}
function judge(ok) {
  const sol = solutionText(D.cur.item);
  if (D.phase === "extra") extraAnswer(ok, sol); else answer(ok, sol);
}

/* ---------- Fach anlegen / bearbeiten (Emma & Eltern) ---------- */
const SAMPLE = `# Englisch – Tiere
F: die Katze
A: the cat
F: das Pferd
A: the horse
X: the house
X: the hose

# Mathe – Einmaleins
F: 7 · 8 = ?
A: 56
X: 54
X: 64`;
function subjectToText(s) {
  return s.topics.map(t => `# ${t.name}\n` + (t.cards || []).map(c => `F: ${c.q}\nA: ${c.a}` + (c.ex ? `\nS: ${c.ex}` : "") + (c.wrong || []).map(w => `\nX: ${w}`).join("")).join("\n")).join("\n\n");
}
function parseText(txt) {
  const topics = []; let t = null, c = null; const errs = [];
  const ensureTopic = () => { if (!t) { t = { name: "Allgemein", cards: [] }; topics.push(t); } };
  txt.split(/\r?\n/).forEach((raw, n) => {
    const line = raw.trim(); if (!line) return;
    if (line.startsWith("#")) { t = { name: line.replace(/^#+\s*/, "") || "Übung", cards: [] }; topics.push(t); c = null; return; }
    const m = line.match(/^([FAXS])\s*:\s*(.*)$/i);
    if (!m) { if (c && c.a !== undefined) c.a += " " + line; else if (c) c.q += " " + line; else errs.push(`Zeile ${n + 1}: Bitte mit „F:“, „A:“, „S:“, „X:“ oder „#“ beginnen.`); return; }
    const k = m[1].toUpperCase(), val = m[2].trim();
    if (k === "F") { ensureTopic(); c = { q: val }; t.cards.push(c); }
    else if (k === "A") { if (!c) errs.push(`Zeile ${n + 1}: Antwort ohne Frage davor.`); else c.a = val; }
    else if (k === "X") { if (!c) errs.push(`Zeile ${n + 1}: Falsche Antwort ohne Frage davor.`); else (c.wrong = c.wrong || []).push(val); }
    else if (k === "S") { if (!c) errs.push(`Zeile ${n + 1}: Beispielsatz ohne Frage davor.`); else c.ex = val; }
  });
  topics.forEach(tp => tp.cards.forEach(cd => { if (!cd.a) errs.push(`„${cd.q.slice(0, 40)}“ hat keine Antwort (A:).`); }));
  const clean = topics.filter(tp => tp.cards.length).map((tp, i) => ({ id: slug(tp.name) + "-" + i, name: tp.name, cards: tp.cards.map(cd => Object.assign({ q: cd.q, a: cd.a || "" }, cd.ex ? { ex: cd.ex } : {}, cd.wrong ? { wrong: cd.wrong } : {})) }));
  return { topics: clean, errs };
}
function editorHTML(ed, backAct, backAttrs) {
  return `<button class="back" data-act="${backAct}" ${backAttrs || ""}>← Zurück</button>
    <h1>${ed ? "Fach bearbeiten" : "Neues Fach"}</h1>
    <div class="formgrid">
      <label for="f-name">Name des Fachs<input id="f-name" value="${esc(ed ? ed.name : "")}" placeholder="z. B. Englisch"></label>
      <label for="f-test">Testdatum (optional)<input id="f-test" type="date" value="${esc(ed ? ed.test || "" : "")}"></label>
    </div>
    <div class="help">
      <b>So schreibst du die Fragen</b>
      <span><code># Thema</code> startet eine neue Übung (Thema).</span>
      <span><code>F:</code> Frage &nbsp; <code>A:</code> richtige Antwort &nbsp; <code>X:</code> falsche Antwort (optional, bis zu 3).</span>
      <span><code>S:</code> Beispielsatz (optional), das gesuchte Wort in eckigen Klammern, z. B. <code>S: Can you [carry] my guitar?</code> – daraus wird ein Lückensatz.</span>
      <span class="muted">Ohne <code>X:</code> nimmt die App automatisch Antworten anderer Fragen als falsche Auswahl. Aus jeder Frage wird eine Karteikarte (Aufwärmen) und eine Quizfrage (Turnen). Mehrere richtige Schreibweisen mit „/“ trennen, z. B. <code>A: cannot / can't</code>.</span>
    </div>
    <label class="check" for="f-write"><input type="checkbox" id="f-write" ${ed && ed.write ? "checked" : ""}> Schreibübungen: Antworten selbst eintippen (ideal für Vokabeln)</label>
    <label for="f-text">Fragen<textarea id="f-text" spellcheck="false" placeholder="${esc(SAMPLE)}">${esc(ed ? subjectToText(ed) : "")}</textarea></label>
    <p id="f-preview" class="muted">Noch keine Fragen.</p>
    <div class="row"><button class="btn primary" data-act="savesubj">${ed ? "Änderungen speichern" : "Fach anlegen"}</button>
    ${ed ? "" : `<button class="btn ghost small" data-act="sample">Beispiel einfügen</button>`}</div>`;
}
function renderEditor() {
  const ed = view.edit ? getSubj(view.edit) : null;
  app.innerHTML = `${board()}${editorHTML(ed, ed ? "subject" : "home", ed ? `data-s="${esc(ed.id)}"` : "")}`;
  updatePreview();
}
function updatePreview() {
  const el = $("#f-preview"), ta = $("#f-text"); if (!el || !ta) return;
  if (!ta.value.trim()) { el.className = "muted"; el.textContent = "Noch keine Fragen."; return; }
  const r = parseText(ta.value);
  const n = r.topics.reduce((a, t) => a + t.cards.length, 0);
  if (r.errs.length) { el.className = "err"; el.textContent = r.errs.slice(0, 3).join(" "); }
  else { el.className = "okmsg"; el.textContent = `${r.topics.length} Übung${r.topics.length === 1 ? "" : "en"}, ${n} Frage${n === 1 ? "" : "n"} erkannt.`; }
}
async function saveSubject() {
  const name = $("#f-name").value.trim(), test = $("#f-test").value, r = parseText($("#f-text").value);
  const el = $("#f-preview");
  if (!name) { el.className = "err"; el.textContent = "Bitte gib dem Fach einen Namen."; $("#f-name").focus(); return; }
  if (r.errs.length || !r.topics.length) { el.className = "err"; el.textContent = r.errs[0] || "Bitte mindestens eine Frage mit F: und A: eingeben."; return; }
  const editId = view.edit;
  let id = editId || slug(name);
  if (!editId) { let k = id, n = 2; while (getSubj(k)) k = id + "-" + n++; id = k; }
  const data = { name, test: test || "", write: !!$("#f-write")?.checked, topics: r.topics, updated: Date.now() };
  const local = () => { custom = custom.filter(s => s.id !== id).concat([{ id, ...data }]); lsSet("emma_subjects", custom); };
  local();
  go("subject", { s: id });
}
async function deleteSubject(id) {
  custom = custom.filter(s => s.id !== id); lsSet("emma_subjects", custom);
}

/* ---------- Pokalvitrine ---------- */
function renderVitrine() {
  checkBadges();
  app.innerHTML = `${board()}
    <button class="back" data-act="home">← Alle Fächer</button>
    <h1>Pokalvitrine</h1>
    <div class="statgrid">
      <div class="stat"><b style="color:var(--gold)">${S.medals.gold || 0}</b><span>Gold</span></div>
      <div class="stat"><b style="color:var(--silver)">${S.medals.silber || 0}</b><span>Silber</span></div>
      <div class="stat"><b style="color:var(--bronze)">${S.medals.bronze || 0}</b><span>Bronze</span></div>
      <div class="stat"><b>${S.perfect}</b><span>Perfekte 10</span></div>
      <div class="stat"><b>${Object.values(S.cards).filter(Boolean).length}</b><span>Karten gekonnt</span></div>
    </div>
    <h2>Abzeichen</h2>
    <div class="badges">${BADGES.map(b => `<div class="badge ${S.badges.includes(b.id) ? "on" : ""}"><span class="ic">${b.ic}</span><div><b>${esc(b.name)}</b><span>${esc(b.desc)}</span></div></div>`).join("")}</div>
    <h2>Turnerin</h2>
    <div class="row" style="align-items:flex-end"><label for="f-player" style="flex:1;min-width:200px">Name auf der Wertungstafel<input id="f-player" value="${esc(S.player)}" maxlength="20"></label><button class="btn" data-act="saveplayer">Speichern</button></div>
    <h2>Eltern-Benachrichtigung</h2>
    ${parentJustLinked ? `<p class="okmsg">Eltern-Code über den Link übernommen.</p>` : ""}
    <p class="muted">Ist ein Eltern-Code eingetragen, bekommen Mama oder Papa in der Eltern-App eine Meldung, sobald eine Übung fertig ist.</p>
    ${!ntfyTopic() ? `
      <div class="row" style="align-items:flex-end"><label for="f-ntfy" style="flex:1;min-width:200px">Eltern-Code<input id="f-ntfy" type="password" placeholder="Code von Mama oder Papa" autocomplete="off" autocapitalize="off" spellcheck="false"></label><button class="btn" data-act="saventfy">Speichern</button></div>`
    : view.unlocked ? `
      <div class="row" style="align-items:flex-end"><label for="f-ntfy" style="flex:1;min-width:200px">Neuer Eltern-Code<input id="f-ntfy" value="${esc(ntfyTopic())}" autocomplete="off" autocapitalize="off" spellcheck="false"></label><button class="btn" data-act="saventfy">Speichern</button></div>
      <div class="row"><span class="chip ok">Entsperrt</span><button class="btn small danger" data-act="offntfy">Ausschalten</button><button class="btn small ghost" data-act="lockntfy">Wieder sperren</button></div>`
    : `
      <div class="row"><span class="chip ok">Aktiv · gesperrt</span><button class="btn small ghost" data-act="testntfy">Test-Nachricht senden</button></div>
      <p class="muted">Ändern oder ausschalten können nur Mama oder Papa mit dem Eltern-Code.</p>
      <div class="row" style="align-items:flex-end"><label for="f-unlock" style="flex:1;min-width:200px">Eltern-Code zum Entsperren<input id="f-unlock" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"></label><button class="btn" data-act="unlockntfy">Entsperren</button></div>`}
    <p id="ntfy-msg" class="muted"></p>
    <h2>Fortschritt</h2>
    ${view.confirmReset ? `<div class="confirm"><span>Alle Sterne, Medaillen und Abzeichen auf 0 setzen?</span><div class="row"><button class="btn small ghost" data-act="cancelreset">Abbrechen</button><button class="btn small danger" data-act="reset">Ja, zurücksetzen</button></div></div>`
      : `<button class="btn small danger" data-act="askreset" style="align-self:flex-start">Fortschritt zurücksetzen</button>`}
    <p class="sync">${esc(syncLabel)}</p>`;
}

/* ========================= Events ========================= */
document.addEventListener("submit", e => {
  if (e.target.id !== "wform") return;
  e.preventDefault();
  if (!D || !D.cur || D.cur.done) return;
  const val = $("#w-in").value;
  if (!val.trim()) { $("#w-in").focus(); return; }
  const r = checkWrite(val, D.cur.item.a);
  D.cur.typed = val.trim(); D.cur.near = r.near; D.cur.noTo = r.noTo;
  judge(r.ok);
});
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
  const a = b.dataset.act, sid = b.dataset.s, tid = b.dataset.t;
  switch (a) {
    case "home": go("home"); break;
    case "subject": go("subject", { s: sid }); break;
    case "add": go("add"); break;
    case "edit": go("add", { edit: sid }); break;
    case "vitrine": go("vitrine"); break;
    case "askdel": view.confirmDel = true; render(); break;
    case "canceldel": view.confirmDel = false; render(); break;
    case "del": await deleteSubject(sid); go("home"); break;
    case "warm": startWarm(sid, tid); break;
    case "kuer": startKuer(sid, tid, b.dataset.k === "write" ? "write" : undefined); break;
    case "whint": D.cur.typed = $("#w-in")?.value || ""; D.cur.hint = true; render(); focusWrite(); break;
    case "wk": startWK(sid); break;
    case "flip": H.flip = !H.flip; render(); break;
    case "hknow": {
      const k = tKey(H.s, H.t) + "|" + H.queue[0];
      if (!S.cards[k]) { S.cards[k] = true; S.stars++; H.gained++; }
      H.queue.shift(); H.flip = false; checkBadges(); save();
      if (!H.queue.length) endWarm();
      render(); break;
    }
    case "hagain": { const i = H.queue.shift(); H.queue.push(i); H.again++; H.flip = false; render(); break; }
    case "mc": { const i = +b.dataset.i; D.cur.pickedI = i; judge(D.cur.opts[i].ok); break; }
    case "tf": { const v = b.dataset.v === "1"; D.cur.picked = v; judge(v === D.cur.item.answer); break; }
    case "opick": { const p = D.cur.pool.splice(+b.dataset.k, 1)[0]; D.cur.ans.push(p); render(); break; }
    case "ounpick": { const p = D.cur.ans.splice(+b.dataset.k, 1)[0]; D.cur.pool.push(p); render(); break; }
    case "oreset": D.cur.pool = D.cur.pool.concat(D.cur.ans); D.cur.ans = []; render(); break;
    case "ocheck": judge(D.cur.ans.every((p, k) => p.i === k)); break;
    case "selfshow": D.cur.shown = true; render(); break;
    case "selfyes": judge(true); break;
    case "selfno": judge(false); break;
    case "next": cont(); break;
    case "extra": startExtra(); break;
    case "extradone": D.phase = "extradone"; render(); break;
    case "savesubj": saveSubject(); break;
    case "sample": $("#f-text").value = SAMPLE; if (!$("#f-name").value) $("#f-name").value = "Englisch & Mathe"; updatePreview(); break;
    case "saveplayer": { const v = $("#f-player").value.trim(); if (v) { S.player = v; save(); render(); } break; }
    case "askreset": view.confirmReset = true; render(); break;
    case "cancelreset": view.confirmReset = false; render(); break;
    case "reset": { notifyParent(`${S.player} hat den Fortschritt zurückgesetzt`, "Alle Sterne, Medaillen und Abzeichen wurden auf 0 gesetzt.", ["warning"]); const p = S.player; S = Object.assign(fresh(), { player: p }); save(); view.confirmReset = false; render(); break; }
    case "unlockntfy": {
      const v = $("#f-unlock").value.trim(), m = $("#ntfy-msg");
      if (v && v === ntfyTopic()) { view.unlocked = true; render(); }
      else { m.className = "err"; m.textContent = "Der Code stimmt nicht."; $("#f-unlock").value = ""; }
      break;
    }
    case "lockntfy": view.unlocked = false; render(); break;
    case "saventfy": {
      const v = $("#f-ntfy").value.trim(), m = $("#ntfy-msg");
      if (ntfyTopic() && !view.unlocked) break;
      if (!v) { m.className = "err"; m.textContent = "Bitte einen Code eingeben. Zum Ausschalten gibt es den Knopf „Ausschalten“."; break; }
      if (!NTFY_RE.test(v)) { m.className = "err"; m.textContent = "Der Code darf nur Buchstaben, Zahlen, - und _ enthalten (8–64 Zeichen)."; break; }
      lsSet(NTFY_KEY, v); view.unlocked = false; render(); $("#ntfy-msg").className = "okmsg"; $("#ntfy-msg").textContent = "Gespeichert. Schick zur Kontrolle eine Test-Nachricht."; sendStatus("Eltern-Benachrichtigung eingeschaltet."); break;
    }
    case "testntfy": {
      const m = $("#ntfy-msg"); m.className = "muted"; m.textContent = "Wird gesendet …";
      notifyParent(`Test von ${S.player}`, "Die Eltern-Benachrichtigung der Lernapp funktioniert.", ["white_check_mark"])
        .then(ok => { m.className = ok ? "okmsg" : "err"; m.textContent = ok ? "Test-Nachricht gesendet." : "Senden hat nicht geklappt. Bist du online?"; });
      break;
    }
    case "offntfy": if (view.unlocked) { notifyParent("Benachrichtigung aus", `In ${S.player}s Lernapp wurde die Eltern-Benachrichtigung ausgeschaltet.`, ["no_bell"]); lsSet(NTFY_KEY, null); view.unlocked = false; render(); } break;
  }
});
document.addEventListener("input", e => { if (e.target.id === "f-text") updatePreview(); });
document.addEventListener("keydown", e => {
  if (view.name !== "kuer" || !D || !D.cur || e.target.matches("input,textarea")) return;
  if (!D.cur.done && D.cur.item.type === "mc" && /^[1-4]$/.test(e.key)) document.querySelector(`[data-act="mc"][data-i="${+e.key - 1}"]`)?.click();
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") maybeSendStatus(); });

/* ========================= Konfetti: Glitzer & Bänder ========================= */
function burst() {
  if (reduceMotion) return;
  const cv = $("#confetti"), ctx = cv.getContext("2d");
  cv.hidden = false; cv.width = innerWidth; cv.height = innerHeight;
  const css = getComputedStyle(document.documentElement);
  const cols = ["--berry", "--gold", "--mat", "--silver"].map(v => css.getPropertyValue(v).trim() || "#c2185b");
  const ps = Array.from({ length: 150 }, (_, i) => ({ x: cv.width / 2, y: cv.height * .35, vx: (Math.random() - .5) * 14, vy: -Math.random() * 12 - 4, s: 4 + Math.random() * 6, c: pick(cols), r: Math.random() * 6, star: i % 3 === 0 }));
  let f = 0;
  (function step() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ps.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += .33; p.vx *= .99; p.r += .15;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      if (p.star) { ctx.beginPath(); for (let k = 0; k < 10; k++) { const rr = k % 2 ? p.s * .45 : p.s; ctx.lineTo(Math.cos(k * Math.PI / 5) * rr, Math.sin(k * Math.PI / 5) * rr); } ctx.closePath(); ctx.fill(); }
      else ctx.fillRect(-p.s, -p.s / 6, p.s * 2, p.s / 3);
      ctx.restore();
    });
    if (++f < 120) requestAnimationFrame(step); else { ctx.clearRect(0, 0, cv.width, cv.height); cv.hidden = true; }
  })();
}

/* ========================= Start ========================= */
render();
maybeSendStatus();
