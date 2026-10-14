'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Play } from 'lucide-react';
import { appApi, RecoFeed as Feed, RecoItem } from '@/lib/app-api';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useIsDesktop } from '@/hooks/use-media-query';
import type { PlayableItem } from '@/utils/api';
import { SHELF_CHANGED } from './PlaceBar';
import { dots, SongRow } from './SongRow';

/**
 * 「いまのおすすめ」。一面に混ぜる（続けて・懐かしい・新曲・界隈・ニコニコ・定番）。
 * いま流れてる曲・キュー・さっき置いた曲が変わると、その場で取り直して上が入れ替わる
 * （流れてる「○○」に合わせて）。押した行は並びを動かさずに「キューに追加しました」へ。
 * 取り直すのは: 流れてる曲が変わったとき（1 秒後）・曲を置いたとき・キューが変わって 3 秒たったとき
 */

const MOBILE_FIRST = 10;
const FIRST_LIMIT = 18;
const STEP = 20;
const MAX = 120;

function toPlayable(it: RecoItem): PlayableItem {
  return { title: it.title, artist: it.artist, thumbnail: it.thumb || '', url: it.url, type: 'song' };
}

export function RecoFeed({ guildId, onEnqueue }: { guildId: string; onEnqueue?: (item: PlayableItem) => void }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // 何曲見せるか（「もっと見る」で 20 曲ずつ。足りなければサーバーに limit を増やして聞く。上の並びは変わらない）
  const [visible, setVisible] = useState<number | null>(null);
  const limitRef = useRef(FIRST_LIMIT);
  const [fetchingMore, setFetchingMore] = useState(false);
  const isDesktop = useIsDesktop();
  const lastTap = useRef(0);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const f = await appApi.recoFeed(guildId, limitRef.current);
      if (my !== seq.current) return;
      setFeed(f);
      setError(false);
    } catch {
      if (my === seq.current) setError(true);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener(SHELF_CHANGED, onChanged);
    return () => window.removeEventListener(SHELF_CHANGED, onChanged);
  }, [load]);

  // 流れてる曲が変わったら（ほぼすぐ）
  const currentUrl = usePlayerStore((s) => s.currentTrack?.url ?? '');
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = window.setTimeout(() => void load(), 1000);
    return () => window.clearTimeout(t);
  }, [currentUrl, load]);

  // キューが変わったら、押すのが止まって 3 秒たってから（押している最中に並びを動かさない）
  const queueSig = usePlayerStore((s) => s.queue.map((q) => q.url).join('|'));
  const firstQueue = useRef(true);
  useEffect(() => {
    if (firstQueue.current) {
      firstQueue.current = false;
      return;
    }
    const wait = Math.max(3000, 3000 - (Date.now() - lastTap.current));
    const t = window.setTimeout(() => void load(), wait);
    return () => window.clearTimeout(t);
  }, [queueSig, load]);

  if (error && !feed) return null;

  const items = (feed?.items ?? []).filter((it) => !hidden.has(it.key));
  const show = visible ?? (isDesktop ? FIRST_LIMIT : MOBILE_FIRST);
  const shown = items.slice(0, show);
  const canMore = items.length > show || !!feed?.has_more;
  const showMore = async (all = false) => {
    const next = all ? MAX : Math.min(MAX, show + STEP);
    setVisible(next);
    if (next > items.length && feed?.has_more && limitRef.current < next) {
      limitRef.current = Math.min(MAX, next + 10);
      setFetchingMore(true);
      await load();
      setFetchingMore(false);
    }
  };

  const play = (it: RecoItem) => {
    lastTap.current = Date.now();
    setAdded((s) => new Set(s).add(it.key));
    onEnqueue?.(toPlayable(it));
    appApi.recoFeedback(guildId, it.key, 'play', it.kind).catch(() => {});
  };
  const dismiss = (it: RecoItem) => {
    setHidden((s) => new Set(s).add(it.key));
    appApi.recoFeedback(guildId, it.key, 'dismiss', it.kind).catch(() => {});
  };
  const playTop = async () => {
    for (const it of items.filter((x) => !added.has(x.key)).slice(0, 5)) {
      play(it);
      await new Promise((r) => setTimeout(r, 350));
    }
  };

  const label = feed?.context.label;
  const caption = label ?? (feed ? `${feed.stats.songs}曲・${feed.stats.people}人の記録から` : '');
  return (
    <section className="mb-10" data-tour="reco-feed" aria-label="いまのおすすめ">
      <div className="mb-3 px-1">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[20px] font-bold leading-tight tracking-tight text-foreground">いまのおすすめ</h2>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => void playTop()}
              className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[13px] font-semibold text-background hover:bg-foreground/90"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              まとめて流す
            </button>
          )}
        </div>
        {/* いま何に合わせているか（入れ替わったことが分かるように、変わるときは動かす） */}
        <div className="mt-1 flex h-5 items-center gap-1.5 overflow-hidden text-[13px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={caption}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className={`flex min-w-0 items-center gap-1.5 ${label ? 'font-semibold text-primary' : 'text-muted-foreground'}`}
              data-testid="reco-caption"
            >
              {label && <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-primary" aria-hidden="true" />}
              <span className="truncate">{caption}</span>
            </motion.span>
          </AnimatePresence>
          {loading && feed && <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-muted-foreground" aria-label="更新中" />}
        </div>
      </div>

      {!feed ? (
        <div className="grid gap-x-4 md:grid-cols-2" aria-label="読み込み中">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <span className="h-[52px] w-[52px] animate-pulse rounded-lg bg-secondary" />
              <span className="flex-1 space-y-1.5">
                <span className="block h-3.5 w-2/3 animate-pulse rounded bg-secondary" />
                <span className="block h-3 w-1/2 animate-pulse rounded bg-secondary" />
              </span>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="px-1 py-6 text-[13px] text-muted-foreground">まだ材料が足りません。上に曲を置くと増えます</p>
      ) : (
        <div className="grid gap-x-4 md:grid-cols-2" role="list" aria-label="いまのおすすめ">
          <AnimatePresence initial={false}>
            {shown.map((it, i) => (
              <SongRow
                key={it.key}
                thumb={it.thumb}
                title={it.title}
                line2={dots([
                  <span key="t" className={`font-semibold ${it.kind === 'context' ? 'text-primary' : 'text-foreground/70'}`}>{it.tag}</span>,
                  it.reason,
                ])}
                line3={dots([it.artist || null, it.label, it.sub])}
                onPlay={() => play(it)}
                added={added.has(it.key)}
                onRemove={() => dismiss(it)}
                removeLabel={`${it.title} をおすすめから外す`}
                anchor={i === 0 ? 'reco-first' : undefined}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
      {feed && items.length > 0 && (canMore || show > (isDesktop ? FIRST_LIMIT : MOBILE_FIRST)) && (
        <div className="mt-1 flex gap-2">
          {canMore && (
            <>
              <button
                type="button"
                onClick={() => void showMore()}
                disabled={fetchingMore}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-60"
              >
                {fetchingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                もっと見る
              </button>
              <button
                type="button"
                onClick={() => void showMore(true)}
                disabled={fetchingMore}
                className="h-10 flex-shrink-0 rounded-xl px-4 text-[13px] font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-60"
              >
                すべて表示
              </button>
            </>
          )}
          {show > (isDesktop ? FIRST_LIMIT : MOBILE_FIRST) && (
            <button
              type="button"
              onClick={() => setVisible(null)}
              className="h-10 flex-shrink-0 rounded-xl px-4 text-[13px] font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            >
              たたむ
            </button>
          )}
        </div>
      )}
      {feed && !canMore && items.length >= MAX && (
        <p className="mt-1 px-1 text-center text-[12px] text-muted-foreground">ここまでの {items.length} 曲がいまのおすすめです</p>
      )}
    </section>
  );
}

export default RecoFeed;
