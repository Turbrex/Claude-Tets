// Static content for the office simulation: staff, tasks and random events.
// Dialogue lives in dialogue.js.

const OFFICE = {
  company: "Brightline Logistics",

  // Traits are 0..1.
  //   diligence  - work speed and accuracy, resists slacking off
  //   resilience - how slowly stress builds up
  //   sociability- how often they chat with coworkers
  //   ambition   - how much rewards/punishments affect them
  //   temper     - how sharply they react to criticism (and, for the boss, how harsh she grades)
  staff: [
    {
      id: "victoria", name: "Victoria Hale", role: "boss", title: "Regional Director",
      avatar: "👑", color: "#e74c3c", voice: "boss",
      traits: { diligence: 0.85, resilience: 0.75, sociability: 0.3, ambition: 0.95, temper: 0.7 },
      bio: "Runs the branch with an iron calendar. Respects results, not excuses. Secretly proud of her team, never says so.",
    },
    {
      id: "dana", name: "Dana Brooks", role: "manager", title: "Operations Manager",
      avatar: "📋", color: "#9b59b6", voice: "strict", reports: ["riley"],
      traits: { diligence: 0.9, resilience: 0.55, sociability: 0.35, ambition: 0.8, temper: 0.6 },
      bio: "By-the-book perfectionist with a color-coded planner. Catches every typo. Struggles to delegate and to relax.",
    },
    {
      id: "marcus", name: "Marcus Webb", role: "manager", title: "Team Lead",
      avatar: "😎", color: "#3498db", voice: "laidback", reports: ["jamie"],
      traits: { diligence: 0.55, resilience: 0.85, sociability: 0.9, ambition: 0.45, temper: 0.2 },
      bio: "Everybody's favorite manager. Great at morale, less great at reading the fine print.",
    },
    {
      id: "jamie", name: "Jamie Park", role: "entry", title: "Junior Associate",
      avatar: "🌱", color: "#2ecc71", voice: "eager", manager: "marcus",
      traits: { diligence: 0.75, resilience: 0.45, sociability: 0.8, ambition: 0.85, temper: 0.15 },
      bio: "Three weeks in and determined to impress. Takes criticism to heart. Brings homemade cookies on Fridays.",
    },
    {
      id: "riley", name: "Riley Chen", role: "entry", title: "Data Clerk",
      avatar: "☕", color: "#f39c12", voice: "sarcastic", manager: "dana",
      traits: { diligence: 0.6, resilience: 0.4, sociability: 0.55, ambition: 0.35, temper: 0.45 },
      bio: "Deadpan, anxious, and running on cold brew. Hides real worry behind jokes. Surprisingly fast when focused.",
    },
  ],

  // New hires who replace anyone the boss fires.
  replacements: {
    entry: [
      { name: "Sam Okafor", title: "Junior Associate", avatar: "🧩", color: "#1abc9c", voice: "stoic",
        traits: { diligence: 0.7, resilience: 0.7, sociability: 0.35, ambition: 0.5, temper: 0.2 },
        bio: "Quiet, methodical new hire. Says little, finishes things." },
      { name: "Taylor Reyes", title: "Data Clerk", avatar: "🎧", color: "#e67e22", voice: "stoic",
        traits: { diligence: 0.6, resilience: 0.6, sociability: 0.5, ambition: 0.6, temper: 0.3 },
        bio: "Works with headphones on. Unbothered by most things." },
      { name: "Morgan Ellis", title: "Junior Associate", avatar: "📎", color: "#16a085", voice: "stoic",
        traits: { diligence: 0.8, resilience: 0.5, sociability: 0.3, ambition: 0.7, temper: 0.25 },
        bio: "Transferred from accounting. Loves a clean spreadsheet." },
    ],
    manager: [
      { name: "Priya Nair", title: "Operations Manager", avatar: "📈", color: "#8e44ad", voice: "climber",
        traits: { diligence: 0.8, resilience: 0.65, sociability: 0.6, ambition: 0.95, temper: 0.45 },
        bio: "Fast-tracked hire with a five-year plan and a LinkedIn habit." },
      { name: "Alex Kim", title: "Team Lead", avatar: "🗂️", color: "#2980b9", voice: "climber",
        traits: { diligence: 0.7, resilience: 0.75, sociability: 0.55, ambition: 0.85, temper: 0.35 },
        bio: "Ex-consultant who says 'synergy' unironically." },
    ],
  },

  // `work` is the amount of effort required; a calm, rested worker does ~10 per tick.
  tasks: {
    entry: [
      { name: "enter this week's client invoices", work: 45 },
      { name: "update the customer contact spreadsheet", work: 35 },
      { name: "proofread the quarterly newsletter", work: 30 },
      { name: "file the pending expense reports", work: 30 },
      { name: "answer the support ticket backlog", work: 55 },
      { name: "reconcile warehouse inventory counts", work: 60 },
      { name: "draft minutes from the morning stand-up", work: 25 },
      { name: "clean up the shared drive folders", work: 40 },
      { name: "format the shipping manifest", work: 35 },
      { name: "call vendors to confirm delivery dates", work: 50 },
      { name: "scan and archive signed contracts", work: 30 },
      { name: "build slides for the client pitch", work: 55 },
    ],
    manager: [
      { name: "update the project roadmap", work: 50 },
      { name: "prepare the budget forecast", work: 65 },
      { name: "write the weekly status memo", work: 40 },
      { name: "rebalance next week's shift schedule", work: 45 },
      { name: "handle a client escalation", work: 55 },
      { name: "prep one-on-one notes", work: 30 },
      { name: "approve vendor purchase orders", work: 35 },
    ],
    boss: [
      { name: "review branch KPIs", work: 50 },
      { name: "take a call with headquarters", work: 40 },
      { name: "approve the quarterly budget", work: 60 },
      { name: "walk the office floor", work: 30, walk: true },
      { name: "negotiate with a major client", work: 55 },
    ],
  },

  // Per-period output targets used in progress reports.
  targets: { entry: 5, manager: 3 },

  events: [
    { id: "printer", label: "Printer jam", good: false, weight: 3,
      text: "🖨️ The printer jammed. Again. Someone's report is stuck halfway through.",
      apply: (sim) => sim.affect(sim.pick(sim.byRole("entry")), { stress: 9 }) },
    { id: "coffee", label: "Coffee machine broke", good: false, weight: 2,
      text: "☕❌ The coffee machine is broken. Breaks are less restful until it's fixed.",
      apply: (sim) => { sim.effects.noCoffee = 24; sim.affectAll({ stress: 3 }); } },
    { id: "donuts", label: "Free donuts", good: true, weight: 3,
      text: "🍩 Someone left a box of donuts in the break room!",
      apply: (sim) => sim.affectAll({ stress: -8, morale: 3 }) },
    { id: "outage", label: "Server outage", good: false, weight: 2,
      text: "🔌 The network is down. Nobody can save anything for a bit.",
      apply: (sim) => { sim.effects.outage = 3; sim.affectAll({ stress: 5 }); } },
    { id: "escalation", label: "Client escalation", good: false, weight: 2,
      text: "📞 An angry client is on the phone demanding a manager.",
      apply: (sim) => {
        const m = sim.pick(sim.byRole("manager"));
        if (!m) return;
        sim.affect(m, { stress: 12 });
        m.queue.unshift({ name: "calm down an angry client", work: 35, progress: 0, kind: "own", urgent: true });
      } },
    { id: "cake", label: "Birthday cake", good: true, weight: 2,
      text: "🎂 It's somebody's birthday! There's cake by the kitchen.",
      apply: (sim) => sim.affectAll({ stress: -10, morale: 5 }) },
    { id: "drill", label: "Fire drill", good: false, weight: 1,
      text: "🚨 Fire drill! Everyone out to the parking lot.",
      apply: (sim) => { sim.effects.drill = 3; } },
    { id: "deadline", label: "Surprise deadline", good: false, weight: 2,
      text: "⏰ Headquarters moved a deadline up. Victoria is handing out urgent work.",
      apply: (sim) => sim.surpriseDeadline() },
    { id: "walk", label: "Boss walkaround", good: false, weight: 2,
      text: "👀 Victoria is walking the floor and looking at screens.",
      apply: (sim) => sim.startBossWalk() },
    { id: "plant", label: "Office plant thriving", good: true, weight: 1,
      text: "🪴 The office plant everyone forgot about has a new leaf. Small wins.",
      apply: (sim) => sim.affectAll({ stress: -3 }) },
  ],

  // Things the player can trigger from the toolbar.
  interventions: [
    { id: "pizza", label: "🍕 Pizza party", title: "Lowers everyone's stress a lot, but costs 2 ticks of work",
      apply: (sim) => { sim.system("🍕 Pizza party in the break room! Courtesy of an anonymous benefactor."); sim.affectAll({ stress: -18, morale: 8, energy: 10 }); sim.effects.drill = 2; sim.reactAll("eventGood", 0.7); } },
    { id: "donuts", label: "🍩 Donuts", title: "Small stress relief for everyone",
      apply: (sim) => sim.triggerEvent("donuts") },
    { id: "deadline", label: "⏰ Surprise deadline", title: "Victoria hands out urgent work",
      apply: (sim) => sim.triggerEvent("deadline") },
    { id: "walk", label: "👀 Boss walkaround", title: "Victoria hovers. Everyone gets tense.",
      apply: (sim) => sim.triggerEvent("walk") },
    { id: "outage", label: "🔌 Network outage", title: "Nobody can work for a few ticks",
      apply: (sim) => sim.triggerEvent("outage") },
    { id: "report", label: "📊 Report now", title: "Run a progress report immediately",
      apply: (sim) => sim.runReport(true) },
  ],
};
