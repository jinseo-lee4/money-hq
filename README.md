# Money HQ

A personal finance dashboard: where my money comes from, where it goes, how much I can safely spend this week, and how much I can risk on an ecom test by a date.

- **No API, no server, no account.** All maths runs in the browser. Data is saved in the browser (`localStorage`) and never leaves it.
- **Plain HTML, CSS and JavaScript.** No framework, no build step.

## Sections

| Section | What it does |
|---|---|
| **Overview: Monthly plan** (default) | Balance now in the orb, with **the balance at the end of this month** under it. One card per monthly budget line (Job from Settings, extra income, each spending category, fixed costs). All cards flow into a net-per-month hub, which fans out to the balance at the end of the next 6 months. The panel shows money in/out per month, what's left over, and the month you reach your goal. Click a card for per week / month / year and what a 25% cut would save. |
| **Overview: Logged entries** | The same map built from what you logged one by one; each card's entries fan out from that card. Filter by month. |
| **This week** | Safe to spend Monday–Sunday = pay − fixed costs − savings − spent. Spending by category. |
| **Planner** | Pick a date: job pay by then, money on that date, and the most you can afford to lose without going under your safety floor. Projected balance chart. |
| **Add panel (left)** | Monthly budget (the main way to plan), plus optional one-by-one income and spending, monthly fixed costs, settings, backup and restore, sync code. |

## Files

| File | What it does |
|---|---|
| `index.html` | Page layout for every section and the add panel |
| `style.css` | Colours (tokens at the top), layout, phone sizes |
| `app.js` | Data, maths, drawing the map and chart, forms. Split into 8 numbered sections |

## The maths

**Income and goal**
- Take-home per hour = hourly rate × take-home %
- A shift's amount = hours × take-home per hour, fixed when logged
- Balance = already saved + all income − all spending
- Hours left = (goal − balance) ÷ take-home per hour, rounded up

**Monthly plan**
- Job per month = hours per week × take-home per hour × 52 ÷ 12
- Left over per month = money in per month − money out per month (budget spending + fixed costs)
- End of this month = balance now + left over per month × (days left in the month ÷ days in the month)
- Each month after that adds one more "left over per month"

**This week (Monday–Sunday)**
- Pay = hours per week × take-home per hour
- Fixed per week = monthly fixed costs × 12 ÷ 52
- To goal = pay × save %
- Safe to spend = pay − fixed − to goal − spent this week ("Bills" don't count, fixed costs cover them)

**Planner**
- Weeks = days until the date ÷ 7
- Job pay by then = hours per week × take-home per hour × weeks
- Money on that date = balance + job pay − (spending per week + fixed per week) × weeks
- Most you can lose = money on that date − safety floor − locked money

## Sync code (move data between browsers without a file)

Backup → type a key → **Copy sync code**. You get one line of text starting with `MHQ1.`. In the other browser: Backup → paste the code → same key → **Load my data**.

How it's locked, all inside the browser with the built-in Web Crypto (no server, no API):
- key → PBKDF2-SHA-256, 250,000 rounds, random 16-byte salt → 256-bit AES-GCM key
- data → gzip → AES-GCM with a random 12-byte IV
- code = `MHQ1.` + base64url(salt + IV + locked data)

A wrong key or a cut-off code fails the AES-GCM check, so nothing gets loaded. A forgotten key can't be recovered. Use a long key (a short phrase is good), because anyone with the code can try guessing it.

## Run it

Double-click `index.html`.

## Put it online with Vercel (free)

1. On GitHub, create a new repository called `money-hq` and upload `index.html`, `style.css`, `app.js` and `README.md` (Add file → Upload files → Commit).
2. On vercel.com, sign in with GitHub → **Add New… → Project** → pick `money-hq` → **Import**.
3. Framework preset: **Other**. Leave build settings empty. Click **Deploy**.
4. You get a link like `money-hq-xxxx.vercel.app`. Every new upload to GitHub redeploys it.

The site is public, but your numbers are not: they stay in each browser you use. A phone and a laptop each keep their own data. Use Backup → Download / Restore to move it.

## Roadmap

- [x] v1: income log, goal progress, hours left
- [x] v2: spending, fixed costs, safe to spend this week
- [x] Money map and detail panel
- [x] v3: future planner
- [ ] The ecom calculator (v4) will be its own separate site
