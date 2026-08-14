const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const OpenAI = require('openai');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let _idCounter = Date.now();
function uid() { return 'fl_' + (++_idCounter); }

function makeOpp(overrides) {
  return {
    id: uid(),
    type: 'freelance',
    source: 'unknown',
    platform: 'Unknown',
    title: '',
    clientName: '',
    description: '',
    skills: [],
    budget: 'Not specified',
    budgetType: 'unspecified',
    budgetMin: null,
    duration: 'Not specified',
    location: 'Remote',
    postedAt: new Date().toISOString(),
    applyUrl: '',
    contactEmail: null,
    status: 'new',
    starred: false,
    note: '',
    proposalDraft: null,
    proposalSentAt: null,
    score: null,
    scoreReason: '',
    fetchedAt: new Date().toISOString(),
    ...overrides
  };
}

// ── JSearch (freelance/contract filter) ─────────────────────────────────────

async function fetchFromJSearch(keywords, max, apiKey) {
  if (!apiKey) return [];
  const results = [];
  const queries = [
    `${keywords} freelance remote`,
    `${keywords} contract project remote`
  ];
  for (const q of queries) {
    try {
      const resp = await axios.get('https://jsearch.p.rapidapi.com/search', {
        params: { query: q, page: '1', num_pages: '1', remote_jobs_only: 'true' },
        headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'jsearch.p.rapidapi.com' },
        timeout: 10000
      });
      for (const j of (resp.data?.data || []).slice(0, Math.ceil(max / 2))) {
        const isFreelance = /freelance|contract|project|part.?time|consultant/i.test(
          (j.job_title || '') + (j.job_description || '') + (j.job_employment_type || '')
        );
        if (!isFreelance) continue;
        results.push(makeOpp({
          source: 'jsearch',
          platform: j.job_apply_link?.includes('linkedin') ? 'LinkedIn' : 'Web',
          title: j.job_title || '',
          clientName: j.employer_name || '',
          description: (j.job_description || '').slice(0, 800),
          skills: extractTags(j.job_title + ' ' + (j.job_description || '')),
          budget: j.job_salary_currency ? `${j.job_salary_currency}${j.job_min_salary || '?'}-${j.job_max_salary || '?'}` : 'Not specified',
          budgetMin: j.job_min_salary || null,
          duration: j.job_employment_type || 'Project',
          location: j.job_city ? `${j.job_city}, ${j.job_country}` : 'Remote',
          applyUrl: j.job_apply_link || '',
          contactEmail: extractEmail(j.job_description || ''),
          postedAt: j.job_posted_at_datetime_utc || new Date().toISOString()
        }));
      }
    } catch (e) {
      console.log('[Freelance] JSearch error:', e.message);
    }
  }
  return results;
}

// ── LinkedIn posts (via Tavily Search API) ─────────────────────────────────
// Tavily: genuinely free 1000/mo, NO credit card, signup at https://app.tavily.com/
// Set TAVILY_API_KEY in .env OR pass via settings.tavilyKey

