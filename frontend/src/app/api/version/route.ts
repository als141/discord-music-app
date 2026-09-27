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
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID || null, version: APP_VERSION },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
