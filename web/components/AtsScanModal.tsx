'use client';
import { useEffect, useState } from 'react';
import { X, Loader2, CheckCircle2, XCircle, ScanSearch, Zap, AlertTriangle } from 'lucide-react';

type Check = { id: string; label: string; ok: boolean; weight: number };
type Health = { score: number; grade: string; wordCount: number; checks: Check[] };
type Match = {
  matchScore: number;
  matchedKeywords?: string[];
  missingKeywords?: string[];
  matchedResponsibilities?: string[];
  gaps?: string[];
  quickFixes?: string[];
  verdict?: string;
  source?: 'openai' | 'keyword-fallback';
};
type ScanResult = {
  kind: 'per-job' | 'health-only';
  job?: { title: string; company: string; platform?: string };
  match?: Match;
  health: Health;
  resumeChars: number;
};

export function AtsScanModal({ job, onClose }: {
  job?: { id: string; title: string; company: string; description?: string; tags?: string[]; platform?: { name: string } } | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(new URL('/api/ats/scan', window.location.origin).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job: job || undefined })
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err?.error || `Scan failed (${r.status})`);
        }
        setData(await r.json());
      } catch (e: any) {
        setError(e?.message || 'Scan failed');
      } finally { setLoading(false); }
    })();
  }, [job]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-strong w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-white/5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-neon to-cyan-500 flex items-center justify-center shrink-0">
            <ScanSearch className="w-4 h-4 text-void" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-mono uppercase tracking-widest text-muted">ATS SCANNER</div>
            <div className="text-ink font-medium truncate">
              {job ? `${job.title} · ${job.company}` : 'Resume health check'}
            </div>
            <div className="text-[12px] text-muted2">
              {job ? 'How your resume matches this specific job' : 'General ATS-friendliness'}
            </div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && (
            <div className="flex items-center gap-3 text-muted2 py-8">
              <Loader2 className="w-4 h-4 animate-spin text-neon" />
              Parsing your resume and analyzing…
            </div>
          )}

          {error && !loading && (
            <div className="glass p-4 border border-amber/40 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber shrink-0 mt-0.5" />
              <div className="text-sm text-ink">{error}</div>
            </div>
          )}

          {data && !loading && (
            <>
              {/* JOB MATCH SCORE (if per-job) */}
              {data.match && (
                <ScoreCard
                  score={data.match.matchScore}
                  label="Job match"
                  subtitle={data.match.verdict}
                  color="violet"
                />
              )}

              {/* HEALTH SCORE */}
              <ScoreCard
                score={data.health.score}
                label={`ATS health · Grade ${data.health.grade}`}
                subtitle={`${data.health.wordCount} words scanned`}
                color="neon"
              />

              {/* MATCHED / MISSING KEYWORDS */}
              {data.match && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <KeywordList
                    title="Matched keywords"
                    icon={CheckCircle2}
                    color="text-neon"
                    words={data.match.matchedKeywords || []}
                    emptyMsg="No matches — this JD may not use standard keywords"
                  />
                  <KeywordList
                    title="Missing keywords"
                    icon={XCircle}
                    color="text-amber"
                    words={data.match.missingKeywords || []}
                    emptyMsg="Nothing critical missing"
                  />
                </div>
              )}

              {/* GAPS */}
              {data.match?.gaps && data.match.gaps.length > 0 && (
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-widest text-muted mb-2">Gaps</div>
                  <ul className="space-y-1.5">
                    {data.match.gaps.map((g, i) => (
                      <li key={i} className="text-[13px] text-muted2 flex items-start gap-2">
                        <span className="text-amber mt-1">•</span> {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* QUICK FIXES */}
              {data.match?.quickFixes && data.match.quickFixes.length > 0 && (
                <div className="glass p-4 border-violet-500/20">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="w-4 h-4 text-violet-400" />
                    <div className="text-[11px] font-mono uppercase tracking-widest text-violet-400">Quick fixes</div>
                  </div>
                  <ol className="space-y-2">
                    {data.match.quickFixes.map((f, i) => (
                      <li key={i} className="text-[13px] text-ink flex items-start gap-2">
                        <span className="text-violet-400 font-mono text-[11px] mt-0.5">{String(i + 1).padStart(2, '0')}</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* HEALTH CHECKS */}
              <div>
                <div className="text-[11px] font-mono uppercase tracking-widest text-muted mb-3">Resume checks</div>
                <div className="space-y-1.5">
                  {data.health.checks.map(c => (
                    <div key={c.id} className="flex items-center gap-2 text-[13px]">
                      {c.ok
                        ? <CheckCircle2 className="w-4 h-4 text-neon shrink-0" />
                        : <XCircle className="w-4 h-4 text-amber shrink-0" />}
                      <span className={c.ok ? 'text-ink' : 'text-muted2'}>{c.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* SOURCE FOOTER */}
              <div className="text-[11px] font-mono text-muted flex items-center gap-2 pt-1">
                <span className={data.match?.source === 'openai' ? 'text-neon' : 'text-amber'}>●</span>
                {data.match
                  ? (data.match.source === 'openai'
                      ? 'Analyzed via OpenAI · resume compared to job description'
                      : 'Keyword-match fallback (no OPENAI_API_KEY)')
                  : 'Rule-based ATS health check'}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/5 flex items-center justify-between gap-3">
          <span className="text-[12px] text-muted2">
            Tip: real ATS systems favor plain text, standard section names, and quantified achievements.
          </span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function ScoreCard({ score, label, subtitle, color }: {
  score: number; label: string; subtitle?: string; color: 'violet' | 'neon';
}) {
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  const barCls = color === 'neon' ? 'from-neon to-cyan-400' : 'from-violet-500 to-cyan-400';
  const ringCls = color === 'neon' ? 'border-neon/40 text-neon' : 'border-violet-500/40 text-violet-400';
  return (
    <div className="glass p-5 flex items-center gap-5">
      <div className={`w-16 h-16 rounded-2xl border ${ringCls} bg-white/[0.03] flex items-center justify-center flex-col`}>
        <div className="text-2xl font-bold num leading-none">{score}</div>
        <div className="text-[9px] font-mono opacity-70">SCORE</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-ink font-medium">{label}</div>
        {subtitle && <div className="text-[12px] text-muted2 mt-0.5">{subtitle}</div>}
        <div className="h-1.5 mt-3 rounded-full bg-white/5 overflow-hidden">
          <div className={`h-full bg-gradient-to-r ${barCls}`} style={{ width: `${Math.max(2, score)}%` }} />
        </div>
      </div>
    </div>
  );
}

function KeywordList({ title, icon: Icon, color, words, emptyMsg }: {
  title: string; icon: any; color: string; words: string[]; emptyMsg: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-mono uppercase tracking-widest text-muted mb-2 flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        {title} · {words.length}
      </div>
      {words.length === 0 ? (
        <div className="text-[12px] text-muted2 italic">{emptyMsg}</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {words.slice(0, 25).map((w, i) => (
            <span key={i} className={`text-[11px] font-mono ${color} border border-current/30 bg-current/5 px-2 py-0.5 rounded-md`}>
              {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
