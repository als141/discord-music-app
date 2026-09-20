'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession, getSession } from 'next-auth/react';
import type { Session } from 'next-auth';

/**
 * 「ログインが頻繁に外れる」問題（原因A）への対策フック。
 *
 * next-auth v4 のクライアントは `/api/auth/session` の取得が一度でも失敗すると
 * `__NEXTAUTH._session = null` になり、以後 focus / refetchInterval のどちらでも
 * 取り直さない（SessionProvider の _getSession が `_session === null` で早期 return し、
 * refetchInterval のタイマーも `if (__NEXTAUTH._session)` でスキップされる）。
 * オフライン・PWA 復帰・コールドスタートで 1 回失敗しただけで、実際にはログイン中なのに
 * 永久に `unauthenticated` のままになる。
 *
 * そこでこのフックは
 *   - このタブで一度でも authenticated になったあとに unauthenticated へ落ちた場合だけ
 *   - `getSession()` を 1s / 3s / 8s のバックオフで叩き直し
 *   - 取れたら SessionProvider にも取り直させて（storage イベント経由）復帰させる
 * 全部失敗したら本当に切れたとみなして unauthenticated を返す。
 * 初回訪問（一度も authenticated になっていない）は従来どおり即 unauthenticated。
 */
export type SessionGuardStatus = 'loading' | 'authenticated' | 'recovering' | 'unauthenticated';

export interface SessionGuardResult {
  session: Session | null;
  status: SessionGuardStatus;
}

/** 再試行のバックオフ（ms）。合計で約12秒待つ */
const RETRY_DELAYS_MS = [1000, 3000, 8000];

/**
 * 復帰したのに SessionProvider が追従しなかった（= フォールバックで動いている）場合の再確認間隔。
 * ここでセッションが無くなっていたら、本当にログアウトしたとみなす。
 */
const FALLBACK_REVALIDATE_INTERVAL_MS = 15000;

/** next-auth v4 がタブ間同期に使う localStorage のキー（client/_utils.js の BroadcastChannel） */
const NEXTAUTH_BROADCAST_KEY = 'nextauth.message';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * SessionProvider に「セッションを取り直せ」と伝える。
 *
 * next-auth v4 は storage イベント（= 他タブからの通知）を受けたときだけ
 * `_session === null` のガードを飛ばして再取得する。`getSession()` 自身も
 * localStorage へ post するが、同一タブでは storage イベントが発火しないため
 * ここで同じ形の StorageEvent を自分で投げて復帰させる。
 */
function notifySessionProvider(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: NEXTAUTH_BROADCAST_KEY,
        newValue: JSON.stringify({
          event: 'session',
          data: { trigger: 'getSession' },
          timestamp: Math.floor(Date.now() / 1000),
        }),
      })
    );
  } catch {
    // StorageEvent が作れない環境でも、フック側の recoveredSession で復帰できるので致命的ではない
  }
}

export function useSessionGuard(): SessionGuardResult {
  const { data: session, status } = useSession();

  // このタブで一度でも認証済みになったか（初回訪問と「外れた」を区別する）
  const hasAuthenticatedRef = useRef(false);
  // 再試行を全部使い切ったか（使い切ったら IntroPage を出す）
  const gaveUpRef = useRef(false);
  // 走っている再試行を打ち切るための世代カウンタ
  const generationRef = useRef(0);

  const [isRecovering, setIsRecovering] = useState(false);
  // SessionProvider が追従できなかった場合のフォールバック（取得できたセッションを保持）
  const [recoveredSession, setRecoveredSession] = useState<Session | null>(null);

  const runRecovery = useCallback(async () => {
    const generation = ++generationRef.current;
    setIsRecovering(true);

    for (const delay of RETRY_DELAYS_MS) {
      await sleep(delay);
      if (generation !== generationRef.current) return; // 途中で復帰した/やり直された

      let fetched: Session | null = null;
      try {
        fetched = await getSession();
      } catch {
        fetched = null;
      }
      if (generation !== generationRef.current) return;

      if (fetched) {
        setRecoveredSession(fetched);
        notifySessionProvider();
        setIsRecovering(false);
        return;
      }
    }

    if (generation !== generationRef.current) return;
    // 全部失敗 = 本当に切れた
    gaveUpRef.current = true;
    setIsRecovering(false);
  }, []);

  // status の変化に応じて再試行を開始 / 打ち切る
  useEffect(() => {
    if (status === 'authenticated') {
      hasAuthenticatedRef.current = true;
      gaveUpRef.current = false;
      generationRef.current++; // 走っている再試行を無効化
      setIsRecovering(false);
      setRecoveredSession(null);
      return;
    }

    if (
      status === 'unauthenticated' &&
      hasAuthenticatedRef.current &&
      !gaveUpRef.current &&
      !isRecovering &&
      !recoveredSession
    ) {
      void runRecovery();
    }
  }, [status, isRecovering, recoveredSession, runRecovery]);

  // フォールバックで動いている間（getSession は成功しているのに SessionProvider が
  // unauthenticated のまま）は定期的に確認し、セッションが無くなっていたらログアウト扱いにする。
  // 通常は上の notifySessionProvider() で status が authenticated に戻るのでここは走らない。
  useEffect(() => {
    if (!recoveredSession || status === 'authenticated') return;

    let cancelled = false;
    const timer = setInterval(async () => {
      let fetched: Session | null = null;
      try {
        fetched = await getSession();
      } catch {
        return; // 一時的な失敗ではログアウト扱いにしない
      }
      if (cancelled) return;

      if (fetched) {
        setRecoveredSession(fetched);
        notifySessionProvider();
      } else {
        gaveUpRef.current = true;
        setRecoveredSession(null);
      }
    }, FALLBACK_REVALIDATE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [recoveredSession, status]);

  // オンラインに戻ったら、諦めたあとでも一度だけ確認し直す
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      if (!hasAuthenticatedRef.current) return;
      if (status === 'authenticated' || recoveredSession || isRecovering) return;
      gaveUpRef.current = false;
      void runRecovery();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [status, isRecovering, recoveredSession, runRecovery]);

  const effectiveSession = session ?? recoveredSession;

  let effectiveStatus: SessionGuardStatus;
  if (status === 'authenticated' || recoveredSession) {
    effectiveStatus = 'authenticated';
  } else if (isRecovering) {
    effectiveStatus = 'recovering';
  } else if (status === 'loading') {
    effectiveStatus = 'loading';
  } else {
    effectiveStatus = 'unauthenticated';
  }

  return { session: effectiveSession, status: effectiveStatus };
}
