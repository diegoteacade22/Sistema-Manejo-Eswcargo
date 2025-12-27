import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Suppress known hydration warnings from Radix UI components
  // These warnings occur because Radix generates dynamic IDs 
  // that don't match between server and client in lists
  logging: {
    fetches: {
      fullUrl: false, // Reduce verbose logging
    },
  },
  // Suppress specific hydration warnings
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },
};

export default nextConfig;

