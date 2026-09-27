'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGuideStore } from '@/store/useGuideStore';
import { GuideNavigation, TOURS } from '@/lib/guide/tours';

/**
 * 画面案内（スポットライト + 説明カード）。
 *
 * - 対象は `data-tour="…"`。見つかって位置が落ち着くまで待ってから出す（タブ切替のアニメーション対策）
 * - 周りを暗くして対象だけ切り抜く。切り抜きの外は押せない（うっかり操作しないように）。
 *   interactive なステップだけ、切り抜きの中を押せる（押したら次へ）
 * - 対象が無いステップは飛ばす（skipIf の要素が出ていれば即、そうでなければ 4 秒待って）
 * - Esc = やめる、← → = 戻る / 次へ。フォーカスはカードの中に閉じ込め、終わったら元に戻す
 * - 位置は requestAnimationFrame で追いかける（スクロール・リサイズ・レイアウト変化に追従）
 */

const PAD = 6;
const GAP = 14;
const EDGE = 16;
const CARD_MAX_W = 340;
const FIND_TIMEOUT_MS = 4000;
const DIM = 'rgba(12, 12, 16, 0.58)';

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
  radius: number;
}

const near = (a: Box, b: Box) =>
  Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.left - b.left) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5 &&
  a.radius === b.radius;

function isShown(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  if (el.closest('[aria-hidden="true"], [inert]')) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

function findTarget(name: string): HTMLElement | null {
  const els = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(name)}"]`);
  for (const el of Array.from(els)) if (isShown(el)) return el;
  return null;
}

function boxOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return {
    top: r.top - PAD,
    left: r.left - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
    radius: Math.min(radius + PAD, (r.height + PAD * 2) / 2, (r.width + PAD * 2) / 2),
  };
}

/** 対象なし（中央にカードだけ）のときは、切り抜きを画面中央の点に縮める＝全体が暗くなる */
const centerBox = (): Box => ({
  top: window.innerHeight / 2,
  left: window.innerWidth / 2,
  width: 0,
  height: 0,
  radius: 0,
});

interface TourOverlayProps {
  onNavigate: (nav: GuideNavigation) => void;
}

