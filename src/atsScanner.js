/**
 * ATS Resume Scanner
 * Two modes:
 *   1. Per-job scan  — matches a resume against a specific job description,
 *                      returns match %, matched/missing keywords, tailored fixes.
 *   2. Health check  — general ATS-friendliness of the resume itself
 *                      (parseability, structure, contact info, keyword density).
 *
 * Uses OpenAI for smart analysis when key present; falls back to a
 * deterministic keyword-match algorithm so the feature never breaks.
 */
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// Cache parsed resume text per file mtime — avoids re-parsing the same PDF.
const _cache = new Map();

async function extractResumeText(resumePath) {
  if (!resumePath || !fs.existsSync(resumePath)) throw new Error('Resume file not found');
  const stat = fs.statSync(resumePath);
  const key = `${resumePath}|${stat.mtimeMs}|${stat.size}`;
  if (_cache.has(key)) return _cache.get(key);

  const buf = fs.readFileSync(resumePath);
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buf });
  const parsed = await parser.getText();
  const text = (parsed.text || '').replace(/\s+/g, ' ').trim();
  _cache.set(key, text);
  return text;
}

async function scan({ resumePath, profile, job }) {
  const text = await extractResumeText(resumePath);
  if (!text || text.length < 50) {
    throw new Error('Resume text extraction returned almost nothing — is this a scanned image PDF? ATS systems can\'t read those either — export from Word/Google Docs.');
  }

  // Both scans share the same health baseline
  const health = healthCheck(text, profile);

  if (job?.title) {
    const jobScan = await matchAgainstJob(text, job);
    return {
      kind: 'per-job',
      job: { title: job.title, company: job.company, platform: job.platform?.name },
      match: jobScan,
      health,
      resumeChars: text.length
    };
  }

  return { kind: 'health-only', health, resumeChars: text.length };
}

// ── HEALTH CHECK ──────────────────────────────────────────────
function healthCheck(text, profile) {
  const t = text.toLowerCase();
  const checks = [];

  // Contact info
  checks.push({
    id: 'email',
    label: 'Email address present',
    ok: /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/.test(text),
    weight: 10
  });
  checks.push({
    id: 'phone',
    label: 'Phone number present',
    ok: /(\+?\d[\d\s().-]{8,})/.test(text),
    weight: 8
  });
  checks.push({
    id: 'linkedin',
    label: 'LinkedIn URL present',
    ok: /linkedin\.com\/in\//i.test(text),
    weight: 6
  });

  // Section headers ATS parsers look for
  const sections = ['experience', 'education', 'skills'];
  for (const s of sections) {
    checks.push({
      id: `section:${s}`,
      label: `Section: ${s.charAt(0).toUpperCase() + s.slice(1)}`,
      ok: new RegExp(`\\b${s}\\b`, 'i').test(text),
      weight: 8
    });
  }

  // Dates — should have some year-year or "Present"
  checks.push({
    id: 'dates',
    label: 'Employment dates present',
    ok: /(20\d{2}|19\d{2}|present|current)/i.test(t),
    weight: 6
  });

  // Length — too short = under-detailed, too long = wall of text
  const wordCount = text.split(/\s+/).length;
  checks.push({
    id: 'length',
    label: `Length: ${wordCount} words (target 400–900)`,
    ok: wordCount >= 250 && wordCount <= 1200,
    weight: 5
  });

  // Avoid weird artifacts that suggest a template with tables/columns
  const looksSuspicious = /\|\s*\|\s*\|/.test(text) || (text.match(/\t/g) || []).length > 20;
  checks.push({
    id: 'plain-structure',
    label: 'No table/column artifacts (ATS-safe layout)',
    ok: !looksSuspicious,
    weight: 6
  });

  // Action verbs — resumes with strong verbs perform better
  const verbs = ['led', 'built', 'shipped', 'designed', 'launched', 'grew', 'reduced',
    'improved', 'delivered', 'managed', 'architected', 'developed', 'created',
    'increased', 'scaled', 'implemented', 'optimized', 'automated'];
  const verbHits = verbs.filter(v => new RegExp(`\\b${v}\\b`, 'i').test(text)).length;
  checks.push({
    id: 'action-verbs',
    label: `Action verbs: ${verbHits} found (aim for 8+)`,
    ok: verbHits >= 8,
    weight: 5
  });

  // Metrics — numbers indicate quantified impact
  const metricCount = (text.match(/\b\d+(\.\d+)?[%kMB+]?\b/g) || []).length;
  checks.push({
    id: 'metrics',
    label: `Quantified impact: ${metricCount} numbers (aim for 6+)`,
    ok: metricCount >= 6,
    weight: 6
  });

  // Score
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const scored = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  const score = Math.round((scored / totalWeight) * 100);

  return {
    score,
    grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D',
    wordCount,
    checks
  };
}

