const axios = require('axios');

// Auto-apply capability rank — lower is better (preferred as the primary applyUrl).
const APPLY_RANK = [
  { rank: 1, hosts: ['greenhouse.io', 'boards.greenhouse.io'] },
  { rank: 1, hosts: ['lever.co', 'jobs.lever.co'] },
  { rank: 1, hosts: ['ashbyhq.com'] },
  { rank: 1, hosts: ['workable.com'] },
  { rank: 1, hosts: ['myworkdayjobs.com', 'workday.com'] },
  { rank: 1, hosts: ['smartrecruiters.com'] },
  { rank: 2, hosts: ['indeed.com'] },
  { rank: 2, hosts: ['linkedin.com'] }
];

function rankApplyLink(url) {
  const u = (url || '').toLowerCase();
  for (const g of APPLY_RANK) {
    if (g.hosts.some(h => u.includes(h))) return g.rank;
  }
  return 5;
}

/**
 * Search real jobs from multiple free public APIs in parallel.
 * No API keys required. Returns deduped list, most recent first.
 *
 * If SERPAPI_KEY is present and valid, also queries Google Jobs for LinkedIn/Indeed coverage.
 */
async function searchJobs(keywords, location, maxJobs = 20, apiKey = '') {
  const key = (apiKey || process.env.SERPAPI_KEY || '').trim();
  const useSerp = key && key !== 'your-key-here' && key.length > 20;

  const sources = [
    fromRemotive(keywords, location).catch(e => (console.warn('[Remotive]', e.message), [])),
    fromRemoteOK(keywords).catch(e => (console.warn('[RemoteOK]', e.message), [])),
    fromArbeitnow(keywords, location).catch(e => (console.warn('[Arbeitnow]', e.message), [])),
    useSerp
      ? fromSerpAPI(keywords, location, key).catch(e => (console.warn('[SerpAPI]', e.message), []))
      : Promise.resolve([])
  ];

  const batches = await Promise.all(sources);
  const all = batches.flat();
  console.log(`[Jobs] Remotive:${batches[0].length} RemoteOK:${batches[1].length} Arbeitnow:${batches[2].length} SerpAPI:${batches[3].length}`);

  // Dedupe on (company + title)
  const seen = new Set();
  const unique = [];
  for (const j of all) {
    const k = `${(j.company || '').toLowerCase().trim()}|${(j.title || '').toLowerCase().trim()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(j);
  }

  // Only jobs posted within last 7 days
  const cutoff = Date.now() - 7 * 86400000;
  const recent = unique.filter(j => (j.postedAtEpoch || 0) >= cutoff);

  // Newest first
  recent.sort((a, b) => (b.postedAtEpoch || 0) - (a.postedAtEpoch || 0));

  return recent.slice(0, maxJobs).map((j, i) => ({ ...j, id: `j${i + 1}` }));
}

// ── Remotive ────────────────────────────────────────────────
async function fromRemotive(keywords, location) {
  const params = { search: keywords };
  const r = await axios.get('https://remotive.com/api/remote-jobs', { params, timeout: 15000 });
  return (r.data?.jobs || []).map(j => {
    const applyUrl = j.url || '';
    return normalize({
      title: j.title,
      company: j.company_name,
      location: j.candidate_required_location || 'Remote',
      remote: true,
      salary: j.salary || null,
      posted: relTime(j.publication_date),
      postedAtEpoch: Date.parse(j.publication_date) || Date.now(),
      description: stripHtml(j.description).slice(0, 500),
      applyUrl,
      allApplyUrls: [applyUrl].filter(Boolean),
      tags: (j.tags || []).slice(0, 6),
      source: 'remotive'
    });
  });
}

// ── RemoteOK ────────────────────────────────────────────────
async function fromRemoteOK(keywords) {
  // RemoteOK filters by comma-separated tags
  const tags = keywords.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 3).join(',');
  const url = tags ? `https://remoteok.com/api?tags=${encodeURIComponent(tags)}` : 'https://remoteok.com/api';
  const r = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobAutopilot/2.0)' }
  });
  const jobs = Array.isArray(r.data) ? r.data.filter(x => x && x.position) : [];
  return jobs.map(j => {
    const applyUrl = j.apply_url || j.url || '';
    return normalize({
      title: j.position,
      company: j.company,
      location: j.location || 'Remote',
      remote: true,
      salary: (j.salary_min && j.salary_max) ? `$${Math.round(j.salary_min / 1000)}k–$${Math.round(j.salary_max / 1000)}k` : null,
      posted: relTime(j.date),
      postedAtEpoch: (j.epoch ? j.epoch * 1000 : Date.parse(j.date)) || Date.now(),
      description: stripHtml(j.description || '').slice(0, 500),
      applyUrl,
      allApplyUrls: [applyUrl].filter(Boolean),
      tags: (j.tags || []).slice(0, 6),
      source: 'remoteok'
    });
  });
}

