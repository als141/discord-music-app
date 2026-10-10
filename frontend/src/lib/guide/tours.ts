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

export type TourId = 'shelf' | 'games';

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
  games: {
    id: 'games',
    title: 'ゲーム置き場の使い方',
    steps: [
      {
        id: 'tab',
        target: 'tab-games',
        title: 'ここがゲーム置き場',
        body: '#ゲーム置き場 に貼られたゲームが、何人で遊べるか・いくらか付きでここに並びます。タブを押しても次へ進めます。',
        interactive: true,
      },
      {
        id: 'now',
        target: 'games-now',
        skipIf: 'games-empty',
        navigate: { homeTab: 'games' },
        title: 'いま',
        body: 'VC にいる人と、Discord で何をプレイ中かが出ます。見られるのはドデカのメンバーだけ。出したくない人は「通知とアプリ」でオフにすると、これまでの記録も消えます。',
      },
      {
        id: 'tonight',
        target: 'games-tonight',
        skipIf: 'games-empty',
        navigate: { homeTab: 'games' },
        title: '今夜どれ？',
        body: '人数を選ぶと、その人数で遊べるゲームを置き場から選びます。VC に人がいるときはその人数で、持っている人が多いものを上に出します。',
      },
      {
        id: 'deadlines',
        target: 'games-deadlines',
        skipIf: 'games-empty',
        navigate: { homeTab: 'games' },
        title: '期限つき',
        body: 'Epic や Steam の期限つき無料配布、置き場のゲームのセール、もうすぐ発売のものです。',
      },
      {
        id: 'card',
        target: 'games-first-card',
        skipIf: 'games-empty',
        navigate: { homeTab: 'games' },
        title: 'カードを押すと詳しく',
        body: '人数・協力か対戦か・価格・評価・誰が遊んだかが見られて、「やりたい」「持ってる」を付けられます。Steam を連携すると自動で付きます。',
      },
      {
        id: 'done',
        navigate: { homeTab: 'games' },
        title: '貼るのはいつも通り',
        body: '#ゲーム置き場 にリンクを貼るだけで増えていきます。セールや「VC に人がそろったら」の通知は「通知とアプリ」で選べます。',
      },
    ],
  },
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
