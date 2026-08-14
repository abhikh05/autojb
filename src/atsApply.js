/**
 * ATS auto-apply adapters. Uses Puppeteer to fill and submit real forms
 * on Greenhouse, Lever, Ashby, and Workable. Each adapter returns { ok, reason, method }.
 *
 * Design notes:
 * - Every selector is a list of alternates. ATS forms mutate constantly.
 * - We handle iframe embeds (Greenhouse loves those).
 * - We handle hidden file inputs (common: styled drop-zone hides the real <input type=file>).
 * - We never blindly submit — we verify confirmation before returning ok:true.
 */
const puppeteer = require('puppeteer-core');
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
  if (u.includes('greenhouse.io') || u.includes('boards.greenhouse.io')) return { name: 'greenhouse', fn: applyGreenhouse };
  if (u.includes('lever.co') || u.includes('jobs.lever.co')) return { name: 'lever', fn: applyLever };
  if (u.includes('ashbyhq.com')) return { name: 'ashby', fn: applyAshby };
  if (u.includes('workable.com')) return { name: 'workable', fn: applyWorkable };
  return null;
}

async function applyATS(job, profile, resumePath) {
  const adapter = pickAdapter(job.applyUrl);
  if (!adapter) return { ok: false, reason: 'No adapter available for this platform' };

  const missing = [];
  if (!profile?.name) missing.push('name');
  if (!profile?.email) missing.push('email');
  if (!resumePath || !fs.existsSync(resumePath)) missing.push('resume PDF');
  if (missing.length) {
    return { ok: false, reason: `Complete your profile first — missing: ${missing.join(', ')}` };
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: CHROME,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--disable-blink-features=AutomationControlled', '--window-size=1280,900'],
      defaultViewport: { width: 1280, height: 900 }
    });
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.evaluateOnNewDocument(stealthScript);

    const result = await adapter.fn(page, job, profile, resumePath);
    return { ...result, method: `auto:${adapter.name}` };
  } catch (e) {
    return { ok: false, reason: `${adapter.name}: ${e.message}`, method: `auto:${adapter.name}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── Common helpers ────────────────────────────────────────────
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function stealthScript() {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  window.chrome = { runtime: {} };
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') || parts[0] || '' };
}

// Try each selector on target (page or frame) until one works. Returns true if filled.
async function tryFill(target, selectors, value) {
  if (!value) return false;
  for (const sel of selectors) {
    try {
      const el = await target.$(sel);
      if (!el) continue;
      await el.evaluate(e => { e.focus(); if ('value' in e) e.value = ''; });
      await el.type(String(value), { delay: 25 });
      return true;
    } catch {}
  }
  return false;
}

// Find a file input even if it's visually hidden. Returns handle or null.
async function findFileInput(target) {
  for (const sel of [
    'input[type="file"][name*="resume" i]',
    'input[type="file"][id*="resume" i]',
    'input[type="file"][aria-label*="resume" i]',
    'input[type="file"][accept*="pdf"]',
    'input[type="file"]'
  ]) {
    const el = await target.$(sel);
    if (el) return el;
  }
  return null;
}

async function uploadResume(target, resumePath) {
  const el = await findFileInput(target);
  if (!el) return false;
  // Unhide if styled hidden — some sites use display:none which blocks upload
  await el.evaluate(e => {
    e.style.display = 'block';
    e.style.visibility = 'visible';
    e.style.opacity = '1';
  });
  await el.uploadFile(resumePath);
  return true;
}

// Find submit button by common text patterns
async function clickSubmit(target) {
  const clicked = await target.evaluate(() => {
    const btns = [...document.querySelectorAll('button, input[type=submit]')];
    const submit = btns.find(b => {
      const t = (b.innerText || b.value || '').trim().toLowerCase();
      return /^(submit|submit application|apply now|send application|apply|next)$/.test(t)
        || b.type === 'submit';
    });
    if (submit) { submit.click(); return true; }
    return false;
  });
  return clicked;
}

// Wait for a confirmation signal or the URL to change to a thanks page.
async function waitForConfirmation(target, timeout = 12000) {
  const startedUrl = typeof target.url === 'function' ? target.url() : '';
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const currentUrl = typeof target.url === 'function' ? target.url() : startedUrl;
    if (currentUrl !== startedUrl && /thank|confirm|submitted|received|success|complete/i.test(currentUrl)) {
      return { confirmed: true, signal: 'url' };
    }
    const bodyText = await target.evaluate(() => document.body?.innerText?.slice(0, 800) || '').catch(() => '');
    if (/thank you|thanks for applying|application (was )?(received|submitted|sent|complete)|we('ve| have) received/i.test(bodyText)) {
      return { confirmed: true, signal: 'body' };
    }
    if (/error|please try again|required field|invalid/i.test(bodyText.slice(0, 400))) {
      return { confirmed: false, signal: 'error', bodyPreview: bodyText.slice(0, 300) };
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return { confirmed: false, signal: 'timeout' };
}

async function getFormTarget(page, hostFragment) {
  // Some job boards embed via iframe; find the frame if present.
  const frames = page.frames();
  for (const f of frames) {
    if (f.url().includes(hostFragment)) return f;
  }
  return page;
}

// ── Greenhouse ───────────────────────────────────────────────
async function applyGreenhouse(page, job, profile, resumePath) {
  await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout?.(1200) ?? new Promise(r => setTimeout(r, 1200));

  const target = await getFormTarget(page, 'greenhouse');
  const { first, last } = splitName(profile.name);

  const filled = {
    first: await tryFill(target, [
      '#first_name', 'input[name="first_name"]',
      'input[autocomplete="given-name"]', 'input[aria-label*="First name" i]'
    ], first),
    last: await tryFill(target, [
      '#last_name', 'input[name="last_name"]',
      'input[autocomplete="family-name"]', 'input[aria-label*="Last name" i]'
    ], last),
    email: await tryFill(target, [
      '#email', 'input[name="email"]', 'input[type="email"]', 'input[autocomplete="email"]'
    ], profile.email),
    phone: await tryFill(target, [
      '#phone', 'input[name="phone"]', 'input[type="tel"]', 'input[autocomplete="tel"]'
    ], profile.phone || '')
  };

  const uploaded = await uploadResume(target, resumePath);
  if (!uploaded) return { ok: false, reason: 'Could not find resume upload field on Greenhouse form' };

  // Give the async upload UI a moment to register
  await new Promise(r => setTimeout(r, 2500));

  const submitted = await clickSubmit(target);
  if (!submitted) return { ok: false, reason: `Filled ${Object.keys(filled).filter(k=>filled[k]).length} fields but no submit button found` };

  const confirm = await waitForConfirmation(target, 15000);
  return confirm.confirmed
    ? { ok: true, reason: `Submitted to Greenhouse (${confirm.signal})` }
    : { ok: false, reason: `Submitted but not confirmed — ${confirm.signal}${confirm.bodyPreview ? ': ' + confirm.bodyPreview.slice(0, 120) : ''}` };
}

// ── Lever ────────────────────────────────────────────────────
async function applyLever(page, job, profile, resumePath) {
  const applyUrl = /\/apply(\/?|$)/.test(job.applyUrl) ? job.applyUrl : job.applyUrl.replace(/\/?$/, '/apply');
  await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));

  await tryFill(page, ['input[name="name"]', 'input[autocomplete="name"]'], profile.name);
  await tryFill(page, ['input[name="email"]', 'input[type="email"]'], profile.email);
  await tryFill(page, ['input[name="phone"]', 'input[type="tel"]'], profile.phone || '');
  await tryFill(page, [
    'input[name="urls[LinkedIn]"]',
    'input[name*="linkedin" i]',
    'input[placeholder*="linkedin" i]'
  ], profile.linkedin || '');
  await tryFill(page, [
    'input[name="urls[Portfolio]"]',
    'input[name*="portfolio" i]',
    'input[name*="website" i]'
  ], profile.portfolio || '');

  const uploaded = await uploadResume(page, resumePath);
  if (!uploaded) return { ok: false, reason: 'Could not find resume upload field on Lever form' };
  await new Promise(r => setTimeout(r, 2500));

  const submitted = await clickSubmit(page);
  if (!submitted) return { ok: false, reason: 'No submit button found on Lever form' };

  const confirm = await waitForConfirmation(page, 15000);
  return confirm.confirmed
    ? { ok: true, reason: `Submitted to Lever (${confirm.signal})` }
    : { ok: false, reason: `Submitted but not confirmed — ${confirm.signal}${confirm.bodyPreview ? ': ' + confirm.bodyPreview.slice(0, 120) : ''}` };
}

// ── Ashby ────────────────────────────────────────────────────
async function applyAshby(page, job, profile, resumePath) {
  await page.goto(job.applyUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Ashby uses React with heavily controlled inputs. Use native setter trick.
  await page.evaluate((profile) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    function setReactValue(el, value) {
      if (!el || value == null) return;
      nativeSetter.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const inputs = [...document.querySelectorAll('input, textarea')];
    for (const i of inputs) {
      const lbl = (i.getAttribute('aria-label') || i.name || i.id || i.placeholder || '').toLowerCase();
      if (/name/.test(lbl) && !/company|first|last|user/.test(lbl)) setReactValue(i, profile.name);
      else if (/first.?name/.test(lbl)) setReactValue(i, (profile.name || '').split(/\s+/)[0]);
      else if (/last.?name|surname/.test(lbl)) setReactValue(i, (profile.name || '').split(/\s+/).slice(1).join(' '));
      else if (/email/.test(lbl)) setReactValue(i, profile.email);
      else if (/phone|tel/.test(lbl)) setReactValue(i, profile.phone || '');
      else if (/linkedin/.test(lbl)) setReactValue(i, profile.linkedin || '');
      else if (/portfolio|website|url/.test(lbl)) setReactValue(i, profile.portfolio || '');
    }
  }, {
    name: profile.name, email: profile.email, phone: profile.phone || '',
    linkedin: profile.linkedin || '', portfolio: profile.portfolio || ''
  });

  const uploaded = await uploadResume(page, resumePath);
  if (!uploaded) return { ok: false, reason: 'Could not find resume upload field on Ashby form' };
  await new Promise(r => setTimeout(r, 2500));

  const submitted = await clickSubmit(page);
  if (!submitted) return { ok: false, reason: 'No submit button found on Ashby form' };

  const confirm = await waitForConfirmation(page, 15000);
  return confirm.confirmed
    ? { ok: true, reason: `Submitted to Ashby (${confirm.signal})` }
    : { ok: false, reason: `Submitted but not confirmed — ${confirm.signal}` };
}

// ── Workable ─────────────────────────────────────────────────
async function applyWorkable(page, job, profile, resumePath) {
  await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  // Sometimes Workable shows a "Apply for this position" button before the form
  const cta = await page.$('a[href*="/apply"], button[data-ui*="apply"]');
  if (cta) {
    await cta.click().catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
  }

  const { first, last } = splitName(profile.name);
  await tryFill(page, ['input[name*="first" i]', 'input[id*="firstname" i]'], first);
  await tryFill(page, ['input[name*="last" i]', 'input[id*="lastname" i]'], last);
  await tryFill(page, ['input[type="email"]', 'input[name*="email" i]'], profile.email);
  await tryFill(page, ['input[type="tel"]', 'input[name*="phone" i]'], profile.phone || '');

  const uploaded = await uploadResume(page, resumePath);
  if (!uploaded) return { ok: false, reason: 'Could not find resume upload field on Workable form' };
  await new Promise(r => setTimeout(r, 2500));

  const submitted = await clickSubmit(page);
  if (!submitted) return { ok: false, reason: 'No submit button found on Workable form' };

  const confirm = await waitForConfirmation(page, 15000);
  return confirm.confirmed
    ? { ok: true, reason: `Submitted to Workable (${confirm.signal})` }
    : { ok: false, reason: `Submitted but not confirmed — ${confirm.signal}` };
}

module.exports = { applyATS, pickAdapter };
