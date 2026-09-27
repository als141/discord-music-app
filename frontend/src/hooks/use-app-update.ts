'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 開いたままのタブ / ホーム画面に追加したアプリが、古いビルドのまま動いていないかを見る。
 *
 * - /api/version のビルド ID と、このバンドルに埋め込まれた ID を比べる
 * - 見るタイミング: 起動 30 秒後、画面に戻ってきたとき、表示中は 10 分ごと
 * - 違っていたら `available` を立てる（画面に「新しいバージョン」を出すのは呼び出し側）
 * - 10 分以上裏にいたあと戻ってきた時点で新しいビルドがあれば、何も操作していないので
 *   その場で静かに読み込み直す。同じビルドへの自動読み込みは 1 回まで（ループ防止）
 * - 開発時（ビルド ID が空）は何もしない
 */

const CURRENT_BUILD = process.env.NEXT_PUBLIC_BUILD_ID || '';
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30 * 1000;
const SILENT_RELOAD_AFTER_HIDDEN_MS = 10 * 60 * 1000;
const RELOADED_KEY = 'irina.update.reloadedFor';

async function fetchServerBuild(): Promise<string | null> {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { buildId?: string | null };
    return data.buildId || null;
  } catch {
    return null;
  }
}

function alreadyReloadedFor(build: string): boolean {
  try {
    return sessionStorage.getItem(RELOADED_KEY) === build;
  } catch {
    return true; // 記録できない環境では自動読み込みしない
  }
}

export function useAppUpdate() {
  const [available, setAvailable] = useState(false);
  const hiddenAtRef = useRef<number | null>(null);

  const reload = useCallback(() => {
    window.location.reload();
  }, []);

  useEffect(() => {
    if (!CURRENT_BUILD) return;
    let disposed = false;

    const check = async (): Promise<string | null> => {
      const server = await fetchServerBuild();
      if (disposed || !server || server === CURRENT_BUILD) return null;
      setAvailable(true);
      return server;
    };

    const onVisibility = async () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = null;
      const newer = await check();
      if (newer && hiddenFor >= SILENT_RELOAD_AFTER_HIDDEN_MS && !alreadyReloadedFor(newer)) {
        try {
          sessionStorage.setItem(RELOADED_KEY, newer);
        } catch {
          return;
        }
        window.location.reload();
      }
    };

    const first = window.setTimeout(check, FIRST_CHECK_DELAY_MS);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return { available, reload };
}
