/** @type {import('next').NextConfig} */
const backend = process.env.BACKEND_URL || 'http://localhost:3000';

module.exports = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/uploads/:path*', destination: `${backend}/uploads/:path*` }
    ];
  }
};
