/**
 * プッシュ通知の購読（Web Push / VAPID）。
 *
 * 大事な順序:
 *   - Safari（iPhone）は「ボタンを押した」操作の中で `pushManager.subscribe()` を直接呼ぶ必要がある。
 *     間に別の await（鍵の取得など）を挟むと操作と見なされず失敗することがあるので、
 *     Service Worker と公開鍵は画面を開いた時点で `preparePush()` で用意しておく
 *   - subscribe() は未許可なら許可ダイアログも出す（Notification.requestPermission を別に呼ばない）
 */

import { appApi, NotifPermission } from '@/lib/app-api';

const DEVICE_KEY = 'irina.device.id';

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'no-storage-device';
  }
}

export function notificationPermission(): NotifPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotifPermission;
}

let registration: ServiceWorkerRegistration | null = null;
let vapidKey: string | null = null;

export async function swRegistration(timeoutMs = 5000): Promise<ServiceWorkerRegistration | null> {
  if (registration) return registration;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    registration = reg;
    return reg;
  } catch {
    return null;
  }
}

/** ボタンを押す前に用意しておく（Service Worker と公開鍵） */
export async function preparePush(): Promise<boolean> {
  const reg = await swRegistration();
  if (!vapidKey) {
    try {
      vapidKey = await appApi.vapidPublicKey();
    } catch {
      vapidKey = null;
    }
  }
  return !!(reg && vapidKey);
}

export function pushPrepared(): boolean {
  return !!(registration && vapidKey);
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = registration ?? (await swRegistration(2000));
  if (!reg || !('pushManager' in reg)) return null;
  try {
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export interface EnablePushResult {
  ok: boolean;
  permission: NotifPermission;
  subscription: PushSubscription | null;
  error?: string;
}

/** 必ずボタンの onClick から直接呼ぶ */
export async function enablePush(): Promise<EnablePushResult> {
  if (notificationPermission() === 'unsupported') {
    return { ok: false, permission: 'unsupported', subscription: null, error: 'この端末では通知を使えません' };
  }
  try {
    let reg = registration;
    let key = vapidKey;
    if (!reg || !key) {
      // 用意が間に合っていない: 先に許可だけ取り（操作の中で）、そのあと購読する
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return { ok: false, permission: perm as NotifPermission, subscription: null };
      await preparePush();
      reg = registration;
      key = vapidKey;
      if (!reg || !key) {
        return { ok: false, permission: 'granted', subscription: null, error: '通知の準備ができませんでした。読み込み直してください' };
      }
    }
    const existing = await reg.pushManager.getSubscription();
    const subscription =
      existing ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
    return { ok: true, permission: notificationPermission(), subscription };
  } catch (e) {
    const permission = notificationPermission();
    const name = e instanceof Error ? e.name : '';
    return {
      ok: false,
      permission,
      subscription: null,
      error:
        permission === 'denied' || name === 'NotAllowedError'
          ? undefined
          : '通知をオンにできませんでした。もう一度試してください',
    };
  }
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) {
    try {
      await sub.unsubscribe();
    } catch {
      /* 既に無効 */
    }
  }
}

/** アプリのアイコンの数字（対応している端末だけ） */
export function clearAppBadge(): void {
  const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
  nav.clearAppBadge?.().catch(() => {});
}
