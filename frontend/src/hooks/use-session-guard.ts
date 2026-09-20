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
  /** 復帰待ちをやめてログイン画面へ行く（「接続を確認しています」画面の手動脱出用） */
  giveUp: () => void;
}

/**
 * 再試行の間隔（ms）。最初は素早く、その後は 60 秒ごとに無期限で続ける。
 * 「本当にログアウトしている」ときは probeSession() が 'none' を返して即終了するので、
 * 無期限に続くのは通信/サーバー障害が続いている間だけ（その間はログイン画面に落とさない）。
 */
const RETRY_DELAYS_MS = [1000, 3000, 8000, 15000, 30000];
const RETRY_STEADY_MS = 60000;

type SessionProbe = 'ok' | 'none' | 'error';

/**
 * /api/auth/session を直接叩いて、「サーバーがセッション無しと答えた（本当に切れた）」のか
 * 「通信やサーバーの失敗（一時的）」なのかを区別する。
 * next-auth の getSession() はどちらでも null を返すので区別できない。
 */
async function probeSession(): Promise<SessionProbe> {
  try {
    const res = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return 'error';
    const body = await res.json().catch(() => null);
    return body && typeof body === 'object' && body.user ? 'ok' : 'none';
  } catch {
    return 'error';
  }
}

/**
 * 復帰したのに SessionProvider が追従しなかった（= フォールバックで動いている）場合の再確認間隔。
 * ここでセッションが無くなっていたら、本当にログアウトしたとみなす。
 */
const FALLBACK_REVALIDATE_INTERVAL_MS = 15000;

/** next-auth v4 がタブ間同期に使う localStorage のキー（client/_utils.js の BroadcastChannel） */
const NEXTAUTH_BROADCAST_KEY = 'nextauth.message';

/**
 * 「このブラウザで以前ログインしていた」印。
 * PWA の再起動やリロード直後（このタブではまだ一度も authenticated になっていない）に
 * /api/auth/session の取得が失敗した場合も、印があれば復帰を試みる。
 * ログアウト時（markExplicitSignOut）に消す。
 */
const SEEN_KEY = 'irina.session.seen';

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSeen(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(SEEN_KEY, '1');
    else window.localStorage.removeItem(SEEN_KEY);
  } catch {
    // localStorage が使えない環境では印なし（= 従来どおりの挙動）
  }
}

/** 自分でログアウトするとき、復帰の再試行を走らせないために signOut() の前に呼ぶ */
export function markExplicitSignOut(): void {
  if (typeof window === 'undefined') return;
  writeSeen(false);
}

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

  // このタブで一度でも認証済みになったか（初回訪問と「外れた」を区別する）。
  // 以前ログインしていた印が localStorage にあれば、リロード直後の失敗も「外れた」側として扱う
  const hasAuthenticatedRef = useRef(false);
  useEffect(() => {
    if (readSeen()) hasAuthenticatedRef.current = true;
  }, []);
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

    for (let attempt = 0; ; attempt++) {
      const delay = RETRY_DELAYS_MS[attempt] ?? RETRY_STEADY_MS;
      await sleep(delay);
      if (generation !== generationRef.current) return; // 途中で復帰した/やり直された

      const probe = await probeSession();
      if (generation !== generationRef.current) return;

      if (probe === 'none') {
        // サーバーが「セッション無し」と答えた = 本当にログアウトしている（次回のリロードでは即ログイン画面にする）
        gaveUpRef.current = true;
        writeSeen(false);
        setIsRecovering(false);
        return;
      }

      if (probe === 'ok') {
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
        // probe は ok なのに getSession が null → 一時的な不整合。次の周回で再確認する
      }
      // 'error'（通信/サーバーの失敗）はログアウト扱いにせず、待って再試行する
    }
  }, []);

  const giveUp = useCallback(() => {
    generationRef.current++; // 走っている再試行を止める
    gaveUpRef.current = true;
    writeSeen(false);
    setIsRecovering(false);
    setRecoveredSession(null);
  }, []);

  // status の変化に応じて再試行を開始 / 打ち切る
  useEffect(() => {
    if (status === 'authenticated') {
      hasAuthenticatedRef.current = true;
      writeSeen(true);
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

  // オンラインに戻った / タブが前面に来たら、待ち時間を飛ばしてすぐ確認し直す（諦めたあとでも一度だけ）
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const retryNow = () => {
      if (!hasAuthenticatedRef.current) return;
      if (status === 'authenticated' || recoveredSession) return;
      gaveUpRef.current = false;
      void runRecovery(); // 走っている再試行があっても generation が進むので新しい周回に置き換わる
    };
    const handleOnline = () => retryNow();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') retryNow();
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [status, recoveredSession, runRecovery]);

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

  return { session: effectiveSession, status: effectiveStatus, giveUp };
}
