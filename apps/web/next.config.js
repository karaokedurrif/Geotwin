/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disabled for Cesium compatibility (prevents double-mount issues)
  reactStrictMode: false,
  output: 'standalone',
  transpilePackages: ['@geotwin/types'],
  // Force cache bust by changing build ID
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
  images: {
    unoptimized: true,
  },
  eslint: {
    // Type safety enforced by tsc --noEmit; legacy unused-var warnings don't block deploy
    ignoreDuringBuilds: true,
  },
  async redirects() {
    return [
      {
        source: '/visor/:twinId',
        destination: '/twin/:twinId?tab=3d',
        permanent: false,
      },
    ];
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

      // Ensure single Three.js instance (prevents "Multiple instances" warning
      // which breaks PBR materials in @react-three/fiber)
      // three$ matches exact 'three' imports only, not subpath like 'three/src/...'
      config.resolve.alias = {
        ...config.resolve.alias,
        'three$': require.resolve('three'),
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
