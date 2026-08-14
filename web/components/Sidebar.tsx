'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Search, Briefcase, Send, User, Settings, Sparkles, Radio, X, LogOut } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useEffect } from 'react';
import { useSidebar } from './SidebarState';
import { api } from '@/lib/api';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/search', label: 'Job Search', icon: Search },
  { href: '/freelance', label: 'Freelance', icon: Briefcase },
  { href: '/applications', label: 'Applications', icon: Send },
  { href: '/profile', label: 'Profile', icon: User },
  { href: '/settings', label: 'Settings', icon: Settings }
];

export function Sidebar() {
  const path = usePathname();
  const { open, close } = useSidebar();

  // Close drawer on route change
  useEffect(() => { close(); }, [path, close]);

  return (
    <>
      {/* Mobile scrim */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in fade-in"
          onClick={close}
        />
      )}
      <aside
        className={cn(
          'border-r border-white/5 bg-black/40 backdrop-blur-xl px-4 py-6 flex flex-col gap-1',
          'fixed lg:static inset-y-0 left-0 z-50 w-[260px] transition-transform lg:translate-x-0',
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between mb-6 px-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center shadow-glow">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="font-mono text-[13px] font-bold tracking-wide text-gradient">AUTOPILOT</div>
              <div className="text-[10px] text-muted font-mono tracking-widest">v2.0 · JOBS</div>
            </div>
          </Link>
          <button
            className="lg:hidden text-muted hover:text-ink p-1"
            onClick={close}
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-[10px] font-mono tracking-widest text-muted px-3 mt-2 mb-1">WORKSPACE</div>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? path === '/' : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] transition-all',
                active
                  ? 'bg-gradient-to-r from-violet-500/15 to-cyan-500/5 text-ink border border-violet-500/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                  : 'text-muted2 hover:text-ink hover:bg-white/[0.04] border border-transparent'
              )}
            >
              <Icon className={cn('w-4 h-4', active ? 'text-violet-400' : 'text-muted')} />
              <span>{label}</span>
              {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-400 shadow-[0_0_8px_#a78bfa]" />}
            </Link>
          );
        })}

        <div className="mt-auto pt-4 space-y-2">
          <div className="glass px-3 py-3 rounded-xl">
            <div className="flex items-center gap-2 mb-1.5">
              <Radio className="w-3.5 h-3.5 text-neon" />
              <span className="text-[11px] font-mono text-neon tracking-wider">SYSTEM ONLINE</span>
            </div>
            <div className="text-[11px] text-muted leading-snug">All adapters ready. Auto-apply engine armed.</div>
          </div>
          <button
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] text-muted2 hover:text-ink hover:bg-white/[0.04] border border-transparent hover:border-white/10 transition"
            onClick={async () => {
              try { await api('/api/logout', { method: 'POST' }); } catch {}
              window.location.href = '/login';
            }}
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
