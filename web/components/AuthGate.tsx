'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/**
 * Client-side auth gate. Runs once on mount, hits /api/auth/status.
 * If not authenticated → redirects to /login. If auth is disabled (no
 * password configured server-side) → does nothing.
 * Skips the check when already on /login.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (pathname === '/login') { setOk(true); return; }
    (async () => {
      try {
        const r = await fetch(new URL('/api/auth/status', window.location.origin).toString(), { credentials: 'include' });
        const d = await r.json();
        if (d.authenticated || !d.enabled) {
          setOk(true);
        } else {
          router.replace('/login');
        }
      } catch {
        // Backend unreachable → let the page render (client will show its own error)
        setOk(true);
      }
    })();
  }, [pathname, router]);

  if (ok === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
      </div>
    );
  }
  return <>{children}</>;
}