export const TourOverlay: React.FC<TourOverlayProps> = ({ onNavigate }) => {
  const active = useGuideStore((s) => s.activeTour);
  const goToStep = useGuideStore((s) => s.goToStep);
  const finishTour = useGuideStore((s) => s.finishTour);
  const reduceMotion = useReducedMotion();

  const tour = active ? TOURS[active.id] : null;
  const stepIndex = active?.step ?? 0;
  const step = tour?.steps[stepIndex];
  const total = tour?.steps.length ?? 0;
  const isLast = stepIndex === total - 1;

  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  // 表示し終わったステップのキー。ステップが変わった瞬間に古い位置で新しい文面が 1 フレーム出ないよう、
  // 真偽値ではなく「どのステップの準備ができたか」で持つ
  const stepKey = active ? `${active.id}:${stepIndex}` : '';
  const [readyKey, setReadyKey] = useState('');
  const ready = readyKey !== '' && readyKey === stepKey;
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [cardH, setCardH] = useState(200);

  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const directionRef = useRef<1 | -1>(1);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const titleId = useId();
  const bodyId = useId();

  // 開始時のフォーカスを覚えておき、終わったら戻す
  useEffect(() => {
    if (!active) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      returnFocusRef.current?.focus?.({ preventScroll: true });
    };
    // 案内の開始・終了のときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // ステップが変わったら: 画面を切り替え → 対象を探す → 位置が落ち着いたら表示
  useEffect(() => {
    if (!tour || !step) return;
    const key = stepKey;
    setTarget(null);
    onNavigateRef.current(step.navigate ?? {});

    if (!step.target) {
      setBox(centerBox());
      setReadyKey(key);
      return;
    }

    let cancelled = false;
    let timer = 0;
    let last: Box | null = null;
    let stableTicks = 0;
    const started = performance.now();

    const skipToNeighbor = () => {
      // 同じ向きに 1 つ進む。端なら中央表示に切り替える
      const next = stepIndex + directionRef.current;
      if (next >= 0 && next < total) {
        goToStep(next);
      } else {
        setBox(centerBox());
        setReadyKey(key);
      }
    };

    const tick = () => {
      if (cancelled) return;
      if (step.skipIf && findTarget(step.skipIf)) {
        skipToNeighbor();
        return;
      }
      const el = findTarget(step.target!);
      if (el) {
        const r = el.getBoundingClientRect();
        const outOfView = r.bottom < 64 || r.top > window.innerHeight - 24;
        if (outOfView) {
          el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
          stableTicks = 0;
        } else {
          const b = boxOf(el);
          stableTicks = last && near(last, b) ? stableTicks + 1 : 0;
          last = b;
          if (stableTicks >= 2) {
            setTarget(el);
            setBox(b);
            setReadyKey(key);
            return;
          }
        }
      }
      if (performance.now() - started > FIND_TIMEOUT_MS) {
        skipToNeighbor();
        return;
      }
      timer = window.setTimeout(tick, 60);
    };
    timer = window.setTimeout(tick, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // step の中身は tour.id と stepIndex で決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour?.id, stepIndex]);

  // 対象の位置を追いかける
  useEffect(() => {
    if (!target) return;
    let raf = 0;
    const loop = () => {
      if (!target.isConnected) {
        const again = step?.target ? findTarget(step.target) : null;
        if (again && again !== target) {
          setTarget(again);
          return;
        }
      } else {
        const b = boxOf(target);
        setBox((prev) => (prev && near(prev, b) ? prev : b));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [target, step?.target]);

  // 画面サイズ
  useEffect(() => {
    if (!active) return;
    const update = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      if (!step?.target) setBox(centerBox());
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [active, step?.target]);

  // カードの高さ（配置の計算用）
  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [ready, stepIndex, viewport.w]);

  // 表示されたら主ボタンにフォーカス
  useEffect(() => {
    if (ready) primaryRef.current?.focus({ preventScroll: true });
  }, [ready, stepIndex]);

  const next = useCallback(() => {
    directionRef.current = 1;
    if (isLast) finishTour('completed');
    else goToStep(stepIndex + 1);
  }, [isLast, finishTour, goToStep, stepIndex]);

  const back = useCallback(() => {
    if (stepIndex === 0) return;
    directionRef.current = -1;
    goToStep(stepIndex - 1);
  }, [goToStep, stepIndex]);

  const skip = useCallback(() => finishTour('skipped'), [finishTour]);

  // interactive: 切り抜いた要素そのものを押したら次へ（アプリ側のクリック処理が先に動く）
  useEffect(() => {
    if (!target || !step?.interactive || !ready) return;
    const onClick = () => window.setTimeout(next, 0);
    target.addEventListener('click', onClick);
    return () => target.removeEventListener('click', onClick);
  }, [target, step?.interactive, ready, next]);

  // キーボード
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        skip();
      } else if (e.key === 'ArrowRight' && ready) {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft' && ready) {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, ready, next, back, skip]);

  // フォーカスをカードの中に閉じ込める
  const onCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !cardRef.current) return;
    const focusables = Array.from(
      cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const lastEl = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!active || !tour || !step || typeof document === 'undefined') return null;

  const vw = viewport.w || window.innerWidth;
  const vh = viewport.h || window.innerHeight;
  const hole = box ?? centerBox();
  const hasHole = hole.width > 0 && hole.height > 0;
  const cardW = Math.min(CARD_MAX_W, vw - EDGE * 2);

  // カードの位置: 対象の下に入れば下、ダメなら上、どちらも狭ければ広い方。横は対象の中央に合わせて画面内に収める
  let cardTop: number;
  let cardLeft: number;
  let arrow: { side: 'top' | 'bottom'; x: number } | null = null;
  if (!hasHole || !step.target) {
    cardTop = Math.max(EDGE, (vh - cardH) / 2);
    cardLeft = (vw - cardW) / 2;
  } else {
    const below = vh - (hole.top + hole.height) - EDGE;
    const above = hole.top - EDGE;
    const placeBelow = below >= cardH + GAP || (above < cardH + GAP && below >= above);
    cardTop = placeBelow ? hole.top + hole.height + GAP : hole.top - GAP - cardH;
    cardTop = Math.min(Math.max(cardTop, EDGE), vh - cardH - EDGE);
    const cx = hole.left + hole.width / 2;
    cardLeft = Math.min(Math.max(cx - cardW / 2, EDGE), vw - cardW - EDGE);
    arrow = { side: placeBelow ? 'top' : 'bottom', x: Math.min(Math.max(cx - cardLeft, 22), cardW - 22) };
  }

  const move = reduceMotion ? 'none' : 'top 260ms cubic-bezier(.25,.1,.25,1), left 260ms cubic-bezier(.25,.1,.25,1), width 260ms cubic-bezier(.25,.1,.25,1), height 260ms cubic-bezier(.25,.1,.25,1), border-radius 260ms';
  const blockHole = !step.interactive || !ready;

  // 切り抜きの外で押せないようにする 4 枚（切り抜きが無ければ全面 1 枚）
  const blockers: React.CSSProperties[] = hasHole
    ? [
        { top: 0, left: 0, right: 0, height: Math.max(0, hole.top) },
        { top: hole.top + hole.height, left: 0, right: 0, bottom: 0 },
        { top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height },
        { top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height },
      ]
    : [{ inset: 0 }];

  return createPortal(
    <div className="fixed inset-0 z-[300] pointer-events-none" data-guide-tour={tour.id}>
      {/* 暗幕（切り抜き付き） */}
      <div
        aria-hidden="true"
        className="fixed pointer-events-none"
        style={{
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
          borderRadius: hole.radius,
          boxShadow: hasHole
            ? `0 0 0 2px color-mix(in oklab, var(--color-primary) 70%, transparent), 0 0 0 100vmax ${DIM}`
            : `0 0 0 100vmax ${DIM}`,
          transition: move,
        }}
      />
      {blockers.map((style, i) => (
        <div key={i} aria-hidden="true" className="fixed" style={{ ...style, pointerEvents: 'auto' }} />
      ))}
      {hasHole && blockHole && (
        <div
          aria-hidden="true"
          className="fixed"
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height, pointerEvents: 'auto' }}
        />
      )}

      {/* 説明カード */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onCardKeyDown}
        className="fixed rounded-2xl border border-border bg-background p-4 shadow-2xl"
        style={{
          top: cardTop,
          left: cardLeft,
          width: cardW,
          opacity: ready ? 1 : 0,
          transform: ready || reduceMotion ? 'none' : 'translateY(4px)',
          // 次のステップへ移るときは即座に隠し、新しい位置に置いてからふわっと出す（古い位置に新しい文面を見せない）
          transition: reduceMotion || !ready ? 'none' : 'opacity 180ms ease, transform 180ms ease',
          pointerEvents: ready ? 'auto' : 'none',
        }}
      >
        {arrow && (
          <span
            aria-hidden="true"
            className="absolute h-3 w-3 rotate-45 border-border bg-background"
            style={{
              left: arrow.x - 6,
              ...(arrow.side === 'top'
                ? { top: -6.5, borderTopWidth: 1, borderLeftWidth: 1 }
                : { bottom: -6.5, borderBottomWidth: 1, borderRightWidth: 1 }),
            }}
          />
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-muted-foreground">
            {tour.title} · {stepIndex + 1} / {total}
          </span>
          <button
            type="button"
            onClick={skip}
            className="-mr-1.5 -mt-1 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="案内を閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 id={titleId} className="mt-1 text-[16px] font-bold leading-snug text-foreground">
          {step.title}
        </h2>
        <p id={bodyId} className="mt-1.5 text-[13.5px] leading-relaxed text-foreground/75">
          {step.body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1" aria-hidden="true">
            {tour.steps.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 rounded-full transition-all ${i === stepIndex ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/25'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs" onClick={back}>
                戻る
              </Button>
            )}
            <Button
              ref={primaryRef}
              size="sm"
              className="h-8 rounded-full bg-primary px-4 text-xs font-semibold text-white hover:bg-primary/90"
              onClick={next}
            >
              {isLast ? '完了' : '次へ'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
