/**
 * Simple job search — one function, three real sources, no state.
 * Called by POST /api/search. Returns jobs directly. That's it.
 */
const axios = require('axios');
const cheerio = require('cheerio');

const APPLY_PLATFORMS = {
  greenhouse:      { name: 'Greenhouse',      autoApply: true,  hosts: ['greenhouse.io', 'boards.greenhouse.io'] },
  lever:           { name: 'Lever',           autoApply: true,  hosts: ['lever.co', 'jobs.lever.co'] },
  ashby:           { name: 'Ashby',           autoApply: true,  hosts: ['ashbyhq.com'] },
  workable:        { name: 'Workable',        autoApply: true,  hosts: ['workable.com'] },
  workday:         { name: 'Workday',         autoApply: true,  hosts: ['myworkdayjobs.com', 'workday.com'] },
  smartrecruiters: { name: 'SmartRecruiters', autoApply: true,  hosts: ['smartrecruiters.com'] },
  indeed:          { name: 'Indeed',          autoApply: true,  hosts: ['indeed.com'] },
  linkedin:        { name: 'LinkedIn',        autoApply: true,  hosts: ['linkedin.com'] },
  remotive:        { name: 'Remotive',        autoApply: false, hosts: ['remotive.com'] },
  remoteok:        { name: 'RemoteOK',        autoApply: false, hosts: ['remoteok.com'] },
  arbeitnow:       { name: 'Arbeitnow',       autoApply: false, hosts: ['arbeitnow.com'] },
  jobicy:          { name: 'Jobicy',          autoApply: false, hosts: ['jobicy.com'] },
  himalayas:       { name: 'Himalayas',       autoApply: false, hosts: ['himalayas.app'] },
  wwr:             { name: 'WeWorkRemotely',  autoApply: false, hosts: ['weworkremotely.com'] }
};

function classify(url) {
  const u = (url || '').toLowerCase();
  for (const [kind, p] of Object.entries(APPLY_PLATFORMS)) {
    if (p.hosts.some(h => u.includes(h))) {
      return { kind, name: p.name, autoApply: p.autoApply };
    }
  }
  return { kind: 'company', name: 'Company site', autoApply: false };
}

