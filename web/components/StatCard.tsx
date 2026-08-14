import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';

export function StatCard({
  label, value, icon: Icon, accent = 'violet', hint
}: {
  label: string; value: string | number; icon?: LucideIcon; accent?: 'violet' | 'cyan' | 'neon' | 'amber'; hint?: string;
}) {
  const accentClass = {
    violet: 'text-violet-400',
    cyan: 'text-cyan-400',
    neon: 'text-neon',
    amber: 'text-amber'
  }[accent];
  const ringClass = {
    violet: 'from-violet-500/20',
    cyan: 'from-cyan-500/20',
    neon: 'from-emerald-500/20',
    amber: 'from-amber-500/20'
  }[accent];

  return (
    <div className="glass p-5 relative overflow-hidden group">
      <div className={cn('absolute -top-8 -right-8 w-32 h-32 rounded-full blur-3xl opacity-40 bg-gradient-to-br to-transparent', ringClass)} />
      <div className="flex items-start justify-between relative">
        <div>
          <div className="text-[11px] font-mono tracking-widest text-muted uppercase">{label}</div>
          <div className="num text-3xl font-bold text-ink mt-2">{value}</div>
          {hint && <div className="text-[11px] text-muted2 mt-1">{hint}</div>}
        </div>
        {Icon && (
          <div className={cn('w-9 h-9 rounded-xl border border-white/10 bg-white/[0.03] flex items-center justify-center', accentClass)}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>
    </div>
  );
}
