// next-auth.d.ts

import "next-auth"

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    /** 'RefreshAccessTokenError' … Discord の refresh に失敗した（＝再ログインが必要） */
    error?: string;
    user: {
      id: string;
      name: string;
      email?: string;
      image?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    /** Discord の refresh_token（ローテーションするので更新のたびに差し替える） */
    refreshToken?: string;
    /** access_token の失効時刻（epoch ミリ秒） */
    accessTokenExpires?: number;
    /** 'RefreshAccessTokenError' … リフレッシュ失敗。再ログインが必要 */
    error?: string;
    id?: string;
    picture?: string;
  }
}
