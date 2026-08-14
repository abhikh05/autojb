'use client';
import useSWR from 'swr';
import { fetcher, api } from '@/lib/api';
import { classifyApply } from '@/lib/platforms';
import { PageHeader } from '@/components/PageHeader';
import { PlatformBadge } from '@/components/PlatformBadge';
import { ApplyButton } from '@/components/ApplyButton';
import { useState, useMemo } from 'react';
import { Play, Zap, Mail, Star } from 'lucide-react';

export default function FreelancePage() {
  const { data, mutate } = useSWR('/api/freelance/opportunities', fetcher, { refreshInterval: 4000 });
  const opps: any[] = data?.opportunities || data || [];
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'all' | 'auto' | 'manual'>('all');

  const items = useMemo(() =>
    opps.map(o => ({ o, c: classifyApply({ applyUrl: o.url || o.applyUrl, email: o.email, source: o.platform }) }))
  , [opps]);

  const filtered = items.filter(({ o, c }) => {
    if (mode !== 'all' && c.mode !== mode) return false;
    if (q && !`${o.title || ''} ${o.client || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const runSearch = async () => { await api('/api/freelance/run', { method: 'POST' }); setTimeout(() => mutate(), 800); };

  return (
    <div>
      <PageHeader
        eyebrow="FREELANCE"
        title="Opportunities"
        subtitle="Upwork, Fiverr, Contra and more. Auto-draft proposals or apply directly."
        actions={
          <>
            <button className="btn" onClick={runSearch}><Play className="w-3.5 h-3.5" /> Refresh</button>
            <button className="btn btn-primary" onClick={async () => { await api('/api/freelance/draft-all', { method: 'POST' }); mutate(); }}>
              <Mail className="w-3.5 h-3.5" /> Draft all proposals
            </button>
          </>
        }
      />

      <div className="glass p-4 mb-6 flex gap-3 items-center flex-wrap">
        <input className="input flex-1 min-w-[200px]" placeholder="Filter by client or title…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="flex items-center gap-1 p-1 rounded-xl border border-white/10">
          {(['all', 'auto', 'manual'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} className={`btn btn-sm ${mode === m ? 'btn-primary' : 'btn-ghost border-transparent'}`}>
              {m === 'auto' && <Zap className="w-3 h-3" />} {m}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="glass p-14 text-center text-muted2">No freelance opportunities yet. Hit Refresh.</div>
      )}

      <div className="space-y-3">
        {filtered.map(({ o, c }) => (
          <div key={o.id} className="glass p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <PlatformBadge c={c} />
                  {o.budget && <span className="pill pill-cyan num">{o.budget}</span>}
                  {o.postedAt && <span className="text-[11px] text-muted font-mono">{o.postedAt}</span>}
                </div>
                <h3 className="text-lg font-semibold text-ink">{o.title}</h3>
                <div className="text-sm text-muted2 mt-1">{o.client || 'Unknown client'}</div>
                {o.description && <p className="text-[13px] text-muted2 mt-3 line-clamp-2">{o.description}</p>}
              </div>
              <div className="flex flex-col items-end gap-2">
                <ApplyButton c={c} jobId={o.id} kind="freelance" applied={o.status === 'applied'} onApplied={() => mutate()} />
                <button
                  className="btn btn-sm"
                  onClick={async () => { await api(`/api/freelance/opportunity/${o.id}/star`, { method: 'POST' }); mutate(); }}
                >
                  <Star className={`w-3.5 h-3.5 ${o.starred ? 'fill-amber text-amber' : ''}`} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
