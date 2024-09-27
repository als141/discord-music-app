// 新規作成：/middleware.ts

export { default } from "next-auth/middleware"

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] }
