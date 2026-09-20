'use client'

import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // 30分ごと + ウィンドウフォーカス時にセッションを再取得。
    // オフライン中のポーリングは無意味（失敗して unauthenticated に落ちる）ので止める。
    <SessionProvider
      refetchInterval={30 * 60}
      refetchOnWindowFocus
      refetchWhenOffline={false}
    >
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {children}
        <Toaster />
      </ThemeProvider>
    </SessionProvider>
  )
}
