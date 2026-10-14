'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { appApi, ShelfItem } from '@/lib/app-api';
import type { PlayableItem } from '@/utils/api';
import { SHELF_CHANGED } from './PlaceBar';
import { ago, dots, SongRow } from './SongRow';

/**
 * 「みんなの置き場」。Discord の #曲置き場（と #一般 に貼られた音楽）とアプリで置いた曲を、新しい順に 1 本で。
 * どこから来たかは 3 行目に小さく（#曲置き場・#一般・アプリ）。アプリで置いた曲は誰が置いたかを出さない（自分の分だけ「自分」）。
 * 自分がアプリで置いた曲は × で取り出せる
 */

const STEP = 12;

export function ShelfList({ guildId, onEnqueue, onShowGuide }: { guildId: string; onEnqueue?: (item: PlayableItem) => void; onShowGuide?: () => void }) {
  const [items, setItems] = useState<ShelfItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [count, setCount] = useState(STEP);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const r = await appApi.recoShelf(guildId);
      setItems(r.items);
      setTotal(r.total);
    } catch {
      setItems((v) => v ?? []);
    }
  }, [guildId]);

  useEffect(() => {
    void load();
    window.addEventListener(SHELF_CHANGED, load);
    return () => window.removeEventListener(SHELF_CHANGED, load);
  }, [load]);

  const play = (it: ShelfItem) => {
    setAdded((s) => new Set(s).add(it.key));
    onEnqueue?.({ title: it.title, artist: it.artist, thumbnail: it.thumb || '', url: it.url, type: 'song' });
  };
  const takeOut = async (it: ShelfItem) => {
    if (!it.box_id) return;
    setItems((xs) => (xs ?? []).filter((x) => x.key !== it.key));
    try {
      await appApi.recoBoxRemove(guildId, it.box_id);
      window.dispatchEvent(new Event(SHELF_CHANGED));
    } catch {
      void load();
    }
  };

  const list = items ?? [];
  return (
    <section data-tour="shelf-list" aria-label="みんなの置き場">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold leading-tight tracking-tight text-foreground">みんなの置き場</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{items ? `Discord とアプリから ${total} 曲` : ' '}</p>
        </div>
        {onShowGuide && (
          <button type="button" onClick={onShowGuide} className="h-9 flex-shrink-0 rounded-full px-3 text-[13px] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground">
            使い方
          </button>
        )}
      </div>
      {items && list.length === 0 ? (
        <p className="px-1 py-6 text-[13px] text-muted-foreground" data-tour="shelf-empty">まだ何も置かれていません</p>
      ) : (
        <div className="grid gap-x-4 md:grid-cols-2" role="list" aria-label="置かれた曲">
          <AnimatePresence initial={false}>
            {list.slice(0, count).map((it, i) => (
              <SongRow
                key={it.key}
                thumb={it.thumb}
                title={it.title}
                line2={it.artist || ' '}
                line3={
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    {it.who?.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.who.image} alt="" className="h-4 w-4 flex-shrink-0 rounded-full object-cover" />
                    )}
                    {/* 曲置き箱（アプリ）の曲は誰が置いたかを出さない。自分の分だけ「自分」 */}
                    <span className="truncate">{dots([it.who?.name, it.source, ago(it.at)])}</span>
                  </span>
                }
                onPlay={() => play(it)}
                added={added.has(it.key)}
                onRemove={it.mine && it.box_id ? () => void takeOut(it) : undefined}
                removeLabel={`${it.title} を取り出す`}
                anchor={i === 0 ? 'shelf-first-card' : undefined}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
      {list.length > count && (
        <button
          type="button"
          onClick={() => setCount((c) => c + STEP * 2)}
          className="mt-1 h-10 w-full rounded-xl text-[13px] font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          もっと見る（あと {list.length - count} 曲）
        </button>
      )}
    </section>
  );
}

export default ShelfList;
