'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bell, BellOff, Bookmark, Download, Loader2, RefreshCw, Smartphone, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGuideStore } from '@/store/useGuideStore';
import { useAppUpdate } from '@/hooks/use-app-update';
import { computeSetupNeed, nudgeDue, SetupNeed, useDeviceStore } from '@/store/useDeviceStore';
import { preparePush } from '@/lib/pwa/push';
import { useToast } from '@/hooks/use-toast';
import { Notice, NOTICE_KIND_LABEL, pendingPromo } from '@/lib/guide/notices';
import type { GuideNavigation } from '@/lib/guide/tours';
import { runNoticeAction } from './NoticeCenter';
import { TourOverlay } from './TourOverlay';

/**
 * お知らせ系の表示をまとめて面倒を見る（MainApp に 1 つだけ置く）。
 *
 * 下部の小さなカードは同時に 1 枚だけ:
 *   1. 新しいバージョンがあります（開いたままのタブが古いとき）
 *   2. お願い（通知をオンに / ホーム画面に追加 / ブラウザで開いて）。強制＝「もう表示しない」は無いが、
 *      出す間隔は 1 回目 → 1 日後 → 3 日後 → 以後 7 日ごと（useDeviceStore.nudgeDue）
 *   3. 新機能の紹介（お知らせの promo。1 回だけ）
 * 2 と 3 は 1 セッションにどちらか 1 枚まで（続けて何枚も出さない）。
 * いずれも、起動直後・メニューや検索・フルスクリーンプレイヤー・ダイアログ・案内の最中は出さない。
 * 背景を暗くしない / フォーカスを奪わない / 操作を止めない。
 */

const SETTLE_DELAY_MS = 2500;

/** Radix / vaul のモーダルが開いている間は body の pointer-events が none になる */
function useModalOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const read = () => setOpen(document.body.style.pointerEvents === 'none');
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    return () => mo.disconnect();
  }, []);
  return open;
}

interface FloatingCardProps {
  isDesktop: boolean;
  miniPlayerVisible: boolean;
  label: string;
  children: React.ReactNode;
}

function FloatingCard({ isDesktop, miniPlayerVisible, label, children }: FloatingCardProps) {
  const reduceMotion = useReducedMotion();
  const style: React.CSSProperties = isDesktop
    ? { left: 20, bottom: 20, width: 380 }
    : {
        left: 12,
        right: 12,
        bottom: `calc(${miniPlayerVisible ? 84 : 12}px + env(safe-area-inset-bottom, 0px))`,
        maxWidth: 480,
        marginInline: 'auto',
      };
  return (
    <motion.section
      role="region"
      aria-label={label}
      className="fixed z-[90] rounded-2xl border border-border bg-background/95 p-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.14),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-xl"
      style={style}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.section>
  );
}

