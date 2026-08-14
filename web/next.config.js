/** @type {import('next').NextConfig} */
const backend = process.env.BACKEND_URL || '';

const config = {
  reactStrictMode: true
};

// Only wire the proxy when BACKEND_URL points to something reachable.
// On Vercel with no backend, we skip rewrites and let the client show a
// "backend not configured" error instead of crashing the serverless function.
if (backend && /^https?:\/\//.test(backend) && !backend.includes('localhost')) {
  config.rewrites = async () => [
    { source: '/api/:path*', destination: `${backend}/api/:path*` },
    { source: '/uploads/:path*', destination: `${backend}/uploads/:path*` }
  ];
} else if (backend.includes('localhost')) {
  // Dev only — proxy to local Express
  config.rewrites = async () => [
    { source: '/api/:path*', destination: `${backend}/api/:path*` },
    { source: '/uploads/:path*', destination: `${backend}/uploads/:path*` }
  ];
}

module.exports = config;
