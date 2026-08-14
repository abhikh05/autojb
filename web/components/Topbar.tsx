'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { Zap, PlayCircle, StopCircle, Menu } from 'lucide-react';
import { api } from '@/lib/api';
import { useSidebar } from './SidebarState';

export function Topbar() {
  const { data: state, mutate } = useSWR('/api/state', fetcher, { refreshInterval: 4000 });
  const { openMenu } = useSidebar();
  const running = !!state?.running;
  const jobsCount = state?.jobs?.length || 0;
  const resume = state?.profile?.resumeFileName;

  return (
    <header className="h-14 px-4 sm:px-6 flex items-center justify-between border-b border-white/5 bg-black/40 backdrop-blur-xl sticky top-0 z-20">
      <div className="flex items-center gap-3 min-w-0">
        <button
          className="lg:hidden text-muted hover:text-ink p-1.5 -ml-1.5 rounded-lg hover:bg-white/5"
          onClick={openMenu}
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <span className={running ? 'live-dot' : 'w-2 h-2 rounded-full bg-muted'} />
          <span className="font-mono text-[11px] tracking-widest text-muted2">
            {running ? 'RUNNING' : 'IDLE'}
          </span>
        </div>
        <div className="h-4 w-px bg-white/10 hidden sm:block" />
        <span className="font-mono text-[11px] text-muted hidden sm:inline truncate">
          {jobsCount} jobs indexed · {resume ? 'resume ready' : 'no resume'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {running ? (
          <button className="btn btn-sm" onClick={async () => { await api('/api/stop', { method: 'POST' }); mutate(); }}>
            <StopCircle className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Stop</span>
          </button>
        ) : (
          <button className="btn btn-sm btn-primary" onClick={async () => { await api('/api/run', { method: 'POST' }); mutate(); }}>
            <PlayCircle className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Run pipeline</span>
          </button>
        )}
        <button className="btn btn-sm btn-neon">
          <Zap className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Auto-apply</span>
        </button>
      </div>
    </header>
  );
}