async function search({ keywords = '', location = '', remote = false, limit = 30 } = {}) {
  const kw = String(keywords).trim();
  if (!kw) return { jobs: [], sources: {}, error: 'Enter a keyword to search' };

  const started = Date.now();
  const [remotive, remoteok, arbeitnow, jobicy, himalayas, wwr, linkedin] = await Promise.all([
    fromRemotive(kw).catch(e => { console.warn('[Remotive]', e.message); return []; }),
    fromRemoteOK(kw).catch(e => { console.warn('[RemoteOK]', e.message); return []; }),
    fromArbeitnow(kw).catch(e => { console.warn('[Arbeitnow]', e.message); return []; }),
    fromJobicy(kw).catch(e => { console.warn('[Jobicy]', e.message); return []; }),
    fromHimalayas(kw).catch(e => { console.warn('[Himalayas]', e.message); return []; }),
    fromWWR(kw).catch(e => { console.warn('[WWR]', e.message); return []; }),
    fromLinkedIn(kw, location, remote).catch(e => { console.warn('[LinkedIn]', e.message); return []; })
  ]);

  const sources = {
    remotive: remotive.length, remoteok: remoteok.length, arbeitnow: arbeitnow.length,
    jobicy: jobicy.length, himalayas: himalayas.length, wwr: wwr.length, linkedin: linkedin.length
  };
  const all = [...remotive, ...remoteok, ...arbeitnow, ...jobicy, ...himalayas, ...wwr, ...linkedin];

  // Dedupe by (company + title)
  const seen = new Set();
  let unique = [];
  for (const j of all) {
    const key = `${(j.company || '').toLowerCase().trim()}|${(j.title || '').toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(j);
  }

  // Strict relevance filter — drop jobs where the keyword isn't a real match.
  // This kills "Executive Assistant" showing up for "python developer".
  unique = unique
    .map(j => ({ ...j, relevance: scoreRelevance(j, kw) }))
    .filter(j => j.relevance > 0);

  // Last 7 days
  const cutoff = Date.now() - 7 * 86400000;
  unique = unique.filter(j => (j.postedAt || 0) >= cutoff);

  // Location filter — only match against the job's location string, not company/title
  if (location.trim()) {
    const loc = location.toLowerCase();
    unique = unique.filter(j => {
      const jobLoc = (j.location || '').toLowerCase();
      if (jobLoc.includes(loc)) return true;
      if (j.remote && /remote|anywhere/i.test(loc)) return true;
      return false;
    });
  }

  // Remote-only filter
  if (remote) unique = unique.filter(j => j.remote);

  // Sort: relevance bucket first, then newest within bucket
  unique.sort((a, b) => {
    const dr = Math.round((b.relevance || 0) * 10) - Math.round((a.relevance || 0) * 10);
    if (dr !== 0) return dr;
    return (b.postedAt || 0) - (a.postedAt || 0);
  });

  // Cap early, then resolve aggregator URLs → real ATS URLs (in parallel, bounded).
  // Turns e.g. "https://remotive.com/remote-jobs/X" into the underlying Greenhouse/Lever URL,
  // which lets our ATS auto-apply engine kick in for many more jobs.
  const capped = unique.slice(0, limit);
  await resolveApplyUrls(capped);

  const jobs = capped.map((j, i) => {
    const platform = classify(j.applyUrl);
    return { id: `j${i + 1}`, ...j, platform };
  });

  return {
    jobs,
    sources,
    total: jobs.length,
    tookMs: Date.now() - started
  };
}

// ── Sources ──────────────────────────────────────────────────

async function fromRemotive(kw) {
  const r = await axios.get('https://remotive.com/api/remote-jobs', {
    params: { search: kw },
    timeout: 15000
  });
  return (r.data?.jobs || []).map(j => ({
    title: j.title,
    company: j.company_name || 'Unknown',
    location: j.candidate_required_location || 'Remote',
    remote: true,
    salary: j.salary || null,
    posted: relTime(j.publication_date),
    postedAt: Date.parse(j.publication_date) || Date.now(),
    description: cleanText(j.description).slice(0, 400),
    applyUrl: j.url,
    tags: (j.tags || []).slice(0, 6),
    source: 'remotive'
  }));
}

async function fromRemoteOK(kw) {
  const tags = kw.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 3).join(',');
  const url = tags ? `https://remoteok.com/api?tags=${encodeURIComponent(tags)}` : 'https://remoteok.com/api';
  const r = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobAutopilot/2.0)' }
  });
  const jobs = Array.isArray(r.data) ? r.data.filter(x => x && x.position) : [];
  return jobs.map(j => ({
    title: j.position,
    company: j.company || 'Unknown',
    location: j.location || 'Remote',
    remote: true,
    salary: (j.salary_min && j.salary_max)
      ? `$${Math.round(j.salary_min / 1000)}k–$${Math.round(j.salary_max / 1000)}k`
      : null,
    posted: relTime(j.date),
    postedAt: (j.epoch ? j.epoch * 1000 : Date.parse(j.date)) || Date.now(),
    description: cleanText(j.description || '').slice(0, 400),
    applyUrl: j.apply_url || j.url,
    tags: (j.tags || []).slice(0, 6),
    source: 'remoteok'
  }));
}

