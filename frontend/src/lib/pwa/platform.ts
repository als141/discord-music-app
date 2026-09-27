/**
 * 端末・ブラウザ・起動のされ方の判定（UA とメディアクエリ）。
 * 判定はあくまで案内文を出し分けるためのもの。機能の有無は必ず API の存在で確かめる（pushCapability 参照）。
 */

export type Platform = 'ios' | 'android' | 'windows' | 'mac' | 'linux' | 'chromeos' | 'other';
export type Browser =
  | 'safari'
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'samsung'
  | 'opera'
  | 'discord'
  | 'line'
  | 'instagram'
  | 'facebook'
  | 'x'
  | 'webview'
  | 'other';
export type FormFactor = 'mobile' | 'tablet' | 'desktop';

export interface PlatformInfo {
  platform: Platform;
  browser: Browser;
  formFactor: FormFactor;
  /** ホーム画面に追加したアプリとして開いている */
  standalone: boolean;
  /** Discord などアプリ内ブラウザ（インストール・通知ができない） */
  inApp: boolean;
  /** iOS のメジャー.マイナー（例 18.4）。iOS 以外は null */
  iosVersion: number | null;
}

const IN_APP: Browser[] = ['discord', 'line', 'instagram', 'facebook', 'x', 'webview'];

export function detectPlatform(): PlatformInfo {
  if (typeof window === 'undefined') {
    return { platform: 'other', browser: 'other', formFactor: 'desktop', standalone: false, inApp: false, iosVersion: null };
  }
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPadOS はデスクトップ版 Safari を名乗る
  const isIOS = /iPhone|iPad|iPod/.test(ua) || touchMac;

  let platform: Platform = 'other';
  if (isIOS) platform = 'ios';
  else if (/Android/.test(ua)) platform = 'android';
  else if (/CrOS/.test(ua)) platform = 'chromeos';
  else if (/Windows/.test(ua)) platform = 'windows';
  else if (/Macintosh|Mac OS X/.test(ua)) platform = 'mac';
  else if (/Linux/.test(ua)) platform = 'linux';

  let browser: Browser = 'other';
  if (/Discord/i.test(ua)) browser = 'discord';
  else if (/\bLine\//i.test(ua)) browser = 'line';
  else if (/Instagram/i.test(ua)) browser = 'instagram';
  else if (/FBAN|FBAV|FB_IAB/i.test(ua)) browser = 'facebook';
  else if (/Twitter|TwitterAndroid/i.test(ua)) browser = 'x';
  else if (/EdgiOS|EdgA|Edg\//.test(ua)) browser = 'edge';
  else if (/SamsungBrowser/.test(ua)) browser = 'samsung';
  else if (/OPR\/|OPiOS|OPX\//.test(ua)) browser = 'opera';
  else if (/FxiOS|Firefox\//.test(ua)) browser = 'firefox';
  else if (/CriOS|Chrome\//.test(ua)) browser = /; wv\)/.test(ua) ? 'webview' : 'chrome';
  else if (/Safari\//.test(ua) && (isIOS || platform === 'mac')) browser = 'safari';
  else if (isIOS) browser = 'webview'; // Safari を名乗らない iOS の WKWebView

  const formFactor: FormFactor =
    /iPad/.test(ua) || touchMac || (platform === 'android' && !/Mobile/.test(ua))
      ? 'tablet'
      : isIOS || platform === 'android'
        ? 'mobile'
        : 'desktop';

  const iosMatch = ua.match(/OS (\d+)[_.](\d+)/);
  const iosVersion = isIOS && iosMatch ? Number(`${iosMatch[1]}.${iosMatch[2]}`) : null;

  return { platform, browser, formFactor, standalone: isStandalone(), inApp: IN_APP.includes(browser), iosVersion };
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches
  );
}

export type PushCapability = 'ok' | 'needs-install' | 'in-app' | 'unsupported';

/** この端末でプッシュ通知を受け取れるか */
export function pushCapability(info: PlatformInfo): PushCapability {
  if (typeof window === 'undefined') return 'unsupported';
  if (info.inApp) return 'in-app';
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (info.platform === 'ios' && !info.standalone) {
    // iPhone / iPad はホーム画面に追加したアプリの中でだけ通知を受け取れる（iOS 16.4+）
    return info.iosVersion !== null && info.iosVersion < 16.4 ? 'unsupported' : 'needs-install';
  }
  return hasApis ? 'ok' : 'unsupported';
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  ios: 'iPhone / iPad',
  android: 'Android',
  windows: 'Windows',
  mac: 'Mac',
  linux: 'Linux',
  chromeos: 'Chromebook',
  other: 'その他',
};

export const BROWSER_LABEL: Record<Browser, string> = {
  safari: 'Safari',
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  samsung: 'Samsung Internet',
  opera: 'Opera',
  discord: 'Discord アプリ内',
  line: 'LINE アプリ内',
  instagram: 'Instagram アプリ内',
  facebook: 'Facebook アプリ内',
  x: 'X アプリ内',
  webview: 'アプリ内ブラウザ',
  other: 'ブラウザ',
};

/** 端末の短い説明（管理画面・設定用）。例: 「iPhone / iPad・アプリ」「Windows・Chrome」 */
export function describeDevice(platform: string | null, browser: string | null, standalone: boolean): string {
  const p = PLATFORM_LABEL[(platform as Platform) || 'other'] ?? platform ?? 'その他';
  if (standalone) return `${p}・アプリ`;
  const b = BROWSER_LABEL[(browser as Browser) || 'other'] ?? browser ?? 'ブラウザ';
  return `${p}・${b}`;
}
