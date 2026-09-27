import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { appApi, NotifPermission, NotifPrefs, PushSendResult } from '@/lib/app-api';
import { APP_VERSION } from '@/lib/guide/notices';
import { detectPlatform, PlatformInfo, pushCapability, PushCapability } from '@/lib/pwa/platform';
import { canPromptInstall, installedHint, promptInstall, relatedAppInstalled } from '@/lib/pwa/install';
import {
  currentSubscription,
  disablePush as disablePushLib,
  enablePush as enablePushLib,
  EnablePushResult,
  getDeviceId,
  notificationPermission,
  preparePush,
} from '@/lib/pwa/push';

/**
 * この端末の「アプリとして入っているか / 通知を受け取れるか」と、その案内の出し方。
 *
 * - 状態は開いたとき・画面に戻ったとき・許可が変わったときに読み直し、変化があれば（無くても 5 分に 1 回）
 *   バックエンドに報告する → 管理画面で「誰がインストール済みか・通知オンか」が分かる
 * - お願いカード（SetupCard）は強制: 「もう表示しない」は無い。ただし出す間隔は
 *   1 回目 → 1 日後 → 3 日後 → 以後 7 日ごと、と空けていく（1 セッションに 1 枚、の制限は GuideHost 側）
 */

const REPORT_INTERVAL_MS = 5 * 60 * 1000;
const NUDGE_INTERVALS_MS = [0, 24 * 3600e3, 3 * 24 * 3600e3, 7 * 24 * 3600e3];
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || '';

export type SetupNeed =
  | { kind: 'in-app' }
  | { kind: 'install'; mode: 'prompt' | 'ios' | 'android-menu' }
  | { kind: 'notify' }
  | { kind: 'notify-blocked' };

interface DeviceState {
  info: PlatformInfo | null;
  permission: NotifPermission;
  subscribed: boolean;
  capability: PushCapability;
  canPromptInstall: boolean;
  installed: boolean;
  prefs: NotifPrefs | null;
  isAdmin: boolean;
  serverPushEnabled: boolean;
  lastReportAt: number;
  lastReportKey: string;
  busy: boolean;
  settingsOpen: boolean;
  /** お願いカードを出した回数と最後に出した時刻（永続） */
  nudge: { lastShownAt: number; count: number };

  sync: (opts?: { force?: boolean }) => Promise<void>;
  refreshInstallPrompt: () => void;
  enablePush: () => Promise<EnablePushResult>;
  disablePush: () => Promise<void>;
  setPref: (key: keyof NotifPrefs, value: boolean) => Promise<void>;
  sendTest: () => Promise<PushSendResult>;
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  openSettings: () => void;
  closeSettings: () => void;
  markNudgeShown: () => void;
}

let syncInflight: Promise<void> | null = null;
let syncAgain = false;

