// src/lib/auth.ts

import { NextAuthOptions } from 'next-auth';
import DiscordProvider from 'next-auth/providers/discord';
import { Session } from 'next-auth';
import { JWT } from 'next-auth/jwt';

// Discord のアクセストークンは約7日で失効する。以前はリフレッシュしていなかったため、
// NextAuth のセッション（Cookie）は生きていても Discord トークンだけ死に、
// /api/discord/userGuilds が 401 になって「ログインが外れた」ように見えていた。
// refresh_token でサーバー側だけ黙って更新し、再ログインを不要にする。
async function refreshDiscordToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) {
      return { ...token, error: 'NoRefreshToken' };
    }
    const res = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID as string,
        client_secret: process.env.DISCORD_CLIENT_SECRET as string,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken as string,
      }),
    });
    const refreshed = await res.json();
    if (!res.ok) {
      throw refreshed;
    }
    return {
      ...token,
      accessToken: refreshed.access_token,
      // Discord は refresh 時にも新しい refresh_token を返す。無ければ既存を使い回す
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + (refreshed.expires_in ?? 604800),
      error: undefined,
    };
  } catch (e) {
    console.error('Discord token refresh failed:', e);
    // 失敗しても再ログインは強制しない（次回アクセスで再試行）。error は残す
    return { ...token, error: 'RefreshAccessTokenError' };
  }
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  // セッション（Cookie）は明示的に90日。友人サーバー用途で「たまに開くと切れている」を防ぐ
  session: {
    strategy: 'jwt',
    maxAge: 90 * 24 * 60 * 60, // 90日
    updateAge: 24 * 60 * 60,   // 1日ごとに有効期限をローリング延長
  },
  providers: [
    DiscordProvider({
      clientId: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID as string,
      clientSecret: process.env.DISCORD_CLIENT_SECRET as string,
      authorization: {
        params: {
          scope: 'identify guilds',
        },
      },
    }),
  ],
  callbacks: {
    async session({ session, token }: { session: Session; token: JWT }) {
      session.accessToken = token.accessToken as string;
      session.error = token.error as string | undefined;
      session.user = {
        ...session.user,
        id: token.id as string,
        image: token.picture as string,
      };
      return session;
    },
    async jwt({ token, account, profile }) {
      // 初回ログイン: account からトークン一式を保存
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at ?? Math.floor(Date.now() / 1000) + 604800;
      }
      if (profile && typeof profile === 'object' && profile !== null && 'id' in profile) {
        const discordProfile = profile as { id: string; avatar?: string };
        token.id = discordProfile.id;
        token.picture = discordProfile.avatar
          ? `https://cdn.discordapp.com/avatars/${discordProfile.id}/${discordProfile.avatar}.png`
          : undefined;
      }
      // まだ有効（60秒の余裕を見る）ならそのまま
      const expiresAt = (token.expiresAt as number) ?? 0;
      if (expiresAt && Date.now() / 1000 < expiresAt - 60) {
        return token;
      }
      // 失効間近/失効済み → リフレッシュ
      if (token.refreshToken) {
        return await refreshDiscordToken(token);
      }
      return token;
    },
  },
};
