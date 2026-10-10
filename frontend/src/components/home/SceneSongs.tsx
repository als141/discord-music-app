'use client';

import React, { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { AvatarStack, Hero, Meta, RankList, RankRow, SectionHeader } from '@/components/games/ui';
import { appApi, SceneSong } from '@/lib/app-api';
import type { PlayableItem } from '@/utils/api';

/**
 * 曲置き場の「界隈の新曲」。ゲーム置き場の「界隈で話題」と同じ部品・同じ形（1 位を大きく＋順位）で対になる。
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
const thumbOf = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/** 「葛葉 / Kuzuha」→「葛葉」 */
const cleanName = (n: string) => n.split(/\s*[/／|｜【(（]\s*/)[0].trim() || n;

function songTitle(s: SceneSong): string {
  return s.song || s.videos[0].title;
}

function songMeta(s: SceneSong): React.ReactNode[] {
  const top = s.videos[0];
  const who = Array.from(new Set(s.videos.map((v) => cleanName(v.channel))));
  return [
    top.type ? TYPE_LABEL[top.type] : null,
    s.artist || cleanName(top.channel),
    s.people > 1 ? <span key="p" className="font-semibold text-primary">{s.people}人がやってる</span> : who.length > 1 ? who.slice(0, 2).join('、') : null,
  ];
}

function toItem(s: SceneSong, videoId: string): PlayableItem {
  const top = s.videos[0];
  return { title: songTitle(s), artist: s.artist || cleanName(top.channel), thumbnail: thumbOf(videoId), url: watch(videoId), type: 'song' };
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
  const play = (s: SceneSong, id = s.play_video_id) => onSelectTrack?.(toItem(s, id));
  const [first, ...rest] = songs;
  const firstTop = first.videos[0];
  return (
    <section className="-mx-4 mb-10 sm:-mx-6" data-tour="shelf-scene">
      <SectionHeader title="界隈の新曲" caption="よく貼られる人・配信者の新着" />
      <div className="px-4 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start lg:gap-6" aria-label="界隈の新曲">
        <div>
          <Hero
            image={thumbOf(first.play_video_id).replace('mqdefault', 'hqdefault')}
            ratio="16 / 9"
            kicker={first.people > 1 ? `${first.people}人がやってる` : firstTop.type ? `界隈の${TYPE_LABEL[firstTop.type]}` : '界隈の新曲'}
            title={songTitle(first)}
            fact={[first.artist || cleanName(firstTop.channel), first.hook].filter(Boolean).join(' · ')}
            onClick={() => play(first)}
            anchor="shelf-scene-first"
            ariaLabel={`${songTitle(first)} をキューに追加`}
            badge={
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-foreground shadow-md" aria-hidden="true">
                <Play className="ml-0.5 h-5 w-5 fill-current" />
              </span>
            }
          />
          {first.orig_video_id && first.orig_video_id !== first.play_video_id && (
            <button type="button" onClick={() => play(first, first.orig_video_id!)} className="mt-2 text-[13px] font-semibold text-primary hover:text-primary/80">
              原曲を流す
            </button>
          )}
        </div>
        <div className="-mx-4 mt-2 sm:mx-0 lg:mt-0">
          <RankList>
            {rest.slice(0, 7).map((s, i) => {
              const top = s.videos[0];
              return (
                <RankRow
                  key={s.key}
                  rank={i + 2}
                  thumb={top.thumb || thumbOf(s.play_video_id)}
                  thumbRatio="16 / 9"
                  title={songTitle(s)}
                  meta={<Meta parts={songMeta(s)} />}
                  right={<AvatarStack images={Array.from(new Set(s.videos.map((v) => v.channel_image)))} size={24} max={3} />}
                  onClick={() => play(s)}
                  ariaLabel={`${songTitle(s)} をキューに追加`}
                />
              );
            })}
          </RankList>
        </div>
      </div>
    </section>
  );
}

export default SceneSongs;