// Valid LinkedIn URLs that can contain an actual hiring post (not just a profile/company page)
const LINKEDIN_POST_PATTERNS = [/\/posts\//, /\/pulse\//, /\/feed\/update\//, /\/jobs\/view\//];

function cleanLinkedInTitle(raw) {
  if (!raw) return '';
  return raw
    .replace(/\s*[|·\-–]\s*LinkedIn\s*$/i, '')
    .replace(/^LinkedIn\s*[:|·\-]\s*/i, '')
    .replace(/\s*\(\d+\)\s*$/, '')         // strip "(12)" notification counts
    .replace(/\s+on\s+LinkedIn\s*:?\s*/i, ': ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchFromLinkedInPosts(keywords, tavilyKey, timeRange = 'week', deepFetch = false) {
  if (!tavilyKey) {
    console.log('[Freelance] LinkedIn-posts skipped: no Tavily API key. Get one free (no card) at https://app.tavily.com/');
    return [];
  }
  const results = [];
  const seenLinks = new Set();
  const queries = [
    `${keywords} hiring freelancer email contact site:linkedin.com/posts`,
    `${keywords} "looking for" freelance ("DM me" OR "reach out" OR "send your") site:linkedin.com/posts`,
    `freelance ${keywords} opportunity send portfolio site:linkedin.com/posts`
  ];

  for (const q of queries) {
    try {
      const resp = await axios.post('https://api.tavily.com/search', {
        api_key: tavilyKey,
        query: q,
        search_depth: 'advanced',   // ~1500 char snippets instead of ~300
        max_results: 15,
        include_domains: ['linkedin.com'],
        include_answer: false,
        time_range: timeRange,
        topic: 'general'
      }, { timeout: 20000 });

      const items = resp.data?.results || [];
      for (const it of items) {
        const link = it.url || '';
        if (!link.includes('linkedin.com')) continue;
        if (seenLinks.has(link)) continue;

        // Only accept URLs that look like actual posts, not profile/company pages
        if (!LINKEDIN_POST_PATTERNS.some(rx => rx.test(link))) continue;
        seenLinks.add(link);

        const title = cleanLinkedInTitle(it.title);
        const snippet = (it.content || '').replace(/\s+/g, ' ').trim();
        const fullText = `${title} ${snippet}`;
        const email = extractEmail(fullText);
        const phone = extractPhone(fullText);
        const hasContact = !!(email || phone);
        const looksLikeHiring = /hiring|looking for|freelance|opportunity|reach out|DM me|send.*(cv|resume|portfolio)/i.test(fullText);
        if (!hasContact && !looksLikeHiring) continue;
        // Skip if title is degenerate (e.g. just "LinkedIn" or empty)
        if (title.length < 8) continue;
        // Skip scam-warning / how-to / opinion posts
        if (NEGATIVE_POST_PATTERNS.test(fullText)) continue;

        // Tavily returns it.published_date sometimes — use it for postedAt
        const postedAt = it.published_date
          ? new Date(it.published_date).toISOString()
          : new Date().toISOString();

        results.push(makeOpp({
          source: 'linkedin-post',
          platform: 'LinkedIn',
          title: title.slice(0, 140),
          clientName: extractPosterName(it.title) || 'LinkedIn poster',
          description: snippet.slice(0, 600),
          skills: extractTags(fullText),
          applyUrl: link,
          contactEmail: email,
          contactPhone: phone,
          budget: 'See post',
          duration: 'Project',
          location: 'Remote',
          postedAt
        }));
      }
    } catch (e) {
      const status = e.response?.status;
      const msg = e.response?.data?.error || e.message;
      console.log('[Freelance] Tavily error:', status ? `HTTP ${status} ${msg}` : msg);
      if (status === 401 || status === 403) break;
    }
  }

  // ── Deep-fetch fallback: for promising posts with no contact info found in snippet,
  //    call Tavily Extract to get the full post body and re-regex.
  if (deepFetch && results.length) {
    const needContact = results.filter(o => !o.contactEmail && !o.contactPhone).slice(0, 20);
    if (needContact.length) {
      try {
        const resp = await axios.post('https://api.tavily.com/extract', {
          api_key: tavilyKey,
          urls: needContact.map(o => o.applyUrl),
          extract_depth: 'advanced'   // ~2 credits/post but yields full post body — much higher contact hit rate
        }, { timeout: 45000 });
        const extracted = resp.data?.results || [];
        const byUrl = {};
        extracted.forEach(e => { byUrl[e.url] = e.raw_content || ''; });
        for (const opp of needContact) {
          const full = byUrl[opp.applyUrl];
          if (!full) continue;
          const email = extractEmail(full);
          const phone = extractPhone(full);
          if (email) opp.contactEmail = email;
          if (phone) opp.contactPhone = phone;
          // Also extend description with a clip of the full body for better context
          if (full.length > opp.description.length) {
            opp.description = full.slice(0, 800).replace(/\s+/g, ' ').trim();
          }
        }
        const found = needContact.filter(o => o.contactEmail || o.contactPhone).length;
        console.log(`[Freelance] Deep-fetch: extracted ${extracted.length} posts, found contact on ${found}`);
      } catch (e) {
        console.log('[Freelance] Tavily Extract error:', e.response?.data?.error || e.message);
      }
    }
  }

  return results;
}

function extractPhone(text) {
  if (!text) return null;
  // Require either + prefix OR an actual separator — rejects 12-digit IDs/timestamps
  const patterns = [
    /\+\d{1,3}[\s.\-]?\(?\d{2,4}\)?[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}/, // +91 9876 543210
    /\(\d{2,4}\)[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}/,                    // (415) 555-1234
    /\b\d{3,4}[\s.\-]\d{3,4}[\s.\-]\d{3,4}\b/,                       // 415-555-1234
    /\b\d{5}[\s.\-]\d{5,6}\b/                                        // 98765 43210 (Indian)
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (!m) continue;
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 14) return m[0].trim();
  }
  return null;
}

// Skip posts that are clearly NOT hiring (scam warnings, tips, opinion pieces)
const NEGATIVE_POST_PATTERNS = /\b(scam|warning|fraud|fake|beware|avoid|red flag|how to spot|don'?t fall|protect yourself|exposed)\b/i;

function extractPosterName(title) {
  // LinkedIn titles often "Firstname Lastname on LinkedIn: ..."
  const m = title.match(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})\s+on\s+LinkedIn/);
  return m ? m[1] : null;
}

