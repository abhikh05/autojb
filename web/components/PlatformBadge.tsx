import { Classified, pillClassFor } from '@/lib/platforms';
import { Bot, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';

export function PlatformBadge({ c }: { c: Classified }) {
  const Icon = c.mode === 'auto' ? Bot : ExternalLink;
  return (
    <span className={cn('pill', pillClassFor(c.platform.color))}>
      <Icon className="w-3 h-3" />
      {c.platform.name}
    </span>
  );
}
