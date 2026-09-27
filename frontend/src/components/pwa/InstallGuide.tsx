'use client';

import React, { useState } from 'react';
import { Check, Copy, EllipsisVertical, Ellipsis, Share, SquarePlus, Lock, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlatformInfo } from '@/lib/pwa/platform';

/**
 * 端末ごとの手順（ホーム画面への追加 / ブラウザで開き直す / 通知のブロック解除）。
 * 文言は画面上のボタン名に合わせて短く。アイコンは実物のボタンの見た目に寄せる。
 */

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-1.5 py-0.5 align-middle text-[12px] font-semibold text-foreground">
      {children}
    </span>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-foreground/85">
          <span className="mt-[1px] flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
            {i + 1}
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function InstallSteps({ info }: { info: PlatformInfo }) {
  if (info.platform === 'ios') {
    if (info.browser === 'chrome' || info.browser === 'edge' || info.browser === 'firefox') {
      return (
        <Steps
          items={[
            <>アドレスバーの <Key><Share className="h-3.5 w-3.5" />共有</Key> を押す</>,
            <><Key><SquarePlus className="h-3.5 w-3.5" />ホーム画面に追加</Key> を選ぶ（無ければ一覧を下へ）</>,
            <>右上の <Key>追加</Key> を押す</>,
            <>ホーム画面の <strong>Irina</strong> から開く</>,
          ]}
        />
      );
    }
    return (
      <div className="space-y-2.5">
        <Steps
          items={[
            <>画面下の <Key><Share className="h-3.5 w-3.5" />共有</Key> を押す（iOS 26 は右下の <Key><Ellipsis className="h-3.5 w-3.5" /></Key> → <Key>共有</Key>）</>,
            <><Key><SquarePlus className="h-3.5 w-3.5" />ホーム画面に追加</Key> を選ぶ（無ければ一覧を下へ）</>,
            <><strong>Web アプリとして開く</strong>がオンのまま、右上の <Key>追加</Key> を押す</>,
            <>ホーム画面の <strong>Irina</strong> から開く（いまログインしているので、そのままログインした状態で開きます。通知はそこでオンにできます）</>,
          ]}
        />
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          「ホーム画面に追加」が見つからないときは、Safari でこのページを開き直してから行ってください（Discord から開いた場合は右下のコンパスのアイコン）
        </p>
      </div>
    );
  }
  if (info.browser === 'samsung') {
    return (
      <Steps
        items={[
          <>画面下の <Key>≡</Key>（メニュー）を押す</>,
          <><Key>現在のページを追加</Key> → <Key>ホーム画面</Key> を選ぶ</>,
          <>ホーム画面の <strong>Irina</strong> から開く</>,
        ]}
      />
    );
  }
  return (
    <Steps
      items={[
        <>右上の <Key><EllipsisVertical className="h-3.5 w-3.5" /></Key> を押す</>,
        <><Key>ホーム画面に追加</Key> または <Key>アプリをインストール</Key> を選ぶ</>,
        <><Key>インストール</Key> を押す</>,
        <>ホーム画面（またはアプリ一覧）の <strong>Irina</strong> から開く</>,
      ]}
    />
  );
}

export function OpenInBrowserSteps({ info }: { info: PlatformInfo }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + '/');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* コピーできない環境 */
    }
  };
  return (
    <div className="space-y-3">
      <Steps
        items={
          info.platform === 'ios'
            ? [
                <>右下の <Key>Safari で開く</Key>（コンパスのアイコン）か、<Key><Share className="h-3.5 w-3.5" />共有</Key> → <Key>Safari で開く</Key> を押す</>,
                <>見つからなければ、下のボタンでリンクをコピーして Safari に貼り付ける</>,
              ]
            : [
                <>右上の <Key><EllipsisVertical className="h-3.5 w-3.5" /></Key> → <Key>Chrome で開く</Key>（または <Key>ブラウザで開く</Key>）を押す</>,
                <>見つからなければ、下のボタンでリンクをコピーして Chrome に貼り付ける</>,
              ]
        }
      />
      <Button variant="outline" size="sm" className="h-8 rounded-full px-4 text-xs" onClick={copy}>
        {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
        {copied ? 'コピーしました' : 'リンクをコピー'}
      </Button>
    </div>
  );
}

export function UnblockSteps({ info }: { info: PlatformInfo }) {
  if (info.platform === 'ios') {
    return (
      <Steps
        items={[
          <>iPhone の <Key><Settings className="h-3.5 w-3.5" />設定</Key> を開く</>,
          <><Key>通知</Key> → 一覧の <strong>Irina</strong> を選ぶ</>,
          <><Key>通知を許可</Key> をオンにする</>,
        ]}
      />
    );
  }
  if (info.platform === 'android' && info.standalone) {
    return (
      <Steps
        items={[
          <>ホーム画面の <strong>Irina</strong> のアイコンを長押し → <Key>アプリ情報</Key></>,
          <><Key>通知</Key> → <Key>通知を許可</Key>（または <Key>すべての Irina の通知</Key>）をオン</>,
          <>このアプリに戻る</>,
        ]}
      />
    );
  }
  if (info.browser === 'safari') {
    return (
      <Steps
        items={[
          <>メニューの <Key>Safari</Key> → <Key>設定</Key> → <Key>Web サイト</Key> → <Key>通知</Key></>,
          <>このサイトを <Key>許可</Key> にする</>,
          <>ページを読み込み直す</>,
        ]}
      />
    );
  }
  return (
    <Steps
      items={[
        <>アドレスバー左の <Key><Lock className="h-3.5 w-3.5" /></Key>（サイト情報）を押す</>,
        info.platform === 'android'
          ? <><Key>権限</Key> → <Key>通知</Key> → <Key>許可</Key></>
          : <><Key>通知</Key> を <Key>許可</Key> にする（無ければ <Key>サイトの設定</Key> から）</>,
        <>ページを読み込み直す</>,
      ]}
    />
  );
}
