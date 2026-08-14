# Deploy — Frontend on Vercel, Backend on Render (both free)

Two services, one permanent URL. Follow this order.

## 0. Push to GitHub

If you haven't already:

```bash
cd /Users/abhishekkhandelwal/Downloads/autojb
git init
git add .
git commit -m "Deploy-ready"
gh repo create autojb --public --source=. --push
```

(Or push manually to a GitHub repo.)

## 1. Deploy backend to Render

1. Go to https://dashboard.render.com/blueprints
2. Click **New Blueprint Instance**
3. Connect the GitHub repo. Render auto-detects [render.yaml](render.yaml).
4. On the env-vars screen, fill:
   - `OPENAI_API_KEY` — from https://platform.openai.com/api-keys (for AI tailoring)
   - `SERPAPI_KEY` — leave blank, we use free sources
   - `GMAIL_USER` / `GMAIL_APP_PASSWORD` — only if you want email outreach
   - `CORS_ORIGIN` — leave blank for now, fill after Vercel gives you a URL
5. Click **Apply**. First build takes ~5 min (installs Chromium in Docker).
6. Copy the URL Render gives you, e.g. `https://autojb-backend.onrender.com`. Confirm the health check:
   ```bash
   curl https://autojb-backend.onrender.com/health
   # {"ok":true,"uptime":42.5}
   ```

**Render free-tier gotcha:** the service spins down after 15 min of no traffic. First request after idle takes ~30s to wake. Subsequent requests are fast.

## 2. Deploy frontend to Vercel

1. Go to https://vercel.com/new
2. Import the same GitHub repo.
3. Set **Root Directory** to `web`. Vercel auto-detects Next.js.
4. Under **Environment Variables**, add:
   - `BACKEND_URL` = `https://autojb-backend.onrender.com` (your Render URL, no trailing slash)
5. Click **Deploy**. Takes ~1 min.
6. Vercel gives you a URL like `https://autojb.vercel.app`.

## 3. Lock the backend to your Vercel URL

Back on Render:

1. Open the service → **Environment**
2. Set `CORS_ORIGIN` = `https://autojb.vercel.app` (add preview URLs too if you use them, comma-separated)
3. Save. Render restarts automatically.

## 4. Add password protection (optional)

Vercel env vars → add:
- `AUTH_USER` = a username you pick
- `AUTH_PASS` = a password you pick

Redeploy. Site now shows a browser login prompt for every visitor. Remove both env vars to make it open again.

## Costs — free tier limits

- **Vercel Hobby**: 100 GB bandwidth/month, unlimited requests. Way more than enough.
- **Render Free**: 750 hours/month of a single web service (basically 24/7). Spins down after 15 min idle, ~30s cold start on wake.
- **OpenAI**: pay-as-you-go, ~$0.0002 per AI tailoring call. 5000 tailorings ≈ $1.

## When you push updates

Both platforms auto-redeploy on `git push`. Backend rebuilds Docker image (~3 min), frontend rebuilds Next.js (~1 min). No manual step.

## What breaks on Render free tier

- **Cold start on first hit**: normal, wait 30s
- **Puppeteer auto-apply**: works, but slow (Chromium in a small container). If it times out often, upgrade to Render Starter ($7/mo) or accept manual apply.
- **File uploads (resume)**: persist to disk in the container — **lost on redeploy or spin-down**. To fix later, wire in Vercel Blob or Render's disk add-on ($1/mo).
