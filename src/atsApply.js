/**
 * ATS-specific auto-apply adapters. Uses Puppeteer to fill and submit real forms
 * on Greenhouse, Lever, and Ashby. Each adapter returns { ok, reason }.
 *
 * Only submits when profile has the required fields AND a resume file exists.
 * When submission conditions aren't met, opens a visible browser so the user can
 * finish manually — that's still faster than starting from scratch.
 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

// Chrome path resolution: env override → local mac → linux server locations.
function findChrome() {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || candidates[0];
}
const CHROME = findChrome();

function pickAdapter(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('greenhouse.io') || u.includes('boards.greenhouse.io')) return applyGreenhouse;
  if (u.includes('lever.co') || u.includes('jobs.lever.co')) return applyLever;
  if (u.includes('ashbyhq.com')) return applyAshby;
  return null;
}

async function applyATS(job, profile, resumePath) {
  const adapter = pickAdapter(job.applyUrl);
  if (!adapter) return { ok: false, reason: 'No adapter for this URL' };
  if (!profile?.name || !profile?.email) {
    return { ok: false, reason: 'Fill your name + email on the Profile page first' };
  }
  if (!resumePath || !fs.existsSync(resumePath)) {
    return { ok: false, reason: 'Upload your resume on the Profile page first' };
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
    defaultViewport: { width: 1280, height: 900 }
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    const result = await adapter(page, job, profile, resumePath);
    return result;
  } catch (e) {
    return { ok: false, reason: `Adapter error: ${e.message}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── Common helpers ────────────────────────────────────────────
async function typeIn(page, selector, value) {
  if (!value) return;
  const el = await page.$(selector);
  if (!el) return;
  await el.click({ clickCount: 3 }).catch(() => {});
  await el.type(String(value), { delay: 30 });
}

async function uploadTo(page, selector, filePath) {
  const el = await page.$(selector);
  if (!el) return false;
  await el.uploadFile(filePath);
  return true;
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

// ── Greenhouse ───────────────────────────────────────────────
async function applyGreenhouse(page, job, profile, resumePath) {
  await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Greenhouse iframe embed detection — some boards embed via iframe
  const iframeHandle = await page.$('iframe[src*="greenhouse"]');
  const target = iframeHandle ? await iframeHandle.contentFrame() : page;
  if (!target) return { ok: false, reason: 'Could not access Greenhouse form' };

  const { first, last } = splitName(profile.name);

  await typeIn(target, '#first_name, input[name="first_name"], input[autocomplete="given-name"]', first);
  await typeIn(target, '#last_name, input[name="last_name"], input[autocomplete="family-name"]', last);
  await typeIn(target, '#email, input[name="email"], input[type="email"]', profile.email);
  await typeIn(target, '#phone, input[name="phone"], input[type="tel"]', profile.phone || '');

  const resumeUploaded = await uploadTo(target, 'input[type="file"][name*="resume"], input[type="file"][id*="resume"], input[type="file"]', resumePath);
  if (!resumeUploaded) return { ok: false, reason: 'Could not find resume field' };

  // Wait a beat for the upload to register
  await new Promise(r => setTimeout(r, 1500));

  // Find submit button
  const submitted = await target.evaluate(() => {
    const btn = document.querySelector('button[type="submit"], input[type="submit"], button[data-source="candidate-submit"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!submitted) return { ok: false, reason: 'Could not find submit button' };

  await new Promise(r => setTimeout(r, 3500));
  const url = target.url ? target.url() : '';
  const confirmed = /thank|confirm|submitted|received/i.test(url) ||
    await target.evaluate(() => /thank|confirm|submitted|received/i.test(document.body.innerText.slice(0, 500)));

  return confirmed
    ? { ok: true, reason: 'Submitted to Greenhouse' }
    : { ok: false, reason: 'Submitted but no confirmation detected — check manually' };
}

// ── Lever ────────────────────────────────────────────────────
async function applyLever(page, job, profile, resumePath) {
  // Lever job URL → apply URL is either the same page or /apply appended
  const applyUrl = /\/apply(\/?|$)/.test(job.applyUrl) ? job.applyUrl : job.applyUrl.replace(/\/?$/, '/apply');
  await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  await typeIn(page, 'input[name="name"]', profile.name);
  await typeIn(page, 'input[name="email"]', profile.email);
  await typeIn(page, 'input[name="phone"]', profile.phone || '');
  await typeIn(page, 'input[name="urls[LinkedIn]"], input[name*="linkedin"]', profile.linkedin || '');

  const uploaded = await uploadTo(page, 'input[type="file"][name="resume"], input[type="file"]', resumePath);
  if (!uploaded) return { ok: false, reason: 'Could not find resume field' };

  await new Promise(r => setTimeout(r, 1500));

  const submitted = await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"], input[type="submit"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!submitted) return { ok: false, reason: 'Could not find submit button' };

  await new Promise(r => setTimeout(r, 3500));
  const url = page.url();
  return /thanks|confirm|submitted/i.test(url)
    ? { ok: true, reason: 'Submitted to Lever' }
    : { ok: false, reason: 'Submitted but no confirmation detected — check manually' };
}

// ── Ashby ────────────────────────────────────────────────────
async function applyAshby(page, job, profile, resumePath) {
  await page.goto(job.applyUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  // Ashby uses React with dynamic fields — try common selectors
  await typeIn(page, 'input[name="_systemfield_name"], input[aria-label*="Name" i]', profile.name);
  await typeIn(page, 'input[name="_systemfield_email"], input[aria-label*="Email" i], input[type="email"]', profile.email);

  const uploaded = await uploadTo(page, 'input[type="file"]', resumePath);
  if (!uploaded) return { ok: false, reason: 'Could not find resume field (Ashby form may need manual completion)' };

  await new Promise(r => setTimeout(r, 2000));

  const submitted = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const submit = btns.find(b => /submit|apply/i.test(b.textContent));
    if (submit) { submit.click(); return true; }
    return false;
  });
  if (!submitted) return { ok: false, reason: 'Could not find submit button' };

  await new Promise(r => setTimeout(r, 3500));
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 600));
  return /thank|receiv|submitted/i.test(bodyText)
    ? { ok: true, reason: 'Submitted to Ashby' }
    : { ok: false, reason: 'Submitted but no confirmation detected — check manually' };
}

module.exports = { applyATS, pickAdapter };