async function fromArbeitnow(kw) {
  const r = await axios.get('https://www.arbeitnow.com/api/job-board-api', { timeout: 15000 });
  const jobs = r.data?.data || [];
  const words = kw.toLowerCase().split(/\s+/).filter(Boolean);
  return jobs
    .filter(j => {
      const hay = `${j.title} ${(j.tags || []).join(' ')} ${j.description || ''}`.toLowerCase();
      return words.some(w => hay.includes(w));
    })
    .map(j => ({
      title: j.title,
      company: j.company_name || 'Unknown',
      location: j.location || (j.remote ? 'Remote' : ''),
      remote: !!j.remote,
      salary: null,
      posted: relTime(j.created_at),
      postedAt: (typeof j.created_at === 'number' ? j.created_at * 1000 : Date.parse(j.created_at)) || Date.now(),
      description: cleanText(j.description || '').slice(0, 400),
      applyUrl: j.url,
      tags: (j.tags || []).slice(0, 6),
      source: 'arbeitnow'
    }));
}

// ── LinkedIn (public guest search, no auth) ─────────────────
// Parses LinkedIn's public jobs-guest search endpoint. Returns real listings
// with LinkedIn URLs. Many LinkedIn jobs are "off-platform apply" → follow the
// redirect to expose the underlying Greenhouse/Lever/Ashby URL for auto-apply.
async function fromLinkedIn(kw, location = '', remoteOnly = false) {
  const params = new URLSearchParams({
    keywords: kw,
    f_TPR: 'r604800', // last 7 days
    start: '0'
  });
  if (location) params.set('location', location);
  else if (remoteOnly) params.set('f_WT', '2'); // remote filter code

  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`;
  const r = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  const $ = cheerio.load(r.data);
  const jobs = [];
  $('.base-card, .job-search-card').each((_, el) => {
    const $el = $(el);
    const title = $el.find('.base-search-card__title').text().trim();
    const company = $el.find('.base-search-card__subtitle a, .base-search-card__subtitle').first().text().trim();
    const loc = $el.find('.job-search-card__location').text().trim();
    const link = $el.find('a.base-card__full-link').attr('href') || '';
    const posted = $el.find('time').attr('datetime') || '';
    const jobId = ($el.attr('data-entity-urn') || '').replace('urn:li:jobPosting:', '');
    if (!title || !link) return;

    jobs.push({
      title,
      company: company || 'Unknown',
      location: loc || (remoteOnly ? 'Remote' : ''),
      remote: /remote|anywhere/i.test(loc + ' ' + title),
      salary: null,
      posted: posted ? relTime(posted) : 'Recently',
      postedAt: posted ? Date.parse(posted) || Date.now() : Date.now(),
      description: '',
      applyUrl: link.split('?')[0], // strip tracking params
      linkedinJobId: jobId,
      tags: [],
      source: 'linkedin'
    });
  });

  return jobs.slice(0, 25);
}

async function fromJobicy(kw) {
  // Jobicy API: no server-side search, so fetch a wide page and filter client-side.
  const r = await axios.get('https://jobicy.com/api/v2/remote-jobs', {
    params: { count: 50 },
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobAutopilot/2.0)' }
  });
  const jobs = r.data?.jobs || [];
  const words = kw.toLowerCase().split(/\s+/).filter(Boolean);
  return jobs
    .filter(j => {
      const hay = `${j.jobTitle} ${(j.jobIndustry || []).join(' ')} ${j.jobExcerpt || ''}`.toLowerCase();
      return words.some(w => hay.includes(w));
    })
    .map(j => ({
      title: j.jobTitle,
      company: cleanText(j.companyName) || 'Unknown',
      location: (j.jobGeo || 'Remote'),
      remote: true,
      salary: (j.annualSalaryMin && j.annualSalaryMax)
        ? `$${Math.round(j.annualSalaryMin / 1000)}k–$${Math.round(j.annualSalaryMax / 1000)}k`
        : null,
      posted: relTime(j.pubDate),
      postedAt: Date.parse(j.pubDate) || Date.now(),
      description: cleanText(j.jobExcerpt || j.jobDescription || '').slice(0, 400),
      applyUrl: j.url,
      tags: (j.jobIndustry || []).slice(0, 4).map(t => cleanText(t)),
      source: 'jobicy'
    }));
}

async function fromHimalayas(kw) {
  const r = await axios.get('https://himalayas.app/jobs/api', {
    params: { limit: 50 },
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobAutopilot/2.0)' }
  });
  const jobs = r.data?.jobs || [];
  const words = kw.toLowerCase().split(/\s+/).filter(Boolean);
  return jobs
    .filter(j => {
      const hay = `${j.title} ${(j.categories || []).join(' ')} ${j.excerpt || ''}`.toLowerCase();
      return words.some(w => hay.includes(w));
    })
    .map(j => {
      const slug = j.companySlug || 'company';
      const jobSlug = j.slug || '';
      const applyUrl = j.applyUrl || j.link || `https://himalayas.app/companies/${slug}/jobs/${jobSlug}`;
      return {
        title: j.title,
        // Himalayas' `companyName` is often the string "name". Prefer slug when so.
        company: (j.companyName && j.companyName !== 'name') ? j.companyName : humanize(slug),
        location: (j.locationRestrictions || []).join(', ') || 'Remote',
        remote: true,
        salary: (j.minSalary && j.maxSalary)
          ? `$${Math.round(j.minSalary / 1000)}k–$${Math.round(j.maxSalary / 1000)}k`
          : null,
        posted: relTime(j.pubDate || j.publishedAt),
        postedAt: Date.parse(j.pubDate || j.publishedAt) || Date.now(),
        description: cleanText(j.excerpt || '').slice(0, 400),
        applyUrl,
        tags: (j.categories || []).slice(0, 4).map(humanize),
        source: 'himalayas'
      };
    });
}

