require('dotenv').config();
const { autoApplyToJob, closeBrowser } = require('./autoApply');
const { applyIndeedJob, setupGoogleLogin, hasCookies } = require('./indeedApply');
const { searchFreelance, scoreOpportunities } = require('./freelanceSearch');
const { draftProposal, draftFollowUp, applyToOpportunity } = require('./freelanceApply');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const multer = require('multer');
const { searchJobs } = require('./jobSearch');
const { search: newSearch } = require('./search');
const { applyATS, pickAdapter: pickATSAdapter } = require('./atsApply');
const { tailor } = require('./tailor');
const { scoreJobs } = require('./scorer');
const { draftEmails } = require('./emailDrafter');
const { sendEmail, testConnection } = require('./mailer');
const { saveRun, loadState } = require('./state');

const app = express();
// CORS — allow the deployed frontend + local dev. Whitelist via CORS_ORIGIN env
// (comma-separated). Reflect origin when it matches or when list is empty.
const CORS_ORIGINS = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);            // curl / same-origin
    if (CORS_ORIGINS.length === 0) return cb(null, true); // dev: no list = allow all
    if (CORS_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const UPLOAD_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) cb(null, true);
    else cb(new Error('Only PDF files allowed'));
  }
});

let state = loadState();
let sseClients = [];
let cronTask = null;

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients = sseClients.filter(res => {
    try { res.write(msg); return true; } catch { return false; }
  });
}

// ── Health (for Render / uptime probes) ─────────────────────
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ── NEW: simple synchronous search ──────────────────────────
// POST /api/search { keywords, location?, remote?, limit? } → { jobs, sources, total, tookMs }
// Zero state. Zero pipeline. Zero SSE. Returns real jobs in <15s.
app.post('/api/search', async (req, res) => {
  try {
    const { keywords = '', location = '', remote = false, limit = 30 } = req.body || {};
    const result = await newSearch({ keywords, location, remote, limit });
    res.json(result);
  } catch (e) {
    console.error('[search]', e);
    res.status(500).json({ error: e.message, jobs: [] });
  }
});

// Apply to a single job — hands off to the auto-apply engine and records history.
app.post('/api/search/apply', async (req, res) => {
  const { job, profile, method } = req.body || {};
  if (!job?.applyUrl) return res.json({ ok: false, error: 'No apply URL' });

  const fp = fingerprint(job);
  const useProfile = profile || state.profile || {};

  let result = { ok: true, reason: 'Marked applied' };
  if (method !== 'manual') {
    const isIndeed = job.applyUrl.includes('indeed.com');
    if (pickATSAdapter(job.applyUrl)) {
      result = await applyATS(job, useProfile, state.resumePath);
    } else if (isIndeed) {
      result = await applyIndeedJob(job, useProfile, state.resumePath, broadcast);
    } else {
      result = await autoApplyToJob(job, useProfile, state.resumePath);
    }
  }

  if (result?.ok) {
    ensureLibrary();
    state.library.applied[fp] = {
      at: new Date().toISOString(),
      method: method || (result.method || 'auto'),
      platform: job.platform?.name || 'unknown',
      title: job.title, company: job.company, applyUrl: job.applyUrl, location: job.location
    };
    saveRun(state);
  }
  res.json(result);
});

// ── Library (persistent starred / applied history) ─────────
function fingerprint(job) {
  return `${(job.company || '').toLowerCase().trim()}|${(job.title || '').toLowerCase().trim()}`;
}
function ensureLibrary() {
  if (!state.library) state.library = { starred: {}, applied: {}, dismissed: {} };
  state.library.starred ||= {};
  state.library.applied ||= {};
  state.library.dismissed ||= {};
}

app.get('/api/library', (req, res) => {
  ensureLibrary();
  res.json({
    starred: state.library.starred,
    applied: state.library.applied,
    dismissed: state.library.dismissed
  });
});

app.post('/api/library/star', (req, res) => {
  ensureLibrary();
  const { job } = req.body || {};
  if (!job) return res.status(400).json({ error: 'job required' });
  const fp = fingerprint(job);
  if (state.library.starred[fp]) delete state.library.starred[fp];
  else state.library.starred[fp] = {
    at: new Date().toISOString(),
    title: job.title, company: job.company, applyUrl: job.applyUrl,
    location: job.location, platform: job.platform?.name
  };
  saveRun(state);
  res.json({ ok: true, starred: !!state.library.starred[fp] });
});

app.post('/api/library/dismiss', (req, res) => {
  ensureLibrary();
  const { job } = req.body || {};
  const fp = fingerprint(job || {});
  state.library.dismissed[fp] = new Date().toISOString();
  saveRun(state);
  res.json({ ok: true });
});

app.delete('/api/library/applied/:fp', (req, res) => {
  ensureLibrary();
  delete state.library.applied[req.params.fp];
  saveRun(state);
  res.json({ ok: true });
});

