'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Check, Play, X } from 'lucide-react';

/**
 * 曲置き場の 1 行（おすすめ・置き場で共通）。行ぜんたいを押すとキューへ。
 * 押した行はその場で「キューに追加しました」に変わる（並びは動かさない）
 */
export function SongRow({
  thumb,
  title,
  line2,
  line3,
  onPlay,
  added,
  onRemove,
  removeLabel,
  anchor,
}: {
  thumb: string | null;
  title: string;
  line2: React.ReactNode;
  line3?: React.ReactNode;
  onPlay: () => void;
  added?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
  anchor?: string;
}) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
      className="group flex items-center gap-1 rounded-xl hover:bg-secondary/60"
      role="listitem"
      data-tour={anchor}
    >
      <button type="button" onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 px-1 py-2 text-left sm:px-2" aria-label={`${title} をキューに追加`}>
        <span className="relative h-[52px] w-[52px] flex-shrink-0 overflow-hidden rounded-lg bg-secondary">
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <span
            className={`absolute inset-0 flex items-center justify-center bg-black/40 text-white transition-opacity ${
              added ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            aria-hidden="true"
          >
            {added ? <Check className="h-5 w-5" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-snug text-foreground">{title}</span>
          <span className="block truncate text-[13px] leading-snug text-foreground/80">
            {added ? <span className="font-semibold text-primary">キューに追加しました</span> : line2}
          </span>
          {line3 && <span className="block truncate text-[12px] leading-snug text-muted-foreground">{line3}</span>}
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="flex h-10 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground/50 hover:bg-secondary hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          aria-label={removeLabel}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </motion.div>
  );
}

/** 「2時間前」 */
export function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min) || min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}時間前`;
  const d = Math.floor(min / 1440);
  if (d < 30) return `${d}日前`;
  const dt = new Date(iso);
  return `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
}

/** 行の 2 行目に出す「・」区切り */
export function dots(parts: React.ReactNode[]): React.ReactNode {
  const xs = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '');
  return xs.map((p, i) => (
    <React.Fragment key={i}>
      {i > 0 && <span className="mx-1 text-muted-foreground/50">·</span>}
      {p}
    </React.Fragment>
  ));
}
