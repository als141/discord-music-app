import nextPWA from '@ducanh2912/next-pwa';

const withPWA = nextPWA({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development', // 開発環境では無効化
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
          maxAgeSeconds: 60 * 60 * 24 * 30, // 30日間
        },
      },
    },
  ],
});

const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: [
      'i.ytimg.com',
      'lh3.googleusercontent.com',
      'cdn.discordapp.com', // 必要な画像ドメインを許可
    ],
    unoptimized: true, // 画像最適化を無効化
  },
  async headers() {
    return [
      {
        source: '/(.*)', // すべてのリクエストを対象
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; connect-src 'self' https://irina.f5.si; img-src 'self' data: https://cdn.discordapp.com; style-src 'self' 'unsafe-inline';",
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(), microphone=(), camera=()',
          },
        ],
      },
    ];
  },
};

export default withPWA(nextConfig);