export const useDeviceStore = create<DeviceState>()(
  persist(
    (set, get) => ({
      info: null,
      permission: 'default',
      subscribed: false,
      capability: 'unsupported',
      canPromptInstall: false,
      installed: false,
      prefs: null,
      isAdmin: false,
      serverPushEnabled: false,
      lastReportAt: 0,
      lastReportKey: '',
      busy: false,
      settingsOpen: false,
      nudge: { lastShownAt: 0, count: 0 },

      sync: ({ force = false } = {}) => {
        // 同時に呼ばれたら 1 本にまとめる（強制の依頼が来ていたら、終わったあとにもう 1 回だけ）
        if (syncInflight) {
          syncAgain = syncAgain || force;
          return syncInflight;
        }
        syncInflight = (async () => {
            const info = detectPlatform();
            const capability = pushCapability(info);
            const permission: NotifPermission = capability === 'unsupported' ? 'unsupported' : notificationPermission();
            let sub = capability === 'ok' && permission === 'granted' ? await currentSubscription() : null;
            if (capability === 'ok' && permission === 'granted' && !sub) {
              // 許可はあるのに購読が無い（ブラウザ側で消えた等）: 黙って作り直す。ダメならカードで 1 タップしてもらう
              if (await preparePush()) {
                const res = await enablePushLib();
                sub = res.subscription;
              }
            }
            const installed = info.standalone || installedHint() || (info.platform === 'android' && (await relatedAppInstalled()));
            set({ info, capability, permission, subscribed: !!sub, installed, canPromptInstall: canPromptInstall() });

            const body = {
              device_id: getDeviceId(),
              platform: info.platform,
              browser: info.browser,
              form_factor: info.formFactor,
              standalone: info.standalone,
              installed,
              permission,
              subscription: sub ? (sub.toJSON() as PushSubscriptionJSON) : null,
              app_version: APP_VERSION,
              app_build: BUILD_ID,
              user_agent: navigator.userAgent.slice(0, 400),
            };
            const key = JSON.stringify([body.standalone, body.installed, body.permission, body.subscription?.endpoint ?? null, BUILD_ID]);
            if (!force && key === get().lastReportKey && Date.now() - get().lastReportAt < REPORT_INTERVAL_MS) return;
            try {
              const res = await appApi.reportDevice(body);
              set({
                prefs: res.prefs,
                isAdmin: res.is_admin,
                serverPushEnabled: res.push_enabled,
                lastReportAt: Date.now(),
                lastReportKey: key,
              });
            } catch {
              /* オフライン等。次の機会に送る */
            }
        })().finally(() => {
          syncInflight = null;
          if (syncAgain) {
            syncAgain = false;
            void get().sync({ force: true });
          }
        });
        return syncInflight;
      },

      refreshInstallPrompt: () => set({ canPromptInstall: canPromptInstall(), installed: get().installed || installedHint() }),

      enablePush: async () => {
        set({ busy: true });
        try {
          const res = await enablePushLib();
          set({ permission: res.permission, subscribed: !!res.subscription });
          await get().sync({ force: true });
          return res;
        } finally {
          set({ busy: false });
        }
      },

      disablePush: async () => {
        set({ busy: true });
        try {
          await disablePushLib();
          await get().sync({ force: true });
        } finally {
          set({ busy: false });
        }
      },

      setPref: async (key, value) => {
        const prev = get().prefs;
        set({ prefs: { ...(prev ?? { shelf: false, vc_music: false }), [key]: value } });
        try {
          const saved = await appApi.putPrefs({ [key]: value });
          set({ prefs: saved });
        } catch (e) {
          set({ prefs: prev });
          throw e;
        }
      },

      sendTest: () => appApi.pushTest(),

      install: async () => {
        const outcome = await promptInstall();
        set({ canPromptInstall: canPromptInstall() });
        if (outcome === 'accepted') {
          set({ installed: true });
          void get().sync({ force: true });
        }
        return outcome;
      },

      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
      markNudgeShown: () => set((s) => ({ nudge: { lastShownAt: Date.now(), count: s.nudge.count + 1 } })),
    }),
    {
      name: 'irina-device',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ nudge: s.nudge }),
    }
  )
);

/** いま何をお願いすべきか（無ければ null） */
export function computeSetupNeed(s: Pick<DeviceState, 'info' | 'capability' | 'permission' | 'subscribed' | 'installed' | 'canPromptInstall' | 'serverPushEnabled'>): SetupNeed | null {
  const info = s.info;
  if (!info) return null;
  const mobile = info.formFactor !== 'desktop';
  if (mobile && info.inApp) return { kind: 'in-app' };
  if (info.platform === 'ios' && !info.standalone) {
    return s.capability === 'unsupported' ? null : { kind: 'install', mode: 'ios' };
  }
  const notifyNeed: SetupNeed | null =
    s.capability !== 'ok' || !s.serverPushEnabled
      ? null
      : s.permission === 'denied'
        ? { kind: 'notify-blocked' }
        : s.permission === 'default' || (s.permission === 'granted' && !s.subscribed)
          ? { kind: 'notify' }
          : null;
  // 通知（1 タップで済む）を先に。そのあと Android はインストールもお願いする
  if (notifyNeed && notifyNeed.kind === 'notify') return notifyNeed;
  if (info.platform === 'android' && !info.standalone && !s.installed) {
    return { kind: 'install', mode: s.canPromptInstall ? 'prompt' : 'android-menu' };
  }
  return notifyNeed;
}

export function nudgeDue(nudge: { lastShownAt: number; count: number }, now = Date.now()): boolean {
  const wait = NUDGE_INTERVALS_MS[Math.min(nudge.count, NUDGE_INTERVALS_MS.length - 1)];
  return now - nudge.lastShownAt >= wait;
}
