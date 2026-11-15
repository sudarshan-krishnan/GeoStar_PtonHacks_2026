import type { NextConfig } from 'next';
const config: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['@prisma/client'],
  // /dashboard-2 was retired; /studio is the dashboard now.
  async redirects() {
    return [{ source: '/dashboard-2', destination: '/studio', permanent: false }];
  },
};
export default config;
