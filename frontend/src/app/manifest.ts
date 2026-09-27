import type { MetadataRoute } from "next";

const ORIGIN = "https://discord-music-app.vercel.app";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // id を固定しておく（start_url を変えても同じアプリとして扱われる）
    id: "/",
    name: "Irina Music Player",
    short_name: "Irina",
    description: "Discord音楽プレイヤーアプリ - YouTubeやローカルファイルから音楽を再生",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    orientation: "portrait-primary",
    categories: ["music", "entertainment"],
    lang: "ja",
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // アイコン長押しのメニュー（Android / PC）
    shortcuts: [
      {
        name: "曲置き場",
        short_name: "曲置き場",
        description: "Discord に貼られた曲の一覧",
        url: "/?tab=shelf",
        icons: [{ src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "通知とアプリ",
        short_name: "通知",
        url: "/?open=settings",
        icons: [{ src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
    // Android: YouTube アプリ等の「共有」に Irina が出る → 確認してキューに追加（app/share/page.tsx）
    share_target: {
      action: "/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
    // Android の Chrome が「このサイトのアプリが入っているか」を判定するため（getInstalledRelatedApps）
    related_applications: [{ platform: "webapp", url: `${ORIGIN}/manifest.webmanifest` }],
    prefer_related_applications: false,
  };
}
