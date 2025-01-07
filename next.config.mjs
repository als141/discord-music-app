import nextPWA from '@ducanh2912/next-pwa';

const withPWA = nextPWA({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  runtimeCaching: [
    {
      // APIリクエストをキャッシュせず、常にネットワークから取得
      urlPattern: /^https:\/\/irina\.f5\.si\/.*$/,
      handler: 'NetworkOnly',
    },
    {
      // 静的リソースをキャッシュ
      urlPattern: /^https:\/\/discord-music-app\.vercel\.app\/_next\/static\/.*$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'static-resources',
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 60 * 60 * 24 * 30, // 30日
        },
      },
    },
    // 追加のキャッシュ戦略があればここに記載
  ],
});

const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['i.ytimg.com', 'lh3.googleusercontent.com'],
    unoptimized: true, // 画像最適化を無効化
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "script-src 'self' 'unsafe-eval' 'unsafe-inline';",
          },
        ],
      },
    ];
  },
};

export default withPWA(nextConfig);