// layout.tsx
'use client'

import { Inter } from 'next/font/google'
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import DifyChatButton from '@/components/DifyChatButton'
import { SessionProvider } from 'next-auth/react' // 追加
import { GuildProvider } from '@/contexts/GuildContext';

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className={inter.className}>
        <SessionProvider> {/* 追加 */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
            <GuildProvider> {/* 追加 */}
            {children}
            <Toaster />
            <DifyChatButton />
            </GuildProvider>
        </ThemeProvider>
          </SessionProvider>
      </body>
    </html>
  )
}
