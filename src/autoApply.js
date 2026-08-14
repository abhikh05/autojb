const puppeteer = require('puppeteer-core');
const fs = require('fs');

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

const SKIP_DOMAINS = [
  'linkedin.com', 'glassdoor.com', 'ziprecruiter.com', 'dailyremote.com',
  'dynamitejobs.com', 'bebee.com', 'remote.co', 'builtin.com', 'tealhq.com',
  'ycombinator.com', 'theirstack.com', 'jobgether.com', 'remoteok.com',
  'remoterocketship.com', 'jobleads.com', 'jooble.org', 'jobcase.com',
  'simplyhired.com', 'careerjet.com', 'jobright.ai', 'getwork.com',
  'lensa.com', 'snagajob.com', 'joblist.com', 'talent.com', 'learn4good.com'
];

let sharedBrowser = null;

// ATS platforms that detect headless and need a visible browser
const VISIBLE_BROWSER_DOMAINS = ['workable.com', 'greenhouse.io', 'lever.co', 'ashbyhq.com', 'myworkdayjobs.com'];

async function getBrowser(visible = false) {
  // Always launch fresh visible browser — don't share it (causes cross-site issues)
  if (visible) {
    return puppeteer.launch({
      headless: false,
      executablePath: findChrome(),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
      defaultViewport: { width: 1280, height: 900 }
    });
  }
  if (!sharedBrowser || !sharedBrowser.connected) {
    sharedBrowser = await puppeteer.launch({
      headless: 'new',
      executablePath: findChrome(),
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--disable-extensions', '--no-first-run', '--mute-audio',
        '--js-flags=--max-old-space-size=128'
      ]
    });
  }
  return sharedBrowser;
}

async function closeBrowser() {
  if (sharedBrowser) { await sharedBrowser.close(); sharedBrowser = null; }
}

async function autoApplyToJob(job, profile, resumePath) {
  if (!job.applyUrl) return { ok: false, reason: 'No apply URL' };
  const isSkipped = SKIP_DOMAINS.some(d => job.applyUrl.includes(d));
  if (isSkipped) return { ok: false, reason: 'Job board — no direct apply' };

  const needsVisible = VISIBLE_BROWSER_DOMAINS.some(d => job.applyUrl.includes(d));
  const browser = await getBrowser(needsVisible);
  const page = await browser.newPage();

  // Stealth — hide automation signals
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  
  
  
  
  await page.setRequestInterception(true);
  page.on('request', req => {
    try {
      if (['image','font','media','stylesheet'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    } catch(e) {}
  });

  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    await page.goto(job.applyUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    let result;
    if (job.applyUrl.includes('indeed.com')) result = await applyIndeed(page, job, profile);
    else if (job.applyUrl.includes('workable.com')) result = await applyWorkable(page, job, profile, resumePath);
    else if (job.applyUrl.includes('greenhouse.io') || job.applyUrl.includes('boards.greenhouse')) result = await applyGreenhouse(page, job, profile, resumePath);
    else if (job.applyUrl.includes('lever.co')) result = await applyLever(page, job, profile, resumePath);
    else result = await applyGeneric(page, job, profile, resumePath);
    await page.close();
    if (needsVisible) await browser.close(); // close visible browser after each ATS apply
    return result;
  } catch (e) {
    await page.close().catch(()=>{});
    if (needsVisible) await browser.close().catch(()=>{});
    return { ok: false, reason: e.message.slice(0, 80) };
  }
}

async function applyWorkable(page, job, profile, resumePath) {
  const fs = require('fs');
  try {
    await sleep(2000);
    // Click the Apply button to open the form
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button, a')].find(el => /apply now|apply for/i.test(el.textContent));
      if (btn) btn.click();
    });
    await sleep(3000);

    // Upload resume — Workable requires it
    if (resumePath && fs.existsSync(resumePath)) {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.uploadFile(resumePath);
        await sleep(2000);
      }
    }

    await fillField(page, 'input[name="firstname"], input[placeholder*="first" i]', profile.name?.split(' ')[0] || '');
    await fillField(page, 'input[name="lastname"], input[placeholder*="last" i]', profile.name?.split(' ').slice(1).join(' ') || 'Khandelwal');
    await fillField(page, 'input[type="email"], input[name="email"]', profile.email || '');
    await fillField(page, 'input[type="tel"], input[name="phone"]', profile.phone || '+91 7898405490');
    await fillField(page, 'input[name="address"], input[placeholder*="location" i]', profile.location || 'Gwalior, India');
    await fillField(page, 'input[name="website"], input[placeholder*="website" i]', profile.link || '');
    await fillField(page, 'input[name="linkedin"], input[placeholder*="linkedin" i]', profile.link || '');
    await fillField(page, 'textarea', buildCoverLetter(job, profile));
    await sleep(1000);

    await page.evaluate(() => {
      const sub = [...document.querySelectorAll('button[type="submit"], input[type="submit"], button')]
        .find(el => /submit|apply|send/i.test(el.textContent + el.type));
      if (sub) sub.click();
    });
    await sleep(4000);

    // Check for real success message
    const success = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('application submitted') || text.includes('thank you') ||
             text.includes('successfully applied') || text.includes('we received') ||
             text.includes('your application');
    });

    return success
      ? { ok: true, reason: 'Workable application submitted — confirmation expected at ' + (profile.email || '') }
      : { ok: false, reason: 'Workable form may not have submitted — check manually' };
  } catch (e) {
    return { ok: false, reason: 'Workable: ' + e.message.slice(0, 80) };
  }
}

