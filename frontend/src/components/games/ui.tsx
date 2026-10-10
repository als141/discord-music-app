'use client';

/**
 * ゲーム置き場・曲置き場で共通の見た目の部品。2 つの置き場は同じ部品で組んで「対」にする。
 *
 * 約束ごと（崩さない）
 * - 文字は 3 段だけ: 見出し 20 / 項目 15 / 補足 13（ヒーローの見出しだけ 22〜26）
 * - 見出しにアイコンを付けない。説明文を置かない（出どころは見出しの右に一言）
 * - 事実は灰色のピルにしない。「最大6人 · 協力 · ¥1,615」の 1 行（Meta）
 * - ローズは 1 枚に 1 か所（セール価格か、いちばん強い理由）。緑は「無料」だけ
 * - カードは 3 種類: Hero（1 画面に 1 つ）/ 横に流れるカード / 順位つきの行（RankRow）
 */

import React from 'react';

export function SectionHeader({ title, caption, action, className = '' }: { title: string; caption?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-3 flex items-end justify-between gap-3 px-4 sm:px-6 ${className}`}>
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h2 className="flex-shrink-0 text-[20px] font-bold leading-tight tracking-tight text-foreground">{title}</h2>
        {caption && <span className="truncate text-[13px] text-muted-foreground">{caption}</span>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

/** 小見出し（セクションの中の区切り） */
export function SubHeader({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1 px-4 text-[13px] font-semibold text-muted-foreground sm:px-6">{children}</h3>;
}

/** 「最大6人 · 協力 · ¥1,615」。null/false は飛ばす */
export function Meta({ parts, className = '' }: { parts: React.ReactNode[]; className?: string }) {
  const xs = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '');
  return (
    <span className={`text-[13px] text-muted-foreground ${className}`}>
      {xs.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="mx-1 text-muted-foreground/60">·</span>}
          {p}
        </React.Fragment>
      ))}
    </span>
  );
}

/** 重なった丸いアイコン（配信者・メンバー） */
export function AvatarStack({ images, size = 22, max = 4, label }: { images: (string | null | undefined)[]; size?: number; max?: number; label?: string }) {
  const shown = images.slice(0, max);
  if (!shown.length) return null;
  return (
    <span className="inline-flex items-center" aria-label={label}>
      {shown.map((src, i) => (
        <span
          key={i}
          className="inline-block overflow-hidden rounded-full bg-secondary ring-2 ring-background"
          style={{ width: size, height: size, marginLeft: i ? -size / 3 : 0 }}
        >
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * 画面に 1 つだけの大きなカード。画像の上に文字を載せる（下を暗くして読めるように）。
 * PC は横長に抑える（縦に場所を取りすぎない）
 */
export function Hero({
  image,
  kicker,
  title,
  fact,
  onClick,
  href,
  anchor,
  ratio = '460 / 215',
  badge,
  ariaLabel,
}: {
  image: string | null;
  kicker: string;
  title: string;
  fact?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  anchor?: string;
  ratio?: string;
  badge?: React.ReactNode;
  ariaLabel?: string;
}) {
  const body = (
    <>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      {badge && <div className="absolute left-4 top-4">{badge}</div>}
      <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
        <p className="text-[12px] font-semibold tracking-wide text-white/80">{kicker}</p>
        <h3 className="mt-0.5 line-clamp-2 text-[22px] font-bold leading-tight text-white sm:text-[26px]">{title}</h3>
        {fact && <p className="mt-1 line-clamp-1 text-[13px] text-white/85">{fact}</p>}
      </div>
    </>
  );
  // スマホは少し縦長（16:10）にして、下の暗い部分に文字の余白を作る。sm 以上は ratio（既定は Steam のヘッダー比）
  const cls = 'group relative block w-full overflow-hidden rounded-2xl bg-secondary text-left aspect-[16/10] sm:aspect-[var(--hero-ratio)] sm:rounded-3xl';
  const style = { ['--hero-ratio' as string]: ratio.replace(/\s/g, ''), maxHeight: 360 } as React.CSSProperties;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls} style={style} data-tour={anchor} aria-label={ariaLabel}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} style={style} data-tour={anchor} aria-label={ariaLabel}>
      {body}
    </button>
  );
}

/** 順位つきの 1 行（App Store のランキング風）。rank を省くと番号なしの行 */
export function RankRow({
  rank,
  thumb,
  thumbRatio = '460 / 215',
  title,
  meta,
  right,
  onClick,
  href,
  anchor,
  ariaLabel,
}: {
  rank?: number;
  thumb: string | null;
  thumbRatio?: string;
  title: string;
  meta?: React.ReactNode;
  right?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  anchor?: string;
  ariaLabel?: string;
}) {
  const body = (
    <>
      {rank != null && <span className="w-5 flex-shrink-0 text-center text-[15px] font-bold tabular-nums text-muted-foreground">{rank}</span>}
      <span className="relative h-[40px] flex-shrink-0 overflow-hidden rounded-md bg-secondary" style={{ aspectRatio: thumbRatio }}>
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-snug text-foreground">{title}</span>
        {meta && <span className="block truncate leading-snug">{meta}</span>}
      </span>
      {right && <span className="flex flex-shrink-0 items-center">{right}</span>}
    </>
  );
  const cls = 'flex min-h-[56px] w-full items-center gap-3 py-2 text-left transition-colors hover:bg-secondary/50 sm:rounded-xl sm:px-2';
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls} data-tour={anchor} aria-label={ariaLabel}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} data-tour={anchor} aria-label={ariaLabel}>
      {body}
    </button>
  );
}

/** RankRow を並べる箱（行の間に細い線） */
export function RankList({ children, ariaLabel }: { children: React.ReactNode; ariaLabel?: string }) {
  return (
    <div className="divide-y divide-border/60 px-4 sm:px-4" role="list" aria-label={ariaLabel}>
      {children}
    </div>
  );
}
