'use client';

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Info, Play } from 'lucide-react';
import { useInView } from 'react-intersection-observer';
import { api, PlayableItem, SharedTrack, SharedTrackChannel, SharedTracksResponse } from '@/utils/api';
import { Loading } from '@/components/ui/loading';
import { Button } from '@/components/ui/button';

/**
 * 「曲置き場」タブ: Discord の曲置き場などに貼られた曲を一覧し、タップでキューに追加する画面。
 *
 * - データは `GET /shared-tracks/{guild_id}`（認証不要）。30秒だけメモリにキャッシュする
 * - 見た目はホームの曲カード（HomeScreen の TrackCard / HistoryCard）に合わせる
 * - 読み取り専用モード（ログイン前プレビュー）ではタップで signIn を促す
 */

const CACHE_TTL_MS = 30 * 1000;
const cache = new Map<string, { at: number; data: SharedTracksResponse }>();

/** メタ解決前でもサムネだけは YouTube から出せる */
export const shelfThumbnail = (item: SharedTrack): string =>
  item.thumbnail || `https://i.ytimg.com/vi/${item.video_id}/hqdefault.jpg`;

/** タイトル未解決の控えめな代替 */
export const shelfTitle = (item: SharedTrack): string => item.title || 'YouTube 動画';

export const sharedTrackToPlayable = (item: SharedTrack): PlayableItem => ({
  title: shelfTitle(item),
  artist: item.artist || '',
  thumbnail: shelfThumbnail(item),
  url: item.url,
  type: 'song',
});