async function fromWWR(kw) {
  // WeWorkRemotely — RSS feed, lightweight parse (no xml parser dep).
  const r = await axios.get('https://weworkremotely.com/remote-jobs.rss', {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobAutopilot/2.0)' }
  });
  const xml = String(r.data || '');
  const items = xml.split('<item>').slice(1).map(chunk => {
    const pick = (tag) => {
      const m = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? cleanText(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')) : '';
    };
    return {
      title: pick('title'),
      link: pick('link'),
      description: pick('description'),
      pubDate: pick('pubDate'),
      region: pick('region')
    };
  });
  const words = kw.toLowerCase().split(/\s+/).filter(Boolean);
  return items
    .filter(x => x.title && words.some(w => (x.title + ' ' + x.description).toLowerCase().includes(w)))
    .map(x => {
      // WWR titles look like "Company: Title" — split it
      let title = x.title, company = 'Unknown';
      const m = x.title.match(/^([^:]+):\s*(.+)$/);
      if (m) { company = m[1].trim(); title = m[2].trim(); }
      return {
        title,
        company,
        location: x.region || 'Remote',
        remote: true,
        salary: null,
        posted: relTime(x.pubDate),
        postedAt: Date.parse(x.pubDate) || Date.now(),
        description: cleanText(x.description).slice(0, 400),
        applyUrl: x.link,
        tags: [],
        source: 'wwr'
      };
    });
}

