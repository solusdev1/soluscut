/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Permite validar o build sem sobrescrever o cache usado pelo `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

module.exports = nextConfig;
