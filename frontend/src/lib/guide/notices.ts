/**
 * お知らせ（リリースノート）の台帳。
 *
 * 新しい機能を出すときはここに 1 件足すだけで、次の 3 か所に出る:
 *   - ヘッダーのベル（未読の点）→ お知らせ一覧
 *   - promo を付けたものは、1 回だけ画面の下に小さなカードで知らせる
 *   - newBadge を付けたものは、そのタブを一度開くまでタブに「NEW」
 *
 * 運用ルール:
 *   - id は既読管理のキーなので、出したあとに変えない
 *   - 文面は事実だけを短く（何ができるようになったか / どこにあるか）
 *   - promo は同時に 1 件まで表示される（新しいもの優先）。期限を過ぎたら一覧にだけ残る
 */

import type { TourId } from './tours';

/** 現在のアプリのバージョン（ホームのバージョン表示・お知らせ一覧の見出しに使う） */
export const APP_VERSION = '1.2.0';
export const APP_RELEASE_DATE = '2026-09-28';

export type HomeTab = 'home' | 'shelf' | 'uploaded-music';

export type NoticeKind = 'feature' | 'improvement' | 'info';

export const NOTICE_KIND_LABEL: Record<NoticeKind, string> = {
  feature: '新機能',
  improvement: '改善',
  info: 'お知らせ',
};

export type NoticeAction =
  | { type: 'tour'; tourId: TourId; label: string }
  | { type: 'open-tab'; tab: HomeTab; label: string }
  | { type: 'open-settings'; label: string };

export interface Notice {
  /** 既読管理のキー。公開後は変更しない */
  id: string;
  /** 公開日（JST, YYYY-MM-DD）。一覧は新しい順 */
  publishedAt: string;
  kind: NoticeKind;
  title: string;
  body: string;
  /** 関連するバージョン（任意） */
  version?: string;
  /** 1 回だけ下部のカードで知らせる。until（JST, YYYY-MM-DD, その日を含む）を過ぎたら出さない */
  promo?: { until: string; summary: string };
  /** 未読として数えない（過去の記録として一覧に残すだけ） */
  quiet?: boolean;
  /** ボタン。先頭が主ボタン */
  actions?: NoticeAction[];
  /** そのタブを一度開くまで「NEW」を付ける（promo.until まで） */
  newBadge?: { tab: HomeTab };
}

export const NOTICES: Notice[] = [
  {
    id: '2026-09-push',
    publishedAt: '2026-09-28',
    version: '1.2.0',
    kind: 'feature',
    title: 'スマホに通知が届くように',
    body:
      'イリーナからの通知を受け取れるようになりました。新機能のお知らせのほか、曲置き場に曲が置かれたときや、VC で音楽が流れ始めたときにも届きます（種類ごとにオフにできます）。iPhone はホーム画面に追加すると使えます。',
    actions: [{ type: 'open-settings', label: '通知をオンにする' }],
  },
  {
    id: '2026-09-shelf',
    publishedAt: '2026-09-28',
    version: '1.1.0',
    kind: 'feature',
    title: '曲置き場',
    body:
      'Discord のチャンネルに貼られた YouTube のリンクが、「曲置き場」タブに自動で並ぶようになりました。押すとそのままキューに入ります。曲名やアーティストも自動で付きます。',
    promo: {
      until: '2026-10-26',
      summary: 'Discord に貼られた曲が、アプリに自動で並ぶようになりました',
    },
    actions: [
      { type: 'tour', tourId: 'shelf', label: '使い方を見る' },
      { type: 'open-tab', tab: 'shelf', label: '開く' },
    ],
    newBadge: { tab: 'shelf' },
  },
  {
    id: '2026-09-mention',
    publishedAt: '2026-09-23',
    kind: 'feature',
    title: 'どのチャンネルでも @イリーナ',
    body: 'bot 用のチャンネル以外でも、@イリーナ を付けるか、イリーナの発言に返信すると返事をします。',
    quiet: true,
  },
  {
    id: '2026-09-now-playing',
    publishedAt: '2026-09-21',
    kind: 'feature',
    title: '再生中の曲が Discord に出るように',
    body: 'イリーナのステータスと、再生しているボイスチャンネルのステータスに、いま流れている曲が表示されます。',
    quiet: true,
  },
  {
    id: '2026-09-resume',
    publishedAt: '2026-09-21',
    kind: 'improvement',
    title: '更新中も曲が止まりにくく',
    body: 'アプリの更新が入っても、数秒で同じ曲の同じ位置から再生が続くようになりました。',
    quiet: true,
  },
  {
    id: '2026-09-login',
    publishedAt: '2026-09-21',
    kind: 'improvement',
    title: 'ログインが切れにくく',
    body: '一度ログインすれば、基本的にそのまま使い続けられるようになりました。',
    quiet: true,
  },
];

/** JST の今日（YYYY-MM-DD） */
export function todayJst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now);
}

/** 新しい順 */
export function sortedNotices(): Notice[] {
  return [...NOTICES].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
}

export function isUnread(notice: Notice, seen: readonly string[]): boolean {
  return !notice.quiet && !seen.includes(notice.id);
}

export function unreadNotices(seen: readonly string[]): Notice[] {
  return sortedNotices().filter((n) => isUnread(n, seen));
}

/** いま紹介カードを出すべきお知らせ（無ければ null） */
export function pendingPromo(seen: readonly string[], handled: readonly string[], today = todayJst()): Notice | null {
  return (
    sortedNotices().find(
      (n) => n.promo && today <= n.promo.until && !seen.includes(n.id) && !handled.includes(n.id)
    ) ?? null
  );
}

/** 「NEW」を付けるタブ */
export function newBadgeTabs(visitedTabs: readonly string[], today = todayJst()): HomeTab[] {
  return NOTICES.filter(
    (n) => n.newBadge && (!n.promo || today <= n.promo.until) && !visitedTabs.includes(n.newBadge.tab)
  ).map((n) => n.newBadge!.tab);
}

/** 「9月28日」 */
export function formatNoticeDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return m && d ? `${m}月${d}日` : ymd;
}
