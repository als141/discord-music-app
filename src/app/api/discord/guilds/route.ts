// route.ts

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import axios from 'axios';
import NodeCache from 'node-cache'; // 追加

const cache = new NodeCache({ stdTTL: 60 }); // キャッシュの有効期限を60秒に設定

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized. Please log in again.' }, { status: 401 });
  }
  const accessToken = session.accessToken as string;
  const cacheKey = `guilds_${accessToken}`;

  // キャッシュからギルド情報を取得
  const cachedGuilds = cache.get(cacheKey);
  if (cachedGuilds) {
    return NextResponse.json(cachedGuilds);
  }

  try {
    const response = await axios.get('https://discord.com/api/users/@me/guilds', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    // ギルド情報をキャッシュに保存
    cache.set(cacheKey, response.data);
    return NextResponse.json(response.data);
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // サーバーがエラーレスポンスを返した場合
        return NextResponse.json({ error: `Server error: ${error.response.data.message}` }, { status: error.response.status });
      } else if (error.request) {
        // リクエストが送信されたが応答がない場合
        return NextResponse.json({ error: 'No response from server. Please try again later.' }, { status: 503 });
      } else {
        // その他のエラー
        return NextResponse.json({ error: `Request error: ${error.message}` }, { status: 500 });
      }
    }
    // 予期しないエラー
    return NextResponse.json({ error: 'An unexpected error occurred. Please try again later.' }, { status: 500 });
  }
}
