'use client';
import { useEffect, useState } from 'react';
import { X, Loader2, Copy, Check, Mail, FileText, AlertTriangle } from 'lucide-react';

type Mode = 'cover' | 'email';
type EmailResp = { ok: boolean; to?: string; subject?: string; body?: string; source?: string; reason?: string };
type CoverResp = { letter: string; source: string };

export function CoverLetterModal({ job, mode, onClose }: {
  job: { id: string; title: string; company: string; description?: string };
  mode: Mode;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [letter, setLetter] = useState<string>('');
  const [emailData, setEmailData] = useState<EmailResp | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const path = mode === 'cover' ? '/api/cover-letter' : '/api/email-draft';
        const r = await fetch(new URL(path, window.location.origin).toString(), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
        if (mode === 'cover') setLetter((d as CoverResp).letter || '');
        else setEmailData(d as EmailResp);
      } catch (e: any) { setError(e?.message || 'Generation failed'); }
      finally { setLoading(false); }
    })();
  }, [job, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async (text: string, tag: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(null), 1200); } catch {}
  };

  const noEmail = mode === 'email' && emailData && !emailData.ok;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-strong w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-white/5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center shrink-0">
            {mode === 'cover' ? <FileText className="w-4 h-4 text-white" /> : <Mail className="w-4 h-4 text-white" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-mono uppercase tracking-widest text-muted">
              {mode === 'cover' ? 'COVER LETTER' : 'OUTREACH EMAIL'}
            </div>
            <div className="text-ink font-medium truncate">{job.title} · {job.company}</div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex items-center gap-3 text-muted2 py-8">
              <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
              {mode === 'cover' ? 'Writing your cover letter…' : 'Drafting an email…'}
            </div>
          )}
          {error && !loading && (
            <div className="glass p-4 border border-amber/40 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber shrink-0 mt-0.5" /><div className="text-sm text-ink">{error}</div>
            </div>
          )}
          {noEmail && !loading && (
            <div className="glass p-4 border border-amber/40 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber shrink-0 mt-0.5" />
              <div className="text-sm text-ink">{emailData?.reason || 'This job description has no email address to reach out to.'}</div>
            </div>
          )}

          {mode === 'cover' && letter && !loading && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-mono uppercase tracking-widest text-muted">Letter</div>
                <button className="btn btn-sm btn-ghost" onClick={() => copy(letter, 'letter')}>
                  {copied === 'letter' ? <Check className="w-3 h-3 text-neon" /> : <Copy className="w-3 h-3" />}
                  {copied === 'letter' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="text-[13px] text-ink leading-relaxed rounded-xl bg-white/[0.03] border border-white/10 p-4 whitespace-pre-wrap">
                {letter}
              </div>
            </div>
          )}

          {mode === 'email' && emailData?.ok && !loading && (
            <>
              <Field label="To" value={emailData.to || ''} onCopy={() => copy(emailData.to || '', 'to')} copied={copied === 'to'} />
              <Field label="Subject" value={emailData.subject || ''} onCopy={() => copy(emailData.subject || '', 'subj')} copied={copied === 'subj'} />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-mono uppercase tracking-widest text-muted">Body</div>
                  <button className="btn btn-sm btn-ghost" onClick={() => copy(emailData.body || '', 'body')}>
                    {copied === 'body' ? <Check className="w-3 h-3 text-neon" /> : <Copy className="w-3 h-3" />}
                    {copied === 'body' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="text-[13px] text-ink leading-relaxed rounded-xl bg-white/[0.03] border border-white/10 p-4 whitespace-pre-wrap">
                  {emailData.body}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-white/5 flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] text-muted2">Review and personalize before sending.</span>
          <div className="flex items-center gap-2">
            {mode === 'email' && emailData?.ok && (
              <a
                className="btn btn-primary"
                href={`mailto:${emailData.to}?subject=${encodeURIComponent(emailData.subject || '')}&body=${encodeURIComponent(emailData.body || '')}`}
              >
                <Mail className="w-3.5 h-3.5" /> Open in mail app
              </a>
            )}
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onCopy, copied }: { label: string; value: string; onCopy: () => void; copied: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] font-mono uppercase tracking-widest text-muted">{label}</div>
        <button className="btn btn-sm btn-ghost" onClick={onCopy}>
          {copied ? <Check className="w-3 h-3 text-neon" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <div className="text-[13px] text-ink rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 font-mono">{value}</div>
    </div>
  );
}
