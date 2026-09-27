'use client'

import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
// ホーム画面への追加の合図（beforeinstallprompt）は読み込み直後に 1 回だけ来るので、画面より先に待ち受ける
import "@/lib/pwa/install"

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
