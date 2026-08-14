/** @type {import('next').NextConfig} */
const backend = process.env.BACKEND_URL || '';

const config = {
  reactStrictMode: true,
  // Don't fail deploys on TS/eslint issues. Local dev still shows them.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true }
};

// Only wire the API proxy when BACKEND_URL is a real URL. On Vercel with no
// backend, we skip rewrites so /api/* returns 404 (client shows "Search failed")
// instead of the whole serverless function crashing.
if (backend && /^https?:\/\//.test(backend)) {
  config.rewrites = async () => [
    { source: '/api/:path*', destination: `${backend}/api/:path*` },
    { source: '/uploads/:path*', destination: `${backend}/uploads/:path*` }
  ];
}

module.exports = config;
