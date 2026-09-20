// src/lib/auth.ts

import { NextAuthOptions } from 'next-auth';
import DiscordProvider from 'next-auth/providers/discord';
import { Session } from 'next-auth';
import { JWT } from 'next-auth/jwt';

/**
 * Discord の access_token は 7 日で失効する。
 * 失効すると /api/discord/userGuilds が 401 になり、実質ログアウトに見えるため
 * 期限の 24 時間前を切ったら refresh_token でローテーションする。
 */
const ACCESS_TOKEN_DEFAULT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // Discord の既定（7日）
const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 期限の24時間前になったら更新

/**
 * refresh_token で Discord の access_token を更新する。
 * - Discord は refresh_token もローテーションするので、返ってきた新しい値へ必ず差し替える
 * - 失敗しても accessToken は消さない（まだ生きている可能性があり、消すと即ログアウトになるため）
 * - レスポンス本文はログに出さない（token が含まれるため）
 */
async function refreshDiscordAccessToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) {
      return { ...token, error: 'RefreshAccessTokenError' };
    }

    const body = new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID as string,
      client_secret: process.env.DISCORD_CLIENT_SECRET as string,
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    });

    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      // 本文は出さない（トークンやクライアント情報が含まれうる）
      console.error('[auth] Discord token refresh failed with status', response.status);
      return { ...token, error: 'RefreshAccessTokenError' };
    }

    const refreshed = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!refreshed.access_token) {
      console.error('[auth] Discord token refresh returned no access_token');
      return { ...token, error: 'RefreshAccessTokenError' };
    }

    return {
      ...token,
      accessToken: refreshed.access_token,
      // Discord は refresh_token をローテーションする。新しいものが来たら必ず差し替える
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      accessTokenExpires:
        Date.now() +
        (typeof refreshed.expires_in === 'number'
          ? refreshed.expires_in * 1000
          : ACCESS_TOKEN_DEFAULT_LIFETIME_MS),
      error: undefined,
    };
  } catch (error) {
    console.error(
      '[auth] Discord token refresh threw',
      error instanceof Error ? error.name : 'UnknownError'
    );
    return { ...token, error: 'RefreshAccessTokenError' };
  }
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30日
    updateAge: 24 * 60 * 60, // 24時間ごとにセッションCookieを書き戻す
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
      session.error = token.error;
      session.user = {
        ...session.user,
        id: token.id as string,
        image: token.picture as string,
      };
      return session;
    },
    async jwt({ token, account, profile }) {
      // 初回サインイン（および再認証）時: トークン一式を保存
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + ACCESS_TOKEN_DEFAULT_LIFETIME_MS;
        token.error = undefined;
      }
      if (profile && typeof profile === 'object' && profile !== null && 'id' in profile) {
        const discordProfile = profile as { id: string; avatar?: string };
        token.id = discordProfile.id;
        token.picture = discordProfile.avatar
          ? `https://cdn.discordapp.com/avatars/${discordProfile.id}/${discordProfile.avatar}.png`
          : undefined;
      }

      // refresh_token を持っていない既存ログインユーザーは強制ログアウトしない（そのまま通す）
      if (!token.refreshToken) {
        return token;
      }

      // 期限の24時間前を切っていなければそのまま
      const expiresAt = token.accessTokenExpires;
      if (typeof expiresAt === 'number' && Date.now() < expiresAt - REFRESH_THRESHOLD_MS) {
        return token;
      }

      return refreshDiscordAccessToken(token);
    },
  },
};
