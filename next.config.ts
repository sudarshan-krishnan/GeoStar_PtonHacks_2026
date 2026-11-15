import type { NextConfig } from 'next';
const config: NextConfig = { devIndicators: false, serverExternalPackages: ['@prisma/client'] };
export default config;
