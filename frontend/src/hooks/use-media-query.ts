'use client';

import { useSyncExternalStore } from 'react';

/**
 * SSR セーフなメディアクエリフック。
 * サーバー/初回ハイドレーション時は false を返し、クライアントで実際の値に更新される。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = (callback: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener('change', callback);
    return () => mql.removeEventListener('change', callback);
  };
  const getSnapshot = () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false);
  const getServerSnapshot = () => false;
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** lg ブレークポイント（1024px）以上 = Now Playing パネルをドッキング表示するデスクトップレイアウト */
export const DESKTOP_QUERY = '(min-width: 1024px)';
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}
