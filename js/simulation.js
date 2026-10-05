// Core simulation engine. Pure logic; the UI subscribes through `on*` callbacks.
//
// Time: one tick = 5 simulated minutes. The workday runs 09:00-17:00 (96 ticks).
// Progress reports happen at 12:00 (tick 36) and 17:00 (tick 96); lunch is 12:00-13:00.

const TICKS_PER_DAY = 96;
const MIDDAY_TICK = 36;
const LUNCH_END_TICK = 48;
const HISTORY_LEN = 96;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const chance = (p) => Math.random() < p;

class OfficeSim {
  constructor() {
    this.onChat = () => {};
    this.onFeed = () => {};
    this.onReport = () => {};
    this.onUpdate = () => {};
    this.reset();
  }

  reset() {
    this.day = 1;
    this.tick = 0;
    this.periodStart = 0;
    this.effects = { noCoffee: 0, outage: 0, drill: 0, bossWalk: 0 };
    this.pending = [];
    this.slipped = [];
    this.reports = [];
    this.lastLines = {};
    this.chatBudget = 0;
    this.usedReplacements = new Set();
    this.agents = OFFICE.staff.map((p) => this.makeAgent(p));
    this.agents.forEach((a) => this.initRelationships(a));
    this.started = false;
  }

  makeAgent(p) {
    return {
      id: p.id, name: p.name, first: p.name.split(" ")[0], role: p.role, title: p.title,
      avatar: p.avatar, color: p.color, voice: p.voice, traits: { ...p.traits }, bio: p.bio,
      manager: p.manager || null, reports: p.reports ? [...p.reports] : [],
      stress: rand(10, 25), energy: 100, morale: rand(55, 75),
      status: "idle", statusTicks: 0, activity: "Arriving",
      task: null, queue: [],
      period: this.blankPeriod(),
      warnings: 0, bonusTotal: 0, goodStreak: 0, lastGrade: null,
      absent: false, cooldown: 0, rel: {}, stressHist: [],
      totals: { done: 0, reports: 0, avgScore: 0 },
    };
  }

  blankPeriod() {
    return { submitted: 0, caught: 0, slippedFound: 0, ownDone: 0, reviews: 0, catches: 0, missed: 0, breakTicks: 0, meltdowns: 0 };
  }

  initRelationships(a) {
    for (const b of this.agents) {
      if (b === a || a.rel[b.id] !== undefined) continue;
      let base = rand(-10, 30) + (a.traits.sociability + b.traits.sociability) * 15;
      if (b.role === "boss" || a.role === "boss") base -= 20;
      a.rel[b.id] = Math.round(clamp(base, -50, 80));
      if (b.rel[a.id] === undefined) b.rel[a.id] = Math.round(clamp(base + rand(-15, 15), -50, 80));
    }
  }

  // ---------- helpers ----------
  get(id) { return this.agents.find((a) => a.id === id); }
  byRole(role) { return this.agents.filter((a) => a.role === role && !a.absent); }
  boss() { return this.agents.find((a) => a.role === "boss"); }
  pick(list) { return list.length ? list[Math.floor(Math.random() * list.length)] : null; }
  present() { return this.agents.filter((a) => !a.absent); }

  clock(tick = this.tick) {
    const mins = 9 * 60 + tick * 5;
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }

  isLunch() { return this.tick >= MIDDAY_TICK && this.tick < LUNCH_END_TICK; }

  // Lower stress = better work. Mild stress (~15-25) is the sweet spot; above that efficiency drops fast.
  efficiency(a) {
    const s = a.stress / 100;
    let e = 1.1 - 1.5 * Math.pow(Math.max(0, s - 0.2), 1.3);
    if (s < 0.08) e -= 0.08; // a little too relaxed
    e *= 0.55 + 0.45 * (a.energy / 100);
    e *= 0.75 + 0.4 * a.traits.diligence;
    e *= 0.9 + 0.2 * (a.morale / 100);
    return clamp(e, 0.1, 1.4);
  }

  errorChance(a) {
    const s = a.stress / 100;
    return clamp(0.05 + 0.6 * s * s * (1.25 - a.traits.diligence) + (a.energy < 30 ? 0.08 : 0), 0, 0.6);
  }

  stressLabel(s) {
    if (s < 25) return "Calm";
    if (s < 45) return "Focused";
    if (s < 65) return "Tense";
    if (s < 85) return "Stressed";
    return "Overwhelmed";
  }

