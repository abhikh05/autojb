'use client';
/**
 * Simple search page. One button. One request. Results.
 * No SSE, no polling, no state.jobs pipeline. Fetch → set state → render.
 */
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { TailorModal } from '@/components/TailorModal';
import {
  Search as SearchIcon, MapPin, Bot, ExternalLink, Loader2, Sparkles,
  Zap, ArrowUpDown, Check, X, Star, Play, AlertTriangle, FileText
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────
type ApplyMode = 'auto' | 'assisted' | 'manual';
type Platform = { kind: string; name: string; autoApply: boolean; applyMode: ApplyMode };
type Job = {
  id: string; title: string; company: string; location?: string;
  remote?: boolean; salary?: string | null; posted?: string; postedAt?: number;
  description?: string; applyUrl?: string; tags?: string[]; source?: string;
  platform: Platform;
  applied?: boolean; starred?: boolean;
};
type Sources = { remotive?: number; remoteok?: number; arbeitnow?: number };

type SortKey = 'newest' | 'auto-first' | 'company';

// ── Common searches for quick access ─────────────────────────
const QUICK = [
  'Python Developer', 'React Developer', 'Node.js Developer', 'Full Stack Engineer',
  'Product Manager', 'Data Scientist', 'DevOps Engineer', 'Marketing Manager',
  'UGC Creator', 'Influencer Marketing', 'Customer Success', 'Sales'
];

export default function SearchPage() {
  const [keywords, setKeywords] = useState('');
  const [location, setLocation] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [autoOnly, setAutoOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('auto-first');
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Sources>({});
  const [tookMs, setTookMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Local UI state
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [starred, setStarred] = useState<Record<string, boolean>>({});
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [tailorJob, setTailorJob] = useState<Job | null>(null);

  // Load persistent library from backend on mount.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(new URL('/api/library', window.location.origin).toString());
        if (!r.ok) return;
        const lib = await r.json();
        const starredFps = Object.keys(lib.starred || {});
        const appliedFps = Object.keys(lib.applied || {});
        // starred/applied maps use job.id but library uses fingerprint;
        // we store both so JobRow can look up by id after render matches.
        setStarred(Object.fromEntries(starredFps.map(fp => [fp, true])));
        setApplied(Object.fromEntries(appliedFps.map(fp => [fp, true])));
      } catch {}
    })();
  }, []);

  const fingerprint = (j: Job) => `${(j.company || '').toLowerCase().trim()}|${(j.title || '').toLowerCase().trim()}`;

  const runSearch = async (overrideKeywords?: string) => {
    const kw = (overrideKeywords ?? keywords).trim();
    if (!kw) { setError('Type a role or keyword first'); return; }

    setLoading(true);
    setError(null);
    setJobs([]);
    setTookMs(null);
    if (overrideKeywords !== undefined) setKeywords(overrideKeywords);

    try {
      const res = await fetch(new URL('/api/search', window.location.origin).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: kw, location, remote: remoteOnly, limit: 80 })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Search failed');
      setJobs(data.jobs || []);
      setSources(data.sources || {});
      setTookMs(data.tookMs ?? null);
      if ((data.jobs || []).length === 0) setError('No results in the last 7 days. Try a different keyword or turn off filters.');
    } catch (e: any) {
      setError(e?.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  // Client-side sort + auto/manual filter
  const shown = useMemo(() => {
    let list = jobs;
    if (autoOnly) list = list.filter(j => j.platform.autoApply);
    return list.slice().sort((a, b) => {
      if (sortBy === 'auto-first') {
        const ax = a.platform.autoApply ? 0 : 1;
        const bx = b.platform.autoApply ? 0 : 1;
        if (ax !== bx) return ax - bx;
        return (b.postedAt || 0) - (a.postedAt || 0);
      }
      if (sortBy === 'company') return (a.company || '').localeCompare(b.company || '');
      return (b.postedAt || 0) - (a.postedAt || 0);
    });
  }, [jobs, autoOnly, sortBy]);

  const autoCount = jobs.filter(j => j.platform.applyMode === 'auto').length;
  const assistedCount = jobs.filter(j => j.platform.applyMode === 'assisted').length;
  const manualCount = jobs.filter(j => j.platform.applyMode === 'manual').length;

  const markLocalApplied = (job: Job) => {
    const fp = fingerprint(job);
    setApplied(a => ({ ...a, [job.id]: true, [fp]: true }));
  };

  const persistApplied = async (job: Job, method: 'auto' | 'manual') => {
    // Backend records this in state.library.applied (fingerprint keyed)
    await fetch(new URL('/api/search/apply', window.location.origin).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job, method, confirmed: true })
    }).catch(() => {});
  };

  const applyOne = async (job: Job) => {
    const mode = job.platform.applyMode;

    // ── MANUAL ── just open, no marking
    if (mode === 'manual') {
      if (job.applyUrl) window.open(job.applyUrl, '_blank', 'noopener');
      return;
    }

    // ── ASSISTED ── open on platform, then ask user to confirm they applied
    if (mode === 'assisted') {
      if (job.applyUrl) window.open(job.applyUrl, '_blank', 'noopener');
      // Small delay so the new tab has time to focus before the confirm dialog
      setTimeout(() => {
        const ok = window.confirm(
          `Opened on ${job.platform.name}.\n\n` +
          `Did you complete the application? Click OK to mark it as applied, or Cancel to leave it open.`
        );
        if (ok) {
          markLocalApplied(job);
          persistApplied(job, 'manual');
        }
      }, 800);
      return;
    }

    // ── AUTO ── real server-side form-fill
    setApplyingId(job.id);
    try {
      const r = await fetch(new URL('/api/search/apply', window.location.origin).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job })
      });
      const data = await r.json();
      if (data?.ok) {
        markLocalApplied(job);
      } else {
        const openIt = window.confirm(
          `Auto-apply couldn't complete: ${data?.reason || 'unknown error'}\n\n` +
          `Want to open the listing to apply manually?`
        );
        if (openIt && job.applyUrl) window.open(job.applyUrl, '_blank', 'noopener');
      }
    } catch (e: any) {
      alert('Auto-apply request failed: ' + (e?.message || e));
    } finally {
      setApplyingId(null);
    }
  };

  const toggleStar = async (job: Job) => {
    const fp = fingerprint(job);
    // Optimistic
    setStarred(s => ({ ...s, [job.id]: !s[job.id], [fp]: !s[job.id] }));
    await fetch(new URL('/api/library/star', window.location.origin).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job })
    }).catch(() => {});
  };

  const autoApplyAll = async () => {
    // Only true auto-apply — never mass-open LinkedIn/Indeed tabs
    const targets = shown.filter(j => j.platform.applyMode === 'auto' && !applied[j.id]);
    if (!targets.length) return alert('No true auto-apply jobs in this view (Greenhouse, Lever, Ashby, Workable). Assisted jobs like LinkedIn need one click each.');
    if (!confirm(`Auto-apply to ${targets.length} jobs? The server will fill each ATS form and submit. Takes ~30s per job.`)) return;
    for (const j of targets) await applyOne(j);
  };

  return (
    <div>
      <PageHeader
        eyebrow="DISCOVERY"
        title="Job Search"
        subtitle="Real jobs from LinkedIn, Remotive, RemoteOK, Arbeitnow, Jobicy, Himalayas and WeWorkRemotely. Posted this week."
        actions={
          <button className="btn btn-neon" onClick={autoApplyAll} disabled={loading || autoCount === 0}>
            <Zap className="w-3.5 h-3.5" /> Auto-apply all ({autoCount})
          </button>
        }
      />

      {/* MAIN SEARCH BAR */}
      <div className="glass p-4 sm:p-5 mb-4 space-y-3">
        <div className="flex gap-2 items-stretch">
          <div className="relative flex-1">
            <SearchIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              className="input pl-10"
              placeholder="Search real jobs (e.g. python developer, product designer)…"
              value={keywords}
              onChange={e => setKeywords(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
              autoFocus
              autoComplete="off"
            />
          </div>
          <button
            className="btn btn-primary px-5"
            onClick={() => runSearch()}
            disabled={loading || !keywords.trim()}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        {/* Secondary filters */}
        <div className="flex items-center gap-3 flex-wrap text-[13px]">
          <div className="relative flex-1 min-w-[180px]">
            <MapPin className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              className="input pl-10 py-2"
              placeholder="Location (e.g. Berlin, India, US)"
              value={location}
              onChange={e => setLocation(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg border border-white/10 hover:bg-white/[0.03]">
            <input type="checkbox" checked={remoteOnly} onChange={e => setRemoteOnly(e.target.checked)} className="accent-violet-500" />
            <span className="text-ink">Remote only</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg border border-white/10 hover:bg-white/[0.03]" title="Only show jobs where the server can fully fill and submit the form">
            <input type="checkbox" checked={autoOnly} onChange={e => setAutoOnly(e.target.checked)} className="accent-neon" />
            <Bot className="w-3.5 h-3.5 text-neon" />
            <span className="text-ink">True auto-apply only</span>
          </label>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-3.5 h-3.5 text-muted" />
            <select className="input w-auto py-2" value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)}>
              <option value="auto-first">Auto-apply first</option>
              <option value="newest">Newest first</option>
              <option value="company">Company A→Z</option>
            </select>
          </div>
          <span className="pill pill-cyan ml-auto">last 7 days</span>
        </div>
      </div>

      {/* QUICK PICKS */}
      {jobs.length === 0 && !loading && (
        <div className="glass p-4 mb-4">
          <div className="text-[11px] font-mono uppercase tracking-widest text-muted mb-2">Try a quick search</div>
          <div className="flex flex-wrap gap-2">
            {QUICK.map(q => (
              <button
                key={q}
                onClick={() => runSearch(q)}
                className="pill hover:border-violet-500/50 hover:text-ink hover:bg-violet-500/10 cursor-pointer transition"
              >
                <Sparkles className="w-3 h-3" /> {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ERROR */}
      {error && !loading && (
        <div className="glass p-4 mb-4 border border-amber/40 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber shrink-0 mt-0.5" />
          <div className="text-sm text-ink">{error}</div>
        </div>
      )}

      {/* LOADING */}
      {loading && (
        <div className="glass p-6 mb-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl border border-white/10 bg-white/[0.03] flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
          </div>
          <div className="flex-1">
            <div className="text-ink text-sm">Searching Remotive, RemoteOK and Arbeitnow…</div>
            <div className="h-1 mt-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 via-cyan-400 to-neon"
                style={{ width: '30%', animation: 'shimmer 1.6s ease-in-out infinite' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* RESULTS META */}
      {!loading && jobs.length > 0 && (
        <div className="flex items-center gap-3 mb-3 text-[12px] text-muted2 flex-wrap">
          <span className="text-ink font-medium">{shown.length} results</span>
          <span>·</span>
          <span title="Server fills the form for you (Greenhouse, Lever, Ashby, Workable)">Auto <b className="text-neon">{autoCount}</b></span>
          <span>·</span>
          <span title="You sign in on the platform once, then applying is one click (LinkedIn, Indeed)">1-click <b className="text-cyan-400">{assistedCount}</b></span>
          <span>·</span>
          <span title="External link to the company site — you fill the form yourself">Manual <b className="text-amber">{manualCount}</b></span>
          {tookMs != null && <><span>·</span><span className="font-mono">{tookMs}ms</span></>}
        </div>
      )}

      {/* RESULTS */}
      <div className="space-y-3">
        {shown.map(job => {
          const fp = fingerprint(job);
          return (
            <JobRow
              key={job.id}
              job={job}
              applying={applyingId === job.id}
              applied={!!(applied[job.id] || applied[fp])}
              starred={!!(starred[job.id] || starred[fp])}
              onApply={() => applyOne(job)}
              onStar={() => toggleStar(job)}
              onTailor={() => setTailorJob(job)}
            />
          );
        })}
      </div>

      {tailorJob && (
        <TailorModal job={tailorJob} onClose={() => setTailorJob(null)} onApply={() => { applyOne(tailorJob); setTailorJob(null); }} />
      )}
    </div>
  );
}

// ── Job row ──────────────────────────────────────────────────
function JobRow({ job, applying, applied, starred, onApply, onStar, onTailor }: {
  job: Job; applying: boolean; applied: boolean; starred: boolean;
  onApply: () => void; onStar: () => void; onTailor: () => void;
}) {
  const mode = job.platform.applyMode;
  const modePill =
    mode === 'auto'     ? { cls: 'pill-neon',   Icon: Bot,          label: 'AUTO-APPLY' } :
    mode === 'assisted' ? { cls: 'pill-cyan',   Icon: ExternalLink, label: `1-CLICK · ${job.platform.name.toUpperCase()}` } :
                          { cls: 'pill-amber',  Icon: ExternalLink, label: 'MANUAL' };
  return (
    <div className="glass p-4 sm:p-5 hover:border-white/[0.14] transition-all">
      <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
        <div className="min-w-0 flex-1 w-full">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`pill ${modePill.cls}`}>
              <modePill.Icon className="w-3 h-3" />
              {job.platform.name}
            </span>
            <span className={`pill ${modePill.cls}`}>{modePill.label}</span>
            {job.remote && <span className="pill pill-cyan">remote</span>}
            {job.posted && <span className="text-[11px] text-muted font-mono">{job.posted}</span>}
          </div>
          <h3 className="text-base sm:text-lg font-semibold text-ink">{job.title}</h3>
          <div className="flex items-center gap-3 text-sm text-muted2 mt-1 flex-wrap">
            <span className="font-medium text-ink/90">{job.company}</span>
            {job.location && <><span className="text-muted">·</span><span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span></>}
            {job.salary && <><span className="text-muted">·</span><span className="text-cyan-400 num">{job.salary}</span></>}
          </div>
          {job.description && (
            <p className="text-[13px] text-muted2 mt-3 line-clamp-2 leading-relaxed">{job.description}</p>
          )}
          {job.tags && job.tags.length > 0 && (
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              {job.tags.slice(0, 6).map(t => (
                <span key={t} className="text-[10px] font-mono text-muted2 border border-white/10 bg-white/[0.02] px-2 py-0.5 rounded">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex sm:flex-col items-end gap-2 shrink-0 w-full sm:w-auto justify-end">
          {applied ? (
            <span className="btn text-neon border-neon/40 bg-neon/10 pointer-events-none">
              <Check className="w-3.5 h-3.5" /> Applied
            </span>
          ) : mode === 'auto' ? (
            <button className="btn btn-primary" onClick={onApply} disabled={applying}>
              {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
              {applying ? 'Applying…' : `Auto-apply · ${job.platform.name}`}
            </button>
          ) : mode === 'assisted' ? (
            <button className="btn btn-neon" onClick={onApply} title={`Opens ${job.platform.name} in a new tab — sign in there once and applying is one click`}>
              <ExternalLink className="w-3.5 h-3.5" /> Open on {job.platform.name}
            </button>
          ) : (
            <button className="btn" onClick={onApply}>
              <ExternalLink className="w-3.5 h-3.5" /> Apply on site
            </button>
          )}
          <div className="flex items-center gap-1">
            <button className="btn btn-sm btn-ghost" onClick={onTailor} title="AI tailor for this job">
              <FileText className="w-3.5 h-3.5 text-violet-400" />
            </button>
            <button className="btn btn-sm btn-ghost" onClick={onStar} title="Star">
              <Star className={`w-3.5 h-3.5 ${starred ? 'fill-amber text-amber' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