// ── PER-JOB MATCH ─────────────────────────────────────────────
async function matchAgainstJob(resumeText, job) {
  const key = process.env.OPENAI_API_KEY;
  const kwMatch = keywordMatch(resumeText, job);

  if (!key) {
    return { ...kwMatch, source: 'keyword-fallback' };
  }

  try {
    const client = new OpenAI({ apiKey: key });
    const msg = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are an ATS (Applicant Tracking System) analyzer. Given a resume and a job description, return JSON:
{
  "matchScore": 0-100 estimate of ATS pass likelihood,
  "matchedKeywords": ["specific skills/tech from the JD that appear in the resume"],
  "missingKeywords": ["specific must-have skills from the JD that are MISSING from the resume"],
  "matchedResponsibilities": ["role responsibilities the resume clearly evidences"],
  "gaps": ["concrete gaps between the resume and the job — 2-4 items, short"],
  "quickFixes": ["3-5 concrete edits the candidate can make to their resume TODAY to score higher — verbatim rephrase suggestions where possible"],
  "verdict": "one-sentence honest verdict"
}
Rules: never invent skills the candidate doesn't have. Missing = specifically named in JD but absent from resume. Be concrete, not fluffy.`
        },
        {
          role: 'user',
          content: JSON.stringify({
            job: {
              title: job.title, company: job.company,
              description: (job.description || '').slice(0, 2200),
              tags: job.tags || []
            },
            resume: resumeText.slice(0, 4000)
          })
        }
      ]
    });
    const parsed = JSON.parse(msg.choices[0].message.content);
    // Merge in raw keyword stats for transparency
    return { ...parsed, keywordStats: kwMatch, source: 'openai' };
  } catch (e) {
    console.warn('[atsScan] OpenAI failed, falling back:', e.message);
    return { ...kwMatch, source: 'keyword-fallback' };
  }
}

// Deterministic fallback — extract candidate keywords from JD and check the resume
function keywordMatch(resumeText, job) {
  const rt = resumeText.toLowerCase();
  const desc = (job.description || '').toLowerCase();
  const title = (job.title || '').toLowerCase();
  const tags = (job.tags || []).map(String);

  // Candidate keyword pool: tags + capitalised tokens in JD + known tech vocabulary
  const techVocab = ['python','javascript','typescript','node','node.js','react','vue','angular','svelte',
    'next.js','django','flask','fastapi','rails','laravel','spring','graphql','rest','api',
    'aws','gcp','azure','docker','kubernetes','terraform','ci/cd','jenkins','github actions',
    'postgres','postgresql','mysql','mongodb','redis','elasticsearch','kafka','rabbitmq',
    'ml','machine learning','llm','pytorch','tensorflow','pandas','numpy','airflow',
    'figma','sketch','photoshop','illustrator','ux','ui','design system',
    'seo','sem','google ads','meta ads','tiktok','instagram','influencer','ugc',
    'salesforce','hubspot','notion','slack','jira','asana'];

  const candidates = new Set([
    ...tags.map(t => t.toLowerCase()),
    ...techVocab.filter(k => desc.includes(k) || title.includes(k)),
    // Grab TitleCase words from JD (likely proper nouns / tech names)
    ...(desc.match(/\b[A-Z][a-zA-Z.]{2,15}\b/g) || []).map(s => s.toLowerCase())
  ]);

  const matched = [];
  const missing = [];
  for (const k of candidates) {
    if (!k || k.length < 2) continue;
    if (rt.includes(k)) matched.push(k);
    else missing.push(k);
  }

  const total = matched.length + missing.length;
  const matchScore = total === 0 ? 60 : Math.round((matched.length / total) * 100);
  return {
    matchScore,
    matchedKeywords: matched.slice(0, 20),
    missingKeywords: missing.slice(0, 15),
    matchedResponsibilities: [],
    gaps: missing.length ? [`Resume doesn't mention: ${missing.slice(0, 5).join(', ')}`] : [],
    quickFixes: missing.length
      ? [`Add these skills to your Skills section if you have them: ${missing.slice(0, 6).join(', ')}`]
      : [`Resume already covers the main keywords for this role`],
    verdict: matchScore >= 70 ? 'Strong keyword coverage — likely to pass ATS' :
             matchScore >= 50 ? 'Moderate coverage — add missing skills to improve' :
                                'Weak coverage — resume needs significant tailoring for this role'
  };
}

module.exports = { scan, extractResumeText };
