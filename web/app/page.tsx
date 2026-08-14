'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { PlatformBadge } from '@/components/PlatformBadge';
import { classifyApply } from '@/lib/platforms';
import { Send, Zap, CheckCircle2, TrendingUp, Radio, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type LogEntry = { ts: string; level: string; message: string };

export default function DashboardPage() {
  const { data: state } = useSWR('/api/state', fetcher, { refreshInterval: 3000 });
  const { data: analytics } = useSWR('/api/analytics', fetcher, { refreshInterval: 6000 });
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    const push = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.message) setLogs(prev => [{ ts: new Date().toISOString(), level: data.level || 'info', message: data.message }, ...prev].slice(0, 40));
      } catch {}
    };
    es.addEventListener('log', push as any);
    es.addEventListener('progress', push as any);
    return () => es.close();
  }, []);

  const jobs = state?.jobs || [];
  const totals = analytics?.totals || { found: 0, relevant: 0, emailed: 0, applied: 0 };
  const recent = jobs.slice(0, 5);

  return (
    <div>
      <PageHeader
        eyebrow="OVERVIEW"
        title="Command Center"
        subtitle="Live view of your job pipeline — from discovery to auto-apply."
        actions={
          <Link href="/search" className="btn btn-primary">
            <Zap className="w-3.5 h-3.5" /> Go to Search
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard label="Jobs discovered" value={totals.found || jobs.length} icon={TrendingUp} accent="violet" hint="Across all runs" />
        <StatCard label="Auto-applied" value={totals.applied} icon={Zap} accent="neon" hint="Fully automated" />
        <StatCard label="Emails sent" value={totals.emailed} icon={Send} accent="cyan" hint="Warm outreach" />
        <StatCard label="Relevant matches" value={totals.relevant} icon={CheckCircle2} accent="amber" hint="Passed scorer" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 glass p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-mono tracking-widest text-muted uppercase">Recent Jobs</h3>
            <Link href="/search" className="text-[12px] text-violet-400 hover:text-violet-300 flex items-center gap-1">
              View all <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="text-sm text-muted2 py-10 text-center">No jobs yet. Run a search from the Search page.</div>
          ) : (
            <div className="space-y-2">
              {recent.map((j: any) => {
                const c = classifyApply(j);
                return (
                  <Link key={j.id} href="/search" className="flex items-center justify-between p-3 rounded-lg row-hover border border-transparent hover:border-white/10 transition">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <PlatformBadge c={c} />
                        {j.applied && <span className="pill pill-neon">applied</span>}
                      </div>
                      <div className="text-sm text-ink truncate">{j.title}</div>
                      <div className="text-[12px] text-muted2">{j.company} · {j.location || 'Remote'}</div>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-muted" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="glass p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-mono tracking-widest text-muted uppercase">Live Activity</h3>
            <div className="flex items-center gap-2">
              <span className="live-dot" />
              <span className="text-[10px] font-mono text-neon">STREAM</span>
            </div>
          </div>
          <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
            {logs.length === 0 && <div className="text-sm text-muted2">Waiting for events…</div>}
            {logs.map((l, i) => (
              <div key={i} className="text-[12px] flex gap-2 items-start">
                <Radio className={`w-3 h-3 mt-1 shrink-0 ${l.level === 'error' ? 'text-rose' : l.level === 'success' ? 'text-neon' : 'text-cyan-400'}`} />
                <div className="min-w-0">
                  <div className="text-muted2 leading-snug break-words">{l.message}</div>
                  <div className="text-[10px] font-mono text-muted">{new Date(l.ts).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