// ── Upwork RSS ───────────────────────────────────────────────────────────────

async function fetchFromUpwork(keywords) {
  try {
    const q = encodeURIComponent(keywords);
    const url = `https://www.upwork.com/ab/feed/jobs/rss?q=${q}&sort=recency&paging=0%3B15`;
    const resp = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)' }
    });
    const $ = cheerio.load(resp.data, { xmlMode: true });
    const results = [];
    $('item').each((_, el) => {
      const title = $(el).find('title').text().trim();
      const link = $(el).find('link').text().trim() || $(el).find('guid').text().trim();
      const desc = $(el).find('description').text();
      const pubDate = $(el).find('pubDate').text();
      if (!title || !link) return;
      const budget = parseUpworkBudget(desc);
      results.push(makeOpp({
        source: 'upwork',
        platform: 'Upwork',
        title,
        clientName: 'Upwork Client',
        description: cheerio.load(desc).text().slice(0, 800),
        skills: extractTags(title + ' ' + desc),
        budget: budget.budget,
        budgetType: budget.budgetType,
        budgetMin: budget.budgetMin,
        applyUrl: link,
        contactEmail: null,
        postedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
      }));
    });
    return results;
  } catch (e) {
    console.log('[Freelance] Upwork RSS error:', e.message);
    return [];
  }
}

function parseUpworkBudget(html) {
  const text = cheerio.load(html).text();
  const fixed = text.match(/Budget:\s*\$?([\d,]+)/i);
  if (fixed) {
    const amt = parseFloat(fixed[1].replace(/,/g, ''));
    return { budget: `$${fixed[1]}`, budgetType: 'fixed', budgetMin: amt };
  }
  const hourly = text.match(/Hourly Range:\s*\$?([\d.]+)-\$?([\d.]+)/i);
  if (hourly) {
    return { budget: `$${hourly[1]}-$${hourly[2]}/hr`, budgetType: 'hourly', budgetMin: parseFloat(hourly[1]) };
  }
  return { budget: 'Not specified', budgetType: 'unspecified', budgetMin: null };
}

// ── Internshala scraper ──────────────────────────────────────────────────────

