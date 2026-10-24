/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3', 'chokidar'],
  reactStrictMode: true,
};

export default nextConfig;
