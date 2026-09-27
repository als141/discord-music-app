'use client';

import { useEffect } from 'react';
import { useDeviceStore } from '@/store/useDeviceStore';
import { onInstallStateChange } from '@/lib/pwa/install';
import { clearAppBadge } from '@/lib/pwa/push';

/**
 * ログイン中、この端末の状態（アプリとして開いているか・通知の許可・購読）を読み直してバックエンドに報告する。
 * 開いたとき（少し待ってから）・画面に戻ったとき・許可が変わったとき・インストールされたとき。
 * 画面に戻ったらアプリアイコンの数字（通知で付いたもの）も消す。
 */
export function useDeviceSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const sync = (force = false) => void useDeviceStore.getState().sync({ force });

    const first = window.setTimeout(() => sync(true), 1200);
    clearAppBadge();

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      clearAppBadge();
      sync();
    };
    document.addEventListener('visibilitychange', onVisible);

    const offInstall = onInstallStateChange(() => {
      useDeviceStore.getState().refreshInstallPrompt();
      sync(true);
    });

    let status: PermissionStatus | null = null;
    const onPermChange = () => sync(true);
    navigator.permissions
      ?.query({ name: 'notifications' as PermissionName })
      .then((ps) => {
        status = ps;
        ps.addEventListener('change', onPermChange);
      })
      .catch(() => {});

    return () => {
      window.clearTimeout(first);
      document.removeEventListener('visibilitychange', onVisible);
      offInstall();
      status?.removeEventListener('change', onPermChange);
    };
  }, [enabled]);
}
