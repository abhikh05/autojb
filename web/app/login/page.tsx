'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LogIn, Sparkles, AlertTriangle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // If already authenticated (or auth disabled), skip login.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(new URL('/api/auth/status', window.location.origin).toString(), { credentials: 'include' });
        const d = await r.json();
        if (d.authenticated || !d.enabled) router.replace('/');
      } catch {}
      setChecking(false);
    })();
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(new URL('/api/login', window.location.origin).toString(), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Login failed');
      router.replace('/');
    } catch (e: any) {
      setError(e?.message || 'Login failed');
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="glass-strong p-8 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center shadow-glow">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-mono text-[12px] font-bold tracking-widest text-gradient">AUTOPILOT</div>
            <div className="text-[10px] text-muted font-mono tracking-widest">v2.0 · JOBS</div>
          </div>
        </div>

        <h1 className="text-xl text-ink font-semibold mb-1">Welcome back</h1>
        <p className="text-[13px] text-muted2 mb-6">Sign in to access your jobs, resume, and applications.</p>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-[11px] font-mono uppercase tracking-widest text-muted">Password</label>
            <input
              type="password"
              className="input mt-1.5"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-[12px] text-amber py-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={loading || !password.trim()}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
