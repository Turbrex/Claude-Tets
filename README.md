# Office Sim

A browser-based simulation of a small office run by five AI characters with human-like
personalities, stress levels and a chat room where they talk, react and complain.

Open `index.html` in any modern browser — no build step, server or API key needed.

## The staff

| Role | Character | Personality |
|------|-----------|-------------|
| Overseer / boss | **Victoria Hale**, Regional Director | Demanding, results-driven. Grades harder when she's stressed. |
| Manager | **Dana Brooks**, Operations Manager | Strict perfectionist. Catches most mistakes, struggles to relax. |
| Manager | **Marcus Webb**, Team Lead | Laid-back morale booster. Misses details in reviews. |
| Entry level | **Jamie Park**, Junior Associate (reports to Marcus) | Eager people-pleaser. Takes criticism hard. |
| Entry level | **Riley Chen**, Data Clerk (reports to Dana) | Sarcastic, anxious, runs on cold brew. |

Each character has traits (diligence, resilience, sociability, ambition, temper) that shape how
fast they work, how quickly stress builds, how often they chat and how they react to feedback.

## How the simulation works

- **Time**: each tick is 5 simulated minutes; the workday runs 09:00–17:00 with lunch at 12:00.
- **Work**: managers assign simple tasks to entry-level staff. Finished work goes to the manager
  for review; caught errors are sent back for rework, missed errors may be found by the boss.
- **Stress**: rises with workload, deadlines, mistakes, bad reviews, the boss hovering and office
  mishaps; falls with breaks, chatting with friends, praise, bonuses, donuts and sleep.
  **Lower stress means faster work and fewer mistakes.** Past ~95 stress a character melts down
  and steps away; ending a day burned out may lead to a sick day.
- **Progress reports** at **12:00** and **17:00**: the boss scores everyone (output, quality,
  focus; managers also on their team's output and review accuracy) and hands out:
  - *Outstanding* → cash bonus, big stress relief
  - *Good* → praise
  - *Meets expectations* → nothing
  - *Needs improvement* → reprimand, more stress
  - *Unacceptable* → formal warning. **Three warnings = fired**, and a new hire with their own
    personality takes the desk. Two good reports in a row remove a warning.
- **Relationships**: characters like or dislike each other; friendly chats lower stress, cold
  replies raise it, and coworkers react when someone is praised, scolded or fired.

## Playing

- **▶ Start / Pause** (or Space) and pick a speed.
- **Chat** as a visiting consultant: mention someone by name (`@Riley how are you?`), address
  `everyone`, praise or criticise — it affects their stress.
- **☕** on a card brings that person a coffee. Click a card to see their bio and traits.
- **Interventions**: pizza party, donuts, surprise deadline, boss walkaround, network outage, or
  force a report.

## Files

- `index.html`, `css/style.css` — layout and styling
- `js/data.js` — characters, replacement hires, tasks, random events, interventions
- `js/dialogue.js` — personality-specific dialogue lines
- `js/simulation.js` — simulation engine (stress, work, reviews, reports, firing)
- `js/ui.js` — rendering and controls