async function fetchFromInternshala(keywords) {
  let browser;
  try {
    const slug = keywords.toLowerCase().replace(/\s+/g, '-');
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: CHROME,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(`https://internshala.com/internships/keywords-${slug}`, {
      waitUntil: 'domcontentloaded', timeout: 20000
    });
    await page.waitForSelector('.internship_meta, .individual_internship', { timeout: 10000 }).catch(() => {});

    const results = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.individual_internship, [id^="internshiplist"]')];
      return cards.slice(0, 15).map(card => {
        const titleEl = card.querySelector('.profile a, h3 a');
        const companyEl = card.querySelector('.company-name, h4 a');
        const stipendEl = card.querySelector('.stipend');
        const durationEl = card.querySelector('.internship-other-details-container .item_body, .duration-mobile');
        const linkEl = card.querySelector('a[href*="/internship/detail"]');
        return {
          title: titleEl?.innerText?.trim() || '',
          clientName: companyEl?.innerText?.trim() || '',
          budget: stipendEl?.innerText?.trim() || 'Not specified',
          duration: durationEl?.innerText?.trim() || 'Not specified',
          applyUrl: linkEl ? 'https://internshala.com' + linkEl.getAttribute('href') : ''
        };
      }).filter(r => r.title);
    });

    await browser.close();
    return results.map(r => makeOpp({
      source: 'internshala',
      platform: 'Internshala',
      ...r,
      skills: extractTags(r.title),
      budgetType: r.budget.toLowerCase().includes('stipend') ? 'stipend' : 'unspecified',
      location: 'Remote'
    }));
  } catch (e) {
    console.log('[Freelance] Internshala error:', e.message);
    if (browser) await browser.close().catch(() => {});
    return [];
  }
}

// ── Scoring ──────────────────────────────────────────────────────────────────

async function scoreOpportunities(opps, profile) {
  if (!opps.length) return opps;
  try {
    const profileStr = `Role: ${profile?.role || 'Influencer Marketing Specialist'}, ${profile?.exp || '3 years'} experience. Skills: ${profile?.skills || ''}. Achievements: ${profile?.achieve || ''}`;
    const msg = await client.chat.completions.create({
      model: 'gpt-4o-mini', max_tokens: 1000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Score freelance opportunity relevance 0-100. Higher if well-paying, clear scope, matches skills. Return ONLY valid JSON: {"scores":[{"id":"fl_xxx","score":85,"reason":"Under 12 words"}]}' },
        { role: 'user', content: `Candidate: ${profileStr}\n\nScore these:\n${opps.map(o => `ID:${o.id} | ${o.title} at ${o.clientName} | Budget:${o.budget} | ${o.description?.slice(0, 150)}`).join('\n')}` }
      ]
    });
    let scores = [];
    try { scores = JSON.parse(msg.choices[0].message.content).scores || []; } catch {}
    const map = {};
    scores.forEach(s => map[s.id] = s);
    return opps.map(o => ({ ...o, score: map[o.id]?.score ?? 60, scoreReason: map[o.id]?.reason ?? '' }));
  } catch (e) {
    console.log('[Freelance] Scoring error:', e.message);
    return opps.map(o => ({ ...o, score: 60, scoreReason: 'Scoring unavailable' }));
  }
}

// ── Main entry ───────────────────────────────────────────────────────────────

async function searchFreelance(config, apiKey, tavilyKey) {
  const { keywords = 'influencer marketing freelance', maxResults = 20, sources = ['linkedin', 'jsearch', 'internshala'], timeRange = 'week', deepFetch = false } = config;
  let all = [];

  if (sources.includes('linkedin'))    all.push(...await fetchFromLinkedInPosts(keywords, tavilyKey || process.env.TAVILY_API_KEY, timeRange, deepFetch));
  if (sources.includes('jsearch'))     all.push(...await fetchFromJSearch(keywords, maxResults, apiKey));
  if (sources.includes('upwork'))      all.push(...await fetchFromUpwork(keywords));
  if (sources.includes('internshala')) all.push(...await fetchFromInternshala(keywords));

  // Deduplicate by title+client
  const seen = new Set();
  all = all.filter(o => {
    const key = `${o.title}|${o.clientName}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return all.slice(0, maxResults);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractEmail(text) {
  if (!text) return null;
  const m = text.match(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/);
  if (!m) return null;
  const prefix = m[0].split('@')[0];
  if (/^(noreply|no-reply|postmaster|info|support|admin|contact|hello)$/i.test(prefix)) return null;
  return m[0];
}

function extractTags(text) {
  return ['TikTok', 'Instagram', 'YouTube', 'UGC', 'influencer', 'creator', 'campaigns',
    'brand', 'partnerships', 'social media', 'Reels', 'content strategy', 'nano', 'micro']
    .filter(k => text.toLowerCase().includes(k.toLowerCase())).slice(0, 5);
}

module.exports = { searchFreelance, scoreOpportunities };
