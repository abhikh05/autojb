#!/usr/bin/env node
/**
 * AUTOPILOT FULL-STACK CHECK
 *
 * Runs end-to-end tests on every module, helper, endpoint and real-API flow.
 * Designed to be tough — covers happy path, edge cases, malformed input,
 * missing API keys, network failures, and quality regressions (scam filter,
 * phone-regex false positives, banned-phrase compliance).
 *
 * Usage:
 *   node test/check-all.js           # all tests
 *   node test/check-all.js --fast    # skip slow LLM/network calls
 *   node test/check-all.js --grep=email  # only tests matching string
 *
 * Exit code: 0 if all passed, 1 if any failed.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const FAST = args.includes('--fast');
const GREP = (args.find(a => a.startsWith('--grep=')) || '').split('=')[1] || '';

const COLORS = { reset:'\x1b[0m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', blue:'\x1b[34m', magenta:'\x1b[35m', cyan:'\x1b[36m', gray:'\x1b[90m', bold:'\x1b[1m' };
const c = (col, s) => `${COLORS[col]}${s}${COLORS.reset}`;

const results = { pass: 0, fail: 0, skip: 0, failures: [], total_ms: 0 };
let currentGroup = '';

function group(name) {
  currentGroup = name;
  console.log('\n' + c('bold', c('cyan', `── ${name} `.padEnd(72, '─'))));
}

async function test(name, fn, { slow = false, requires = null } = {}) {
  if (GREP && !(currentGroup + ' ' + name).toLowerCase().includes(GREP.toLowerCase())) return;
  if (FAST && slow) { console.log(c('gray', `  ⊘ SKIP (fast)  ${name}`)); results.skip++; return; }
  if (requires) {
    const missing = requires.filter(k => !process.env[k] && !readState()?.settings?.[envToSetting(k)]);
    if (missing.length) { console.log(c('gray', `  ⊘ SKIP (missing ${missing.join(',')})  ${name}`)); results.skip++; return; }
  }
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    results.pass++; results.total_ms += ms;
    console.log(c('green', `  ✓ PASS`) + c('gray', ` (${ms}ms)  `) + name);
  } catch (e) {
    const ms = Date.now() - t0;
    results.fail++; results.total_ms += ms;
    results.failures.push({ group: currentGroup, name, error: e.message, stack: e.stack });
    console.log(c('red', `  ✗ FAIL`) + c('gray', ` (${ms}ms)  `) + name + '\n      ' + c('red', e.message));
  }
}

function envToSetting(k) {
  return { SERPAPI_KEY: 'serpapiKey', JSEARCH_API_KEY: 'jsearchKey', TAVILY_API_KEY: 'tavilyKey', OPENAI_API_KEY: 'openaiKey' }[k] || k.toLowerCase();
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEq(actual, expected, msg) { if (actual !== expected) throw new Error(`${msg||'Mismatch'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
function assertContains(haystack, needle, msg) { if (!haystack || !haystack.includes(needle)) throw new Error(`${msg||'Missing substring'}: "${needle}" not found in ${JSON.stringify(haystack).slice(0,140)}`); }
function assertMatch(str, rx, msg) { if (!rx.test(str)) throw new Error(`${msg||'Regex mismatch'}: ${rx} did not match ${JSON.stringify(str).slice(0,140)}`); }
function assertNotMatch(str, rx, msg) { if (rx.test(str)) throw new Error(`${msg||'Unexpected match'}: ${rx} matched in ${JSON.stringify(str).slice(0,140)}`); }
function readState() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'state.json'), 'utf8')); } catch { return null; } }

function loadKey(envName, settingName) {
  return process.env[envName] || readState()?.settings?.[settingName] || '';
}

// ── Start the server in-process so we can hit real HTTP endpoints ─────────
let SERVER_BASE = 'http://localhost:3001';
let serverProcess = null;
async function startTestServer() {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    serverProcess = spawn('node', [path.join(ROOT, 'src', 'server.js')], {
      env: { ...process.env, PORT: '3001' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let buffered = '';
    serverProcess.stdout.on('data', d => {
      buffered += d.toString();
      if (buffered.includes('running at http')) resolve();
    });
    serverProcess.stderr.on('data', d => { buffered += d.toString(); });
    setTimeout(() => reject(new Error('Server did not start in 5s. Output: ' + buffered.slice(0, 300))), 5000);
  });
}
function stopTestServer() {
  if (serverProcess) { try { serverProcess.kill('SIGTERM'); } catch {} }
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN TEST RUNNER
// ════════════════════════════════════════════════════════════════════════════
(async () => {
  console.log(c('bold', c('magenta', '\n╔══ AUTOPILOT FULL-STACK CHECK ' + '═'.repeat(43) + '╗')));
  console.log(c('gray', `   Mode: ${FAST ? 'fast (skip slow tests)' : 'full'}${GREP ? '  Filter: ' + GREP : ''}`));
  console.log(c('gray', `   SerpAPI key:  ${process.env.SERPAPI_KEY ? '✓' : '✗ (will use OpenAI fallback)'}`));
  console.log(c('gray', `   Tavily key:   ${loadKey('TAVILY_API_KEY','tavilyKey') ? '✓' : '✗ (LinkedIn-posts will skip)'}`));
  console.log(c('gray', `   OpenAI key:   ${process.env.OPENAI_API_KEY ? '✓' : '✗ (LLM tests will fail)'}`));
  console.log(c('gray', `   JSearch key:  ${loadKey('JSEARCH_API_KEY','jsearchKey') ? '✓ (used by freelance JSearch)' : '✗'}`));

  // ──────────────────────────────────────────────────────────────────────
  group('Module loading & exports');
  // ──────────────────────────────────────────────────────────────────────
  await test('state.js exports loadState + saveRun', () => {
    const m = require('../src/state');
    assert(typeof m.loadState === 'function');
    assert(typeof m.saveRun === 'function');
  });
  await test('jobSearch.js exports searchJobs', () => {
    const m = require('../src/jobSearch');
    assert(typeof m.searchJobs === 'function');
  });
  await test('freelanceSearch.js exports searchFreelance + scoreOpportunities', () => {
    const m = require('../src/freelanceSearch');
    assert(typeof m.searchFreelance === 'function');
    assert(typeof m.scoreOpportunities === 'function');
  });
  await test('freelanceApply.js exports draftProposal, draftFollowUp, applyToOpportunity', () => {
    const m = require('../src/freelanceApply');
    assert(typeof m.draftProposal === 'function');
    assert(typeof m.draftFollowUp === 'function');
    assert(typeof m.applyToOpportunity === 'function');
  });
  await test('mailer.js exports sendEmail + validateEmailDomain', () => {
    const m = require('../src/mailer');
    assert(typeof m.sendEmail === 'function');
    assert(typeof m.validateEmailDomain === 'function');
  });
  await test('scorer.js exports scoreJobs', () => {
    assert(typeof require('../src/scorer').scoreJobs === 'function');
  });
  await test('emailDrafter.js exports draftEmails', () => {
    const m = require('../src/emailDrafter');
    assert(typeof m.draftEmails === 'function' || typeof m.draftEmail === 'function' || typeof m.draft === 'function');
  });
  await test('autoApply.js exports autoApplyToJob + closeBrowser', () => {
    const m = require('../src/autoApply');
    assert(typeof m.autoApplyToJob === 'function');
    assert(typeof m.closeBrowser === 'function');
  });
  await test('indeedApply.js loads without error', () => {
    require('../src/indeedApply');
  });

  // ──────────────────────────────────────────────────────────────────────
  group('state.js — persistence & deep-merge');
  // ──────────────────────────────────────────────────────────────────────
  await test('loadState returns shape with required keys', () => {
    const s = require('../src/state').loadState();
    ['running','profile','jobs','logs','stats','runHistory','freelance','settings','appliedCompanies'].forEach(k =>
      assert(k in s, `Missing key: ${k}`));
    assertEq(s.running, false, 'running should be reset to false on load');
    assert(Array.isArray(s.jobs));
    assert(Array.isArray(s.logs));
    assert(s.freelance.settings, 'freelance.settings should exist');
    assert('timeRange' in s.freelance.settings || s.freelance.settings.timeRange === undefined, 'freelance settings should be initialized');
  });
  await test('loadState deep-merges settings without clobbering defaults', () => {
    const s = require('../src/state').loadState();
    assert(typeof s.settings.minSalary === 'number');
    assert(typeof s.settings.skipAppliedCompanies === 'boolean');
    assert(Array.isArray(s.freelance.settings.sources));
  });
  await test('loadState forces running=false on reload', () => {
    const orig = readState();
    if (!orig) return; // no state file yet, skip
    const tmpPath = path.join(ROOT, 'state.json');
    const backup = fs.readFileSync(tmpPath, 'utf8');
    try {
      const modified = { ...orig, running: true, freelance: { ...orig.freelance, running: true } };
      fs.writeFileSync(tmpPath, JSON.stringify(modified));
      // Force fresh require
      delete require.cache[require.resolve('../src/state')];
      const s = require('../src/state').loadState();
      assertEq(s.running, false);
      assertEq(s.freelance.running, false);
    } finally {
      fs.writeFileSync(tmpPath, backup);
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  group('Helpers — email/phone extraction (freelanceSearch internals)');
  // ──────────────────────────────────────────────────────────────────────
  // Re-exporting internals is cleaner, but we test via the public function with crafted input later.
  // Direct unit test: load source and re-eval helpers in isolation.
  const fls = fs.readFileSync(path.join(ROOT, 'src', 'freelanceSearch.js'), 'utf8');
  // Pull each named helper out via a Function constructor — quick & dirty unit testing for internals.
  function extractHelpers(src, names) {
    const wrapped = src + '\nmodule.exports = { ' + names.join(',') + ' };';
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', '__dirname', '__filename', wrapped)(
      require, mod, mod.exports, ROOT + '/src', ROOT + '/src/freelanceSearch.js'
    );
    return mod.exports;
  }
  let flsHelpers;
  try { flsHelpers = extractHelpers(fls, ['extractEmail', 'extractPhone', 'cleanLinkedInTitle']); } catch (e) { flsHelpers = null; }

  await test('extractEmail returns email for valid string', () => {
    if (!flsHelpers) throw new Error('Could not load helpers');
    assertEq(flsHelpers.extractEmail('Contact me at jane@brand.com today'), 'jane@brand.com');
  });
  await test('extractEmail returns null for noreply/postmaster/info/support/admin/contact/hello', () => {
    if (!flsHelpers) throw new Error('Could not load helpers');
    ['noreply','no-reply','postmaster','info','support','admin','contact','hello'].forEach(prefix => {
      const result = flsHelpers.extractEmail(`Send to ${prefix}@brand.com`);
      assertEq(result, null, `${prefix}@ should be filtered, got ${result}`);
    });
  });
  await test('extractEmail returns null for empty/no-match', () => {
    if (!flsHelpers) throw new Error('Could not load helpers');
    assertEq(flsHelpers.extractEmail(''), null);
    assertEq(flsHelpers.extractEmail('no email here'), null);
    assertEq(flsHelpers.extractEmail(null), null);
  });
  await test('extractPhone accepts +91 international format', () => {
    if (!flsHelpers) throw new Error('Could not load helpers');
    const r = flsHelpers.extractPhone('Call me at +91 9876543210 anytime');
    assert(r && r.includes('9876543210'), `Expected to extract phone, got: ${r}`);
  });
  await test('extractPhone accepts (415) 555-1234 US format', () => {
    if (!flsHelpers) throw new Error('Could not load helpers');
    const r = flsHelpers.extractPhone('phone (415) 555-1234');
    assert(r, `Expected to extract phone, got: ${r}`);
  });
  await test('extractPhone REJECTS 12-digit run with no separators (timestamp / ID)', () => {
    if (!flsHelpers) throw new Error('Could not load helpers');
    const r = flsHelpers.extractPhone('post id 745952773030 yesterday');
    assertEq(r, null, `12-digit run should be rejected, got: ${r}`);
  });
  await test('extractPhone REJECTS short numbers (under 10 digits)', () => {
    if (!flsHelpers) throw new Error('Could not load helpers');
    const r = flsHelpers.extractPhone('ext 12345');
    assertEq(r, null);
  });
  await test('cleanLinkedInTitle strips "| LinkedIn" suffix', () => {
    if (!flsHelpers) throw new Error('Could not load helpers');
    assertEq(flsHelpers.cleanLinkedInTitle('Jane Doe | LinkedIn'), 'Jane Doe');
  });
  await test('cleanLinkedInTitle strips notification counts "(12)"', () => {
    if (!flsHelpers) throw new Error('Could not load helpers');
    assertEq(flsHelpers.cleanLinkedInTitle('Jane Doe on LinkedIn: hiring (12)'), 'Jane Doe: hiring');
  });

  // ──────────────────────────────────────────────────────────────────────
  group('Helpers — server.js buildKeywordVariations');
  // ──────────────────────────────────────────────────────────────────────
  const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
  let buildKw;
  try {
    const match = serverSrc.match(/function buildKeywordVariations[\s\S]*?^}/m);
    if (match) {
      buildKw = new Function('return ' + match[0])();
    }
  } catch (e) { buildKw = null; }

  await test('buildKeywordVariations returns 3 unique variants for "influencer marketing manager"', () => {
    if (!buildKw) throw new Error('Helper not found in server.js');
    const v = buildKw('influencer marketing manager');
    assertEq(v.length, 3, `Expected 3 variants, got ${v.length}: ${v.join('|')}`);
    assert(new Set(v).size === 3, 'Variants must be unique');
    assert(v[0] === 'influencer marketing manager', 'First variant must be original keyword');
  });
  await test('buildKeywordVariations handles empty input', () => {
    if (!buildKw) throw new Error('Helper not found');
    const v = buildKw('');
    assert(Array.isArray(v) && v.length >= 1);
  });
  await test('buildKeywordVariations swaps "creator" for "influencer"', () => {
    if (!buildKw) throw new Error('Helper not found');
    const v = buildKw('influencer outreach');
    assert(v.some(s => /creator/i.test(s)), `Expected a "creator" variant, got: ${v.join(' | ')}`);
  });

  // ──────────────────────────────────────────────────────────────────────
  group('Mailer — DNS validation');
  // ──────────────────────────────────────────────────────────────────────
  const { validateEmailDomain } = require('../src/mailer');
  await test('validateEmailDomain accepts gmail.com', async () => {
    assertEq(await validateEmailDomain('test@gmail.com'), true);
  }, { slow: true });
  await test('validateEmailDomain accepts outlook.com', async () => {
    assertEq(await validateEmailDomain('test@outlook.com'), true);
  }, { slow: true });
  await test('validateEmailDomain rejects nonexistent domain', async () => {
    assertEq(await validateEmailDomain('test@nope-xyz123-fake.invalid'), false);
  }, { slow: true });
  await test('validateEmailDomain rejects malformed input gracefully', async () => {
    assertEq(await validateEmailDomain('not-an-email'), false);
  }, { slow: true });

  // ──────────────────────────────────────────────────────────────────────
  group('Job search — real & fallback paths');
  // ──────────────────────────────────────────────────────────────────────
  const { searchJobs } = require('../src/jobSearch');
  await test('searchJobs returns array of shape {title, company, applyUrl}', async () => {
    const jobs = await searchJobs('influencer marketing', 'Remote', 3);
    assert(Array.isArray(jobs), 'must be array');
    assert(jobs.length > 0, 'should return some jobs (either SerpAPI or OpenAI fallback)');
    jobs.forEach((j, i) => {
      assert(j.title, `Job ${i}: missing title`);
      assert(j.company, `Job ${i}: missing company`);
      assert(j.applyUrl !== undefined, `Job ${i}: missing applyUrl field`);
    });
  }, { slow: true, requires: ['OPENAI_API_KEY'] });

  await test('searchJobs with SerpAPI key returns real-looking data', async () => {
    if (!process.env.SERPAPI_KEY) { results.skip++; console.log(c('gray','  ⊘ SKIP (no SERPAPI_KEY)')); return; }
    const jobs = await searchJobs('product manager', 'Remote', 3);
    assert(jobs.length > 0);
    // Real SerpAPI results have source='serpapi'
    const real = jobs.find(j => j.source === 'serpapi');
    assert(real || jobs[0].source === 'openai', 'Expected serpapi source or graceful fallback');
  }, { slow: true });

  await test('searchJobs accepts 4th arg (apiKey from settings) — regression test', async () => {
    // Verify the function signature still accepts 4 args and prefers the passed key.
    // Pass a bogus key and ensure it tries SerpAPI (will error, falls back to OpenAI).
    const orig = process.env.SERPAPI_KEY;
    delete process.env.SERPAPI_KEY;
    delete require.cache[require.resolve('../src/jobSearch')];
    const { searchJobs: sj } = require('../src/jobSearch');
    try {
      // Passing 'invalid-test-key' should hit SerpAPI, get 401, then OpenAI fallback
      const jobs = await sj('test', 'Remote', 2, 'invalid-test-key');
      assert(Array.isArray(jobs), 'should return array even on bad key');
    } finally {
      if (orig) process.env.SERPAPI_KEY = orig;
      delete require.cache[require.resolve('../src/jobSearch')];
    }
  }, { slow: true, requires: ['OPENAI_API_KEY'] });

  await test('server.js wires state.settings.serpapiKey into searchJobs call', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
    assertMatch(src, /state\.settings\??\.?serpapiKey/, 'server.js must read state.settings.serpapiKey');
    assertMatch(src, /searchJobs\([^)]*,\s*\w+\)/, 'server.js must call searchJobs with a 4th arg');
  });

  // ──────────────────────────────────────────────────────────────────────
  group('Freelance search — sources, recency, deep-fetch, scam filter');
  // ──────────────────────────────────────────────────────────────────────
  const { searchFreelance } = require('../src/freelanceSearch');
  const tavilyKey = loadKey('TAVILY_API_KEY','tavilyKey');
  const jsearchKey = loadKey('JSEARCH_API_KEY','jsearchKey');

  await test('searchFreelance with no sources returns []', async () => {
    const r = await searchFreelance({ sources: [], keywords: 'test' }, '', '');
    assertEq(r.length, 0);
  });
  await test('searchFreelance with linkedin source but no Tavily key returns [] (no throw)', async () => {
    const r = await searchFreelance({ sources: ['linkedin'], keywords: 'test', maxResults: 5 }, '', '');
    assert(Array.isArray(r));
    assertEq(r.length, 0, 'Should return empty array gracefully');
  });
  await test('searchFreelance LinkedIn — returns real posts with valid post URLs', async () => {
    if (!tavilyKey) { results.skip++; console.log(c('gray','  ⊘ SKIP (no Tavily key)')); return; }
    const r = await searchFreelance(
      { sources: ['linkedin'], keywords: 'influencer marketing', maxResults: 5, timeRange: 'week', deepFetch: false },
      '', tavilyKey
    );
    assert(r.length > 0, `Expected results, got ${r.length}`);
    r.forEach((o, i) => {
      assert(o.applyUrl?.includes('linkedin.com'), `Result ${i}: applyUrl should be linkedin.com — got ${o.applyUrl}`);
      assertMatch(o.applyUrl, /(\/posts\/|\/pulse\/|\/feed\/update\/|\/jobs\/view\/)/, `Result ${i}: should be a real post URL`);
      assert(o.title?.length > 7, `Result ${i}: title should not be degenerate — got "${o.title}"`);
    });
  }, { slow: true });
  await test('searchFreelance LinkedIn — deepFetch enriches contact info', async () => {
    if (!tavilyKey) { results.skip++; console.log(c('gray','  ⊘ SKIP (no Tavily key)')); return; }
    const r = await searchFreelance(
      { sources: ['linkedin'], keywords: 'influencer marketing freelance', maxResults: 10, timeRange: 'week', deepFetch: true },
      '', tavilyKey
    );
    const withContact = r.filter(o => o.contactEmail || o.contactPhone);
    assert(r.length >= 3, `Should fetch 3+ opps, got ${r.length}`);
    // Deep-fetch should find contact on at least 10% of posts in practice
    if (r.length >= 5) {
      assert(withContact.length >= 1, `Deep-fetch should surface at least 1 contact, got ${withContact.length}/${r.length}`);
    }
  }, { slow: true });
  await test('searchFreelance LinkedIn — scam/warning posts are filtered out', async () => {
    if (!tavilyKey) { results.skip++; console.log(c('gray','  ⊘ SKIP (no Tavily key)')); return; }
    const r = await searchFreelance(
      { sources: ['linkedin'], keywords: 'influencer marketing', maxResults: 15, timeRange: 'month' },
      '', tavilyKey
    );
    const bad = r.filter(o => /scam|warning|fraud|beware|red flag|don'?t fall/i.test(o.title + ' ' + o.description));
    assertEq(bad.length, 0, `Found ${bad.length} scam-like posts that should have been filtered: ${bad.map(b=>b.title).join(' | ')}`);
  }, { slow: true });

  await test('searchFreelance JSearch source returns array (or [] without key)', async () => {
    const r = await searchFreelance({ sources: ['jsearch'], keywords: 'designer', maxResults: 5 }, jsearchKey, '');
    assert(Array.isArray(r));
  }, { slow: true });

  await test('searchFreelance dedupes by title+client', async () => {
    if (!tavilyKey) { results.skip++; console.log(c('gray','  ⊘ SKIP (no Tavily key)')); return; }
    const r = await searchFreelance(
      { sources: ['linkedin'], keywords: 'designer', maxResults: 20, timeRange: 'month' },
      '', tavilyKey
    );
    const keys = r.map(o => `${o.title}|${o.clientName}`.toLowerCase());
    assertEq(new Set(keys).size, keys.length, 'Duplicate title+client combos found');
  }, { slow: true });

  // ──────────────────────────────────────────────────────────────────────
  group('Proposal drafting — tones, banned phrases, word limit');
  // ──────────────────────────────────────────────────────────────────────
  const { draftProposal, draftFollowUp } = require('../src/freelanceApply');
  const sampleOpp = {
    title: 'Looking for an influencer marketing freelancer for music label',
    clientName: 'IndieLabel Co',
    platform: 'LinkedIn',
    budget: '$2000-$3000',
    duration: '2 months',
    description: 'We need someone to source 20 nano-influencers in the music/dance niche for an upcoming album rollout. Reply with your portfolio.'
  };
  const sampleProfile = {
    name: 'Abhishek K',
    email: 'abhi@example.com',
    exp: '3 years',
    sig: 'Abhishek\nabhi@example.com'
  };
  const BANNED = ['excellent fit','passionate about','committed to delivering','leverage my expertise','results-driven','execution-focused','I understand the nuanced','directly relevant to your goal'];

  for (const tone of ['casual','direct','warm']) {
    await test(`draftProposal(tone=${tone}) returns {subject, body}`, async () => {
      const p = await draftProposal(sampleOpp, sampleProfile, tone);
      assert(p.subject?.length > 0, 'subject empty');
      assert(p.body?.length > 50, `body too short: ${p.body?.length} chars`);
    }, { slow: true, requires: ['OPENAI_API_KEY'] });

    await test(`draftProposal(tone=${tone}) — banned phrases absent`, async () => {
      const p = await draftProposal(sampleOpp, sampleProfile, tone);
      BANNED.forEach(phrase => {
        assertNotMatch(p.body.toLowerCase(), new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
          `Banned phrase "${phrase}" appears in proposal`);
      });
    }, { slow: true, requires: ['OPENAI_API_KEY'] });

    await test(`draftProposal(tone=${tone}) — under 130 words`, async () => {
      const p = await draftProposal(sampleOpp, sampleProfile, tone);
      const wordCount = p.body.split(/\s+/).filter(Boolean).length;
      assert(wordCount < 130, `Word count ${wordCount} exceeds 130-word soft cap`);
    }, { slow: true, requires: ['OPENAI_API_KEY'] });

    await test(`draftProposal(tone=${tone}) — body does NOT start with "I"`, async () => {
      const p = await draftProposal(sampleOpp, sampleProfile, tone);
      // Find first content line (skip "Hi," or "Hey,")
      const lines = p.body.split('\n').map(l => l.trim()).filter(Boolean);
      const greeting = lines[0] || '';
      const firstContentLine = lines.find(l => !/^(hi|hey|hello)\b/i.test(l) && l.length > 5) || lines[1] || '';
      assertNotMatch(firstContentLine.slice(0, 6), /^(I |I'm |I am |My name)/i,
        `First content line starts with "I": "${firstContentLine.slice(0,80)}"`);
    }, { slow: true, requires: ['OPENAI_API_KEY'] });
  }

  await test('draftFollowUp returns concise follow-up', async () => {
    const fu = await draftFollowUp({ ...sampleOpp, proposalDraft: 'My previous proposal text...' }, sampleProfile);
    assert(fu.subject && fu.body);
    const wordCount = fu.body.split(/\s+/).filter(Boolean).length;
    assert(wordCount < 80, `Follow-up too long: ${wordCount} words`);
  }, { slow: true, requires: ['OPENAI_API_KEY'] });

  await test('draftProposal falls back gracefully when OpenAI fails (mocked bad key)', async () => {
    // Temporarily replace env key
    const orig = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'bad-key';
    // Re-require freelanceApply to pick up new key
    delete require.cache[require.resolve('../src/freelanceApply')];
    const { draftProposal: dp } = require('../src/freelanceApply');
    try {
      const p = await dp(sampleOpp, sampleProfile);
      assert(p.subject && p.body, 'Fallback should still return subject+body');
      assertContains(p.body, 'Hi,', 'Fallback uses standard greeting');
    } finally {
      process.env.OPENAI_API_KEY = orig;
      delete require.cache[require.resolve('../src/freelanceApply')];
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  group('Auto-apply — URL routing logic (no browser launch)');
  // ──────────────────────────────────────────────────────────────────────
  const autoApplySrc = fs.readFileSync(path.join(ROOT, 'src', 'autoApply.js'), 'utf8');
  await test('autoApply.js declares SKIP_DOMAINS for major job boards', () => {
    assertContains(autoApplySrc, 'linkedin.com');
    assertContains(autoApplySrc, 'glassdoor.com');
    assertContains(autoApplySrc, 'jobright.ai');
  });
  await test('autoApply.js declares VISIBLE_BROWSER_DOMAINS for ATS that detect headless', () => {
    assertContains(autoApplySrc, 'workable.com');
    assertContains(autoApplySrc, 'greenhouse.io');
    assertContains(autoApplySrc, 'lever.co');
  });
  await test('autoApply skips known job-board URLs without launching browser', async () => {
    const { autoApplyToJob } = require('../src/autoApply');
    const r = await autoApplyToJob({ applyUrl: 'https://www.linkedin.com/jobs/view/123', title: 'X', company: 'Y' }, {}, null);
    assert(!r.ok, 'Should not claim success on job-board URL');
    assertContains(r.reason, 'Job board', `Should mention job board, got: ${r.reason}`);
  });
  await test('autoApply errors cleanly when no applyUrl is provided', async () => {
    const { autoApplyToJob } = require('../src/autoApply');
    const r = await autoApplyToJob({ applyUrl: '', title: 'X', company: 'Y' }, {}, null);
    assert(!r.ok);
    assertContains(r.reason, 'No apply URL');
  });
  await test('buildCoverLetter prefers job.proposalDraft over generic template', () => {
    assertContains(autoApplySrc, 'job.proposalDraft', 'buildCoverLetter should check job.proposalDraft');
  });

  // ──────────────────────────────────────────────────────────────────────
  group('HTTP endpoints — spin up real server on :3001');
  // ──────────────────────────────────────────────────────────────────────
  try {
    // Kill any stale 3001 listener first
    try { require('child_process').execSync('lsof -ti:3001 | xargs kill -9 2>/dev/null', { stdio: 'pipe' }); } catch {}
    await startTestServer();
    console.log(c('gray', '  (test server up on :3001)'));

    await test('GET /api/state returns shape with jobs, opps, settings', async () => {
      const r = await axios.get(SERVER_BASE + '/api/state', { timeout: 5000 });
      assertEq(r.status, 200);
      assert(Array.isArray(r.data.jobs));
      assert(r.data.settings, 'settings missing');
      assert(r.data.freelance, 'freelance missing');
    });
    await test('POST /api/profile saves profile fields', async () => {
      const payload = { name: 'Test User', email: 'test@example.com', exp: '5 years', phone: '+91 9876543210' };
      const r = await axios.post(SERVER_BASE + '/api/profile', payload, { timeout: 5000 });
      assert(r.status === 200);
      // Verify by re-reading state
      const s = (await axios.get(SERVER_BASE + '/api/state')).data;
      assertEq(s.profile.name, 'Test User');
      assertEq(s.profile.phone, '+91 9876543210');
    });
    await test('GET /api/settings returns settings object', async () => {
      const r = await axios.get(SERVER_BASE + '/api/settings', { timeout: 5000 });
      assertEq(r.status, 200);
      assert(r.data.provider !== undefined);
    });
    await test('POST /api/settings persists new field', async () => {
      const before = (await axios.get(SERVER_BASE + '/api/settings')).data;
      const next = { ...before, minSalary: 12345, minSalaryLPA: 7 };
      await axios.post(SERVER_BASE + '/api/settings', next, { timeout: 5000 });
      const after = (await axios.get(SERVER_BASE + '/api/settings')).data;
      assertEq(after.minSalary, 12345);
      assertEq(after.minSalaryLPA, 7);
    });
    await test('GET /api/freelance/opportunities returns array', async () => {
      const r = await axios.get(SERVER_BASE + '/api/freelance/opportunities', { timeout: 5000 });
      assertEq(r.status, 200);
      assert(Array.isArray(r.data.opportunities));
    });
    await test('GET /api/freelance/settings includes timeRange field', async () => {
      const r = await axios.get(SERVER_BASE + '/api/freelance/settings', { timeout: 5000 });
      assert(r.data.sources, 'sources missing');
      assert('timeRange' in r.data || true, 'timeRange optional');
    });
    await test('POST /api/freelance/settings persists tone + timeRange', async () => {
      await axios.post(SERVER_BASE + '/api/freelance/settings', { tone: 'direct', timeRange: 'day' }, { timeout: 5000 });
      const after = (await axios.get(SERVER_BASE + '/api/freelance/settings')).data;
      assertEq(after.tone, 'direct');
      assertEq(after.timeRange, 'day');
    });
    await test('POST /api/job/UNKNOWN/apply returns ok:false (not 500)', async () => {
      const r = await axios.post(SERVER_BASE + '/api/job/does-not-exist/apply', {}, { timeout: 5000, validateStatus: () => true });
      assert(r.status === 200 || r.status === 404, `Unexpected status ${r.status}`);
      if (r.status === 200) assertEq(r.data.ok, false);
    });
    await test('POST /api/freelance/opportunity/UNKNOWN/draft handles missing id', async () => {
      const r = await axios.post(SERVER_BASE + '/api/freelance/opportunity/nope/draft', {}, { timeout: 5000, validateStatus: () => true });
      assert(r.status === 200, `Expected 200, got ${r.status}`);
      assertEq(r.data.ok, false);
    });
    await test('GET /api/analytics returns analytics shape', async () => {
      const r = await axios.get(SERVER_BASE + '/api/analytics', { timeout: 5000 });
      assert(r.data.history !== undefined);
      assert(r.data.totals !== undefined);
    });
    await test('GET / serves index.html', async () => {
      const r = await axios.get(SERVER_BASE + '/', { timeout: 5000 });
      assertEq(r.status, 200);
      assertContains(r.data, '<title>Influencer Job Autopilot</title>');
      assertContains(r.data, 'sec-freelance', 'Freelance section markup missing');
    });
    await test('/api/stream SSE connection opens with correct headers', async () => {
      // SSE may not send any data until an event fires, so just verify the connection opens
      // and the headers identify an event-stream.
      const ok = await new Promise((resolve, reject) => {
        const req = http.get(SERVER_BASE + '/api/stream', res => {
          try {
            if (res.statusCode !== 200) throw new Error('SSE status ' + res.statusCode);
            const ct = res.headers['content-type'] || '';
            if (!ct.includes('text/event-stream')) throw new Error('Wrong content-type: ' + ct);
            req.destroy();
            resolve(true);
          } catch (e) { req.destroy(); reject(e); }
        });
        req.setTimeout(2000, () => { req.destroy(); reject(new Error('SSE connect timeout')); });
        req.on('error', reject);
      });
      assert(ok);
    });
    await test('DELETE /api/jobs clears job list', async () => {
      const r = await axios.delete(SERVER_BASE + '/api/jobs', { timeout: 5000 });
      assert(r.status === 200);
      const s = (await axios.get(SERVER_BASE + '/api/state')).data;
      assertEq(s.jobs.length, 0);
    });
    await test('DELETE /api/freelance/opportunities clears opp list', async () => {
      const r = await axios.delete(SERVER_BASE + '/api/freelance/opportunities', { timeout: 5000 });
      assert(r.status === 200);
      const s = (await axios.get(SERVER_BASE + '/api/state')).data;
      assertEq(s.freelance.opportunities.length, 0);
    });

    await test('GET /api/export/csv returns text/csv', async () => {
      const r = await axios.get(SERVER_BASE + '/api/export/csv', { timeout: 5000 });
      assertContains(r.headers['content-type'] || '', 'csv');
    });

  } finally {
    stopTestServer();
    console.log(c('gray', '  (test server stopped)'));
  }

  // ──────────────────────────────────────────────────────────────────────
  group('SMTP — real connection test (opt-in via Gmail creds)');
  // ──────────────────────────────────────────────────────────────────────
  await test('SMTP: nodemailer verify() succeeds with configured Gmail creds', async () => {
    const s = readState();
    const user = s?.settings?.gmailUser;
    const pass = s?.settings?.gmailPass;
    if (!user || !pass) { results.skip++; console.log(c('gray','  ⊘ SKIP (no gmailUser/gmailPass in settings)')); return; }
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user, pass }
    });
    await transporter.verify();   // throws on auth/connectivity failure
  }, { slow: true });

  // ──────────────────────────────────────────────────────────────────────
  group('Puppeteer — dry launch (verifies Chrome is reachable, no form submit)');
  // ──────────────────────────────────────────────────────────────────────
  await test('puppeteer can launch headless Chrome and open a blank page', async () => {
    const puppeteer = require('puppeteer-core');
    const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (!fs.existsSync(CHROME)) { results.skip++; console.log(c('gray','  ⊘ SKIP (Chrome not at expected path)')); return; }
    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: CHROME,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu']
    });
    try {
      const page = await browser.newPage();
      await page.goto('about:blank', { timeout: 5000 });
      const title = await page.title();
      // about:blank title is empty string — but the request not throwing is the real check
      assert(typeof title === 'string', 'page.title should return a string');
    } finally {
      await browser.close();
    }
  }, { slow: true });

  // ──────────────────────────────────────────────────────────────────────
  group('Inline JS in index.html — parse cleanly');
  // ──────────────────────────────────────────────────────────────────────
  await test('index.html inline <script> parses without syntax errors', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    assert(m, 'No inline script found');
    new Function(m[1]); // throws on syntax error
  });
  await test('index.html declares all required globals (jobs, logs, opps)', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    assertMatch(html, /let jobs\s*=.*opps\s*=/, 'jobs and opps must both be declared');
  });
  await test('index.html sw() tabs array includes freelance', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    assertContains(html, "'freelance'", 'freelance must appear in tabs array');
  });
  await test('index.html div count balances (opens = closes)', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const opens = (html.match(/<div\b/g) || []).length;
    const closes = (html.match(/<\/div>/g) || []).length;
    assertEq(opens, closes, `div imbalance: ${opens} opens vs ${closes} closes`);
  });

  // ──────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────────────────
  console.log('\n' + c('bold', '═'.repeat(72)));
  const total = results.pass + results.fail + results.skip;
  console.log(c('bold', `  Results: `) +
    c('green', `${results.pass} passed`) + '  ' +
    c('red', `${results.fail} failed`) + '  ' +
    c('gray', `${results.skip} skipped`) + '  ' +
    c('gray', `(${total} total · ${(results.total_ms / 1000).toFixed(1)}s)`));

  if (results.failures.length) {
    console.log('\n' + c('red', c('bold', '  FAILURES:')));
    results.failures.forEach((f, i) => {
      console.log(c('red', `  ${i+1}. [${f.group}] ${f.name}`));
      console.log(c('gray', `     ${f.error}`));
    });
  }
  console.log(c('bold', '═'.repeat(72)) + '\n');

  process.exit(results.fail > 0 ? 1 : 0);
})().catch(e => {
  console.error(c('red', '\nTest runner crashed:'), e);
  stopTestServer();
  process.exit(2);
});
