/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disabled for Cesium compatibility (prevents double-mount issues)
  reactStrictMode: false,
  output: 'standalone',
  transpilePackages: ['@geotwin/types'],
  images: {
    unoptimized: true,
  },
  eslint: {
    // Type safety enforced by tsc --noEmit; legacy unused-var warnings don't block deploy
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    // Cesium configuration
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        http: false,
        https: false,
      };
    }

    // Copy Cesium static assets
    config.externals = config.externals || {};
    config.externals.push({
      cesium: 'Cesium',
    });

    return config;
  },
};

module.exports = nextConfig;