async function applyIndeed(page, job, profile) {
  try {
    await page.goto('https://secure.indeed.com/auth', { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(2000);

    const googleBtn = await page.$('a[href*="google"], button[aria-label*="Google" i], a[aria-label*="Google" i]');
    if (googleBtn) {
      await googleBtn.click();
      await sleep(3000);
      const accountEl = await page.$('[data-email*="abhi.kh2018"], [data-identifier*="abhi.kh2018"]');
      if (accountEl) {
        await accountEl.click();
        await sleep(4000);
      } else {
        await fillField(page, 'input[type="email"]', process.env.INDEED_EMAIL || profile.email);
        await page.keyboard.press('Enter');
        await sleep(2000);
        await fillField(page, 'input[type="password"]', process.env.INDEED_PASSWORD || '');
        await page.keyboard.press('Enter');
        await sleep(4000);
      }
    } else {
      await fillField(page, 'input[type="email"]', process.env.INDEED_EMAIL || profile.email);
      await page.keyboard.press('Enter');
      await sleep(2000);
      await fillField(page, 'input[type="password"]', process.env.INDEED_PASSWORD || '');
      await page.keyboard.press('Enter');
      await sleep(3000);
    }

    await page.goto(job.applyUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(2000);

    const applyBtn = await page.$('#indeedApplyButton, .indeed-apply-button, button[id*="apply" i]');
    if (applyBtn === null) return { ok: false, reason: 'No Easy Apply button on Indeed' };
    await applyBtn.click();
    await sleep(2000);

    await fillField(page, 'input[name="applicant.name"], input[placeholder*="name" i]', profile.name || '');
    await fillField(page, 'input[type="email"]', profile.email || '');
    await fillField(page, 'input[type="tel"]', profile.phone || '+91 7898405490');
    await fillField(page, 'textarea', buildCoverLetter(job, profile));

    const submit = await page.$('button[type="submit"]');
    if (submit) { await submit.click(); await sleep(3000); }

    return { ok: true, reason: 'Applied via Indeed (Google login)' };
  } catch (e) {
    return { ok: false, reason: 'Indeed: ' + e.message.slice(0, 60) };
  }
}

async function applyGreenhouse(page, job, profile, resumePath) {
  const fs = require('fs');
  try {
    if (resumePath && fs.existsSync(resumePath)) {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) { await fileInput.uploadFile(resumePath); await sleep(2000); }
    }
    await fillField(page, 'input#first_name', profile.name?.split(' ')[0] || '');
    await fillField(page, 'input#last_name', profile.name?.split(' ').slice(1).join(' ') || '');
    await fillField(page, 'input#email', profile.email || '');
    await fillField(page, 'input#phone', profile.phone || '+91 7898405490');
    await fillField(page, 'input#location', profile.location || 'Gwalior, India');
    await fillField(page, 'input[name="website"]', profile.link || '');
    await fillField(page, 'input[name*="linkedin"]', profile.link || '');
    await fillField(page, 'textarea[name="cover_letter"]', buildCoverLetter(job, profile));
    const submit = await page.$('input#submit_app, button[type="submit"]');
    if (submit) { await submit.click(); await sleep(3000); }
    const success = await page.evaluate(() => /thank you|submitted|received|application complete/i.test(document.body.innerText));
    return { ok: success, reason: success ? 'Applied via Greenhouse' : 'Greenhouse submit may have failed — check manually' };
  } catch (e) {
    return { ok: false, reason: 'Greenhouse: ' + e.message.slice(0, 60) };
  }
}

async function applyLever(page, job, profile, resumePath) {
  const fs = require('fs');
  try {
    if (resumePath && fs.existsSync(resumePath)) {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) { await fileInput.uploadFile(resumePath); await sleep(2000); }
    }
    await fillField(page, 'input[name="name"]', profile.name || '');
    await fillField(page, 'input[name="email"]', profile.email || '');
    await fillField(page, 'input[name="phone"]', profile.phone || '+91 7898405490');
    await fillField(page, 'input[name="org"]', 'Freelancer');
    await fillField(page, 'input[name="urls[LinkedIn]"]', profile.link || '');
    await fillField(page, 'input[name="urls[Portfolio]"]', profile.link || '');
    await fillField(page, 'textarea[name="comments"]', buildCoverLetter(job, profile));
    const submit = await page.$('button[type="submit"], .template-btn-submit');
    if (submit) { await submit.click(); await sleep(3000); }
    const success = await page.evaluate(() => /thank you|submitted|received|application complete/i.test(document.body.innerText));
    return { ok: success, reason: success ? 'Applied via Lever' : 'Lever submit may have failed — check manually' };
  } catch (e) {
    return { ok: false, reason: 'Lever: ' + e.message.slice(0, 60) };
  }
}

async function applyGeneric(page, job, profile, resumePath) {
  const fs = require('fs');
  if (resumePath && fs.existsSync(resumePath)) {
    try {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) { await fileInput.uploadFile(resumePath); await sleep(2000); }
    } catch {}
  }
  const map = [
    { keys: ['input[name*="name" i]:not([name*="last"]):not([name*="first"])','input[placeholder*="full name" i]'], val: profile.name },
    { keys: ['input[type="email"]'], val: profile.email },
    { keys: ['input[type="tel"]','input[name*="phone" i]'], val: profile.phone || '+91 7898405490' },
    { keys: ['input[name*="linkedin" i]'], val: profile.link },
    { keys: ['input[name*="website" i]','input[placeholder*="portfolio" i]'], val: profile.link },
    { keys: ['textarea[name*="cover" i]','textarea[name*="message" i]','textarea'], val: buildCoverLetter(job, profile) }
  ];
  let filled = 0;
  for (const { keys, val } of map) {
    for (const sel of keys) {
      try { const el = await page.$(sel); if (el) { await el.click({clickCount:3}); await el.type(val||'',{delay:20}); filled++; break; } } catch {}
    }
  }
  if (filled === 0) return { ok: false, reason: 'Could not find form fields' };
  const submit = await page.$('button[type="submit"],input[type="submit"]');
  if (submit) { await submit.click(); await sleep(3000); }
  const success = await page.evaluate(() => /thank you|submitted|received|application complete/i.test(document.body.innerText));
  return { ok: success, reason: success ? `Filled ${filled} fields and submitted` : 'Could not confirm submission — check manually' };
}

function buildCoverLetter(job, profile) {
  if (job.coverLetter) return job.coverLetter;
  if (job.proposalDraft) return job.proposalDraft;
  return `Hi,\n\nI'm ${profile.name}, an Influencer Marketing Specialist with ${profile.exp} of experience. ${profile.achieve}\n\nI'm excited about the ${job.title} role at ${job.company} and believe my background in ${profile.skills} makes me a strong fit.\n\n${profile.sig || 'Best regards,\n' + profile.name}`;
}

async function fillField(page, selector, value) {
  if (!value) return;
  try { const el = await page.$(selector); if (el) { await el.click({clickCount:3}); await el.type(value, {delay:20}); } } catch {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { autoApplyToJob, closeBrowser };
