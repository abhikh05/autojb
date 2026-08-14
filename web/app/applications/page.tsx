'use client';
import useSWR from 'swr';
import { fetcher, api } from '@/lib/api';
import { classifyApply } from '@/lib/platforms';
import { PageHeader } from '@/components/PageHeader';
import { PlatformBadge } from '@/components/PlatformBadge';
import { StatCard } from '@/components/StatCard';
import { Send, CheckCircle2, ExternalLink, Trash2, Download, Mail } from 'lucide-react';
import { useMemo, useState } from 'react';

export default function ApplicationsPage() {
  const { data: state, mutate } = useSWR('/api/state', fetcher, { refreshInterval: 4000 });
  const jobs: any[] = state?.jobs || [];
  const applied = jobs.filter(j => j.applied || j.status === 'applied' || j.status === 'emailed');
  const [tab, setTab] = useState<'all' | 'auto' | 'email'>('all');

  const rows = useMemo(() => applied.map(j => ({ j, c: classifyApply(j) })), [applied]);
  const filtered = rows.filter(({ j, c }) => {
    if (tab === 'auto') return c.mode === 'auto';
    if (tab === 'email') return j.status === 'emailed';
    return true;
  });

  return (
    <div>
      <PageHeader
        eyebrow="TRACKING"
        title="Applications"
        subtitle="Everything you've applied to or emailed — grouped by platform."
        actions={
          <>
            <a className="btn" href="/api/export/csv" download><Download className="w-3.5 h-3.5" /> Export CSV</a>
            <button className="btn" onClick={async () => { if (confirm('Clear all applications?')) { await api('/api/jobs', { method: 'DELETE' }); mutate(); } }}>
              <Trash2 className="w-3.5 h-3.5" /> Clear
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total applications" value={applied.length} icon={CheckCircle2} accent="neon" />
        <StatCard label="Auto-applied" value={rows.filter(r => r.c.mode === 'auto').length} icon={Send} accent="violet" />
        <StatCard label="Email outreach" value={applied.filter(j => j.status === 'emailed').length} icon={Mail} accent="cyan" />
      </div>

      <div className="flex gap-1 p-1 rounded-xl border border-white/10 bg-white/[0.02] w-fit mb-4">
        {(['all', 'auto', 'email'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-ghost border-transparent'}`}>
            {t}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="glass p-14 text-center text-muted2">No applications yet.</div>
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="text-[11px] font-mono text-muted uppercase tracking-widest border-b border-white/5">
              <tr>
                <th className="text-left px-5 py-3">Job</th>
                <th className="text-left px-5 py-3">Platform</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Applied</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ j, c }) => (
                <tr key={j.id} className="border-b border-white/5 last:border-0 row-hover">
                  <td className="px-5 py-4">
                    <div className="text-ink font-medium">{j.title}</div>
                    <div className="text-[12px] text-muted2">{j.company}</div>
                  </td>
                  <td className="px-5 py-4"><PlatformBadge c={c} /></td>
                  <td className="px-5 py-4">
                    <span className={`pill ${j.status === 'applied' ? 'pill-neon' : j.status === 'emailed' ? 'pill-cyan' : ''}`}>
                      {j.status || 'applied'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-[12px] font-mono text-muted2">
                    {j.appliedAt ? new Date(j.appliedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-5 py-4 text-right">
                    {c.href && (
                      <a href={c.href} target="_blank" rel="noreferrer" className="btn btn-sm">
                        <ExternalLink className="w-3 h-3" /> Open
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
