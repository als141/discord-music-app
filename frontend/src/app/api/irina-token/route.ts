import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { createHmac } from 'node:crypto';

/**
 * バックエンド（api.atoriba.jp）を本人として呼ぶための短命トークン（HS256, 15 分）。
 *
 * NextAuth のセッション（Discord ログイン）を確かめたうえで、Discord のユーザー ID を sub に入れて署名する。
 * 署名鍵 IRINA_API_SIGNING_KEY は Vercel と Pi の .env にだけある（検証は backend/app/services/app_auth.py）。
 * getToken は読み取りのみ（Discord トークンのリフレッシュはここでは起こさない。userGuilds と同じ理由）。
 */
export const dynamic = 'force-dynamic';

const TTL_SEC = 15 * 60;

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export async function GET(req: NextRequest) {
  const key = process.env.IRINA_API_SIGNING_KEY;
  if (!key) {
    return NextResponse.json({ code: 'NOT_CONFIGURED' }, { status: 503 });
  }
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const sub = typeof token?.id === 'string' ? token.id : undefined;
  if (!sub) {
    return NextResponse.json({ code: 'NO_SESSION' }, { status: 401 });
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub,
      name: typeof token?.name === 'string' ? token.name : '',
      image: typeof token?.picture === 'string' ? token.picture : '',
      iss: 'irina-web',
      aud: 'irina-api',
      iat: now,
      exp: now + TTL_SEC,
    })
  );
  const signature = b64url(createHmac('sha256', key).update(`${header}.${payload}`).digest());
  return NextResponse.json(
    { token: `${header}.${payload}.${signature}`, expiresAt: (now + TTL_SEC) * 1000 },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
