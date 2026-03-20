/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
      {
        source: "/health/:path*",
        destination: `${apiUrl}/health/:path*`,
      },
      {
        source: "/media/:path*",
        destination: `${apiUrl}/media/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
