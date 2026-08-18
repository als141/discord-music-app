'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

/**
 * 横スクロールの行。
 *  - スマホ: 指で横にスワイプ（縦スワイプはページのスクロールに素通し）
 *  - PC: 端に矢印ボタン（ホバー時に表示、端では消える）。トラックパッドの横スクロールもそのまま効く
 *  - Shift+ホイール / 横ホイールはブラウザ標準どおり
 */
export const ScrollRow: React.FC<Props> = ({ children, className = '', ariaLabel }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [update, children]);

  const scrollByPage = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <div className="relative group/row">
      <div ref={ref} className={`horizontal-scroll-container ${className}`} role="list" aria-label={ariaLabel}>
        {children}
      </div>
      {/* PC 用の矢印（タッチ端末では表示しない） */}
      <button
        type="button"
        onClick={() => scrollByPage(-1)}
        aria-label="左へスクロール"
        className={`hidden md:flex absolute left-2 top-[38%] -translate-y-1/2 z-10 h-10 w-10 items-center justify-center rounded-full bg-card/95 border border-border shadow-md text-foreground hover:bg-secondary transition-opacity duration-200 ${canLeft ? 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => scrollByPage(1)}
        aria-label="右へスクロール"
        className={`hidden md:flex absolute right-2 top-[38%] -translate-y-1/2 z-10 h-10 w-10 items-center justify-center rounded-full bg-card/95 border border-border shadow-md text-foreground hover:bg-secondary transition-opacity duration-200 ${canRight ? 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
};
