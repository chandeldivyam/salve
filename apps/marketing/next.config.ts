import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  transpilePackages: ['@salve/ui'],
};

export default config;
