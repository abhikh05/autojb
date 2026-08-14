'use client';
import { useState } from 'react';
import { Classified } from '@/lib/platforms';
import { Bot, ExternalLink, Check, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

type Props = {
  c: Classified;
  jobId: string;
  kind?: 'job' | 'freelance';
  applied?: boolean;
  onApplied?: () => void;
  size?: 'sm' | 'md';
};

export function ApplyButton({ c, jobId, kind = 'job', applied, onApplied, size = 'md' }: Props) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(!!applied);

  const endpoint = kind === 'freelance'
    ? `/api/freelance/opportunity/${jobId}/apply`
    : `/api/job/${jobId}/apply`;

  const btnSize = size === 'sm' ? 'btn-sm' : '';

  if (done) {
    return (
      <span className={cn('btn', btnSize, 'text-neon border-neon/40 bg-neon/10 pointer-events-none')}>
        <Check className="w-3.5 h-3.5" /> Applied
      </span>
    );
  }

  if (c.mode === 'auto') {
    return (
      <button
        className={cn('btn', btnSize, 'btn-primary')}
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          try {
            await api(endpoint, { method: 'POST' });
            setDone(true);
            onApplied?.();
          } catch (e) {
            alert(`Auto-apply failed. Try manual apply.`);
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
        {loading ? 'Applying…' : `Auto-apply · ${c.platform.name}`}
      </button>
    );
  }

  // Manual
  if (!c.href) {
    return (
      <span className={cn('btn', btnSize, 'pointer-events-none opacity-60')}>
        <ExternalLink className="w-3.5 h-3.5" /> No apply link
      </span>
    );
  }

  return (
    <a
      href={c.href}
      target={c.href.startsWith('mailto:') ? undefined : '_blank'}
      rel="noreferrer"
      className={cn('btn', btnSize)}
    >
      <ExternalLink className="w-3.5 h-3.5" />
      Apply manually
    </a>
  );
}
