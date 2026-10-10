'use client';

import React, { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { ScrollRow } from '@/components/home/ScrollRow';
import { appApi, SceneSong } from '@/lib/app-api';
import type { PlayableItem } from '@/utils/api';

/**
 * 曲置き場の「界隈の新曲」。ゲーム置き場の「界隈で話題」と対になる。
 *
 * 材料は、曲置き場に貼られたことのある歌い手・アーティストのチャンネルと、メンバーがよく見る配信者・VTuber の
 * 新曲・MV・歌ってみた・踊ってみた（30 日）。何人もやっている曲（流行り）が上に来る。
 * データは `GET /scene/{guild}/songs`（本人のトークン、メンバーのみ）。押すとキューに追加
 */

const cache = new Map<string, { at: number; songs: SceneSong[] }>();
const CACHE_MS = 5 * 60_000;

const TYPE_LABEL: Record<string, string> = {
  original: '新曲',
  mv: 'MV',
  cover: '歌ってみた',
  dance: '踊ってみた',
  live: 'ライブ',
  short: 'ショート',
};

const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

function SongCard({ s, onPlay, anchor }: { s: SceneSong; onPlay: (item: PlayableItem) => void; anchor?: string }) {
  const top = s.videos[0];
  const title = s.song || top.title;
  const thumb = top.thumb || `https://i.ytimg.com/vi/${top.video_id}/mqdefault.jpg`;
  const label = top.type ? TYPE_LABEL[top.type] : null;
  const playOrig = !!s.orig_video_id && s.orig_video_id !== s.play_video_id;
  return (
    <div className="w-[200px] min-w-[200px] self-start sm:w-[220px] sm:min-w-[220px]" data-tour={anchor}>
      <button
        type="button"
        onClick={() => onPlay({ title, artist: s.artist || top.channel, thumbnail: thumb, url: watch(s.play_video_id), type: 'song' })}
        className="group block w-full text-left"
        aria-label={`${title} をキューに追加`}
      >
        <div className="relative mb-2 overflow-hidden rounded-xl bg-secondary" style={{ aspectRatio: '16 / 9' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
          {label && <span className="absolute left-2 top-2 rounded-md bg-background/90 px-1.5 py-0.5 text-[10.5px] font-bold text-foreground">{label}</span>}
        </div>
        <h3 className="line-clamp-1 text-[13.5px] font-semibold text-foreground">{title}</h3>
        <p className="line-clamp-1 text-[12px] text-muted-foreground">{s.hook || `${top.channel}${s.artist ? `・${s.artist}` : ''}`}</p>
      </button>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
        {s.people > 1 && <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{s.people}人がやってる</span>}
        {s.posted_affinity >= 2 && <span className="rounded-full bg-secondary px-2 py-0.5 font-semibold text-foreground/75">よく貼られる人</span>}
        {playOrig && (
          <button
            type="button"
            onClick={() => onPlay({ title, artist: s.artist || '', thumbnail: `https://i.ytimg.com/vi/${s.orig_video_id}/mqdefault.jpg`, url: watch(s.orig_video_id!), type: 'song' })}
            className="font-semibold text-primary hover:text-primary/80"
          >
            原曲を流す
          </button>
        )}
      </div>
    </div>
  );
}

export function SceneSongs({ guildId, onSelectTrack }: { guildId: string; onSelectTrack?: (item: PlayableItem) => void }) {
  const [songs, setSongs] = useState<SceneSong[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const hit = cache.get(guildId);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      setSongs(hit.songs);
      return;
    }
    appApi
      .sceneSongs(guildId)
      .then((r) => {
        if (cancelled) return;
        cache.set(guildId, { at: Date.now(), songs: r.songs });
        setSongs(r.songs);
      })
      .catch(() => !cancelled && setSongs([]));
    return () => {
      cancelled = true;
    };
  }, [guildId]);

  if (!songs || songs.length === 0) return null;
  return (
    <section className="mb-7 -mx-4 sm:-mx-6" data-tour="shelf-scene">
      <h2 className="mb-3 flex items-baseline gap-2 px-4 text-[17px] font-bold tracking-tight text-foreground sm:px-6">
        <Flame className="h-4 w-4 self-center text-primary" />
        <span className="flex-shrink-0">界隈の新曲</span>
        <span className="truncate text-[11.5px] font-medium text-muted-foreground">よく貼られる人・配信者の新着</span>
      </h2>
      <ScrollRow className="gap-4" ariaLabel="界隈の新曲">
        <div className="w-0.5 flex-shrink-0 sm:w-2" aria-hidden="true" />
        {songs.map((s, i) => (
          <SongCard key={s.key} s={s} onPlay={(item) => onSelectTrack?.(item)} anchor={i === 0 ? 'shelf-scene-first' : undefined} />
        ))}
        <div className="w-0.5 flex-shrink-0 sm:w-2" aria-hidden="true" />
      </ScrollRow>
    </section>
  );
}

export default SceneSongs;
