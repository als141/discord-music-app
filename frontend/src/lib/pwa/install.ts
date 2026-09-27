/**
 * ホーム画面への追加（PWA インストール）。
 *
 * - Android / PC の Chromium 系は `beforeinstallprompt` を捕まえておき、こちらのボタンから出す
 *   （このイベントはページ読み込み直後に 1 回だけ来るので、React より先にモジュール読み込み時に待ち受ける。
 *   app/providers.tsx が import する）
 * - iPhone / iPad はプロンプトが無いので、共有メニューからの手順を案内する（InstallGuide）
 * - インストールされたかは: いまアプリとして開いている / appinstalled を受けた / getInstalledRelatedApps
 */

import { isStandalone } from './platform';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const INSTALLED_KEY = 'irina.pwa.installedAt';

let deferred: BeforeInstallPromptEvent | null = null;
let installedEvent = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // ブラウザ任せの小さなバーではなく、こちらの案内から出す
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedEvent = true;
    try {
      localStorage.setItem(INSTALLED_KEY, String(Date.now()));
    } catch {
      /* 保存できなくても続ける */
    }
    emit();
  });
}

export function onInstallStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null; // prompt() は 1 回しか使えない
  emit();
  try {
    await e.prompt();
    const choice = await e.userChoice;
    return choice.outcome;
  } catch {
    return 'unavailable';
  }
}

/** この端末でアプリとしてインストールされた形跡があるか（ブラウザで開いていても true になりうる） */
export function installedHint(): boolean {
  if (installedEvent || isStandalone()) return true;
  try {
    return !!localStorage.getItem(INSTALLED_KEY);
  } catch {
    return false;
  }
}

/** Android の Chrome などで、このサイトのアプリが入っているか（manifest の related_applications） */
export async function relatedAppInstalled(): Promise<boolean> {
  const nav = navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<Array<{ platform: string; url?: string }>>;
  };
  if (!nav.getInstalledRelatedApps) return false;
  try {
    const apps = await nav.getInstalledRelatedApps();
    return apps.some((a) => a.platform === 'webapp');
  } catch {
    return false;
  }
}

export function justInstalled(): boolean {
  return installedEvent;
}
