'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bookmark, RefreshCw, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGuideStore } from '@/store/useGuideStore';
import { useAppUpdate } from '@/hooks/use-app-update';
import { Notice, NOTICE_KIND_LABEL, pendingPromo } from '@/lib/guide/notices';
import type { GuideNavigation } from '@/lib/guide/tours';
import { runNoticeAction } from './NoticeCenter';
import { TourOverlay } from './TourOverlay';

/**
 * お知らせ系の表示をまとめて面倒を見る（MainApp に 1 つだけ置く）。
 *
 * 下部の小さなカードは同時に 1 枚だけ:
 *   1. 新しいバージョンがあります（開いたままのタブが古いとき）
 *   2. 新機能の紹介（お知らせの promo。1 回だけ）
 * どちらも、起動直後・メニューや検索・フルスクリーンプレイヤー・ダイアログ・案内の最中は出さない。
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
  const quiet = !settled || busy || modalOpen || centerOpen || !!activeTour;
  const card: 'update' | 'promo' | null = quiet
    ? null
    : updateAvailable && !updateDismissed
      ? 'update'
      : promo
        ? 'promo'
        : null;

  return (
    <>
      <AnimatePresence>
        {card === 'update' && (
          <FloatingCard key="update" isDesktop={isDesktop} miniPlayerVisible={miniPlayerVisible} label="アップデート">
            <UpdateContent onReload={reload} onDismiss={dismissUpdate} />
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
