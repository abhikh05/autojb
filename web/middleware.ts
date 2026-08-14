import { NextResponse, type NextRequest } from 'next/server';

// Optional HTTP Basic Auth. Set AUTH_USER and AUTH_PASS in env to enable.
// Leave unset to disable auth (local dev).
export function middleware(req: NextRequest) {
  const user = process.env.AUTH_USER;
  const pass = process.env.AUTH_PASS;
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(':');
      if (idx > -1) {
        const u = decoded.slice(0, idx);
        const p = decoded.slice(idx + 1);
        if (u === user && p === pass) return NextResponse.next();
      }
    } catch {}
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Autopilot", charset="UTF-8"' }
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