  affect(a, d) {
    if (!a) return;
    if (d.stress) {
      // Resilient people absorb bad news better.
      const k = d.stress > 0 ? 1.25 - a.traits.resilience * 0.6 : 1;
      a.stress = clamp(a.stress + d.stress * k, 0, 100);
    }
    if (d.energy) a.energy = clamp(a.energy + d.energy, 0, 100);
    if (d.morale) a.morale = clamp(a.morale + d.morale, 0, 100);
  }

  affectAll(d) { this.present().forEach((a) => this.affect(a, d)); }

  // ---------- chat ----------
  line(a, key, ctx = {}) {
    const bank = (DIALOGUE[a.voice] && DIALOGUE[a.voice][key]) || DIALOGUE.generic[key];
    if (!bank || !bank.length) return null;
    const memo = `${a.id}:${key}`;
    let options = bank.length > 1 ? bank.filter((l) => l !== this.lastLines[memo]) : bank;
    const text = this.pick(options);
    this.lastLines[memo] = text;
    return text.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] !== undefined ? ctx[k] : `{${k}}`));
  }

  // Say something in the chat. Non-forced lines respect a per-agent cooldown and a per-tick budget
  // so the room doesn't turn into noise.
  say(a, key, ctx = {}, opts = {}) {
    if (!a || a.absent) return false;
    if (!opts.force) {
      if (a.cooldown > 0 || this.chatBudget <= 0) return false;
      if (opts.p !== undefined && !chance(opts.p)) return false;
    }
    const text = this.line(a, key, ctx);
    if (!text) return false;
    a.cooldown = 3 + Math.floor(rand(0, 5));
    this.chatBudget--;
    this.onChat({ kind: "agent", agent: a, text, time: this.clock(), tag: opts.tag });
    return true;
  }

  later(delay, fn) { this.pending.push({ at: delay, fn }); }

  system(text, tag) { this.onChat({ kind: "system", text, time: this.clock(), tag }); }
  feed(text, tone = "info") { this.onFeed({ text, tone, time: `D${this.day} ${this.clock()}` }); }

  reactAll(key, p = 0.5, exclude = []) {
    this.present().forEach((a, i) => {
      if (exclude.includes(a.id)) return;
      if (chance(p)) this.later(1 + (i % 3), () => this.say(a, key, {}, { force: true }));
    });
  }

  ctxFor(a, extra = {}) {
    const mgr = a.manager ? this.get(a.manager) : null;
    const boss = this.boss();
    return { manager: mgr ? mgr.first : "boss", boss: boss ? boss.first : "boss", ...extra };
  }

  // ---------- main loop ----------
  step() {
    if (!this.started) { this.startDay(); this.started = true; }
    this.tick++;
    // Keep the first few minutes for good-mornings.
    this.chatBudget = this.tick < 4 ? 0 : 3;

    if (this.tick === MIDDAY_TICK) {
      this.runReport();
      this.system("🥪 Lunch break until 13:00.");
      this.present().forEach((a, i) => this.later(1 + i, () => this.say(a, "lunch", this.ctxFor(a), { p: 0.6 })));
    }
    if (this.tick === LUNCH_END_TICK) this.system("🕐 Lunch is over. Back to work!");

    for (const k of Object.keys(this.effects)) if (this.effects[k] > 0) this.effects[k]--;

    if (!this.isLunch() && this.tick < TICKS_PER_DAY && chance(0.035)) this.randomEvent();

    for (const a of this.agents) {
      if (a.cooldown > 0) a.cooldown--;
      if (a.absent) continue;
      this.updateAgent(a);
    }

    // Deferred lines (replies, reactions).
    const due = this.pending.filter((p) => --p.at <= 0);
    this.pending = this.pending.filter((p) => p.at > 0);
    due.forEach((p) => p.fn());

    for (const a of this.agents) {
      a.stressHist.push(a.absent ? null : a.stress);
      if (a.stressHist.length > HISTORY_LEN) a.stressHist.shift();
    }

    if (this.tick >= TICKS_PER_DAY) {
      this.runReport();
      this.endDay();
    }
    this.onUpdate();
  }

  startDay() {
    this.system(`🏢 Day ${this.day} at ${OFFICE.company}. Reports at 12:00 and 17:00.`, "day");
    this.feed(`Day ${this.day} begins.`);
    this.agents.forEach((a, i) => {
      if (a.absent) {
        this.later(1 + i, () => this.onChat({ kind: "agent", agent: a, text: this.line(a, "sickCall", {}), time: this.clock(), tag: "sick" }));
        return;
      }
      a.status = "idle";
      a.activity = "Settling in";
      this.later(1 + i, () => this.say(a, "morning", this.ctxFor(a), { force: true }));
    });
  }

  endDay() {
    // Let report reactions play out before everyone leaves.
    this.chatBudget = 99;
    this.pending.sort((x, y) => x.at - y.at).forEach((p) => p.fn());
    this.pending = [];
    this.present().forEach((a) => {
      const t = this.line(a, "endOfDay", {});
      if (t && chance(0.6)) this.onChat({ kind: "agent", agent: a, text: t, time: this.clock() });
    });
    this.system(`🌙 Day ${this.day} is over. Everyone heads home.`, "day");

    // Overnight recovery. High morale helps people bounce back.
    for (const a of this.agents) {
      const wasStressed = a.stress;
      a.absent = false;
      a.stress = clamp(a.stress * 0.45 + (100 - a.morale) * 0.12 + rand(-3, 3), 3, 90);
      a.energy = 100;
      a.morale = clamp(a.morale + (60 - a.morale) * 0.2, 0, 100);
      a.task = null;
      a.queue = a.queue.filter((t) => t.urgent);
      a.status = "idle";
      a.statusTicks = 0;
      // Burned-out staff may call in sick the next morning (never the boss).
      if (a.role !== "boss" && wasStressed > 85 && chance(0.4)) {
        a.absent = true;
        a.activity = "Out sick";
        this.feed(`${a.name} ended the day burned out and will be out sick tomorrow.`, "bad");
      }
    }
    this.day++;
    this.tick = 0;
    this.periodStart = 0;
    this.started = false;
  }

  updateAgent(a) {
    // Global disruptions.
    if (this.isLunch()) {
      a.status = "lunch"; a.activity = "At lunch";
      this.affect(a, { stress: -1.6, energy: 2.5 });
      if (chance(0.06 * a.traits.sociability)) this.startChat(a, true);
      return;
    }
    if (this.effects.drill > 0) {
      a.status = "away"; a.activity = "Outside (fire drill / gathering)";
      return;
    }

    // Timed states.
    if (a.statusTicks > 0) {
      a.statusTicks--;
      if (a.status === "break" || a.status === "overwhelmed") {
        a.period.breakTicks++;
        const relief = this.effects.noCoffee ? 2 : 3.5;
        this.affect(a, { stress: -(a.status === "overwhelmed" ? relief + 2 : relief), energy: 4 });
      } else if (a.status === "chatting") {
        this.affect(a, { stress: -1.5, energy: 0.5 });
      }
      if (a.statusTicks === 0) a.status = "idle";
      return;
    }

    // Meltdown.
    if (a.stress >= 95) {
      a.status = "overwhelmed"; a.statusTicks = 5; a.activity = "Overwhelmed — stepped away";
      a.period.meltdowns++;
      this.say(a, "meltdown", {}, { force: true });
      this.feed(`${a.name} is overwhelmed and stepped away from their desk.`, "bad");
      this.agents.filter((b) => b !== a && !b.absent && b.rel[a.id] > 25 && b.role !== "boss").slice(0, 1)
        .forEach((b) => this.later(2, () => { this.say(b, "smallTalk", { target: a.first }, { force: true }); b.rel[a.id] += 3; a.rel[b.id] += 5; this.affect(a, { stress: -6 }); }));
      return;
    }

    // Breaks: stressed or tired people step away; diligent people push through longer.
    const breakAt = 55 + a.traits.resilience * 20 + a.traits.diligence * 10;
    if ((a.stress > breakAt && chance(0.18)) || (a.energy < 25 && chance(0.25))) {
      this.takeBreak(a);
      return;
    }

    // Socializing.
    if (chance(0.025 * a.traits.sociability + (a.stress > 50 ? 0.01 : 0)) && this.startChat(a)) return;

    if (this.effects.outage > 0) {
      a.status = "blocked"; a.activity = "Waiting for the network";
      this.affect(a, { stress: 0.8 });
      return;
    }

    if (a.role === "boss") return this.updateBoss(a);
    this.work(a);
  }

  takeBreak(a) {
    a.status = "break";
    a.statusTicks = 2 + Math.floor(rand(0, 3));
    a.activity = this.effects.noCoffee ? "On break (no coffee 😩)" : "On a coffee break";
    this.say(a, "break", {}, { p: 0.6 });
  }

  startChat(a, atLunch = false) {
    const others = this.present().filter((b) => b !== a && (atLunch || b.status === "working" || b.status === "idle"));
    if (!others.length) return false;
    // Prefer people they like.
    const weighted = others.map((b) => ({ b, w: Math.max(1, 50 + a.rel[b.id]) }));
    let r = Math.random() * weighted.reduce((s, x) => s + x.w, 0);
    const target = weighted.find((x) => (r -= x.w) <= 0)?.b || others[0];
    if (!this.say(a, "smallTalk", { target: target.first })) return false;

    if (!atLunch) { a.status = "chatting"; a.statusTicks = 1; a.activity = `Chatting with ${target.first}`; }

    this.later(1, () => {
      let key = "replyWarm";
      if (target.stress >= 70) key = "replyStressed";
      else if (target.rel[a.id] < 10 || (target.stress > 50 && chance(0.4))) key = "replyCold";
      this.say(target, key, { target: a.first }, { force: true });
      const delta = key === "replyWarm" ? 3 : key === "replyCold" ? -2 : -1;
      target.rel[a.id] = clamp(target.rel[a.id] + delta, -100, 100);
      a.rel[target.id] = clamp(a.rel[target.id] + delta, -100, 100);
      if (key === "replyWarm") { this.affect(a, { stress: -3, morale: 1 }); this.affect(target, { stress: -2 }); }
      else this.affect(a, { stress: 1.5 });
    });
    return true;
  }

  // ---------- work ----------
  nextTask(a) {
    if (a.queue.length) return a.queue.shift();

    if (a.role === "entry") {
      const mgr = a.manager ? this.get(a.manager) : null;
      const tpl = this.pick(OFFICE.tasks.entry);
      const t = { ...tpl, progress: 0, kind: "work" };
      if (mgr && !mgr.absent && mgr.status !== "overwhelmed") {
        this.say(mgr, "assign", { target: a.first, task: t.name }, { p: 0.5 })
          && this.later(1, () => this.say(a, "taskAssigned", this.ctxFor(a), { p: 0.6 }));
      }
      return t;
    }
    const tpl = this.pick(OFFICE.tasks[a.role]);
    return { ...tpl, progress: 0, kind: "own" };
  }

  work(a) {
    if (!a.task) {
      a.task = this.nextTask(a);
      if (a.task.kind !== "review") this.say(a, "taskStart", this.ctxFor(a, { task: this.taskTitle(a.task) }), { p: 0.15 });
    }
    const t = a.task;
    const eff = this.efficiency(a);
    t.progress += eff * rand(5, 8) * (t.urgent ? 1.1 : 1);
    a.status = "working";
    a.activity = this.describeTask(t);

    // Workload and deadline pressure.
    const periodEnd = this.tick < MIDDAY_TICK ? MIDDAY_TICK : TICKS_PER_DAY;
    const periodLen = periodEnd - (this.tick < MIDDAY_TICK ? 0 : LUNCH_END_TICK);
    const ticksToReport = periodEnd - this.tick;
    const target = this.periodTarget(a.role, periodLen);
    const output = a.role === "entry" ? a.period.submitted : a.period.ownDone;
    const behind = output < target * (1 - ticksToReport / periodLen) - 0.5;
    let dStress = 0.55 + a.queue.length * 0.3 + (a.role === "manager" ? 0.15 : 0);
    if (behind) dStress += 0.9;
    if (ticksToReport < 8 && output < target) dStress += 1.2;
    if (t.urgent) dStress += 0.4;
    if (this.effects.bossWalk > 0) dStress += 1.2;
    if (a.energy < 30) dStress += 0.4;
    this.affect(a, { stress: dStress, energy: -(0.6 + (1 - a.traits.resilience) * 0.3) });

    if (a.stress > 70) this.say(a, "stressHigh", {}, { p: 0.08 });
    else if (a.stress < 20) this.say(a, "relaxed", {}, { p: 0.02 });

    if (t.progress >= t.work) this.completeTask(a, t);
  }

  taskTitle(t) {
    return `“${t.name.charAt(0).toUpperCase()}${t.name.slice(1)}”`;
  }

  describeTask(t) {
    if (t.kind === "review") return `Reviewing ${t.of}'s "${t.name}"`;
    if (t.kind === "rework") return `Redoing "${t.name}"`;
    return (t.urgent ? "⚡ " : "") + t.name.charAt(0).toUpperCase() + t.name.slice(1);
  }

  completeTask(a, t) {
    a.task = null;
    a.totals.done++;
    this.affect(a, { stress: -0.8 * (0.5 + a.traits.ambition), morale: 0.5 });

    if (a.role === "entry") {
      const hasError = chance(this.errorChance(a));
      if (t.kind !== "rework") a.period.submitted++;
      const mgr = a.manager ? this.get(a.manager) : null;
      if (mgr && !mgr.absent) {
        mgr.queue.unshift({ name: t.name, work: 12 + t.work * 0.2, progress: 0, kind: "review", of: a.first, ofId: a.id, hasError });
      } else if (hasError) {
        this.slipped.push({ entryId: a.id, managerId: null, task: t.name });
      }
      this.say(a, "taskDone", this.ctxFor(a, { task: this.taskTitle(t) }), { p: 0.3 });
      return;
    }

    if (t.kind === "review") return this.finishReview(a, t);

    a.period.ownDone++;
    this.say(a, "taskDone", this.ctxFor(a, { task: this.taskTitle(t) }), { p: 0.2 });
  }

  finishReview(mgr, t) {
    mgr.period.reviews++;
    const worker = this.get(t.ofId);
    if (!worker) return;
    if (t.hasError) {
      // Stressed or careless managers miss mistakes.
      const catchP = clamp(0.3 + 0.6 * mgr.traits.diligence - mgr.stress / 250, 0.1, 0.95);
      if (chance(catchP)) {
        mgr.period.catches++;
        worker.period.caught++;
        this.say(mgr, "catchError", { target: worker.first, task: this.taskTitle(t) }, { force: true });
        this.later(1, () => this.say(worker, "rework", this.ctxFor(worker), { force: true }));
        this.affect(worker, { stress: 5 + worker.traits.temper * 6, morale: -2 });
        worker.rel[mgr.id] = clamp(worker.rel[mgr.id] - 2, -100, 100);
        worker.queue.unshift({ name: t.name, work: 20, progress: 0, kind: "rework" });
        this.feed(`${mgr.first} caught an error in ${worker.first}'s "${t.name}".`, "warn");
      } else {
        this.slipped.push({ entryId: worker.id, managerId: mgr.id, task: t.name });
      }
    } else {
      this.say(mgr, "approve", { target: worker.first, task: this.taskTitle(t) }, { p: 0.25 });
      if (chance(0.3)) this.affect(worker, { stress: -2, morale: 1 });
    }
  }

  updateBoss(b) {
    if (!b.task) {
      b.task = this.nextTask(b);
      this.say(b, "taskStart", { task: this.taskTitle(b.task) }, { p: 0.15 });
    }
    const t = b.task;
    if (t.walk && !t.walked) { t.walked = true; this.startBossWalk(true); }
    t.progress += this.efficiency(b) * rand(5, 8);
    b.status = "working";
    b.activity = t.walk ? "Walking the floor 👀" : this.describeTask(t);
    // Pressure from headquarters, worse when the branch is struggling.
    this.affect(b, { stress: 0.45 + this.present().filter((a) => a.stress > 70).length * 0.15, energy: -0.4 });
    if (b.stress > 70) this.say(b, "stressHigh", {}, { p: 0.06 });
    if (t.progress >= t.work) { b.task = null; b.period.ownDone++; this.say(b, "taskDone", {}, { p: 0.1 }); }

    // While walking, the boss checks in on someone.
    if (this.effects.bossWalk > 0 && chance(0.25)) {
      const victim = this.pick(this.present().filter((a) => a.role !== "boss" && a.status !== "away" && a.id !== this.lastCheckIn));
      if (victim) {
        this.lastCheckIn = victim.id;
        this.say(b, "checkIn", { target: victim.first }, { force: true });
        this.later(1, () => this.say(victim, "bossNearby", {}, { force: true }));
        // Slackers get caught.
        const caughtSlacking = victim.status === "break" || victim.status === "chatting";
        this.affect(victim, { stress: caughtSlacking ? 9 : 4 + (1 - victim.traits.resilience) * 4 });
        if (caughtSlacking) this.feed(`Victoria caught ${victim.first} away from their desk.`, "warn");
      }
    }
  }

  startBossWalk(fromTask = false) {
    const b = this.boss();
    if (!b) return;
    this.effects.bossWalk = 4;
    if (!fromTask) this.say(b, "checkIn", { target: this.pick(this.present().filter((a) => a !== b))?.first || "everyone" }, { force: true });
    this.feed("Victoria is walking the floor.", "warn");
  }

  surpriseDeadline() {
    const b = this.boss();
    const victim = this.pick(this.present().filter((a) => a.role !== "boss"));
    if (!b || !victim) return;
    const tpl = this.pick(OFFICE.tasks[victim.role]);
    victim.queue.unshift({ ...tpl, progress: 0, kind: victim.role === "entry" ? "work" : "own", urgent: true });
    this.say(b, "assignUrgent", { target: victim.first, task: tpl.name }, { force: true });
    this.affect(victim, { stress: 10 });
    this.later(1, () => this.say(victim, "stressHigh", {}, { force: true }));
  }

  randomEvent() {
    const pool = OFFICE.events;
    let r = Math.random() * pool.reduce((s, e) => s + e.weight, 0);
    const ev = pool.find((e) => (r -= e.weight) <= 0) || pool[0];
    this.triggerEvent(ev.id);
  }

  triggerEvent(id) {
    const ev = OFFICE.events.find((e) => e.id === id);
    if (!ev) return;
    this.system(ev.text, "event");
    this.feed(ev.label, ev.good ? "good" : "bad");
    ev.apply(this);
    if (id !== "deadline" && id !== "walk") {
      const reactor = this.pick(this.present().filter((a) => a.role !== "boss" || !ev.good));
      if (reactor) this.later(1, () => this.say(reactor, ev.good ? "eventGood" : "eventBad", {}, { force: true }));
      const second = this.pick(this.present().filter((a) => a !== reactor));
      if (second && chance(0.5)) this.later(2, () => this.say(second, ev.good ? "eventGood" : "eventBad", {}, { force: true }));
    }
    this.onUpdate();
  }

  giveCoffee(id) {
    const a = this.get(id);
    if (!a || a.absent) return;
    this.affect(a, { stress: -7, energy: 15, morale: 2 });
    this.system(`☕ You brought ${a.first} a coffee.`);
    this.say(a, a.stress > 60 ? "praised" : "eventGood", {}, { force: true });
    this.onUpdate();
  }

  // ---------- progress reports ----------
  // Targets are defined per 36 work-ticks (a 3-hour morning) and scale with period length.
  periodTarget(role, ticks) {
    return Math.max(1, Math.round((OFFICE.targets[role] || 3) * ticks / MIDDAY_TICK));
  }

  elapsedWorkTicks() {
    let t = this.tick - this.periodStart;
    if (this.periodStart < MIDDAY_TICK && this.tick > MIDDAY_TICK) t -= Math.min(this.tick, LUNCH_END_TICK) - MIDDAY_TICK;
    return Math.max(6, t);
  }

  scoreAgent(a) {
    const p = a.period;
    const focus = 1 - clamp((p.breakTicks - 4) / 12, 0, 1);
    const ticks = this.elapsedWorkTicks();
    if (a.role === "entry") {
      const target = this.periodTarget("entry", ticks);
      const output = clamp(p.submitted / target, 0, 1.25);
      const mistakes = p.caught + p.slippedFound;
      const quality = p.submitted ? clamp(1 - mistakes / p.submitted, 0, 1) : 0.5;
      const score = output * 56 + quality * 30 + focus * 10 - p.meltdowns * 5;
      return {
        score: Math.round(clamp(score, 0, 100)),
        details: `${p.submitted}/${target} tasks · ${p.caught} errors caught by manager · ${p.slippedFound} found by boss · ${p.breakTicks * 5}m on breaks`,
      };
    }
    // Managers: own work, their team's output, and how well they review.
    const target = this.periodTarget("manager", ticks);
    const entryTarget = this.periodTarget("entry", ticks);
    const own = clamp(p.ownDone / target, 0, 1.25);
    const team = a.reports.map((id) => this.get(id)).filter((r) => r && !r.absent);
    const teamOut = team.length ? team.reduce((s, r) => s + clamp(r.period.submitted / entryTarget, 0, 1), 0) / team.length : 0.6;
    const reviewAcc = p.catches + p.missed ? p.catches / (p.catches + p.missed) : 1;
    const backlog = a.queue.filter((t) => t.kind === "review").length;
    const score = own * 36 + teamOut * 30 + reviewAcc * 24 + focus * 10 - backlog * 4 - p.meltdowns * 5;
    return {
      score: Math.round(clamp(score, 0, 100)),
      details: `${p.ownDone}/${target} own tasks · team output ${Math.round(teamOut * 100)}% · ${p.catches} errors caught, ${p.missed} missed · ${p.reviews} reviews${backlog ? ` · ${backlog} pending` : ""}`,
    };
  }

  runReport(manual = false) {
    const boss = this.boss();
    if (manual && (this.isLunch() || this.tick - this.periodStart < 6)) {
      this.system("📊 Too early for a spot check — give everyone at least 30 minutes of work first.");
      return;
    }
    const label = manual ? "Spot check" : this.tick >= TICKS_PER_DAY ? "End-of-day report" : "Midday report";

    // The boss audits work that got past managers.
    for (const s of this.slipped) {
      if (!chance(0.6)) continue;
      const e = this.get(s.entryId); if (e) e.period.slippedFound++;
      const m = s.managerId && this.get(s.managerId); if (m) m.period.missed++;
    }
    this.slipped = [];

    // A stressed or hot-tempered boss grades harder.
    const harsh = boss ? (boss.stress / 100) * 10 + boss.traits.temper * 5 : 0;
    const rows = [];

    this.system(`📊 ${label} — Day ${this.day}, ${this.clock()}`, "report");
    if (boss) this.say(boss, "reportIntro", {}, { force: true });

    const staff = this.agents.filter((a) => a.role !== "boss");
    for (const a of staff) {
      if (a.absent) {
        rows.push({ id: a.id, name: a.name, avatar: a.avatar, role: a.title, score: null, grade: "Absent", outcome: "Out sick — not evaluated", details: "", tone: "neutral" });
        continue;
      }
      const { score, details } = this.scoreAgent(a);
      const row = { id: a.id, name: a.name, avatar: a.avatar, role: a.title, score, details };
      let delay = 1 + rows.length * 2;

      if (score >= 90 + harsh) {
        const bonus = Math.round((50 + (score - 85) * 10) / 5) * 5;
        a.bonusTotal += bonus;
        a.goodStreak++;
        Object.assign(row, { grade: "Outstanding", outcome: `💰 $${bonus} bonus`, tone: "great" });
        this.forgive(a, row);
        this.affect(a, { stress: -20 * (0.6 + a.traits.ambition * 0.6), morale: 14 });
        this.later(delay, () => this.say(boss, "bossPraise", { target: a.first, bonus }, { force: true }));
        this.later(delay + 1, () => this.say(a, "rewarded", {}, { force: true }));
        boss && (a.rel[boss.id] = clamp(a.rel[boss.id] + 8, -100, 100));
      } else if (score >= 75 + harsh) {
        a.goodStreak++;
        Object.assign(row, { grade: "Good", outcome: "👍 Praise", tone: "good" });
        this.forgive(a, row);
        this.affect(a, { stress: -10, morale: 6 });
        this.later(delay, () => this.say(boss, "bossGood", { target: a.first }, { force: true }));
        this.later(delay + 1, () => this.say(a, "praised", {}, { force: chance(0.6) }));
      } else if (score >= 58 + harsh) {
        a.goodStreak = 0;
        Object.assign(row, { grade: "Meets expectations", outcome: "No change", tone: "neutral" });
        this.affect(a, { stress: -2 });
        this.later(delay, () => this.say(boss, "bossNeutral", { target: a.first }, { force: true }));
        this.later(delay + 1, () => this.say(a, "neutral", {}, { force: chance(0.5) }));
      } else if (score >= 38 + harsh) {
        a.goodStreak = 0;
        Object.assign(row, { grade: "Needs improvement", outcome: "😠 Reprimand", tone: "bad" });
        this.affect(a, { stress: 10 + a.traits.temper * 8, morale: -8 });
        this.later(delay, () => this.say(boss, "bossScold", { target: a.first }, { force: true }));
        this.later(delay + 1, () => this.say(a, "punished", {}, { force: true }));
        boss && (a.rel[boss.id] = clamp(a.rel[boss.id] - 5, -100, 100));
      } else {
        a.goodStreak = 0;
        a.warnings++;
        Object.assign(row, { grade: "Unacceptable", outcome: `⚠️ Formal warning (${a.warnings}/3)`, tone: "terrible" });
        this.affect(a, { stress: 20 + a.traits.temper * 10, morale: -15 });
        boss && (a.rel[boss.id] = clamp(a.rel[boss.id] - 10, -100, 100));
        if (a.warnings >= 3) {
          row.outcome = "🚪 Terminated";
          this.later(delay, () => this.fire(a));
        } else {
          this.later(delay, () => this.say(boss, "bossWarn", { target: a.first }, { force: true }));
          this.later(delay + 1, () => this.say(a, "warned", {}, { force: true }));
          // A manager whose report gets a warning feels it too.
          const mgr = a.manager && this.get(a.manager);
          if (mgr) this.affect(mgr, { stress: 5 });
        }
      }
      a.lastGrade = row.grade;
      a.totals.avgScore = (a.totals.avgScore * a.totals.reports + score) / (a.totals.reports + 1);
      a.totals.reports++;
      rows.push(row);
    }

    // The boss's own stress follows how the office performed.
    const scored = rows.filter((r) => r.score !== null);
    const avg = scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : 60;
    if (boss) {
      this.affect(boss, { stress: (62 - avg) / 2.5 });
      this.later(1 + rows.length * 2 + 1, () => this.say(boss, "reportOutro", {}, { force: true }));
    }

    const report = { day: this.day, time: this.clock(), label, rows, avg: Math.round(avg), harsh: Math.round(harsh), bossMood: boss ? this.stressLabel(boss.stress) : "-" };
    this.reports.push(report);
    this.feed(`${label}: office average ${report.avg}/100.`, avg >= 70 ? "good" : avg >= 55 ? "info" : "bad");
    for (const a of this.agents) a.period = this.blankPeriod();
    this.periodStart = this.isLunch() ? LUNCH_END_TICK : this.tick;
    this.onReport(report);
  }

  // Two good reports in a row wipe one formal warning.
  forgive(a, row) {
    if (a.goodStreak >= 2 && a.warnings > 0) {
      a.warnings--;
      a.goodStreak = 0;
      row.outcome += " · warning removed";
    }
  }

  fire(a) {
    const boss = this.boss();
    this.say(boss, "firing", { target: a.first }, { force: true });
    this.later(1, () => this.onChat({ kind: "agent", agent: a, text: this.line(a, "fired", {}), time: this.clock() }));
    this.feed(`${a.name} was fired.`, "bad");

    // Reactions from coworkers who liked them.
    this.agents.filter((b) => b !== a && b !== boss && !b.absent).forEach((b, i) => {
      this.affect(b, { stress: 8 + (b.rel[a.id] > 30 ? 6 : 0), morale: -6 });
      if (chance(0.7)) this.later(2 + i, () => this.say(b, "coworkerFired", { target: a.first }, { force: true }));
    });

    // Hire a replacement into the same slot.
    const pool = OFFICE.replacements[a.role] || [];
    const tpl = pool.find((p) => !this.usedReplacements.has(p.name)) || pool[Math.floor(Math.random() * pool.length)];
    if (!tpl) return;
    this.usedReplacements.add(tpl.name);
    const id = tpl.name.toLowerCase().replace(/[^a-z]/g, "") + "_" + this.day;
    const hire = this.makeAgent({ ...tpl, id, role: a.role, manager: a.manager, reports: a.reports });
    hire.stress = 30;
    const idx = this.agents.indexOf(a);
    this.agents[idx] = hire;
    for (const other of this.agents) {
      delete other.rel[a.id];
      if (other.manager === a.id) other.manager = id;
      other.reports = other.reports.map((r) => (r === a.id ? id : r));
    }
    this.initRelationships(hire);
    this.slipped = this.slipped.filter((s) => s.entryId !== a.id);

    this.later(5, () => {
      this.system(`🆕 ${hire.name} has joined as ${hire.title}.`, "event");
      this.say(boss, "newHire", { target: hire.first }, { force: true });
      const greeter = this.pick(this.agents.filter((b) => b !== hire && b !== boss && !b.absent));
      if (greeter) this.later(1, () => this.say(greeter, "newHire", { target: hire.first }, { force: true }));
      this.later(2, () => this.say(hire, "morning", {}, { force: true }));
      this.onUpdate();
    });
  }

  // ---------- player chat ----------
  // Returns a list of {agent, key} responses to the player's message.
  respondToUser(text) {
    const lower = text.toLowerCase();
    const present = this.present();
    let addressed = present.filter((a) => lower.includes(a.first.toLowerCase()));
    if (/\b(everyone|all|team|guys|folks|y'all)\b/.test(lower)) addressed = present.slice();
    if (!addressed.length) {
      // Sociable people are more likely to jump in.
      addressed = present.filter((a) => chance(0.15 + a.traits.sociability * 0.35));
      if (!addressed.length) addressed = [this.pick(present)];
    }
    addressed = addressed.slice(0, 3);

    const has = (re) => re.test(lower);
    let kind = "userGeneric";
    if (has(/\b(good job|great job|well done|nice work|awesome|amazing|proud|thank|thanks|appreciate|you rock|great work)\b/)) kind = "userPraise";
    else if (has(/\b(lazy|bad job|terrible|useless|slow|incompetent|awful|worst|fire you|fired|suck|stupid|disappoint)\b/)) kind = "userCriticize";
    else if (has(/\b(how are you|how're you|how is it going|how's it going|you ok|you okay|feeling|stressed|how are things)\b/)) kind = "userHow";
    else if (has(/^(hi|hey|hello|yo|good morning|morning|sup|howdy)\b/)) kind = "userGreet";

    addressed.forEach((a, i) => {
      let key = kind;
      if (kind === "userHow") key = a.stress > 55 ? "userHowBad" : "userHowGood";
      if (kind === "userPraise") this.affect(a, { stress: -4, morale: 3 });
      if (kind === "userCriticize") this.affect(a, { stress: 6 + a.traits.temper * 6, morale: -4 });
      const reply = this.line(a, key, { target: "you" });
      setTimeout(() => {
        this.onChat({ kind: "agent", agent: a, text: reply, time: this.clock() });
        this.onUpdate();
      }, 600 + i * 900 + Math.random() * 500);
    });
  }
}