// ── Arbeitnow ───────────────────────────────────────────────
async function fromArbeitnow(keywords, location) {
  const r = await axios.get('https://www.arbeitnow.com/api/job-board-api', { timeout: 15000 });
  const jobs = r.data?.data || [];
  const kw = keywords.toLowerCase();
  return jobs
    .filter(j => {
      const hay = `${j.title} ${j.description} ${(j.tags || []).join(' ')}`.toLowerCase();
      return kw.split(/\s+/).some(w => w && hay.includes(w));
    })
    .map(j => normalize({
      title: j.title,
      company: j.company_name,
      location: j.location || (j.remote ? 'Remote' : ''),
      remote: !!j.remote,
      salary: null,
      posted: relTime(j.created_at),
      postedAtEpoch: (typeof j.created_at === 'number' ? j.created_at * 1000 : Date.parse(j.created_at)) || Date.now(),
      description: stripHtml(j.description || '').slice(0, 500),
      applyUrl: j.url,
      allApplyUrls: [j.url].filter(Boolean),
      tags: (j.tags || []).slice(0, 6),
      source: 'arbeitnow'
    }));
}

// ── SerpAPI (optional bonus) ────────────────────────────────
async function fromSerpAPI(keywords, location, apiKey) {
  const isRemote = /remote/i.test(location || '') || !location;
  const r = await axios.get('https://serpapi.com/search', {
    params: {
      engine: 'google_jobs',
      q: isRemote ? `${keywords} remote` : keywords,
      location: isRemote ? 'United States' : location,
      api_key: apiKey,
      chips: 'date_posted:week'
    },
    timeout: 20000
  });
  if (r.data?.error) throw new Error(r.data.error);
  const jobs = r.data?.jobs_results || [];
  return jobs.map(j => {
    const links = (j.apply_options || []).filter(l => l && l.link);
    const scored = links.map(l => ({ ...l, _rank: rankApplyLink(l.link) })).sort((a, b) => a._rank - b._rank);
    const applyUrl = scored[0]?.link || '';
    return normalize({
      title: j.title,
      company: j.company_name,
      location: j.location || (isRemote ? 'Remote' : location),
      remote: isRemote || /remote|anywhere/i.test(j.location || ''),
      salary: j.detected_extensions?.salary || null,
      posted: j.detected_extensions?.posted_at || 'Recently',
      postedAtEpoch: parsePostedToEpoch(j.detected_extensions?.posted_at),
      description: (j.description || '').slice(0, 500),
      applyUrl,
      allApplyUrls: scored.map(s => s.link),
      tags: extractTags(`${j.title} ${j.description || ''}`),
      source: 'serpapi'
    });
  });
}

// ── Helpers ─────────────────────────────────────────────────
function normalize(j) {
  return {
    ...j,
    email: extractEmail(j.description || ''),
    title: j.title || 'Untitled',
    company: j.company || 'Unknown',
    tags: (j.tags && j.tags.length) ? j.tags : extractTags(`${j.title || ''} ${j.description || ''}`)
  };
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|quot|lt|gt|apos|#39|#x27|#x2F);/gi, m => ({
      '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>',
      '&apos;': "'", '&#39;': "'", '&#x27;': "'", '&#x2F;': '/'
    }[m.toLowerCase()] || m))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEmail(text) {
  const m = String(text || '').match(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : null;
}

function extractTags(text) {
  const bank = ['React','Node','Node.js','Python','Django','Flask','FastAPI','TypeScript','JavaScript',
    'AWS','GCP','Azure','Docker','Kubernetes','SQL','PostgreSQL','MongoDB','GraphQL','Redis','Rust','Go',
    'iOS','Swift','Android','Kotlin','Flutter','Vue','Angular','Next.js','Tailwind',
    'ML','AI','LLM','PyTorch','TensorFlow','Data Engineering','Analytics',
    'TikTok','Instagram','YouTube','UGC','influencer','creator','campaigns','brand','partnerships','social media'];
  const t = String(text || '').toLowerCase();
  return bank.filter(k => t.includes(k.toLowerCase())).slice(0, 6);
}

function parsePostedToEpoch(str) {
  if (!str) return Date.now();
  const s = String(str).toLowerCase();
  const now = Date.now();
  const day = 86400000;
  if (s.includes('hour') || s.includes('today') || s.includes('just')) return now;
  const n = parseInt(s.match(/\d+/)?.[0] || '1', 10);
  if (s.includes('day')) return now - n * day;
  if (s.includes('week')) return now - n * 7 * day;
  if (s.includes('month')) return now - n * 30 * day;
  return now - day;
}

function relTime(iso) {
  const t = typeof iso === 'number' ? iso * 1000 : Date.parse(iso);
  if (!t) return 'Recently';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

module.exports = { searchJobs, rankApplyLink };
