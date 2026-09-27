'use client';

import { useEffect } from 'react';
import { PENDING_SHARE_KEY } from '@/components/pwa/ShareReceiver';

/**
 * Web Share Target（manifest の share_target）の受け口。
 * YouTube アプリ等から「共有 → Irina」すると ?url= / ?text= / ?title= 付きでここが開く。
 * YouTube の URL を取り出して sessionStorage に置き、アプリ本体で確認してからキューに入れる。
 */
const YOUTUBE_RE = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/)|youtu\.be\/)[^\s]+/i;

export default function SharePage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const candidates = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' ');
    const match = candidates.match(YOUTUBE_RE);
    if (match) {
      try {
        sessionStorage.setItem(
          PENDING_SHARE_KEY,
          JSON.stringify({ url: match[0], title: params.get('title') || undefined })
        );
      } catch {
        /* noop */
      }
    }
    window.location.replace(match ? '/?shared=1' : '/?shared=unsupported');
  }, []);

  return (
    <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">読み込み中...</div>
  );
}
