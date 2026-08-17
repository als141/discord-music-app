'use client'

/**
 * 開発専用プレビュー: Discord ログインなしで MainApp をモックセッションで表示する。
 * レイアウト検証（Playwright スクリーンショット）用。本番ビルドでは 404。
 * API 応答は scripts/preview-screenshots.mjs 側で route モックする。
 */

import { notFound } from 'next/navigation'
import { SessionProvider } from 'next-auth/react'
import type { Session } from 'next-auth'
import { MainApp } from '@/components/MainApp'

const mockSession = {
  user: {
    id: '000000000000000001',
    name: 'als0028',
    email: 'preview@example.com',
    image: 'https://cdn.discordapp.com/embed/avatars/1.png',
  },
  expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
} as unknown as Session

export default function DevPreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return (
    <SessionProvider session={mockSession} refetchOnWindowFocus={false} refetchInterval={0}>
      <MainApp />
    </SessionProvider>
  )
}
