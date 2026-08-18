import type { Metadata, Viewport } from "next"
import { Fraunces, Zen_Kaku_Gothic_New, Shippori_Mincho } from "next/font/google"
import "./globals.css"
import { Providers } from "./providers"

// 見出し: 可変セリフ（opsz/SOFT/WONK 軸）— 2026 のエディトリアル志向
const fontDisplay = Fraunces({
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
  variable: "--font-display",
  display: "swap",
})
// 見出し（和文）: しっぽり明朝
const fontDisplayJp = Shippori_Mincho({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display-jp",
  display: "swap",
})
// 本文（和文/欧文）
const fontBody = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-body",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Irina Music Player",
  description: "Discord音楽プレイヤーアプリ - YouTubeやローカルファイルから音楽を再生",
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Irina",
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  themeColor: "#F1F0EC",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" suppressHydrationWarning className={`${fontDisplay.variable} ${fontDisplayJp.variable} ${fontBody.variable}`}>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
