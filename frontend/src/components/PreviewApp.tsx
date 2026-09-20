'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { signIn } from 'next-auth/react';
import { PauseIcon, PlayIcon } from 'lucide-react';
import { api, PlayerStateSnapshot, Track } from '@/utils/api';
import { useGuildStore } from '@/store';
import { ShelfScreen } from './home/ShelfScreen';
import { Button } from './ui/button';
import { Loading } from './ui/loading';

/**
 * ログイン前プレビュー（読み取り専用）。
 *
 * 未ログインでもいま流れている曲・キュー・曲置き場が見える。何かを操作しようとした瞬間に
 * `signIn('discord')` を出す（それまでは OAuth 画面に飛ばさない）。
 * backend は認証を要求しないので `GET /player-state/{guild_id}` と `GET /shared-tracks/{guild_id}`
 * をそのまま読める。プレビューでは WebSocket は張らず 30 秒ごとのポーリングで十分。
 * 公開範囲を広げないため、ギルド名は出さない（曲名とキューだけ）。
 */

const FALLBACK_GUILD_ID = '1093915551174234212';
const POLL_INTERVAL_MS = 30 * 1000;

const DiscordMark = () => (
  <svg className="w-4 h-4 mr-1.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

export const PreviewApp: React.FC = () => {
  const [guildId, setGuildId] = useState<string | null>(null);
  const [state, setState] = useState<PlayerStateSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  // 対象ギルド: 以前使っていたサーバー（localStorage に永続化済み）→ 既定ギルド
  // SSR と食い違わないようにマウント後に決める
  useEffect(() => {
    const persisted = useGuildStore.getState().activeServerId;
    setGuildId(persisted || process.env.NEXT_PUBLIC_DEFAULT_GUILD_ID || FALLBACK_GUILD_ID);
  }, []);

  // 30秒ごとに /player-state を読む（WebSocket は張らない）
  useEffect(() => {
    if (!guildId) return;
    let cancelled = false;

    const fetchState = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        const snapshot = await api.getPlayerState(guildId);
        if (!cancelled && snapshot) setState(snapshot);
      } catch (error) {
        // 取得できないときは前回の表示のままにする（プレビューなのでエラーは出さない）
        console.warn('プレイヤー状態を取得できませんでした:', error);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    fetchState();
    const timer = setInterval(fetchState, POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchState();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [guildId]);

  const requireSignIn = useCallback(() => {
    signIn('discord');
  }, []);

  const currentTrack: Track | null = state?.current_track ?? null;
  const isPlaying = !!state?.is_playing;
  const upcoming = useMemo(
    () => (state?.queue ?? []).filter((item) => !item.isCurrent).map((item) => item.track).slice(0, 8),
    [state]
  );

  return (
    <div className="app-shell bg-background text-foreground">
      <header className="fixed top-0 left-0 right-0 z-[100] h-14 glass border-b border-border/70">
        <div className="flex items-center justify-between gap-2 h-full px-3 sm:px-4">
          <span className="font-display text-[20px] leading-none text-foreground select-none pl-1" aria-label="Irina">
            Irina
          </span>
          <Button
            onClick={requireSignIn}
            size="sm"
            className="h-8 px-4 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-full text-xs font-medium"
          >
            <DiscordMark />
            Discordでログイン
          </Button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto pt-14">
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 space-y-10">
          {/* いま流れている曲 */}
          <section aria-labelledby="preview-now-heading">
            <h2 id="preview-now-heading" className="text-lg sm:text-xl font-bold tracking-tight text-foreground mb-4">
              いま流れている曲
            </h2>

            {!loaded && !currentTrack ? (
              <div className="py-8 flex items-center justify-center">
                <Loading size="medium" />
              </div>
            ) : currentTrack ? (
              <div className="rounded-2xl border border-border bg-card shadow-sm p-4 flex items-center gap-4">
                <Image
                  src={currentTrack.thumbnail || '/default_thumbnail.webp'}
                  alt={currentTrack.title}
                  width={64}
                  height={64}
                  className="rounded-lg object-cover flex-shrink-0"
                  style={{ width: 64, height: 64 }}
                  unoptimized
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[15px] text-foreground truncate">{currentTrack.title}</p>
                  <p className="text-[13px] text-muted-foreground truncate">{currentTrack.artist}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={requireSignIn}
                  className="rounded-full h-11 w-11 flex-shrink-0"
                  aria-label={isPlaying ? '一時停止（ログインが必要）' : '再生（ログインが必要）'}
                >
                  {isPlaying ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6" />}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">いまは何も流れていません</p>
            )}

            {upcoming.length > 0 && (
              <div className="mt-4">
                <h3 className="text-[13px] font-medium text-muted-foreground mb-2">次に流れる曲</h3>
                <ul className="divide-y divide-border/60 rounded-2xl border border-border bg-card overflow-hidden">
                  {upcoming.map((track, index) => (
                    <li key={`${track.url}-${index}`} className="flex items-center gap-3 px-3 py-2.5">
                      <Image
                        src={track.thumbnail || '/default_thumbnail.webp'}
                        alt=""
                        width={40}
                        height={40}
                        className="rounded-md object-cover flex-shrink-0"
                        style={{ width: 40, height: 40 }}
                        unoptimized
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] text-foreground truncate">{track.title}</p>
                        <p className="text-[12px] text-muted-foreground truncate">{track.artist}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* 曲置き場（読み取り専用。タップでログイン） */}
          <section aria-labelledby="preview-shelf-heading">
            <h2 id="preview-shelf-heading" className="text-lg sm:text-xl font-bold tracking-tight text-foreground mb-4">
              曲置き場
            </h2>
            <ShelfScreen
              guildId={guildId}
              readOnly
              onRequireSignIn={requireSignIn}
              variant="embedded"
            />
          </section>
        </div>
      </div>
    </div>
  );
};

export default PreviewApp;
