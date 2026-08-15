'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

type Status = 'checking' | 'allow' | 'redirect';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    // Login page renders itself with no gate
    if (pathname === '/login') { setStatus('allow'); return; }

    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          new URL('/api/auth/status', window.location.origin).toString(),
          { credentials: 'include', cache: 'no-store' }
        );
        const d = await r.json();
        if (cancelled) return;
        // Auth off OR verified session → allow
        if (!d.enabled || d.authenticated === true) {
          setStatus('allow');
        } else {
          // Explicit unauthenticated → send to login, DON'T render children
          setStatus('redirect');
          router.replace('/login');
        }
      } catch {
        // Backend unreachable → send to login as a safe default (was fail-open, big bug)
        if (!cancelled) {
          setStatus('redirect');
          router.replace('/login');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [pathname, router]);

  if (status !== 'allow') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
      </div>
    );
  }
  return <>{children}</>;
}
