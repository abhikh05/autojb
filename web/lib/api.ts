// Resolve to an absolute URL against the plain origin so a session that was opened
// with `user:pass@` embedded credentials doesn't crash fetch() with
// "URL cannot be constructed from a URL that includes credentials".
function toAbs(path: string): string {
  if (typeof window === 'undefined') return path;
  if (/^https?:\/\//.test(path)) return path;
  return `${window.location.origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(toAbs(path), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const ct = res.headers.get('content-type') || '';
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const fetcher = (path: string) => api(path);
