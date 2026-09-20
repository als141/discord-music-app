// app/api/discord/userGuilds/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import axios from 'axios';

/**
 * ここでは getServerSession を使わない。
 *
 * App Router の route handler 内で getServerSession を呼ぶと jwt callback は走るものの、
 * 更新後の JWT がレスポンス Cookie に書き戻されない（no-op response）。
 * Discord は refresh_token をローテーションするので、書き戻されないまま refresh すると
 * 「使用済みの refresh_token を毎回使う」状態になり恒久的に失敗する。
 * → ここは getToken（読み取りのみ）にとどめ、リフレッシュは /api/auth/session 経由だけで起こす。
 */
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token?.accessToken) {
    return NextResponse.json(
      { code: 'NO_SESSION', error: 'ログインが必要です。' },
      { status: 401 }
    );
  }

  try {
    const response = await axios.get('https://discord.com/api/users/@me/guilds', {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

    return NextResponse.json(response.data);
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;

      // Discord のレスポンス本文はクライアントに返さない（内部情報が漏れるため）
      if (status === 401) {
        return NextResponse.json(
          {
            code: 'DISCORD_REAUTH_REQUIRED',
            error: 'Discordの認証の有効期限が切れました。',
          },
          { status: 401 }
        );
      }

      if (status === 429) {
        return NextResponse.json(
          {
            code: 'RATE_LIMITED',
            error: 'Discord APIのレート制限に達しました。しばらくしてからお試しください。',
          },
          { status: 429 }
        );
      }

      console.error('[userGuilds] Discord API error', status ?? error.code ?? 'no-response');
      return NextResponse.json(
        {
          code: 'UPSTREAM_ERROR',
          error: 'Discordとの通信に失敗しました。しばらくしてからお試しください。',
        },
        { status: 502 }
      );
    }

    console.error('[userGuilds] unexpected error');
    return NextResponse.json(
      { code: 'UNKNOWN', error: '予期しないエラーが発生しました。' },
      { status: 500 }
    );
  }
}