// AI tailoring — POST { job } → { summary, coverLetter, keyPoints, matchScore, source }
app.post('/api/tailor', async (req, res) => {
  try {
    const { job, profile } = req.body || {};
    const useProfile = profile || state.profile || {};
    if (!job?.title) return res.status(400).json({ error: 'job required' });
    const result = await tailor({ job, profile: useProfile });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── State / stream (legacy — kept for other pages) ──────────
app.get('/api/state', (req, res) => res.json(state));

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.push(res);
  req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
});

// ── Analytics ───────────────────────────────────────────────
app.get('/api/analytics', (req, res) => {
  const history = state.runHistory || [];
  const allJobs = state.jobs || [];

  const scoreDistribution = [0, 0, 0, 0, 0];
  const statusCounts = { emailed: 0, applied: 0, 'draft-ready': 0, skipped: 0, 'no-email': 0 };

  allJobs.forEach(j => {
    const bucket = Math.min(4, Math.floor((j.score || 0) / 20));
    scoreDistribution[bucket]++;
    if (statusCounts[j.status] !== undefined) statusCounts[j.status]++;
  });

  const totals = history.reduce((acc, r) => {
    acc.found += r.found || 0;
    acc.relevant += r.relevant || 0;
    acc.emailed += r.emailed || 0;
    acc.applied += r.applied || 0;
    acc.skipped += r.skipped || 0;
    return acc;
  }, { found: 0, relevant: 0, emailed: 0, applied: 0, skipped: 0 });

  res.json({ history, scoreDistribution, statusCounts, totals, runCount: history.length });
});

// ── Profile ─────────────────────────────────────────────────
app.get('/api/profile', (req, res) => {
  const hasResume = !!(state.resumePath && fs.existsSync(state.resumePath));
  let resumeInfo = null;
  if (hasResume) {
    try {
      const st = fs.statSync(state.resumePath);
      resumeInfo = {
        name: path.basename(state.resumePath),
        sizeKB: Math.round(st.size / 1024),
        uploadedAt: st.mtime.toISOString()
      };
    } catch {}
  }
  res.json({
    ...(state.profile || {}),
    hasResume,
    resume: resumeInfo,
    // Readiness score — every field the auto-apply engine needs
    ready: !!(state.profile?.name && state.profile?.email && hasResume)
  });
});

app.post('/api/profile', (req, res) => {
  state.profile = { ...state.profile, ...(req.body || {}) };
  saveRun(state);
  res.json({ ok: true, profile: state.profile });
});

// ── Settings ─────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  res.json({
    ...state.settings,
    hasResume: !!(state.resumePath && fs.existsSync(state.resumePath)),
    resumeName: state.resumePath ? path.basename(state.resumePath) : null,
    // Populate defaults from env if not set in state
    gmailUser: state.settings?.gmailUser || process.env.GMAIL_USER || '',
    jsearchKey: state.settings?.jsearchKey || process.env.JSEARCH_API_KEY || ''
  });
});

app.post('/api/settings', (req, res) => {
  state.settings = { ...state.settings, ...req.body };
  saveRun(state);

  // Restart cron if schedule changed
  scheduleCron();

  res.json({ ok: true });
});

app.post('/api/settings/test-email', async (req, res) => {
  const cfg = buildEmailCfg();
  const result = await testConnection(cfg);
  res.json(result);
});

// ── Indeed login ─────────────────────────────────────────────
app.get('/api/indeed/status', (req, res) => {
  res.json({ loggedIn: hasCookies() });
});

app.post('/api/indeed/setup', async (req, res) => {
  res.json({ ok: true, msg: 'Opening Chrome — complete Google login in the browser window' });
  const result = await setupGoogleLogin(broadcast);
  if (result.ok) {
    log('info', 'Indeed login successful — cookies saved');
    broadcast('indeed-status', { loggedIn: true });
  } else {
    log('error', 'Indeed login failed: ' + result.error);
    broadcast('indeed-status', { loggedIn: false, error: result.error });
  }
});

// ── Resume upload ────────────────────────────────────────────
app.post('/api/upload-resume', upload.single('resume'), (req, res) => {
  if (!req.file) return res.json({ ok: false, error: 'No file uploaded' });
  const dest = path.join(UPLOAD_DIR, 'resume.pdf');
  fs.renameSync(req.file.path, dest);
  state.resumePath = dest;
  saveRun(state);
  broadcast('resume', { hasResume: true, name: 'resume.pdf' });
  res.json({ ok: true, name: 'resume.pdf' });
});

app.delete('/api/resume', (req, res) => {
  if (state.resumePath && fs.existsSync(state.resumePath)) fs.unlinkSync(state.resumePath);
  state.resumePath = null;
  saveRun(state);
  res.json({ ok: true });
});

// ── Suggestions (typeahead) ─────────────────────────────────
const COMMON_TITLES = [
  'Software Engineer', 'Senior Software Engineer', 'Full Stack Developer',
  'Frontend Developer', 'Backend Engineer', 'React Developer', 'Node.js Developer',
  'Python Developer', 'Data Scientist', 'Data Engineer', 'Data Analyst',
  'Machine Learning Engineer', 'AI Engineer', 'DevOps Engineer', 'Site Reliability Engineer',
  'Product Manager', 'Product Designer', 'UX Designer', 'UI Designer',
  'Marketing Manager', 'Content Marketing', 'Growth Marketing', 'Social Media Manager',
  'Influencer Marketing Manager', 'Brand Partnerships', 'Community Manager',
  'Creator Partnerships', 'TikTok Creator', 'YouTube Manager', 'Instagram Manager',
  'UGC Creator', 'Video Editor', 'Motion Designer', 'Graphic Designer',
  'Copywriter', 'Content Writer', 'Technical Writer',
  'Customer Success Manager', 'Account Executive', 'Sales Development Rep',
  'Recruiter', 'HR Manager', 'Operations Manager', 'Project Manager',
  'iOS Developer', 'Android Developer', 'Mobile Developer', 'Flutter Developer',
  'Solidity Developer', 'Web3 Engineer', 'Smart Contract Engineer',
  'QA Engineer', 'Security Engineer', 'Cloud Architect', 'Solutions Architect',
  'Founding Engineer', 'CTO', 'VP Engineering', 'Engineering Manager'
];

