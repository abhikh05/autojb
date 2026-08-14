const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const COOKIES_FILE = path.join(__dirname, '../uploads/indeed_cookies.json');
function findChrome() {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser', '/usr/bin/chromium'
  ];
  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || candidates[0];
}
const CHROME = findChrome();
const GOOGLE_EMAIL = 'abhi.kh2018@gmail.com';

// ── Browser helpers ──────────────────────────────────────────────────────────

function launchArgs(headless) {
  return {
    headless: headless ? 'new' : false,
    executablePath: CHROME,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,900'
    ],
    defaultViewport: { width: 1280, height: 900 }
  };
}

async function stealthPage(browser) {
  const page = await browser.newPage();
  // Hide automation signals that Google/Indeed detect
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  return page;
}

async function saveCookies(page) {
  const cookies = await page.cookies();
  fs.mkdirSync(path.dirname(COOKIES_FILE), { recursive: true });
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  console.log('[Indeed] Cookies saved');
}

async function loadCookies(page) {
  if (!fs.existsSync(COOKIES_FILE)) return false;
  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
    await page.setCookie(...cookies);
    return true;
  } catch { return false; }
}

function hasCookies() {
  if (!fs.existsSync(COOKIES_FILE)) return false;
  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
    // Check if session cookie exists and isn't ancient
    const session = cookies.find(c => c.name === 'CTK' || c.name === 'indeed_sess' || c.name === 'CSRF');
    return !!session;
  } catch { return false; }
}

// ── One-time Google login (visible browser) ──────────────────────────────────

async function setupGoogleLogin(broadcast) {
  broadcast('log', { type: 'info', msg: 'Opening Chrome for Indeed Google login...', time: new Date().toLocaleTimeString() });

  const browser = await puppeteer.launch(launchArgs(false));
  const page = await stealthPage(browser);

  try {
    await page.goto('https://secure.indeed.com/auth?hl=en_IN&co=IN', {
      waitUntil: 'networkidle2', timeout: 30000
    });

    await sleep(2000);

    // Click "Continue with Google"
    const googleBtn = await page.$('a[href*="google"], button[data-tn-element*="google"], [class*="google" i]');
    if (googleBtn) {
      await googleBtn.click();
      broadcast('log', { type: 'info', msg: 'Clicked Google login — select abhi.kh2018@gmail.com in the window', time: new Date().toLocaleTimeString() });
    } else {
      broadcast('log', { type: 'info', msg: 'Please click "Continue with Google" and log in with abhi.kh2018@gmail.com', time: new Date().toLocaleTimeString() });
    }

    // Wait for user to complete login (up to 3 minutes)
    broadcast('log', { type: 'info', msg: 'Waiting for you to complete login in the Chrome window (up to 3 min)...', time: new Date().toLocaleTimeString() });

    await page.waitForFunction(
      () => window.location.hostname === 'www.indeed.com' || window.location.pathname === '/',
      { timeout: 180000 }
    ).catch(() => {});

    // Extra wait to settle
    await sleep(3000);

    const url = page.url();
    if (url.includes('indeed.com') && !url.includes('auth')) {
      await saveCookies(page);
      broadcast('log', { type: 'info', msg: 'Indeed login successful. Cookies saved for future runs.', time: new Date().toLocaleTimeString() });
      await browser.close();
      return { ok: true };
    } else {
      await browser.close();
      return { ok: false, error: 'Login did not complete — please try again' };
    }
  } catch (e) {
    await browser.close().catch(() => {});
    return { ok: false, error: e.message };
  }
}

// ── Indeed Easy Apply (headless with saved cookies) ──────────────────────────

