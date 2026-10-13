'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Meta, SectionHeader } from '@/components/games/ui';
import { appApi, RecoFeed, RecoItem, RecoMood } from '@/lib/app-api';
import type { PlayableItem } from '@/utils/api';

/**
 * 曲置き場の「ドデカのおすすめ」。ドデカで流れた・貼られた・置かれた曲（2024 年の bot チャンネルの頃から）を材料に、
 * 4 つの気分で 12 曲ずつ。押すとキューに入る。×で外すと 90 日出なくなり、次の選曲にも効く。
 * - いま聴きたい: 最近よく流れる曲から広げた曲＋最近流れてない定番
 * - 懐かしい: 半年以上前にドデカで流れた曲（だれが・いつ）＋10 年以上前の名曲
 * - 新しい: 好きなアーティストの今年の曲
 * - ニコニコ: 今週伸びてる・関連・殿堂入り
 * データは `GET /reco/{guild}/feed`（本人のトークン、メンバーのみ）。曲置き箱に置くと `irina-reco-changed` で取り直す
 */

export const RECO_CHANGED = 'irina-reco-changed';

const MOODS: { id: RecoMood; label: string }[] = [
  { id: 'now', label: 'いま聴きたい' },
  { id: 'memories', label: '懐かしい' },
  { id: 'new', label: '新しい' },
  { id: 'nico', label: 'ニコニコ' },
];
const FIRST = 6;
const cache = new Map<string, { at: number; feed: RecoFeed }>();
const CACHE_MS = 2 * 60_000;

function toPlayable(it: RecoItem): PlayableItem {
  return { title: it.title, artist: it.artist, thumbnail: it.thumb || '', url: it.url, type: 'song' };
}

function RecoRow({ it, onPlay, onDismiss, anchor }: { it: RecoItem; onPlay: () => void; onDismiss: () => void; anchor?: string }) {
  return (
    <div className="flex min-h-[70px] items-center gap-1 sm:rounded-xl sm:pr-1 sm:hover:bg-secondary/50" role="listitem" data-tour={anchor}>
      <button type="button" onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left sm:pl-2" aria-label={`${it.title} をキューに追加`}>
        <span className="relative h-[54px] flex-shrink-0 overflow-hidden rounded-md bg-secondary" style={{ aspectRatio: '16 / 9' }}>
          {it.thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
          )}
        </span>
        {/* 題名 → 理由（いちばん伝えたいこと）→ アーティストなど */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-snug text-foreground">{it.title}</span>
          <span className="block truncate text-[13px] leading-snug text-foreground/80">{it.reason}</span>
          <Meta parts={[it.artist || null, it.label, it.sub]} className="block truncate leading-snug" />
        </span>
      </button>
      {it.who?.image && (
        <span className="h-6 w-6 flex-shrink-0 overflow-hidden rounded-full bg-secondary" title={it.who.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={it.who.image} alt={it.who.name} className="h-full w-full object-cover" />
        </span>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="flex h-10 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground/60 hover:bg-secondary hover:text-foreground"
        aria-label={`${it.title} をおすすめから外す`}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function RecoPanel({ guildId, onEnqueue }: { guildId: string; onEnqueue?: (item: PlayableItem) => void }) {
  const [feed, setFeed] = useState<RecoFeed | null>(() => cache.get(guildId)?.feed ?? null);
  const [error, setError] = useState(false);
  const [mood, setMood] = useState<RecoMood>('now');
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (force = false) => {
      const hit = cache.get(guildId);
      if (!force && hit && Date.now() - hit.at < CACHE_MS) {
        setFeed(hit.feed);
        return;
      }
      try {
        const f = await appApi.recoFeed(guildId);
        cache.set(guildId, { at: Date.now(), feed: f });
        setFeed(f);
        setError(false);
      } catch {
        setError(true);
      }
    },
    [guildId]
  );

  useEffect(() => {
    void load();
    const onChanged = () => void load(true);
    window.addEventListener(RECO_CHANGED, onChanged);
    return () => window.removeEventListener(RECO_CHANGED, onChanged);
  }, [load]);

  useEffect(() => setExpanded(false), [mood]);

  if (error && !feed) return null;

  const items = (feed?.moods[mood] ?? []).filter((it) => !hidden.has(it.key));
  const shown = expanded ? items : items.slice(0, FIRST);

  const play = (it: RecoItem) => {
    onEnqueue?.(toPlayable(it));
    appApi.recoFeedback(guildId, it.key, 'play', mood).catch(() => {});
  };
  const dismiss = (it: RecoItem) => {
    setHidden((s) => new Set(s).add(it.key));
    cache.delete(guildId);
    appApi.recoFeedback(guildId, it.key, 'dismiss', mood).catch(() => {});
  };
  const playTop = async () => {
    for (const it of items.slice(0, 5)) {
      play(it);
      await new Promise((r) => setTimeout(r, 350));
    }
  };

  const stats = feed?.stats;
  return (
    <section className="-mx-4 mb-10 sm:-mx-6" data-tour="reco-panel" aria-label="ドデカのおすすめ">
      <SectionHeader
        title="ドデカのおすすめ"
        caption={stats ? `${stats.songs}曲・${stats.people}人の記録から` : undefined}
        action={
          items.length > 0 && (
            <button type="button" onClick={() => void playTop()} className="h-9 rounded-full px-3 text-[13px] font-semibold text-primary hover:bg-primary/10">
              5曲流す
            </button>
          )
        }
      />
      <div className="mb-1 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-thin sm:px-6" role="tablist" aria-label="気分" data-tour="reco-moods">
        {MOODS.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mood === m.id}
            onClick={() => setMood(m.id)}
            className={`h-9 flex-shrink-0 rounded-full px-3.5 text-[14px] font-semibold transition-colors ${
              mood === m.id ? 'bg-foreground text-background' : 'bg-secondary/70 text-foreground/70 hover:text-foreground'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="px-4 sm:px-4">
        {!feed ? (
          <div className="space-y-2 py-2" aria-label="読み込み中">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 py-1.5">
                <span className="h-[54px] w-[96px] animate-pulse rounded-md bg-secondary" />
                <span className="flex-1 space-y-1.5">
                  <span className="block h-3.5 w-2/3 animate-pulse rounded bg-secondary" />
                  <span className="block h-3 w-1/2 animate-pulse rounded bg-secondary" />
                </span>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">まだ材料が足りません。下の曲置き箱に置くと増えます</p>
        ) : (
          <div className="divide-y divide-border/60" role="list" aria-label={MOODS.find((m) => m.id === mood)?.label}>
            {shown.map((it, i) => (
              <RecoRow key={it.key} it={it} onPlay={() => play(it)} onDismiss={() => dismiss(it)} anchor={i === 0 ? 'reco-first' : undefined} />
            ))}
          </div>
        )}
        {feed && items.length > FIRST && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 h-10 w-full rounded-xl text-[13px] font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            {expanded ? 'たたむ' : `あと ${items.length - FIRST} 曲`}
          </button>
        )}
      </div>
    </section>
  );
}

export default RecoPanel;
