import NextAuth from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import { NextAuthOptions } from "next-auth";
import { Session, Account, User } from "next-auth";
import { JWT } from "next-auth/jwt";

const authOptions: NextAuthOptions = {
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
    async session({ session, token }: { session: Session; token: JWT; user: User }) {
      session.accessToken = token.accessToken;
      session.user = {
        ...session.user,
        id: token.id ?? "",
        image: token.picture,
      };
      return session;
    },
    async jwt({ token, account, profile }: { token: JWT; account?: Account | null; profile?: unknown }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      if (profile && typeof profile === 'object' && profile !== null && 'id' in profile) {
        const discordProfile = profile as { id: string; avatar?: string };
        token.id = discordProfile.id;
        token.picture = discordProfile.avatar
          ? `https://cdn.discordapp.com/avatars/${discordProfile.id}/${discordProfile.avatar}.png`
          : undefined;
      }
      return token;
    },
  },
}

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
