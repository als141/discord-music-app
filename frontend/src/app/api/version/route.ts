import { NextResponse } from 'next/server';
import { APP_VERSION } from '@/lib/guide/notices';

/**
 * いま配信中のビルドの ID。開いたままのタブ / PWA が古いビルドのままかどうかを
 * クライアント（hooks/use-app-update.ts）が比べるのに使う。
 * NEXT_PUBLIC_BUILD_ID は next.config.mjs でビルド時に埋め込む（Vercel ではコミット SHA）。
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    // api: Service Worker が購読の付け替え（pushsubscriptionchange）で使うバックエンドの URL
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID || null, version: APP_VERSION, api: process.env.NEXT_PUBLIC_API_URL || null },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
