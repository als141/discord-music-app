import { withAuth } from "next-auth/middleware"

export default withAuth({
  pages: {
    signIn: "/api/auth/signin",
  },
})

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|public|qr-code.png|$).*)'
  ]
}