function humanize(slug) {
  return String(slug || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Helpers ──────────────────────────────────────────────────

function cleanText(s) {
  let out = String(s || '');
  // Decode entities FIRST so any encoded tags become real tags, then strip.
  // Run the decode-then-strip cycle twice for double-encoded payloads.
  for (let i = 0; i < 2; i++) {
    out = out
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&apos;|&#39;|&#x27;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
    out = out.replace(/<[^>]+>/g, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function relTime(iso) {
  const t = typeof iso === 'number' ? iso * 1000 : Date.parse(iso);
  if (!t) return 'Recently';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ── Relevance scoring ────────────────────────────────────────
// Simple weighted keyword match. Every non-trivial word in the query must
// appear somewhere; matches in title/tags weigh more than description.
// Returns 0 for irrelevant jobs (which get filtered out), higher = better.
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'in', 'of', 'to', 'with', 'on', 'at', 'jobs', 'job']);

function tokenize(s) {
  return String(s || '').toLowerCase()
    .replace(/[^\w\s+#./-]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w) && w.length > 1);
}

function scoreRelevance(job, query) {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 1;

  const title = String(job.title || '').toLowerCase();
  const tags = (job.tags || []).join(' ').toLowerCase();
  const desc = String(job.description || '').toLowerCase();
  const company = String(job.company || '').toLowerCase();

  // Phrase bonus — full query as a substring
  const fullPhrase = qTokens.join(' ');
  const phraseInTitle = title.includes(fullPhrase);
  const phraseInDesc = desc.includes(fullPhrase);

  let score = 0;
  let strongMatches = 0; // matches in title OR tags
  let weakMatches = 0;   // matches only in description

  for (const t of qTokens) {
    const inTitle = title.includes(t);
    const inTags = tags.includes(t);
    const inDesc = desc.includes(t);
    const inCompany = company.includes(t);
    // Company-name-only matches don't count — they're often coincidental
    if (inTitle) { score += 3; strongMatches++; }
    else if (inTags) { score += 2; strongMatches++; }
    else if (inDesc) { score += 0.5; weakMatches++; }
    else if (inCompany) { score += 0; } // ignore
    else { score -= 1; } // token entirely absent — punish
  }

  if (phraseInTitle) score += 4;
  else if (phraseInDesc) score += 1;

  // Require SOME real signal. Reject if no strong+weak matches at all.
  if (strongMatches === 0 && weakMatches < Math.ceil(qTokens.length / 2)) return 0;

  // Reject if we deducted more than we added (query barely relates)
  if (score <= 0) return 0;

  return score;
}

// ── URL resolver: follow aggregator redirects to expose real ATS URLs ──
// Runs on the capped result set to keep cost low. Fires in parallel with a
// concurrency limit so we don't hammer sources.
const AGGREGATOR_HOSTS = ['remotive.com', 'arbeitnow.com', 'himalayas.app', 'jobicy.com', 'weworkremotely.com'];
const ATS_HOSTS_FOR_PROMOTION = ['greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'myworkdayjobs.com', 'smartrecruiters.com'];

async function resolveApplyUrls(jobs) {
  const CONCURRENCY = 6;
  const targets = jobs.filter(j => j.applyUrl && AGGREGATOR_HOSTS.some(h => j.applyUrl.includes(h)));
  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () =>
    (async () => {
      while (i < targets.length) {
        const idx = i++;
        const job = targets[idx];
        try {
          const finalUrl = await followRedirects(job.applyUrl);
          if (finalUrl && ATS_HOSTS_FOR_PROMOTION.some(h => finalUrl.includes(h))) {
            job.originalUrl = job.applyUrl;
            job.applyUrl = finalUrl;
            job.source = job.source + '→' + finalUrl.match(/\/\/([^/]+)/)?.[1]?.split('.')?.slice(-2, -1)?.[0];
          }
        } catch {} // silent — worst case we keep the aggregator URL
      }
    })()
  );
  await Promise.all(workers);
}

async function followRedirects(url, maxHops = 5) {
  let current = url;
  for (let hop = 0; hop < maxHops; hop++) {
    try {
      const r = await axios.head(current, {
        timeout: 6000,
        maxRedirects: 0,
        validateStatus: s => s < 500,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobAutopilot/2.0)' }
      });
      const loc = r.headers?.location;
      if (r.status >= 300 && r.status < 400 && loc) {
        current = new URL(loc, current).href;
      } else {
        return current;
      }
    } catch (e) {
      // Some aggregators redirect on GET only, or 405 on HEAD — try GET once
      if (hop === 0) {
        try {
          const r = await axios.get(current, {
            timeout: 8000,
            maxRedirects: 3,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobAutopilot/2.0)' }
          });
          return r.request?.res?.responseUrl || r.config.url || current;
        } catch { return current; }
      }
      return current;
    }
  }
  return current;
}

module.exports = { search, classify, APPLY_PLATFORMS };
