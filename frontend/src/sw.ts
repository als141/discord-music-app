/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, NetworkOnly, CacheFirst, StaleWhileRevalidate, ExpirationPlugin } from "serwist";

// This declares the value of `injectionPoint` to TypeScript.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

const serwist = new Serwist({
  precacheEntries: [...(self.__SW_MANIFEST || []), "/offline"],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
  runtimeCaching: [
    // API requests - network only (no caching)
    {
      matcher: ({ url }) => {
        return url.pathname.startsWith("/api/") ||
               url.hostname === "irina.f5.si";
      },
      handler: new NetworkOnly(),
    },
    // Static assets - cache first
    {
      matcher: ({ request }) => {
        return request.destination === "style" ||
               request.destination === "script" ||
               request.destination === "font";
      },
      handler: new CacheFirst({
        cacheName: "static-assets",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
          }),
        ],
      }),
    },
    // Images - stale while revalidate
    {
      matcher: ({ request }) => {
        return request.destination === "image";
      },
      handler: new StaleWhileRevalidate({
        cacheName: "images",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 200,
            maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
          }),
        ],
      }),
    },
    // Default caching for other requests
    ...defaultCache,
  ],
});

serwist.addEventListeners();

// ---------------------------------------------------------------------------
// プッシュ通知（バックエンド services/push.py が送る）
//
// ペイロードは Safari の Declarative Web Push 形式（mutable なし）:
//   { web_push: 8030, notification: { title, body, navigate, tag, icon }, app_badge, irina: { url, log_id, icon } }
// iOS 18.4+ / Safari 18.5+ は Service Worker を起こさずに自分で表示する。Chrome / Firefox / それより古い Safari は
// このハンドラが同じ JSON から表示する。開封数は navigate の URL の ?n= をアプリが開いたときに数える。
// ---------------------------------------------------------------------------

interface IrinaPushData {
  web_push?: number;
  notification?: { title?: string; body?: string; navigate?: string; tag?: string; lang?: string; icon?: string };
  irina?: { url?: string; log_id?: number | null; icon?: string; image?: string | null; kind?: string };
  // 旧形式
  title?: string;
  body?: string;
}

self.addEventListener("push", (event) => {
  let data: IrinaPushData = {};
  try {
    data = (event.data?.json() as IrinaPushData) ?? {};
  } catch {
    data = { notification: { title: "Irina", body: event.data?.text() ?? "" } };
  }
  const n = data.notification ?? { title: data.title, body: data.body };
  const extra = data.irina ?? {};
  const url = extra.url || n.navigate || "/";
  const options: NotificationOptions & { image?: string; renotify?: boolean } = {
    body: n.body ?? "",
    icon: extra.icon || n.icon || "/icons/icon-192x192.png",
    badge: "/icons/notification-badge.png",
    tag: n.tag,
    renotify: !!n.tag,
    lang: n.lang || "ja",
    data: { url },
  };
  if (extra.image) options.image = extra.image;
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(n.title || "Irina", options);
      // アプリアイコンに印（対応している端末だけ。アプリを開くと消す）
      const nav = self.navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void> };
      try {
        await nav.setAppBadge?.(1);
      } catch {
        /* 非対応 */
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = (event.notification.data ?? {}) as { url?: string };
  const target = new URL(d.url || "/", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        // 開いているアプリをそのまま前に出し、行き先（?tab=shelf など）は画面側で切り替える（再読み込みしない）
        await existing.focus();
        existing.postMessage({ type: "irina-navigate", url: target.pathname + target.search });
        return;
      }
      await self.clients.openWindow(target.href);
    })()
  );
});

// 購読がブラウザ側で作り直されたとき（Firefox など）: 新しい購読をバックエンドに付け替える
self.addEventListener("pushsubscriptionchange", ((event: Event & {
  oldSubscription?: PushSubscription | null;
  newSubscription?: PushSubscription | null;
  waitUntil: (p: Promise<unknown>) => void;
}) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      if (!old?.endpoint) return;
      const cfg = (await (await fetch("/api/version", { cache: "no-store" })).json()) as { api?: string };
      if (!cfg.api) return;
      let sub = event.newSubscription ?? null;
      if (!sub) {
        const key = old.options?.applicationServerKey;
        if (!key) return;
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      await fetch(`${cfg.api}/push/resubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old_endpoint: old.endpoint, subscription: sub.toJSON() }),
      });
    })()
  );
}) as EventListener);
