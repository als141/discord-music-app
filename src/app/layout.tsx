// layout.tsx
'use client'

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { SessionProvider } from 'next-auth/react' // 追加
import { GuildProvider } from '@/contexts/GuildContext';
import { PlaybackProvider } from '@/contexts/PlaybackContext';
import { VolumeProvider } from '@/contexts/VolumeContext'; // 追加
import { MobileOptimizedMessage } from '@/components/MobileOptimizedMessage';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
          <MobileOptimizedMessage />
        <SessionProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <GuildProvider>
              <PlaybackProvider>
                <VolumeProvider> {/* VolumeProvider を追加 */}
                  {children}
                  <Toaster />
                </VolumeProvider>
              </PlaybackProvider>
            </GuildProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}