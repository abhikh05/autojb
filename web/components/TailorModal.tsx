'use client';
import { useEffect, useState } from 'react';
import { X, Loader2, Copy, Check, Sparkles, Bot, ExternalLink } from 'lucide-react';

type Job = {
  id: string; title: string; company: string; description?: string;
  location?: string; tags?: string[]; applyUrl?: string;
  platform: { kind: string; name: string; autoApply: boolean };
};

type Tailored = {
  summary: string;
  coverLetter: string;
  keyPoints: string[];
  matchScore: number | null;
  source: 'openai' | 'template';
};

export function TailorModal({ job, onClose, onApply }: {
  job: Job; onClose: () => void; onApply: () => void;
}) {
  const [data, setData] = useState<Tailored | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(new URL('/api/tailor', window.location.origin).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job })
        });
        if (!r.ok) throw new Error(`Server: ${r.status}`);
        setData(await r.json());
      } catch (e: any) {
        setError(e?.message || 'Tailoring failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [job]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(null), 1200);
    } catch {}
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-white/5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-mono uppercase tracking-widest text-muted">AI TAILORING</div>
            <div className="text-ink font-medium truncate">{job.title}</div>
            <div className="text-[12px] text-muted2 truncate">{job.company} · {job.location || 'Remote'}</div>
          </div>
          {data?.matchScore != null && (
            <span className="pill pill-neon shrink-0">
              <Sparkles className="w-3 h-3" /> {data.matchScore}% match
            </span>
          )}
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && (
            <div className="flex items-center gap-3 text-muted2 py-8">
              <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
              Tailoring your pitch for {job.company}…
            </div>
          )}

          {error && !loading && (
            <div className="pill pill-amber inline-flex">Tailoring failed: {error}</div>
          )}

          {data && !loading && (
            <>
              <Section
                title="Resume summary"
                text={data.summary}
                onCopy={() => copy(data.summary, 'summary')}
                copied={copied === 'summary'}
              />
              <Section
                title="Cover letter"
                text={data.coverLetter}
                onCopy={() => copy(data.coverLetter, 'letter')}
                copied={copied === 'letter'}
                multiline
              />
              {data.keyPoints && data.keyPoints.length > 0 && (
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-widest text-muted mb-2">Key points</div>
                  <ul className="space-y-1.5">
                    {data.keyPoints.map((p, i) => (
                      <li key={i} className="text-[13px] text-muted2 flex items-start gap-2">
                        <span className="text-violet-400 mt-1">•</span> {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="text-[11px] font-mono text-muted flex items-center gap-2 pt-1">
                <span className={data.source === 'openai' ? 'text-neon' : 'text-amber'}>●</span>
                Generated via {data.source === 'openai' ? 'OpenAI' : 'template fallback (no OPENAI_API_KEY)'}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/5 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[12px] text-muted2">
            Review, tweak, then apply.
          </span>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={onClose}>Close</button>
            {job.applyUrl && (
              <a href={job.applyUrl} target="_blank" rel="noreferrer" className="btn">
                <ExternalLink className="w-3.5 h-3.5" /> Open job
              </a>
            )}
            <button
              className={`btn ${job.platform.autoApply ? 'btn-primary' : ''}`}
              onClick={onApply}
              disabled={loading}
            >
              {job.platform.autoApply ? <Bot className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
              {job.platform.autoApply ? `Auto-apply · ${job.platform.name}` : 'Apply manually'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, text, onCopy, copied, multiline }: {
  title: string; text: string; onCopy: () => void; copied: boolean; multiline?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-mono uppercase tracking-widest text-muted">{title}</div>
        <button className="btn btn-sm btn-ghost" onClick={onCopy}>
          {copied ? <Check className="w-3 h-3 text-neon" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className={`text-[13px] text-ink leading-relaxed rounded-xl bg-white/[0.03] border border-white/10 p-4 ${multiline ? 'whitespace-pre-wrap' : ''}`}>
        {text}
      </div>
    </div>
  );
}
