/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    // Пустая строка = same-origin в браузере; "" || "localhost" давало бы неверный хост в Docker SSR.
    const raw = process.env.NEXT_PUBLIC_API_URL;
    const apiUrl =
      raw === ""
        ? process.env.INTERNAL_API_URL || "http://backend:8000"
        : raw ?? "http://localhost:8000";
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