function PromoContent({ notice }: { notice: Notice }) {
  const handlePromo = useGuideStore((s) => s.handlePromo);
  const [primary, secondary] = notice.actions ?? [];
  const Icon = notice.newBadge?.tab === 'shelf' ? Bookmark : Sparkles;
  return (
    <div className="flex gap-3">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[14px] font-semibold leading-snug text-foreground" aria-live="polite">
            <span className="mr-1.5 text-[11px] font-bold text-primary">{NOTICE_KIND_LABEL[notice.kind]}</span>
            {notice.title}
          </p>
          <button
            type="button"
            onClick={() => handlePromo(notice.id)}
            className="-mr-1 -mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{notice.promo?.summary ?? notice.body}</p>
        {primary && (
          <div className="mt-2.5 flex gap-2">
            <Button
              size="sm"
              className="h-8 rounded-full bg-primary px-4 text-xs font-semibold text-white hover:bg-primary/90"
              onClick={() => {
                handlePromo(notice.id);
                runNoticeAction(primary);
              }}
            >
              {primary.label}
            </Button>
            {secondary && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-full px-3 text-xs font-medium"
                onClick={() => {
                  handlePromo(notice.id);
                  runNoticeAction(secondary);
                }}
              >
                {secondary.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const SETUP_COPY: Record<SetupNeed['kind'], { title: string; body: string }> = {
  notify: {
    title: '通知をオンにしてください',
    body: '新機能のお知らせが届きます。曲置き場や VC の通知も、あとで選んでオンにできます',
  },
  'notify-blocked': {
    title: '通知がブロックされています',
    body: 'お知らせが届きません。設定から許可してください（1 分で終わります）',
  },
  install: {
    title: 'ホーム画面に追加してください',
    body: 'アプリとして 1 タップで開けて、通知も届くようになります',
  },
  'in-app': {
    title: 'ブラウザで開いてください',
    body: 'Discord の中のブラウザでは、通知やホーム画面への追加が使えません',
  },
};

function SetupContent({ need, onLater }: { need: SetupNeed; onLater: () => void }) {
  const busy = useDeviceStore((s) => s.busy);
  const { toast } = useToast();
  const copy = SETUP_COPY[need.kind];
  const iosInstall = need.kind === 'install' && need.mode === 'ios';
  const Icon = need.kind === 'notify' ? Bell : need.kind === 'notify-blocked' ? BellOff : need.kind === 'install' ? Download : Smartphone;

  const primary = (() => {
    if (need.kind === 'notify') {
      return {
        label: 'オンにする',
        // iPhone は「押した」操作の中で購読しないと失敗するので、ここで直接呼ぶ
        run: async () => {
          const res = await useDeviceStore.getState().enablePush();
          if (res.ok) toast({ title: '通知をオンにしました' });
          else if (res.permission === 'denied') useDeviceStore.getState().openSettings();
          else if (res.error) toast({ title: 'オンにできませんでした', description: res.error, variant: 'destructive' });
        },
      };
    }
    if (need.kind === 'install' && need.mode === 'prompt') {
      return { label: 'インストール', run: async () => void (await useDeviceStore.getState().install()) };
    }
    return {
      label: need.kind === 'notify-blocked' ? '許可のしかた' : need.kind === 'in-app' ? '開き方' : '追加のしかた',
      run: async () => useDeviceStore.getState().openSettings(),
    };
  })();

  return (
    <div className="flex gap-3">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[14px] font-semibold leading-snug text-foreground" aria-live="polite">
            {copy.title}
          </p>
          <button
            type="button"
            onClick={onLater}
            className="-mr-1 -mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="あとで"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
          {iosInstall ? 'iPhone はホーム画面に追加すると通知が届くようになります。アプリとしても 1 タップで開けます' : copy.body}
        </p>
        <div className="mt-2.5 flex gap-2">
          <Button
            size="sm"
            className="h-8 rounded-full bg-primary px-4 text-xs font-semibold text-white hover:bg-primary/90"
            onClick={primary.run}
            disabled={busy}
          >
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {primary.label}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 rounded-full px-3 text-xs font-medium" onClick={onLater}>
            あとで
          </Button>
        </div>
      </div>
    </div>
  );
}

function UpdateContent({ onReload, onDismiss }: { onReload: () => void; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
        <RefreshCw className="h-[18px] w-[18px]" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug text-foreground" aria-live="polite">
          新しいバージョンがあります
        </p>
        <p className="text-[12.5px] text-muted-foreground">読み込み直すと最新になります</p>
      </div>
      <Button
        size="sm"
        className="h-8 flex-shrink-0 rounded-full bg-primary px-4 text-xs font-semibold text-white hover:bg-primary/90"
        onClick={onReload}
      >
        更新
      </Button>
      <button
        type="button"
        onClick={onDismiss}
        className="-mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-label="閉じる"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

interface GuideHostProps {
  isDesktop: boolean;
  /** サイドメニュー・検索・フルスクリーンプレイヤーなど、何かが上に開いている */
  busy: boolean;
  miniPlayerVisible: boolean;
  /** 案内・お知らせのボタンからの画面切り替え（開いている検索やプレイヤーも閉じる） */
  onNavigate: (nav: GuideNavigation) => void;
}

export const GuideHost: React.FC<GuideHostProps> = ({ isDesktop, busy, miniPlayerVisible, onNavigate }) => {
  const seen = useGuideStore((s) => s.seenNoticeIds);
  const handled = useGuideStore((s) => s.promoHandledIds);
  const activeTour = useGuideStore((s) => s.activeTour);
  const centerOpen = useGuideStore((s) => s.centerOpen);
  const updateDismissed = useGuideStore((s) => s.updateDismissed);
  const dismissUpdate = useGuideStore((s) => s.dismissUpdate);
  const setNavigator = useGuideStore((s) => s.setNavigator);
  const { available: updateAvailable, reload } = useAppUpdate();
  const modalOpen = useModalOpen();
  const settingsOpen = useDeviceStore((s) => s.settingsOpen);
  const nudge = useDeviceStore((s) => s.nudge);
  const markNudgeShown = useDeviceStore((s) => s.markNudgeShown);
  // zustand v5 はセレクタが毎回新しいオブジェクトを返すと無限ループになるので、値ごとに取って useMemo で組み立てる
  const devInfo = useDeviceStore((s) => s.info);
  const devCapability = useDeviceStore((s) => s.capability);
  const devPermission = useDeviceStore((s) => s.permission);
  const devSubscribed = useDeviceStore((s) => s.subscribed);
  const devInstalled = useDeviceStore((s) => s.installed);
  const devCanPrompt = useDeviceStore((s) => s.canPromptInstall);
  const devServerPush = useDeviceStore((s) => s.serverPushEnabled);
  const setupNeed = useMemo(
    () =>
      computeSetupNeed({
        info: devInfo,
        capability: devCapability,
        permission: devPermission,
        subscribed: devSubscribed,
        installed: devInstalled,
        canPromptInstall: devCanPrompt,
        serverPushEnabled: devServerPush,
      }),
    [devInfo, devCapability, devPermission, devSubscribed, devInstalled, devCanPrompt, devServerPush]
  );
  const setupKey = setupNeed ? `${setupNeed.kind}${'mode' in setupNeed ? ':' + setupNeed.mode : ''}` : null;
  // このセッションで出したカード（お願い or 新機能紹介のどちらか 1 枚まで）
  const [sessionCard, setSessionCard] = useState<'setup' | 'promo' | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(false);

  useEffect(() => {
    setNavigator(onNavigate);
    return () => setNavigator(null);
  }, [onNavigate, setNavigator]);

  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(true), SETTLE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  const promo = useMemo(() => pendingPromo(seen, handled), [seen, handled]);
  const quiet = !settled || busy || modalOpen || centerOpen || settingsOpen || !!activeTour;
  const setupEligible =
    !!setupNeed && !setupDismissed && (sessionCard === 'setup' || (sessionCard === null && nudgeDue(nudge)));
  const promoEligible = !!promo && (sessionCard === 'promo' || sessionCard === null);
  const card: 'update' | 'setup' | 'promo' | null = quiet
    ? null
    : updateAvailable && !updateDismissed
      ? 'update'
      : setupEligible
        ? 'setup'
        : promoEligible
          ? 'promo'
          : null;

  // 初めて出した時点で「このセッションの 1 枚」を確定。お願いカードは出した回数を数える（次に出すまでの間隔が延びる）
  useEffect(() => {
    if ((card === 'setup' || card === 'promo') && sessionCard === null) {
      setSessionCard(card);
      if (card === 'setup') markNudgeShown();
    }
  }, [card, sessionCard, markNudgeShown]);

  // 通知のお願いを出すときは、ボタンを押す前に Service Worker と鍵を用意しておく（iPhone 対策）
  useEffect(() => {
    if (setupNeed?.kind === 'notify') void preparePush();
  }, [setupNeed?.kind]);

  return (
    <>
      <AnimatePresence>
        {card === 'update' && (
          <FloatingCard key="update" isDesktop={isDesktop} miniPlayerVisible={miniPlayerVisible} label="アップデート">
            <UpdateContent onReload={reload} onDismiss={dismissUpdate} />
          </FloatingCard>
        )}
        {card === 'setup' && setupNeed && (
          <FloatingCard key={`setup-${setupKey}`} isDesktop={isDesktop} miniPlayerVisible={miniPlayerVisible} label="お願い">
            <SetupContent need={setupNeed} onLater={() => setSetupDismissed(true)} />
          </FloatingCard>
        )}
        {card === 'promo' && promo && (
          <FloatingCard key={promo.id} isDesktop={isDesktop} miniPlayerVisible={miniPlayerVisible} label="新機能のお知らせ">
            <PromoContent notice={promo} />
          </FloatingCard>
        )}
      </AnimatePresence>
      <TourOverlay onNavigate={onNavigate} />
    </>
  );
};
