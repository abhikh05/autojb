// Central registry mapping apply URLs / sources to a platform + capability.
// Adding a new auto-apply adapter? Add its domain(s) here and set autoApply: true.

export type PlatformKind =
  | 'indeed'
  | 'linkedin'
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'workable'
  | 'ashby'
  | 'smartrecruiters'
  | 'upwork'
  | 'fiverr'
  | 'contra'
  | 'company'
  | 'email'
  | 'unknown';

export type Platform = {
  kind: PlatformKind;
  name: string;
  autoApply: boolean;
  color: 'violet' | 'cyan' | 'neon' | 'amber' | 'muted';
  domains: string[];
};

export const PLATFORMS: Record<PlatformKind, Platform> = {
  indeed:          { kind: 'indeed',          name: 'Indeed',              autoApply: true,  color: 'cyan',   domains: ['indeed.com'] },
  linkedin:        { kind: 'linkedin',        name: 'LinkedIn Easy Apply', autoApply: true,  color: 'cyan',   domains: ['linkedin.com/jobs', 'linkedin.com'] },
  greenhouse:      { kind: 'greenhouse',      name: 'Greenhouse',          autoApply: true,  color: 'neon',   domains: ['greenhouse.io', 'boards.greenhouse.io'] },
  lever:           { kind: 'lever',           name: 'Lever',               autoApply: true,  color: 'neon',   domains: ['lever.co', 'jobs.lever.co'] },
  workday:         { kind: 'workday',         name: 'Workday',             autoApply: true,  color: 'neon',   domains: ['myworkdayjobs.com', 'workday.com'] },
  workable:        { kind: 'workable',        name: 'Workable',            autoApply: true,  color: 'neon',   domains: ['workable.com', 'apply.workable.com'] },
  ashby:           { kind: 'ashby',           name: 'Ashby',               autoApply: true,  color: 'neon',   domains: ['ashbyhq.com', 'jobs.ashbyhq.com'] },
  smartrecruiters: { kind: 'smartrecruiters', name: 'SmartRecruiters',     autoApply: true,  color: 'neon',   domains: ['smartrecruiters.com'] },
  upwork:          { kind: 'upwork',          name: 'Upwork',              autoApply: true,  color: 'violet', domains: ['upwork.com'] },
  fiverr:          { kind: 'fiverr',          name: 'Fiverr',              autoApply: true,  color: 'violet', domains: ['fiverr.com'] },
  contra:          { kind: 'contra',          name: 'Contra',              autoApply: true,  color: 'violet', domains: ['contra.com'] },
  company:         { kind: 'company',         name: 'Company site',        autoApply: false, color: 'amber',  domains: [] },
  email:           { kind: 'email',           name: 'Email',               autoApply: false, color: 'amber',  domains: [] },
  unknown:         { kind: 'unknown',         name: 'External',            autoApply: false, color: 'muted',  domains: [] }
};

export type ApplyMode = 'auto' | 'manual';

export type Classified = {
  platform: Platform;
  mode: ApplyMode;
  href: string; // best URL to use (empty for email-only)
};

/**
 * Classify a job/opportunity by its apply URL or email.
 * Order matters: check most specific host paths first (e.g., linkedin.com/jobs before linkedin.com).
 */
export function classifyApply(input: { applyUrl?: string | null; email?: string | null; source?: string | null }): Classified {
  const url = (input.applyUrl || '').trim();
  const email = (input.email || '').trim();

  if (url) {
    const lower = url.toLowerCase();
    for (const kind of Object.keys(PLATFORMS) as PlatformKind[]) {
      const p = PLATFORMS[kind];
      if (p.domains.some(d => lower.includes(d))) {
        return { platform: p, mode: p.autoApply ? 'auto' : 'manual', href: url };
      }
    }
    // URL present but no known platform → assume company career site, manual.
    return { platform: PLATFORMS.company, mode: 'manual', href: url };
  }

  if (email) {
    return { platform: PLATFORMS.email, mode: 'manual', href: `mailto:${email}` };
  }

  return { platform: PLATFORMS.unknown, mode: 'manual', href: '' };
}

export function pillClassFor(color: Platform['color']) {
  return {
    violet: 'pill-violet',
    cyan: 'pill-cyan',
    neon: 'pill-neon',
    amber: 'pill-amber',
    muted: 'pill-muted'
  }[color];
}
