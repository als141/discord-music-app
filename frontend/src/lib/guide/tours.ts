/**
 * 画面の案内（スポットライトで要素を順に指し示すツアー）の台帳。
 *
 * 新しい画面を案内したいとき:
 *   1. 指したい要素に `data-tour="…"` を付ける
 *   2. ここに Tour を足す（steps の target にその値）
 *   3. notices.ts のお知らせに `{ type: 'tour', tourId }` のボタンを付ける
 *
 * 表示は components/guide/TourOverlay.tsx。
 *   - navigate: そのステップに入る前にアプリ側の画面を切り替える（MainApp が実装）
 *   - target が見つからない（まだ曲が無い等）ステップは飛ばす。skipIf の要素が出ていれば待たずに飛ばす
 *   - interactive: 指した要素そのものを押せる（押したら次へ）。それ以外は押しても何も起きない
 */

import type { HomeTab } from './notices';

export type TourId = 'shelf';

export interface GuideNavigation {
  homeTab?: HomeTab;
}

export interface TourStep {
  id: string;
  /** data-tour の値。省略すると画面中央にカードだけ出す */
  target?: string;
  title: string;
  body: string;
  navigate?: GuideNavigation;
  interactive?: boolean;
  /** この data-tour の要素が画面にあれば、このステップは当てはまらないので待たずに飛ばす（空の一覧など） */
  skipIf?: string;
}

export interface Tour {
  id: TourId;
  title: string;
  steps: TourStep[];
}

export const TOURS: Record<TourId, Tour> = {
  shelf: {
    id: 'shelf',
    title: '曲置き場の使い方',
    steps: [
      {
        id: 'tab',
        target: 'tab-shelf',
        title: 'ここが曲置き場',
        body: 'Discord のチャンネルに貼られた YouTube のリンクが、ここに自動で集まります。タブを押しても次へ進めます。',
        interactive: true,
      },
      {
        id: 'channels',
        target: 'shelf-channels',
        skipIf: 'shelf-empty',
        navigate: { homeTab: 'shelf' },
        title: 'チャンネルで切り替え',
        body: '最初は「曲置き場」チャンネルの曲を表示しています。「一般」など、ほかのチャンネルに貼られた曲もここで見られます。',
      },
      {
        id: 'card',
        target: 'shelf-first-card',
        skipIf: 'shelf-empty',
        navigate: { homeTab: 'shelf' },
        title: '押すとキューに追加',
        body: 'カードを押すと、そのままイリーナのキューに入ります。下には貼った人と、いつ貼られたかが出ます。',
      },
      {
        id: 'done',
        navigate: { homeTab: 'shelf' },
        title: 'Discord に貼るだけ',
        body: 'これからは Discord に YouTube のリンクを貼れば、ここに増えていきます。曲名やアーティストは自動で付きます。',
      },
    ],
  },
};