app.get('/api/suggest', (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  if (q.length < 2) return res.json({ suggestions: [] });

  const seen = new Set();
  const out = [];

  const push = (label, type, meta) => {
    const key = `${type}:${label.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, type, meta });
  };

  // Existing jobs first (highest signal)
  for (const j of state.jobs || []) {
    if (out.length >= 8) break;
    if (j.title && j.title.toLowerCase().includes(q)) push(j.title, 'job', j.company);
  }
  for (const j of state.jobs || []) {
    if (out.length >= 8) break;
    if (j.company && j.company.toLowerCase().includes(q)) push(j.company, 'company');
  }
  // Common titles
  for (const t of COMMON_TITLES) {
    if (out.length >= 8) break;
    if (t.toLowerCase().includes(q)) push(t, 'title');
  }

  res.json({ suggestions: out.slice(0, 8) });
});

// ── Export CSV ───────────────────────────────────────────────
app.get('/api/export/csv', (req, res) => {
  const headers = ['ID','Title','Company','Location','Salary','Score','Status','Email','Apply URL','Posted','Tags'];
  const rows = state.jobs.map(j => [
    j.id, j.title, j.company, j.location, j.salary, j.score, j.status,
    j.email || '', j.applyUrl || '', j.posted, (j.tags || []).join(';')
  ].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="jobs.csv"');
  res.send(csv);
});

// ── Job actions ──────────────────────────────────────────────
app.post('/api/run', async (req, res) => {
  if (state.running) return res.json({ ok: false, error: 'Already running' });
  res.json({ ok: true });
  runPilot(req.body || {});
});

app.post('/api/stop', (req, res) => {
  state.running = false;
  broadcast('status', { running: false, label: 'Stopped' });
  res.json({ ok: true });
});

app.post('/api/send-email/:jobId', async (req, res) => {
  const job = state.jobs.find(j => j.id === req.params.jobId);
  if (!job || !job.emailBody) return res.json({ ok: false, error: 'No draft found' });
  try {
    const overrides = {
      gmailUser: state.settings?.gmailUser || process.env.GMAIL_USER,
      gmailPass: state.settings?.gmailPass || process.env.GMAIL_APP_PASSWORD
    };
    const attachments = buildAttachments();
    await sendEmail({ to: job.email, subject: job.emailSubject, body: job.emailBody, attachments, overrides: buildEmailCfg() });
    job.emailSent = true;
    job.status = 'emailed';
    state.stats.emailed = (state.stats.emailed || 0) + 1;
    saveRun(state);
    broadcast('job-update', job);
    broadcast('stats', state.stats);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Bulk send all draft-ready emails
app.post('/api/send-all-drafts', async (req, res) => {
  const drafts = state.jobs.filter(j => j.status === 'draft-ready' && j.email && j.emailBody && !j.emailSent);
  res.json({ ok: true, count: drafts.length });
  const attachments = buildAttachments();
  for (const job of drafts) {
    try {
      await sendEmail({ to: job.email, subject: job.emailSubject, body: job.emailBody, attachments, overrides: buildEmailCfg() });
      job.emailSent = true;
      job.status = 'emailed';
      state.stats.emailed = (state.stats.emailed || 0) + 1;
      broadcast('job-update', job);
      broadcast('stats', state.stats);
      log('email', `✓ Bulk-sent to ${job.company} → ${job.email}`);
    } catch (e) {
      log('error', `Bulk send failed for ${job.company}: ${e.message}`);
    }
  }
  saveRun(state);
  broadcast('bulk-done', { sent: state.stats.emailed });
});

app.post('/api/job/:jobId/note', (req, res) => {
  const job = state.jobs.find(j => j.id === req.params.jobId);
  if (!job) return res.json({ ok: false });
  job.note = req.body.note || '';
  saveRun(state);
  res.json({ ok: true });
});

app.post('/api/job/:jobId/star', (req, res) => {
  const job = state.jobs.find(j => j.id === req.params.jobId);
  if (!job) return res.json({ ok: false });
  job.starred = !job.starred;
  saveRun(state);
  broadcast('job-update', job);
  res.json({ ok: true, starred: job.starred });
});

app.delete('/api/jobs', (req, res) => {
  state.jobs = [];
  state.stats = { found: 0, relevant: 0, emailed: 0, applied: 0, skipped: 0 };
  saveRun(state);
  res.json({ ok: true });
});

// On-demand apply for a single job (when autoApply was off)
app.post('/api/job/:jobId/apply', async (req, res) => {
  const job = state.jobs.find(j => j.id === req.params.jobId);
  if (!job) return res.json({ ok: false, error: 'Job not found' });

  res.json({ ok: true, msg: 'Applying...' });
  broadcast('job-update', { ...job, status: 'processing' });

  const isIndeed = (job.applyUrl || job.url || '').includes('indeed.com');
  const result = isIndeed
    ? await applyIndeedJob(job, state.profile, state.resumePath, broadcast)
    : await autoApplyToJob(job, state.profile, state.resumePath);

  job.status = result.ok ? 'applied' : 'no-email';
  if (!job.timeline) job.timeline = [];
  job.timeline.push({ label: result.reason, state: result.ok ? 'done' : 'pending' });

  if (result.ok) {
    state.stats.applied = (state.stats.applied || 0) + 1;
    if (!state.appliedCompanies) state.appliedCompanies = [];
    if (job.company && !state.appliedCompanies.includes(job.company)) state.appliedCompanies.push(job.company);
    log('apply', `✓ Manually applied to ${job.company}`);
  } else {
    log('apply', `✗ Apply failed for ${job.company}: ${result.reason}`);
  }

  saveRun(state);
  broadcast('job-update', job);
  broadcast('stats', state.stats);
});

app.delete('/api/applied-companies', (req, res) => {
  state.appliedCompanies = [];
  saveRun(state);
  res.json({ ok: true });
});

app.delete('/api/history', (req, res) => {
  state.runHistory = [];
  saveRun(state);
  res.json({ ok: true });
});

// ── Freelance ─────────────────────────────────────────────────
app.get('/api/freelance/opportunities', (req, res) => {
  let opps = state.freelance?.opportunities || [];
  const { platform, status, source } = req.query;
  if (platform && platform !== 'all') opps = opps.filter(o => o.platform === platform);
  if (status && status !== 'all') opps = opps.filter(o => o.status === status);
  if (source && source !== 'all') opps = opps.filter(o => o.source === source);
  res.json({ opportunities: opps, stats: state.freelance?.stats || {}, running: state.freelance?.running || false });
});

app.get('/api/freelance/settings', (req, res) => res.json(state.freelance?.settings || {}));

app.post('/api/freelance/settings', (req, res) => {
  if (!state.freelance) state.freelance = {};
  state.freelance.settings = { ...(state.freelance.settings || {}), ...req.body };
  saveRun(state);
  res.json({ ok: true });
});

app.post('/api/freelance/run', (req, res) => {
  if (state.freelance?.running) return res.json({ ok: false, error: 'Already running' });
  res.json({ ok: true });
  runFreelancePilot(req.body || {});
});

app.post('/api/freelance/stop', (req, res) => {
  if (state.freelance) state.freelance.running = false;
  broadcast('freelance-status', { running: false, label: 'Stopped' });
  res.json({ ok: true });
});

app.post('/api/freelance/opportunity/:id/draft', async (req, res) => {
  const opp = (state.freelance?.opportunities || []).find(o => o.id === req.params.id);
  if (!opp) return res.json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
  const tone = req.body?.tone || state.freelance?.settings?.tone || 'casual';
  const proposal = await draftProposal(opp, state.profile, tone);
  opp.proposalDraft = proposal.body;
  opp.proposalSubject = proposal.subject;
  saveRun(state);
  broadcast('freelance-update', opp);
});

// Bulk-draft proposals for every "new" opportunity at once
app.post('/api/freelance/draft-all', async (req, res) => {
  res.json({ ok: true });
  const tone = req.body?.tone || state.freelance?.settings?.tone || 'casual';
  const newOpps = (state.freelance?.opportunities || []).filter(o => o.status === 'new' && !o.proposalDraft);
  for (const opp of newOpps) {
    try {
      const p = await draftProposal(opp, state.profile, tone);
      opp.proposalDraft = p.body;
      opp.proposalSubject = p.subject;
      broadcast('freelance-update', opp);
    } catch (e) {
      log('error', `Draft failed for ${opp.title}: ${e.message}`);
    }
  }
  saveRun(state);
  log('info', `Bulk-drafted ${newOpps.length} proposals`);
});

// Generate a follow-up message for an already-sent proposal
app.post('/api/freelance/opportunity/:id/followup', async (req, res) => {
  const opp = (state.freelance?.opportunities || []).find(o => o.id === req.params.id);
  if (!opp) return res.json({ ok: false, error: 'Not found' });
  const fu = await draftFollowUp(opp, state.profile);
  opp.followUpDraft = fu.body;
  opp.followUpSubject = fu.subject;
  saveRun(state);
  broadcast('freelance-update', opp);
  res.json({ ok: true, body: fu.body, subject: fu.subject });
});

app.post('/api/freelance/opportunity/:id/apply', async (req, res) => {
  const opp = (state.freelance?.opportunities || []).find(o => o.id === req.params.id);
  if (!opp) return res.json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
  const tone = req.body?.tone || state.freelance?.settings?.tone || 'casual';
  const result = await applyToOpportunity(opp, state.profile, state.resumePath, buildEmailCfg(), broadcast, tone);
  if (result.ok) {
    opp.status = 'proposal-sent';
    if (!state.freelance.stats) state.freelance.stats = {};
    state.freelance.stats.sent = (state.freelance.stats.sent || 0) + 1;
  }
  saveRun(state);
  broadcast('freelance-update', opp);
  broadcast('freelance-stats', state.freelance.stats);
});

app.post('/api/freelance/opportunity/:id/status', (req, res) => {
  const opp = (state.freelance?.opportunities || []).find(o => o.id === req.params.id);
  if (!opp) return res.json({ ok: false });
  const prev = opp.status;
  opp.status = req.body.status || opp.status;
  if (req.body.amount !== undefined) opp.wonAmount = parseFloat(req.body.amount) || 0;
  if (!state.freelance.stats) state.freelance.stats = {};
  if (opp.status === 'won' && prev !== 'won') {
    state.freelance.stats.won = (state.freelance.stats.won || 0) + 1;
    state.freelance.stats.revenue = (state.freelance.stats.revenue || 0) + (opp.wonAmount || 0);
  }
  if (opp.status === 'in-discussion' && prev !== 'in-discussion') state.freelance.stats.inDiscussion = (state.freelance.stats.inDiscussion || 0) + 1;
  saveRun(state);
  broadcast('freelance-update', opp);
  broadcast('freelance-stats', state.freelance.stats);
  res.json({ ok: true });
});

app.post('/api/freelance/opportunity/:id/note', (req, res) => {
  const opp = (state.freelance?.opportunities || []).find(o => o.id === req.params.id);
  if (!opp) return res.json({ ok: false });
  opp.note = req.body.note || '';
  saveRun(state);
  res.json({ ok: true });
});

app.post('/api/freelance/opportunity/:id/star', (req, res) => {
  const opp = (state.freelance?.opportunities || []).find(o => o.id === req.params.id);
  if (!opp) return res.json({ ok: false });
  opp.starred = !opp.starred;
  saveRun(state);
  broadcast('freelance-update', opp);
  res.json({ ok: true, starred: opp.starred });
});

app.delete('/api/freelance/opportunities', (req, res) => {
  if (!state.freelance) state.freelance = {};
  state.freelance.opportunities = [];
  state.freelance.stats = { found: 0, sent: 0, inDiscussion: 0, won: 0 };
  saveRun(state);
  res.json({ ok: true });
});

app.get('/api/freelance/export/csv', (req, res) => {
  const headers = ['ID','Title','Client','Platform','Budget','Duration','Status','Score','Apply URL','Proposal Sent'];
  const rows = (state.freelance?.opportunities || []).map(o => [
    o.id, o.title, o.clientName, o.platform, o.budget, o.duration, o.status, o.score || '',
    o.applyUrl || '', o.proposalSentAt || ''
  ].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="freelance.csv"');
  res.send([headers.join(','), ...rows].join('\n'));
});

async function runFreelancePilot(config) {
  if (!state.freelance) state.freelance = {};
  const settings = { ...state.freelance.settings, ...config };
  state.freelance.running = true;
  broadcast('freelance-status', { running: true, label: 'Searching freelance opportunities...', progress: 10 });

  try {
    const jsearchKey = state.settings?.jsearchKey || process.env.JSEARCH_API_KEY || '';
    const tavilyKey = state.settings?.tavilyKey || state.settings?.braveKey || process.env.TAVILY_API_KEY || '';
    const opps = await searchFreelance(settings, jsearchKey, tavilyKey);
    broadcast('freelance-status', { running: true, label: `Scoring ${opps.length} opportunities...`, progress: 60 });

    const scored = await scoreOpportunities(opps, state.profile);
    const minScore = settings.minScore || 50;
    const minBudget = settings.minBudget || 0;
    const skipSent = settings.skipSentOpportunities !== false;
    const sentIds = new Set((state.freelance.opportunities || []).filter(o => o.status === 'proposal-sent').map(o => `${o.title}|${o.clientName}`.toLowerCase()));

    const filtered = scored.filter(o => {
      if (o.score < minScore) return false;
      if (minBudget > 0 && o.budgetMin !== null && o.budgetMin < minBudget) return false;
      if (skipSent && sentIds.has(`${o.title}|${o.clientName}`.toLowerCase())) return false;
      return true;
    });

    if (!state.freelance.opportunities) state.freelance.opportunities = [];
    if (!state.freelance.stats) state.freelance.stats = { found: 0, sent: 0, inDiscussion: 0, won: 0 };

    for (const opp of filtered) {
      state.freelance.opportunities.unshift(opp);
      broadcast('freelance-opp', opp);
      state.freelance.stats.found++;
    }
    if (state.freelance.opportunities.length > 200) {
      state.freelance.opportunities = state.freelance.opportunities.slice(0, 200);
    }

    // ── AUTO-APPLY: when toggle is on, draft + send/auto-submit for every opp
    if (settings.autoSendProposal && filtered.length) {
      const tone = settings.tone || 'casual';
      let autoSent = 0, autoManual = 0;
      for (let i = 0; i < filtered.length; i++) {
        const opp = filtered[i];
        const pct = 60 + Math.round((i / filtered.length) * 38);
        broadcast('freelance-status', { running: true, label: `Auto-applying ${i+1}/${filtered.length}: ${opp.title.slice(0,40)}`, progress: pct });
        try {
          const result = await applyToOpportunity(opp, state.profile, state.resumePath, buildEmailCfg(), broadcast, tone);
          if (result.ok) {
            opp.status = 'proposal-sent';
            state.freelance.stats.sent = (state.freelance.stats.sent || 0) + 1;
            autoSent++;
            log('info', `Freelance auto-sent: ${opp.title.slice(0,60)} (${opp.proposalMethod})`);
          } else if (result.manual) {
            autoManual++;
            log('skip', `Freelance manual: ${opp.title.slice(0,50)} — ${result.reason}`);
          }
        } catch (e) {
          log('error', `Freelance auto-apply: ${opp.title.slice(0,40)} — ${e.message.slice(0,80)}`);
        }
        broadcast('freelance-update', opp);
      }
      log('info', `Auto-apply: ${autoSent} sent, ${autoManual} need manual action`);
    }

    state.freelance.running = false;
    saveRun(state);
    await closeBrowser().catch(()=>{});
    broadcast('freelance-stats', state.freelance.stats);
    const summary = settings.autoSendProposal
      ? `Found ${filtered.length}, sent ${state.freelance.stats.sent || 0}`
      : `Found ${filtered.length} opportunities`;
    broadcast('freelance-status', { running: false, label: summary, progress: 100 });
    log('info', `Freelance: ${filtered.length} opportunities found (${opps.length} total, filtered by score/budget)`);
  } catch (e) {
    state.freelance.running = false;
    broadcast('freelance-status', { running: false, label: 'Error: ' + e.message, progress: 0 });
    log('error', 'Freelance search error: ' + e.message);
  }
}

// ── Pilot ────────────────────────────────────────────────────
async function runPilot(config) {
  const {
    keywords = 'influencer marketing manager',
    location = 'Remote',
    minScore = 70,
    maxJobs = 10,
    autoEmail = true,
    autoApply = true,
    includeIndia = true
  } = config;

  state.running = true;
  state.lastConfig = config;
  state.stats = { found: 0, relevant: 0, emailed: 0, applied: 0, skipped: 0 };
  broadcast('status', { running: true, label: 'Searching jobs...', progress: 5 });
  log('search', `Starting pilot: "${keywords}" in ${location}`);

  const runStart = Date.now();
  const blacklist = (state.settings?.blacklist || []).map(s => s.toLowerCase().trim()).filter(Boolean);

  try {
    broadcast('status', { running: true, label: 'Fetching job listings...', progress: 10 });
    // Job-search API key: SerpAPI is the active provider in jobSearch.js
    // Primary sources are free public APIs (Remotive, RemoteOK, Arbeitnow) — no key needed.
    // SerpAPI is optional bonus for LinkedIn/Indeed coverage if a valid key is set.
    const serpapiKey = state.settings?.serpapiKey || process.env.SERPAPI_KEY || '';
    const jsearchKey = serpapiKey;
    state.lastError = null;

    // Multi-keyword fan-out: search the user's keywords + 2-3 variations to broaden the net
    const keywordVariations = buildKeywordVariations(keywords);
    const perVariation = Math.max(5, Math.ceil(maxJobs / keywordVariations.length));
    log('search', `Running ${keywordVariations.length} keyword variations: ${keywordVariations.join(' | ')}`);

    const seenJobs = new Set();
    const dedupe = (jobs) => jobs.filter(j => {
      const key = `${(j.company||'').toLowerCase()}|${(j.title||'').toLowerCase()}`;
      if (seenJobs.has(key)) return false;
      seenJobs.add(key);
      return true;
    });

    let mainJobs = [];
    let idCounter = 1;
    for (let v = 0; v < keywordVariations.length; v++) {
      broadcast('status', { running: true, label: `Searching "${keywordVariations[v]}"...`, progress: 10 + v * 3 });
      const batch = await searchJobs(keywordVariations[v], location, perVariation, jsearchKey);
      const unique = dedupe(batch).map(j => ({ ...j, id: `j${idCounter++}` }));
      mainJobs.push(...unique);
    }

    let rawJobs = mainJobs;
    if (includeIndia) {
      broadcast('status', { running: true, label: 'Fetching India remote jobs...', progress: 22 });
      let indiaIdCounter = 1;
      for (let v = 0; v < keywordVariations.length; v++) {
        const indiaBatch = await searchJobs(keywordVariations[v] + ' remote', 'India', perVariation, jsearchKey);
        const unique = dedupe(indiaBatch).map(j => ({ ...j, id: `ji${indiaIdCounter++}` }));
        rawJobs.push(...unique);
      }
      log('info', `India remote: added ${rawJobs.length - mainJobs.length} unique jobs`);
    }

    // Final cap so we don't hammer scoring on huge lists
    if (rawJobs.length > maxJobs * 2) rawJobs = rawJobs.slice(0, maxJobs * 2);

    state.stats.found = rawJobs.length;
    log('search', `Found ${rawJobs.length} unique listings across ${keywordVariations.length} keyword variations (${includeIndia ? 'global + India remote' : location})`);
    broadcast('stats', state.stats);

    broadcast('status', { running: true, label: 'Scoring relevance...', progress: 30 });
    const scoredJobs = await scoreJobs(rawJobs, state.profile);

    const minSalaryUSD = parseInt(state.settings?.minSalary || 0);
    const minSalaryLPA = parseInt(state.settings?.minSalaryLPA || 0);
    const skipApplied = state.settings?.skipAppliedCompanies !== false;
    const appliedCompanies = new Set((state.appliedCompanies || []).map(c => c.toLowerCase().trim()));

    // Apply all filters: score, blacklist, salary, duplicate companies
    const relevant = scoredJobs.filter(j => {
      if (j.score < minScore) return false;
      if (blacklist.length && blacklist.some(b => j.company?.toLowerCase().includes(b))) return false;
      if (minSalaryUSD > 0 || minSalaryLPA > 0) {
        const sal = parseSalary(j.salary);
        if (sal) {
          if (sal.currency === 'INR_LPA' && minSalaryLPA > 0 && sal.amount < minSalaryLPA) return false;
          if (sal.currency === 'USD' && minSalaryUSD > 0 && sal.amount < minSalaryUSD) return false;
        }
      }
      if (skipApplied && appliedCompanies.has(j.company?.toLowerCase().trim())) {
        log('info', `Skipping ${j.company} — already applied in a previous run`);
        return false;
      }
      return true;
    });
    const skipped = scoredJobs.filter(j => !relevant.includes(j));

    state.stats.relevant = relevant.length;
    state.stats.skipped = skipped.length;

    skipped.forEach(j => {
      j.status = 'skipped';
      state.jobs.unshift(j);
      broadcast('job', j);
    });

    log('info', `${relevant.length} relevant, ${skipped.length} skipped (threshold: ${minScore})`);
    if (blacklist.length) log('info', `Blacklisted companies filtered: ${blacklist.join(', ')}`);
    broadcast('stats', state.stats);

    // Draft emails for all jobs with an email in description
    const emailJobs = relevant.filter(j => j.email);
    if (emailJobs.length > 0) {
      broadcast('status', { running: true, label: `Drafting ${emailJobs.length} emails...`, progress: 50 });
      const drafts = await draftEmails(emailJobs, state.profile);
      drafts.forEach(d => {
        const job = emailJobs.find(j => j.id === d.id);
        if (job) { job.emailSubject = d.subject; job.emailBody = d.body; }
      });
      log('info', `Drafted ${drafts.length} emails`);
    }

    const attachments = buildAttachments();
    const overrides = buildEmailCfg();

    for (let i = 0; i < relevant.length; i++) {
      if (!state.running) break;
      const j = relevant[i];
      const pct = 55 + ((i + 1) / relevant.length) * 40;
      broadcast('status', { running: true, label: `Processing ${i + 1}/${relevant.length}: ${j.company}`, progress: pct });

      // Skip OpenAI mock jobs before touching state
      if (j.source === 'openai') {
        j.status = 'skipped';
        j.timeline = [{ label: 'Skipped — AI-generated mock job, not a real listing', state: 'fail' }];
        state.stats.skipped++;
        state.jobs.unshift(j);
        broadcast('job', j);
        broadcast('stats', state.stats);
        log('info', `Skipped mock job: ${j.company} (OpenAI generated)`);
        continue;
      }

      j.status = 'processing';
      j.timeline = [];
      state.jobs.unshift(j);
      broadcast('job', j);
      await sleep(300);

      if (j.email && j.emailBody) {
        j.timeline = [
          { label: `Scored ${j.score}/100 — ${j.reason}`, state: 'done' },
          { label: `Email found in description: ${j.email}`, state: 'done' },
          { label: `Application email drafted${attachments.length ? ' + resume attached' : ''}`, state: 'done' }
        ];

        if (autoEmail) {
          try {
            await sendEmail({ to: j.email, subject: j.emailSubject, body: j.emailBody, attachments, overrides });
            j.emailSent = true;
            j.status = 'emailed';
            j.timeline.push({ label: `Email sent to ${j.email}`, state: 'done' });
            state.stats.emailed++;
            if (!state.appliedCompanies) state.appliedCompanies = [];
            if (j.company && !state.appliedCompanies.includes(j.company)) state.appliedCompanies.push(j.company);
            log('email', `✓ Emailed ${j.company} → ${j.email}`);
          } catch (e) {
            j.status = 'draft-ready';
            j.timeline.push({ label: `Send manually — ${e.message}`, state: 'pending' });
            log('error', `Email failed for ${j.company}: ${e.message}`);
          }
        } else {
          j.status = 'draft-ready';
          j.timeline.push({ label: 'Email draft ready — send manually', state: 'pending' });
        }
      } else {
        log('apply', `No email for ${j.company} — trying auto-apply on ${j.applyUrl}`);
        broadcast('status', { running: true, label: `Auto-applying to ${j.company}...`, progress: pct });

        if (autoApply) {
          const isIndeed = (j.applyUrl || j.url || '').includes('indeed.com');
          const applyResult = isIndeed
            ? await applyIndeedJob(j, state.profile, state.resumePath, broadcast)
            : await autoApplyToJob(j, state.profile, state.resumePath);
          j.status = applyResult.ok ? 'applied' : 'no-email';
          j.timeline = [
            { label: `Scored ${j.score}/100 — ${j.reason}`, state: 'done' },
            { label: 'No email found in description', state: 'fail' },
            { label: applyResult.reason, state: applyResult.ok ? 'done' : 'pending' }
          ];
          if (applyResult.ok) {
            state.stats.applied++;
            if (!state.appliedCompanies) state.appliedCompanies = [];
            if (j.company && !state.appliedCompanies.includes(j.company)) state.appliedCompanies.push(j.company);
            log('apply', `✓ Auto-applied to ${j.company}`);
          } else {
            log('apply', `✗ ${j.company}: ${applyResult.reason}`);
          }
        } else {
          j.status = 'no-email';
          j.timeline = [
            { label: `Scored ${j.score}/100 — ${j.reason}`, state: 'done' },
            { label: 'No email in description — manual apply needed', state: 'pending' }
          ];
        }
      }

      saveRun(state);
      broadcast('job', j);
      broadcast('stats', state.stats);
    }

    state.running = false;

    const runRecord = {
      ts: new Date().toISOString(),
      keywords,
      location,
      durationSec: Math.round((Date.now() - runStart) / 1000),
      ...state.stats
    };
    if (!state.runHistory) state.runHistory = [];
    state.runHistory.unshift(runRecord);
    if (state.runHistory.length > 50) state.runHistory = state.runHistory.slice(0, 50);

    if (state.jobs.length > 200) state.jobs = state.jobs.slice(0, 200);
    if (state.appliedCompanies.length > 500) state.appliedCompanies = state.appliedCompanies.slice(-500);

    saveRun(state);
    broadcast('run-history', runRecord);
    broadcast('status', {
      running: false,
      label: 'Run complete',
      progress: 100,
      summary: `${state.stats.emailed} emailed · ${state.stats.applied} applied · ${state.stats.skipped} skipped`
    });
    log('info', `Run complete — ${state.stats.emailed} emailed, ${state.stats.applied} applied`);
    await closeBrowser();

  } catch (e) {
    state.running = false;
    broadcast('status', { running: false, label: 'Error: ' + e.message, progress: 0 });
    log('error', 'Pipeline error: ' + e.message);
    console.error(e);
    await closeBrowser();
  }
}

function buildEmailCfg() {
  return {
    provider: state.settings?.provider || 'gmail',
    gmailUser: state.settings?.gmailUser || process.env.GMAIL_USER,
    gmailPass: state.settings?.gmailPass || process.env.GMAIL_APP_PASSWORD,
    smtpHost: state.settings?.smtpHost || '',
    smtpPort: state.settings?.smtpPort || '587',
    smtpSecure: state.settings?.smtpSecure || false
  };
}

function buildAttachments() {
  if (state.resumePath && fs.existsSync(state.resumePath)) {
    return [{ filename: 'Resume.pdf', path: state.resumePath }];
  }
  return [];
}

function log(type, msg) {
  const entry = { type, msg, time: new Date().toLocaleTimeString() };
  state.logs.unshift(entry);
  if (state.logs.length > 200) state.logs = state.logs.slice(0, 200);
  broadcast('log', entry);
}

function parseSalary(salaryStr) {
  if (!salaryStr || salaryStr === 'Salary not listed') return null;
  const s = salaryStr.toLowerCase();

  // Indian format: "8 LPA", "8-12 LPA", "₹8 LPA", "8 lakhs"
  if (s.includes('lpa') || s.includes('lakh') || s.includes('₹')) {
    const m = salaryStr.match(/([\d,.]+)/);
    if (!m) return null;
    return { amount: parseFloat(m[1].replace(/,/g, '')), currency: 'INR_LPA' };
  }

  // USD format: "$70k", "$70,000/yr", "70000"
  const m = salaryStr.match(/\$?([\d,]+)(k)?/i);
  if (!m) return null;
  let val = parseFloat(m[1].replace(/,/g, ''));
  if (m[2]) val *= 1000;
  return { amount: val, currency: 'USD' };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Cron scheduler ───────────────────────────────────────────
function scheduleCron() {
  if (cronTask) { cronTask.destroy(); cronTask = null; }
  const hours = parseInt(state.settings?.autoRunHours || process.env.AUTO_RUN_INTERVAL_HOURS || '0') || 0;
  if (hours > 0 && hours <= 24) {
    cronTask = cron.schedule(`0 */${hours} * * *`, () => {
      if (!state.running && state.profile?.name) {
        console.log('[CRON] Auto-running pilot');
        runPilot(state.lastConfig || {});
      }
    });
    console.log(`[CRON] Scheduled every ${hours}h`);
  }
}

scheduleCron();

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`\nInfluencer Job Autopilot running at http://localhost:${PORT}\n`));
// Generate 3 keyword variations to broaden the search net.
// Detects core role words and swaps synonyms; falls back to a generic broadening.
function buildKeywordVariations(kw) {
  const base = (kw || '').trim();
  if (!base) return ['influencer marketing'];

  const variations = new Set([base]);
  const lower = base.toLowerCase();

  // Role-word substitutions
  const swaps = [
    ['manager', 'specialist'],
    ['manager', 'lead'],
    ['specialist', 'manager'],
    ['marketing', 'partnerships'],
    ['influencer', 'creator'],
    ['influencer marketing', 'creator marketing'],
    ['social media', 'creator partnerships']
  ];
  for (const [from, to] of swaps) {
    if (lower.includes(from)) {
      variations.add(base.replace(new RegExp(from, 'gi'), to));
    }
    if (variations.size >= 3) break;
  }

  // If we still don't have 3, add a broader fallback
  if (variations.size < 3) {
    variations.add(base.replace(/\s*(manager|specialist|lead|coordinator)/i, '').trim() || base);
  }
  return [...variations].slice(0, 3);
}

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} already in use — kill the old process first`);
  else console.error('Server error:', e.message);
  process.exit(1);
});
