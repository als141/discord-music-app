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

export type TourId = 'reco' | 'shelf' | 'games';

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
  reco: {
    id: 'reco',
    title: '曲置き場の使い方',
    steps: [
      {
        id: 'tab',
        target: 'tab-shelf',
        title: 'ここが曲置き場',
        body: '曲を置く・おすすめから流す・みんなの曲を見る、がここ 1 つでできます。タブを押しても次へ進めます。',
        interactive: true,
      },
      {
        id: 'place',
        target: 'place-bar',
        navigate: { homeTab: 'shelf' },
        title: 'リンクを貼るだけで置ける',
        body: 'YouTube・YouTube Music・ニコニコ・Spotify・Apple Music のリンクを貼ると、その場で置かれます。',
      },
      {
        id: 'feed',
        target: 'reco-feed',
        navigate: { homeTab: 'shelf' },
        title: 'いまのおすすめ',
        body: '流れている曲や置いた曲に合わせて、すぐ入れ替わります。懐かしい曲・新曲・界隈・ニコニコも一緒に。押せばそのまま流れて、合わない曲は × で外せます。',
      },
      {
        id: 'shelf',
        target: 'shelf-list',
        navigate: { homeTab: 'shelf' },
        title: 'みんなの置き場',
        body: 'Discord の #曲置き場 に貼られた曲と、アプリで置いた曲が新しい順に並びます。',
      },
    ],
  },
  games: {
    id: 'games',
    title: 'ゲーム置き場の使い方',
    steps: [
      {
        id: 'tab',
        target: 'tab-games',
        title: 'ここがゲーム置き場',
        body: '#ゲーム置き場 に貼られたゲームと、界隈でいま話題のゲームがここに並びます。タブを押しても次へ進めます。',
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
        id: 'scene',
        target: 'games-scene',
        skipIf: 'games-empty',
        navigate: { homeTab: 'games' },
        title: '界隈で話題',
        body: 'よく見る配信者・VTuber がいまやってるゲームと、電ファミ・AUTOMATON などで話題の新作・インディーです。日本語の実況の再生数や Steam の売れ筋も見て並べています。',
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
        id: 'songs',
        target: 'reco-feed',
        navigate: { homeTab: 'shelf' },
        title: '曲置き場にも「界隈」',
        body: '曲置き場の「いまのおすすめ」には、よく貼られる歌い手・配信者の新曲や歌ってみたも「界隈」として混ざります。押すとそのままキューに入ります。',
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
        body: 'Discord の #曲置き場 に貼られた曲と、アプリで置いた曲がここに集まります。タブを押しても次へ進めます。',
        interactive: true,
      },
      {
        id: 'place',
        target: 'place-bar',
        navigate: { homeTab: 'shelf' },
        title: 'アプリからも置ける',
        body: '曲のリンクを貼るだけで置けます。Discord に貼るのと同じように、みんなの置き場に並びます。',
      },
      {
        id: 'card',
        target: 'shelf-first-card',
        skipIf: 'shelf-empty',
        navigate: { homeTab: 'shelf' },
        title: '押すとキューに追加',
        body: '行を押すと、そのままイリーナのキューに入ります。3 行目は置いた人と、どこに置かれたか（#曲置き場・アプリなど）です。',
      },
    ],
  },
};
