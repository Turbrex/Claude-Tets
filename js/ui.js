// Rendering and input handling.

(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const sim = new OfficeSim();
  const openCards = new Set();
  let timer = null;
  let running = false;
  let chatCount = 0;
  let autoContinue = false;
  try { autoContinue = localStorage.getItem("officeSim.autoContinue") === "1"; } catch {}
  $("autoContinue").checked = autoContinue;
  $("company").textContent = OFFICE.company;

  // ---------- helpers ----------
  const stressColor = (s) => (s < 25 ? "#2ecc71" : s < 45 ? "#9bd35a" : s < 65 ? "#f1c40f" : s < 85 ? "#e67e22" : "#e74c3c");
  const moodEmoji = (s) => (s < 25 ? "😌" : s < 45 ? "🙂" : s < 65 ? "😐" : s < 85 ? "😰" : "😫");
  const statusLabel = { working: "Working", idle: "Idle", break: "Break", chatting: "Chatting", lunch: "Lunch", overwhelmed: "Overwhelmed", away: "Away", blocked: "Blocked" };

  function meter(label, value, color, text) {
    return `<span class="lbl">${label}</span><div class="bar"><div style="width:${Math.round(value)}%;background:${color}"></div></div><span class="val">${text}</span>`;
  }

  function sparkline(hist) {
    const pts = hist.map((v, i) => (v === null ? null : `${(i / (96 - 1)) * 100},${26 - (v / 100) * 24}`)).filter(Boolean);
    if (pts.length < 2) return "";
    return `<svg class="spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-label="Stress today">
      <line x1="0" y1="${26 - 0.65 * 24}" x2="100" y2="${26 - 0.65 * 24}" stroke="#e67e2244" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>
      <polyline points="${pts.join(" ")}" fill="none" stroke="#8a93a6" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }

  // ---------- staff ----------
  function cardHtml(a) {
    const eff = sim.efficiency(a);
    const t = a.task;
    const progress = t ? Math.min(100, (t.progress / t.work) * 100) : 0;
    const tierTarget = a.role === "boss" ? "" : (() => {
      const p = a.period;
      return a.role === "entry" ? `${p.submitted} submitted · ${p.caught} sent back` : `${p.ownDone} tasks · ${p.reviews} reviews · ${a.queue.filter((q) => q.kind === "review").length} queued`;
    })();
    const traits = Object.entries(a.traits).map(([k, v]) => `<span class="trait">${k} ${Math.round(v * 100)}</span>`).join("");
    const reportsTo = a.manager ? sim.get(a.manager) : a.role === "manager" ? sim.boss() : null;

    return `<div class="card ${a.absent ? "absent" : ""} ${openCards.has(a.id) ? "open" : ""}" data-id="${a.id}" style="--c:${a.color}">
      <div class="card-head">
        <div class="avatar">${a.avatar}</div>
        <div class="who">
          <div class="name">${esc(a.name)}</div>
          <div class="title">${esc(a.title)}${reportsTo ? ` · reports to ${esc(reportsTo.first)}` : ""}</div>
        </div>
        <div class="badges">
          ${a.warnings ? `<span class="badge warn" title="Formal warnings">⚠️ ${a.warnings}/3</span>` : ""}
          ${a.bonusTotal ? `<span class="badge money" title="Total bonuses">💰 $${a.bonusTotal}</span>` : ""}
          ${a.lastGrade ? `<span class="badge" title="Last report grade">${esc(a.lastGrade)}</span>` : ""}
        </div>
      </div>
      <div class="status">
        <span class="pill ${a.absent ? "away" : a.status}">${a.absent ? "Out sick" : statusLabel[a.status] || a.status}</span>
        <span class="activity" title="${esc(a.activity)}">${esc(a.activity)}</span>
      </div>
      <div class="meters">
        ${meter("Stress", a.stress, stressColor(a.stress), `${Math.round(a.stress)} ${moodEmoji(a.stress)}`)}
        ${meter("Energy", a.energy, "#5b8cff", Math.round(a.energy))}
        ${meter("Morale", a.morale, "#9b59b6", Math.round(a.morale))}
        ${meter("Task", progress, a.color, t ? `${Math.round(progress)}%` : "—")}
      </div>
      ${sparkline(a.stressHist)}
      <div class="card-foot">
        <span class="stats" title="This period">⚙️ ${Math.round(eff * 100)}% eff · ${sim.stressLabel(a.stress)}${tierTarget ? ` · ${tierTarget}` : ""}</span>
        <button class="small" data-act="coffee" title="Bring them a coffee (−stress, +energy)">☕</button>
        <button class="small" data-act="mention" title="Mention in chat">💬</button>
      </div>
      <div class="bio">${esc(a.bio)}</div>
      <div class="traits">${traits}</div>
    </div>`;
  }

  function renderStaff() {
    const groups = [["boss", "Overseer"], ["manager", "Managers"], ["entry", "Entry level"]];
    $("staff").innerHTML = groups.map(([role, label]) => {
      const list = sim.agents.filter((a) => a.role === role);
      return `<div class="tier">${label}</div>` + list.map(cardHtml).join("");
    }).join("");
  }

  // pointerdown rather than click: cards re-render every tick, which can swallow a click.
  $("staff").addEventListener("pointerdown", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const id = card.dataset.id;
    const act = e.target.closest("button")?.dataset.act;
    if (act === "coffee") return sim.giveCoffee(id);
    if (act === "mention") {
      const a = sim.get(id);
      $("chatInput").value = `@${a.first} `;
      $("chatInput").focus();
      return;
    }
    openCards.has(id) ? openCards.delete(id) : openCards.add(id);
    renderStaff();
  });

  // ---------- clock ----------
  function renderClock() {
    $("day").textContent = `Day ${sim.day}`;
    $("time").textContent = sim.clock();
    $("dayProgress").style.width = `${(sim.tick / 96) * 100}%`;
    $("nextReport").textContent = sim.tick < 36 ? "Next report at 12:00" : sim.isLunch() ? "Lunch break · next report at 17:00" : "Next report at 17:00";
  }

  // ---------- chat ----------
  function addChat(m) {
    const log = $("chatLog");
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    const el = document.createElement("div");
    if (m.kind === "system") {
      el.className = `sys ${m.tag || ""}`;
      el.textContent = m.text;
    } else if (m.kind === "user") {
      el.className = "msg user";
      el.innerHTML = `<div class="av">🧑‍💻</div><div class="body"><div class="meta"><b>You</b> <span class="muted">(consultant)</span><span class="t">${m.time}</span></div><div class="text">${esc(m.text)}</div></div>`;
    } else {
      const a = m.agent;
      el.className = "msg";
      el.style.setProperty("--c", a.color);
      el.innerHTML = `<div class="av">${a.avatar}</div><div class="body"><div class="meta"><b>${esc(a.name)}</b><span class="mood" title="Stress ${Math.round(a.stress)}">${moodEmoji(a.stress)}</span><span class="t">${m.time}</span></div><div class="text">${esc(m.text)}</div></div>`;
      // Briefly highlight the speaker's card.
      const card = document.querySelector(`.card[data-id="${a.id}"]`);
      if (card) { card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); }
    }
    log.appendChild(el);
    while (log.children.length > 400) log.removeChild(log.firstChild);
    if (stick) log.scrollTop = log.scrollHeight;
    $("chatCount").textContent = `· ${++chatCount} messages`;
  }

  $("chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("chatInput").value.trim();
    if (!text) return;
    $("chatInput").value = "";
    addChat({ kind: "user", text, time: sim.clock() });
    sim.respondToUser(text);
  });

  // ---------- feed & reports ----------
  function addFeed(f) {
    const li = document.createElement("li");
    li.className = f.tone;
    li.innerHTML = `<span class="t">${f.time}</span>${esc(f.text)}`;
    const feed = $("feed");
    feed.prepend(li);
    while (feed.children.length > 80) feed.removeChild(feed.lastChild);
  }

  function renderReportList() {
    const list = $("reportList");
    if (!sim.reports.length) { list.innerHTML = `<li class="muted">No reports yet. First one is at 12:00.</li>`; return; }
    list.innerHTML = sim.reports.map((r, i) => `<li data-i="${i}"><span>Day ${r.day} · ${esc(r.label)}</span><b>${r.avg}</b></li>`).reverse().join("");
  }
  $("reportList").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) showReport(sim.reports[+li.dataset.i], false);
  });

  function showReport(r, pauseSim) {
    const rows = r.rows.map((row) => `<tr class="tone-${row.tone}">
        <td>${row.avatar} <b>${esc(row.name)}</b><div class="details">${esc(row.role)}</div></td>
        <td class="score">${row.score === null ? "—" : row.score}</td>
        <td><div class="grade">${esc(row.grade)}</div><div class="details">${esc(row.details)}</div></td>
        <td>${esc(row.outcome)}</td>
      </tr>`).join("");
    $("reportBody").innerHTML = `
      <h3>📊 ${esc(r.label)} — Day ${r.day}, ${r.time}</h3>
      <div class="sub">Office average <b>${r.avg}/100</b> · Victoria's mood: <b>${esc(r.bossMood)}</b>${r.harsh > 8 ? " (grading harshly)" : ""}</div>
      <table class="report-table">
        <thead><tr><th>Employee</th><th>Score</th><th>Grade</th><th>Outcome</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    if (pauseSim && running) { stop(); $("reportModal").dataset.resume = "1"; }
    $("reportModal").showModal();
  }

  $("reportModal").addEventListener("close", () => {
    if ($("reportModal").dataset.resume === "1") { delete $("reportModal").dataset.resume; start(); }
  });
  $("autoContinue").addEventListener("change", (e) => {
    autoContinue = e.target.checked;
    try { localStorage.setItem("officeSim.autoContinue", autoContinue ? "1" : "0"); } catch {}
  });

  // ---------- wiring ----------
  sim.onChat = addChat;
  sim.onFeed = addFeed;
  sim.onUpdate = () => { renderStaff(); renderClock(); };
  sim.onReport = (r) => { renderReportList(); if (!autoContinue) showReport(r, true); };

  function interval() { return 1000 / Number($("speed").value); }
  function start() {
    running = true;
    $("playBtn").textContent = "⏸ Pause";
    clearInterval(timer);
    timer = setInterval(() => sim.step(), interval());
  }
  function stop() {
    running = false;
    $("playBtn").textContent = "▶ Resume";
    clearInterval(timer);
  }

  $("playBtn").addEventListener("click", () => (running ? stop() : start()));
  $("speed").addEventListener("change", () => { if (running) start(); });
  $("resetBtn").addEventListener("click", () => {
    if (!confirm("Start a new game from Day 1?")) return;
    stop();
    $("playBtn").textContent = "▶ Start";
    sim.reset();
    $("chatLog").innerHTML = "";
    $("feed").innerHTML = "";
    chatCount = 0;
    $("chatCount").textContent = "";
    renderReportList();
    sim.onUpdate();
  });

  const bar = $("interventions");
  bar.innerHTML = `<span class="label">Interventions</span>` + OFFICE.interventions.map((iv) => `<button data-iv="${iv.id}" title="${esc(iv.title)}">${iv.label}</button>`).join("");
  bar.addEventListener("click", (e) => {
    const id = e.target.closest("button")?.dataset.iv;
    const iv = OFFICE.interventions.find((x) => x.id === id);
    if (iv) { iv.apply(sim); sim.onUpdate(); }
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement !== $("chatInput") && !$("reportModal").open) {
      e.preventDefault();
      running ? stop() : start();
    }
  });

  addChat({ kind: "system", text: `Welcome to ${OFFICE.company}. Press ▶ Start (or Space) to begin the workday.`, tag: "day" });
  sim.onUpdate();
})();