async function applyIndeedJob(job, profile, resumePath, broadcast) {
  if (!hasCookies()) {
    return { ok: false, reason: 'Indeed not logged in — run Setup Login first from the app' };
  }

  const browser = await puppeteer.launch(launchArgs(true));
  const page = await stealthPage(browser);

  try {
    // Load saved session
    await loadCookies(page);
    await page.goto('https://www.indeed.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1500);

    // Navigate to job
    const applyUrl = job.applyUrl || job.url;
    if (!applyUrl) { await browser.close(); return { ok: false, reason: 'No apply URL' }; }

    await page.goto(applyUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(2000);

    // Check if still logged in
    const loggedIn = await page.evaluate(() => {
      return !document.querySelector('a[href*="/account/login"]') ||
             !!document.querySelector('[data-tn-element="header-user-nav"]') ||
             !!document.querySelector('.gnav-LoggedInHeaderSignIn');
    });

    if (!loggedIn) {
      await browser.close();
      fs.unlinkSync(COOKIES_FILE); // clear stale cookies
      return { ok: false, reason: 'Session expired — re-run Setup Login' };
    }

    // Click Easy Apply button
    const applyBtn = await page.$(
      '#indeedApplyButton, [data-testid="indeedApplyButton"], ' +
      'button[class*="apply" i], a[class*="apply" i], ' +
      'button[id*="apply" i], .ia-IndeedApplyButton'
    );
    if (!applyBtn) {
      await browser.close();
      return { ok: false, reason: 'No Easy Apply button found on this job' };
    }

    await applyBtn.click();
    await sleep(3000);

    // Handle the multi-step apply modal/flow
    const result = await handleEasyApplySteps(page, profile, resumePath, broadcast, job);

    // Refresh cookies after successful action
    await saveCookies(page);
    await browser.close();
    return result;

  } catch (e) {
    await browser.close().catch(() => {});
    return { ok: false, reason: 'Indeed apply error: ' + e.message.slice(0, 100) };
  }
}

// ── Multi-step Easy Apply handler ────────────────────────────────────────────

async function handleEasyApplySteps(page, profile, resumePath, broadcast, job) {
  const MAX_STEPS = 12;

  for (let step = 0; step < MAX_STEPS; step++) {
    await sleep(2000);

    const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());

    // ── Detect completion ──
    if (
      pageText.includes('application submitted') ||
      pageText.includes('you applied') ||
      pageText.includes('successfully submitted') ||
      pageText.includes('application complete')
    ) {
      return { ok: true, reason: `Applied via Indeed Easy Apply (${step + 1} steps)` };
    }

    // ── Resume upload step ──
    if (pageText.includes('resume') || pageText.includes('upload')) {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput && resumePath && fs.existsSync(resumePath)) {
        try {
          await fileInput.uploadFile(resumePath);
          await sleep(2000);
        } catch (e) {
          console.log('[Indeed] Resume upload failed:', e.message);
        }
      }
    }

    // ── Contact info / basic fields ──
    await fillIfEmpty(page, 'input[name="applicant.name"], input[id*="applicant-name"]', profile.name || '');
    await fillIfEmpty(page, 'input[type="email"], input[id*="email"]', profile.email || '');
    await fillIfEmpty(page, 'input[type="tel"], input[id*="phone"], input[name*="phone"]', profile.phone || '+917898405490');
    await fillIfEmpty(page, 'input[id*="city"], input[name*="city"], input[placeholder*="city" i]', profile.location || 'Gwalior');

    // ── Work authorization / yes-no questions ──
    await answerScreeningQuestions(page, profile);

    // ── Cover letter / additional info ──
    const textarea = await page.$('textarea[id*="cover"], textarea[name*="cover"], textarea[placeholder*="cover" i]');
    if (textarea) {
      const val = await page.evaluate(el => el.value, textarea);
      if (!val || val.trim().length < 10) {
        await textarea.click({ clickCount: 3 });
        await textarea.type(buildCoverLetter(job, profile), { delay: 15 });
      }
    }

    // ── Try Next / Continue / Submit ──
    const advanced = await clickNextOrSubmit(page);
    if (!advanced) {
      // Nothing to click — might be done
      break;
    }
  }

  // Final check
  const finalText = await page.evaluate(() => document.body.innerText.toLowerCase());
  if (
    finalText.includes('application submitted') ||
    finalText.includes('you applied') ||
    finalText.includes('successfully submitted')
  ) {
    return { ok: true, reason: 'Applied via Indeed Easy Apply' };
  }

  return { ok: false, reason: 'Could not complete all apply steps — manual review needed' };
}

