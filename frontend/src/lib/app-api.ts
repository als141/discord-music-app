/**
 * バックエンド（api.atoriba.jp）を「本人として」呼ぶクライアント。
 *
 * /api/irina-token（Vercel）が NextAuth のセッションから 15 分のトークンを作り、
 * それを Authorization: Bearer で付けて直接バックエンドを呼ぶ。トークンは期限の 1 分前まで使い回す。
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

export class AppApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getIrinaToken(force = false): Promise<string | null> {
  if (!force && cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/irina-token', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = (await res.json()) as { token: string; expiresAt: number };
      cached = data;
      return data.token;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await getIrinaToken();
  if (!token) throw new AppApiError(401, 'ログインを確認できませんでした');
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (res.status === 401 && retry) {
    cached = null;
    await getIrinaToken(true);
    return call<T>(path, init, false);
  }
  if (!res.ok) {
    let message = `エラー（${res.status}）`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') message = body.detail;
    } catch {
      /* 本文なし */
    }
    throw new AppApiError(res.status, message);
  }
  return (await res.json()) as T;
}

// ---- 型 ----

export type NotifPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface DeviceReportBody {
  device_id: string;
  platform: string;
  browser: string;
  form_factor: string;
  standalone: boolean;
  installed: boolean;
  permission: NotifPermission;
  subscription: PushSubscriptionJSON | null;
  app_version: string;
  app_build: string;
  user_agent: string;
}

export interface PublicDevice {
  device_id: string;
  platform: string | null;
  browser: string | null;
  form_factor: string | null;
  standalone: boolean;
  installed: boolean;
  installed_at: string | null;
  permission: NotifPermission | null;
  push: boolean;
  push_last_ok_at: string | null;
  push_last_error: string | null;
  app_version: string | null;
  app_build: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface NotifPrefs {
  shelf: boolean;
  vc_music: boolean;
}

export interface DeviceReportResult {
  device: PublicDevice;
  prefs: NotifPrefs;
  push_enabled: boolean;
  is_admin: boolean;
}

export interface PushSendResult {
  log_id: number;
  target_users: number;
  sent: number;
  failed: number;
  removed: number;
}

export interface AdminMember {
  id: string;
  name: string;
  username: string | null;
  avatar: string;
  joined_at: string | null;
  used: boolean;
  installed: boolean;
  push: boolean;
  permission: NotifPermission | null;
  last_seen_at: string | null;
  devices: PublicDevice[];
  prefs: NotifPrefs;
}

export interface PushLogEntry {
  id: number;
  kind: 'announce' | 'shelf' | 'vc_music' | 'test' | string;
  title: string;
  body: string | null;
  url: string | null;
  target_users: number;
  target_devices: number;
  sent: number;
  failed: number;
  removed: number;
  clicked: number;
  created_by: string | null;
  created_at: string;
}

export interface AdminOverview {
  guild: { id: string; name: string };
  summary: { members: number; used: number; installed: number; push: number; denied: number };
  members: AdminMember[];
  others: AdminMember[];
  push_log: PushLogEntry[];
  push_enabled: boolean;
}

// ---- API ----

export const appApi = {
  vapidPublicKey: async (): Promise<string | null> => {
    const res = await fetch(`${API_URL}/push/vapid-public-key`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { key: string | null; enabled: boolean };
    return data.enabled ? data.key : null;
  },
  reportDevice: (body: DeviceReportBody) =>
    call<DeviceReportResult>('/me/device', { method: 'POST', body: JSON.stringify(body) }),
  getPrefs: () => call<NotifPrefs>('/me/notification-prefs'),
  putPrefs: (prefs: Partial<NotifPrefs>) =>
    call<NotifPrefs>('/me/notification-prefs', { method: 'PUT', body: JSON.stringify(prefs) }),
  pushTest: () => call<PushSendResult>('/me/push-test', { method: 'POST' }),
  adminOverview: () => call<AdminOverview>('/admin/overview'),
  adminPush: (body: { title: string; body: string; url: string; user_ids: string[] }) =>
    call<PushSendResult>('/admin/push', { method: 'POST', body: JSON.stringify(body) }),
};
