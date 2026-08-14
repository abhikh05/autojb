const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../state.json');

const DEFAULT_STATE = {
  running: false,
  profile: {},
  jobs: [],
  logs: [],
  stats: { found: 0, relevant: 0, emailed: 0, applied: 0, skipped: 0 },
  lastConfig: {},
  runHistory: [],
  resumePath: null,
  freelance: {
    running: false,
    opportunities: [],
    stats: { found: 0, sent: 0, inDiscussion: 0, won: 0 },
    settings: {
      sources: ['linkedin', 'jsearch', 'internshala'],
      keywords: 'influencer marketing freelance',
      maxResults: 20,
      minBudget: 0,
      timeRange: 'week',
      autoSendProposal: false,
      skipSentOpportunities: true
    }
  },
  settings: {
    provider: 'gmail',
    gmailUser: '',
    gmailPass: '',
    smtpHost: '',
    smtpPort: '587',
    smtpSecure: false,
    jsearchKey: '',
    serpapiKey: '',
    tavilyKey: '',
    blacklist: [],
    autoRunHours: 0,
    notifyOnComplete: true,
    minSalary: 0,
    minSalaryLPA: 0,
    skipAppliedCompanies: true
  },
  appliedCompanies: [],
  // Persistent library of jobs the user acted on. Keyed by stable job fingerprint
  // (company + title) so restarting or re-searching doesn't lose your history.
  library: {
    starred: {},   // { fingerprint: JobSnapshot }
    applied: {},   // { fingerprint: { at: iso, method: 'auto'|'manual', platform: string, ...JobSnapshot } }
    dismissed: {}  // { fingerprint: at }
  }
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return {
        ...DEFAULT_STATE,
        ...data,
        settings: { ...DEFAULT_STATE.settings, ...(data.settings || {}) },
        freelance: {
          ...DEFAULT_STATE.freelance,
          ...(data.freelance || {}),
          settings: { ...DEFAULT_STATE.freelance.settings, ...(data.freelance?.settings || {}) },
          stats: { ...DEFAULT_STATE.freelance.stats, ...(data.freelance?.stats || {}) },
          running: false
        },
        library: {
          starred: (data.library?.starred) || {},
          applied: (data.library?.applied) || {},
          dismissed: (data.library?.dismissed) || {}
        },
        running: false
      };
    }
  } catch (e) {
    console.warn('[State] Could not load state.json, starting fresh');
  }
  return { ...DEFAULT_STATE };
}

function saveRun(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn('[State] Could not save state:', e.message);
  }
}

module.exports = { loadState, saveRun };