// ── Screening questions auto-answerer ─────────────────────────────────────────

async function answerScreeningQuestions(page) {
  // Yes/No radio buttons — default to "Yes" for work authorization, eligibility
  const radios = await page.$$('input[type="radio"]');
  for (const radio of radios) {
    try {
      const label = await page.evaluate(r => {
        const lbl = document.querySelector(`label[for="${r.id}"]`);
        return lbl ? lbl.innerText.toLowerCase() : r.value?.toLowerCase() || '';
      }, radio);
      const isChecked = await page.evaluate(r => r.checked, radio);
      if (isChecked) continue;

      // Answer "Yes" to authorization, eligibility, availability, full-time
      if (/^yes$|^true$|authorized|eligible|available|full.?time|legally/.test(label)) {
        await radio.click();
        await sleep(300);
      }
      // Answer "No" to sponsorship requirements
      if (/sponsor|require sponsor/.test(label) && /no/.test(label)) {
        await radio.click();
        await sleep(300);
      }
    } catch {}
  }

  // Dropdowns — pick sensible defaults
  const selects = await page.$$('select');
  for (const sel of selects) {
    try {
      const val = await page.evaluate(s => s.value, sel);
      if (val) continue; // already has a value
      const opts = await page.evaluate(s =>
        [...s.options].map(o => ({ v: o.value, t: o.text.toLowerCase() })), sel);

      // Experience years
      let chosen = opts.find(o => o.t.includes('3') || o.t.includes('2-3') || o.t.includes('2 - 3'));
      // Yes options
      if (!chosen) chosen = opts.find(o => /^yes$/.test(o.t));
      // Full time
      if (!chosen) chosen = opts.find(o => o.t.includes('full'));
      if (chosen && chosen.v) {
        const selId = await page.evaluate(s => s.id || s.name || '', sel);
        const selector = selId ? `select#${selId}, select[name="${selId}"]` : 'select';
        await page.evaluate((s, v) => { s.value = v; s.dispatchEvent(new Event('change', {bubbles:true})); }, sel, chosen.v);
      }
    } catch {}
  }

  // Number inputs (years of experience etc.) — fill with 3
  const numInputs = await page.$$('input[type="number"], input[inputmode="numeric"]');
  for (const inp of numInputs) {
    try {
      const val = await page.evaluate(i => i.value, inp);
      if (!val) {
        await inp.click({ clickCount: 3 });
        await inp.type('3', { delay: 50 });
      }
    } catch {}
  }
}

async function clickNextOrSubmit(page) {
  const clicked = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('button, input[type="submit"]')];
    const btn = candidates.find(b => {
      const t = (b.textContent + b.value + b.id + b.className).toLowerCase();
      return /submit|apply|next|continue|proceed|review/.test(t) &&
             !b.disabled && b.offsetParent !== null;
    });
    if (btn) { btn.click(); return true; }
    return false;
  });
  await sleep(2500);
  return clicked;
}

async function fillIfEmpty(page, selector, value) {
  if (!value) return;
  try {
    const el = await page.$(selector);
    if (!el) return;
    const current = await page.evaluate(e => e.value, el);
    if (current && current.trim()) return; // already filled
    await el.click({ clickCount: 3 });
    await el.type(value, { delay: 20 });
  } catch {}
}

function buildCoverLetter(job, profile) {
  return `Hi,

I am ${profile.name || 'Abhishek Khandelwal'}, a marketing professional with 3 years of experience in influencer marketing and digital campaigns. I have delivered campaigns for Netflix, Swiggy, Hero Motors, and Dabur, including managing 2,000+ nano-influencers.

I am excited about the ${job.title || 'role'} at ${job.company || 'your company'} and believe my background in ${profile.skills || 'influencer marketing, social media management, and brand partnerships'} makes me a strong fit.

${profile.sig || 'Best regards,\nAbhishek Khandelwal\nabhi.kh2018@gmail.com\n+91 7898405490'}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { applyIndeedJob, setupGoogleLogin, hasCookies };
