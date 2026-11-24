# Money HQ

A personal finance dashboard: where my money comes from, where it goes, how much I can safely spend this week, and how much I can risk on an ecom test by a date.

- **No API, no server, no account.** All maths runs in the browser. Data is saved in the browser (`localStorage`) and never leaves it.
- **Plain HTML, CSS and JavaScript.** No framework, no build step.

## Sections

| Section | What it does |
|---|---|
| **Overview** | Money map: balance orb → one card per group (Shifts, Food, Bills…) → entries fan out. Click a card for its share, change vs last month, average and biggest entry. Click the orb for the goal summary and rule-based insights. Filter by month. |
| **This week** | Safe to spend Monday–Sunday = pay − fixed costs − savings − spent. Spending by category. |
| **Planner** | Pick a date: job pay by then, money on that date, and the most you can afford to lose without going under your safety floor. Projected balance chart. |
| **Add panel (left)** | Add income (shifts or lump sums), spending, monthly fixed costs; settings; backup and restore; sync code. |

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