/** 「3分前」「昨日」程度のゆるい相対表記 */
function formatPostedAt(iso: string): string {
  const posted = new Date(iso).getTime();
  if (Number.isNaN(posted)) return '';
  const diffMin = Math.floor((Date.now() - posted) / 60000);
  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}日前`;
  const d = new Date(posted);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const ShelfCard = memo(({
  item,
  onSelect,
  tourAnchor,
}: {
  item: SharedTrack;
  onSelect: (item: SharedTrack) => void;
  /** 画面案内で指す目印（data-tour） */
  tourAnchor?: string;
}) => {
  const [ref, inView] = useInView({ triggerOnce: true, threshold: 0.1 });
  const title = shelfTitle(item);
  const postedAt = formatPostedAt(item.posted_at);
  const postedBy = item.posted_by?.name || '';

  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={() => onSelect(item)}
      data-tour={tourAnchor}
      // self-start: グリッドで縦に引き伸ばされると button の中身が上下中央に寄って
      // カードの高さ（アーティスト行の有無）でサムネの位置がずれるため
      className="group cursor-pointer text-left w-full self-start"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      aria-label={`${title}をキューに追加`}
    >
      {/* Album Art Container */}
      <div className="relative aspect-square rounded-xl overflow-hidden bg-secondary/30 shadow-sm mb-3">
        {inView && (
          <>
            <Image
              src={shelfThumbnail(item)}
              alt={title}
              fill
              style={{ objectFit: 'cover' }}
              className="transition-transform duration-500 group-hover:scale-105"
              unoptimized
            />
            {/* 貼った人 */}
            {item.posted_by?.image && (
              <div className="absolute top-2 right-2">
                <Image
                  src={item.posted_by.image}
                  alt={postedBy || 'User'}
                  width={28}
                  height={28}
                  className="rounded-full border-2 border-white shadow-md"
                  unoptimized
                />
              </div>
            )}
            {/* 再生アイコン（装飾。クリックはカード全体で受ける） */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-300 flex items-center justify-center pointer-events-none">
              <span className="apple-play-button opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-300">
                <Play className="w-6 h-6 text-white fill-white ml-0.5" />
              </span>
            </div>
          </>
        )}
      </div>

      {/* Track Info */}
      <div className="px-1">
        <h3 className="font-semibold text-[13px] text-foreground leading-tight line-clamp-2 mb-1">
          {title}
        </h3>
        {item.artist && (
          <p className="text-[12px] text-muted-foreground truncate">{item.artist}</p>
        )}
        <p className="text-[11px] text-muted-foreground/80 truncate flex items-center gap-1 mt-0.5">
          {item.posted_by?.image && (
            <Image
              src={item.posted_by.image}
              alt=""
              width={14}
              height={14}
              className="rounded-full flex-shrink-0"
              unoptimized
            />
          )}
          <span className="truncate">{postedBy}</span>
          {postedAt && <span className="flex-shrink-0">· {postedAt}</span>}
        </p>
      </div>
    </motion.button>
  );
});

ShelfCard.displayName = 'ShelfCard';

interface ShelfScreenProps {
  guildId: string | null;
  /** 曲をキューへ（MainApp の addToQueue 経由）。読み取り専用のときは呼ばれない */
  onSelectTrack?: (item: PlayableItem) => void | Promise<void>;
  /** ログイン前プレビュー: タップで signIn を促す */
  readOnly?: boolean;
  onRequireSignIn?: () => void;
  /** 'page' = タブの中身として高さいっぱい / 'embedded' = 親のスクロールに乗せる */
  variant?: 'page' | 'embedded';
  /** 「使い方」から画面案内を始める（ログイン後のアプリのみ） */
  onShowGuide?: () => void;
}

export const ShelfScreen: React.FC<ShelfScreenProps> = ({
  guildId,
  onSelectTrack,
  readOnly = false,
  onRequireSignIn,
  variant = 'page',
  onShowGuide,
}) => {
  const [data, setData] = useState<SharedTracksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!guildId) {
      setData(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      const cached = cache.get(guildId);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS && reloadToken === 0) {
        setData(cached.data);
        setError(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const result = await api.getSharedTracks(guildId);
        if (cancelled) return;
        cache.set(guildId, { at: Date.now(), data: result });
        setData(result);
        setError(false);
      } catch (e) {
        if (cancelled) return;
        console.error('曲置き場の取得に失敗しました:', e);
        setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [guildId, reloadToken]);

  // 初期表示は「曲置き場」チャンネルに絞る（あれば）。このタブの主役は曲置き場で、「一般」は補助
  const initialChannelPickedRef = useRef(false);
  useEffect(() => {
    if (initialChannelPickedRef.current || !data) return;
    initialChannelPickedRef.current = true;
    const shelfChannel = data.channels.find((c) => c.name === '曲置き場');
    if (shelfChannel) setChannelId(shelfChannel.id);
  }, [data]);

  const handleSelect = useCallback(
    (item: SharedTrack) => {
      if (readOnly) {
        onRequireSignIn?.();
        return;
      }
      onSelectTrack?.(sharedTrackToPlayable(item));
    },
    [readOnly, onRequireSignIn, onSelectTrack]
  );

  const channels: SharedTrackChannel[] = data?.channels ?? [];
  const tracks = useMemo(() => {
    const all = data?.tracks ?? [];
    return channelId ? all.filter((t) => t.channel_id === channelId) : all;
  }, [data, channelId]);

  const totalCount = data?.tracks.length ?? 0;

  const body = (() => {
    if (!guildId) {
      return (
        <p className="text-sm text-muted-foreground py-10 text-center" data-tour="shelf-empty">
          サーバーを選択すると、貼られた曲が並びます
        </p>
      );
    }
    if (loading && !data) {
      return (
        <div className="py-16 flex items-center justify-center">
          <Loading size="large" text="読み込み中..." />
        </div>
      );
    }
    if (error && !data) {
      return (
        <div className="py-12 flex flex-col items-center gap-3" data-tour="shelf-empty">
          <p className="text-sm text-muted-foreground">曲置き場を読み込めませんでした</p>
          <Button variant="outline" size="sm" onClick={() => setReloadToken((v) => v + 1)}>
            再読み込み
          </Button>
        </div>
      );
    }
    if (tracks.length === 0) {
      return (
        <p className="text-sm text-muted-foreground py-10 text-center" data-tour={totalCount === 0 ? 'shelf-empty' : undefined}>
          まだ何も貼られていません
        </p>
      );
    }
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-5">
        {tracks.map((item, i) => (
          <ShelfCard key={item.id} item={item} onSelect={handleSelect} tourAnchor={i === 0 ? 'shelf-first-card' : undefined} />
        ))}
      </div>
    );
  })();

  // どこから来た曲なのかを一行で。ここに曲が並ぶ仕組みを知らない人向け
  const intro = variant === 'page' && (
    <div className="mb-3 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
      <Info className="mt-[3px] h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      <p className="min-w-0">
        Discord のチャンネルに貼られた YouTube のリンクが、ここに自動で並びます。押すとキューに追加されます。
        {onShowGuide && (
          <button
            type="button"
            onClick={onShowGuide}
            className="ml-1.5 font-medium text-primary hover:text-primary/80 underline-offset-2 hover:underline"
          >
            使い方
          </button>
        )}
      </p>
    </div>
  );

  const chips = channels.length > 0 && (
    <div className="flex w-fit max-w-full gap-2 overflow-x-auto scrollbar-thin pb-1 mb-4" role="group" aria-label="チャンネルで絞り込む" data-tour="shelf-channels">
      <button
        type="button"
        onClick={() => setChannelId(null)}
        aria-pressed={channelId === null}
        className={`flex-shrink-0 h-8 px-3 rounded-full text-[13px] font-medium border transition-colors ${
          channelId === null
            ? 'bg-primary text-white border-transparent'
            : 'bg-card text-muted-foreground border-border hover:text-foreground'
        }`}
      >
        すべて {totalCount}
      </button>
      {channels.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => setChannelId(c.id)}
          aria-pressed={channelId === c.id}
          className={`flex-shrink-0 h-8 px-3 rounded-full text-[13px] font-medium border transition-colors ${
            channelId === c.id
              ? 'bg-primary text-white border-transparent'
              : 'bg-card text-muted-foreground border-border hover:text-foreground'
          }`}
        >
          {c.name} {c.count}
        </button>
      ))}
    </div>
  );

  const content = (
    <>
      {intro}
      {chips}
      {body}
    </>
  );

  if (variant === 'embedded') {
    return <div>{content}</div>;
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-background">
      <div className="px-4 sm:px-6 py-4 sm:py-6">{content}</div>
    </div>
  );
};

export default ShelfScreen;
