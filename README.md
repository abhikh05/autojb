# Influencer Job Autopilot

Claude finds influencer marketing jobs, scores them against your profile, drafts personalized emails, and sends them automatically.

## Architecture (v2)

Two processes:
- **Backend** — Express API on port `3000` (`npm start`)
- **Frontend** — Next.js 14 app in `web/` on port `3001` (`cd web && npm run dev`)

The Next.js app proxies `/api/*` to the Express backend via `web/next.config.js`. Set `BACKEND_URL` if the API lives elsewhere.

Open http://localhost:3001 for the UI. The legacy `public/index.html` has been removed.

### Auto-apply vs manual

`web/lib/platforms.ts` classifies every job by its apply URL:
- **Auto-apply** (Auto-apply button): Indeed, LinkedIn Easy Apply, Greenhouse, Lever, Workday, Workable, Ashby, SmartRecruiters, Upwork, Fiverr, Contra
- **Manual** (Apply manually button, opens in new tab): everything else + company career sites + email-only listings

Add a new adapter? Add its domain(s) to `PLATFORMS` in `web/lib/platforms.ts` and set `autoApply: true`.

## Setup (5 minutes)

### 1. Install dependencies
```bash
npm install
cd web && npm install && cd ..
```

### 2. Configure environment
```bash
cp .env.example .env
```
Open `.env` and fill in:

**Required:**
- `ANTHROPIC_API_KEY` — get from https://console.anthropic.com

**For email sending (Gmail):**
1. Go to https://myaccount.google.com/security
2. Enable 2-Step Verification (required)
3. Search "App passwords" → Create one → Copy the 16-char password
4. Set `GMAIL_USER=you@gmail.com` and `GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx`

**For real job listings (optional, free tier):**
1. Sign up at https://rapidapi.com
2. Search "JSearch" → Subscribe to free tier (500 req/month free)
3. Copy your API key → set `JSEARCH_API_KEY=...`

> Without JSearch, Claude generates realistic job listings for testing.

### 3. Run
```bash
npm start
```

Open http://localhost:3000

---

## How it works

1. **Fill your profile** — name, role, skills, achievements, email signature
2. **Configure search** — keywords, location, min relevance score
3. **Hit Start** — Claude runs the pipeline:
   - Fetches jobs from JSearch API (or generates via Claude)
   - Scores each job 0-100 against your profile
   - Skips jobs below your threshold
   - Drafts personalized application emails for jobs with emails in the description
   - Auto-sends via Gmail (if configured) or shows "Open in mail" button
4. **Review results** in the Jobs tab

---

## Auto-schedule (optional)
Set `AUTO_RUN_INTERVAL_HOURS=6` in `.env` to auto-run every 6 hours.

---

## File structure
```
src/
  server.js       — Express + SSE + pipeline orchestration
  jobSearch.js    — JSearch API + Claude fallback
  scorer.js       — Claude relevance scoring
  emailDrafter.js — Claude email generation
  mailer.js       — Gmail/nodemailer sending
  state.js        — JSON persistence
public/
  index.html      — Frontend dashboard
state.json        — Auto-created, persists jobs/profile/logs
```
