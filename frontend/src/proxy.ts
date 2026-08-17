import { withAuth } from "next-auth/middleware"

export default withAuth({
  pages: {
    signIn: "/api/auth/signin",
  },
  callbacks: {
    authorized: ({ token, req }) => {
      // 開発時のみ /dev-preview（レイアウト検証用モックページ）を認証不要にする。
      // 本番ではページ自体が notFound() を返す。
      if (process.env.NODE_ENV === 'development' && req.nextUrl.pathname.startsWith('/dev-preview')) {
        return true
      }
      return !!token
    },
  },
})

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|icons|sw.js|manifest|offline|public|qr-code.png|$).*)'
  ]
}
