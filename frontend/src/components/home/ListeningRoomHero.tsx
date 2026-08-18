'use client';

import React, { memo, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Clipboard, Plus, Loader2, Link2, Users, Disc3 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { api, HistoryStats } from '@/utils/api';

interface Props {
  guildId: string | null;
  guildName?: string | null;
  onAddUrl?: (url: string) => void | Promise<void>;
}

const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return '夜更かしの一曲を';
  if (h < 11) return 'おはよう。今日は何を聴く？';
  if (h < 17) return 'こんにちは。次の一曲は？';
  if (h < 22) return 'こんばんは。今夜のプレイリストを';
  return '静かな夜に、一曲どうぞ';
};

/**
 * ホーム最上部の「リスニングルーム」ヒーロー（bento 2 分割）
 *  左: 見出し + URL 追加   右: このサーバーの30日統計（再生数・よく入れる人）
 */
export const ListeningRoomHero = memo(({ guildId, guildName, onAddUrl }: Props) => {
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    if (!guildId) { setStats(null); return; }
    api.getHistoryStats(guildId, 30).then((s) => { if (!cancelled) setStats(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [guildId]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch {
      toast({ title: 'エラー', description: 'クリップボードを読み取れませんでした', variant: 'destructive' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !onAddUrl) return;
    setIsSubmitting(true);
    try {
      await onAddUrl(url.trim());
      setUrl('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const topUsers = stats?.top_users?.slice(0, 4) ?? [];

  return (
    <TooltipProvider>
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1] }}
        className="px-4 sm:px-6 mb-8"
        aria-label="リスニングルーム"
      >
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4">
          {/* 左: 見出し + URL 追加 */}
          <div className="surface grain accent-wash p-5 sm:p-7 flex flex-col justify-between md:min-h-[200px]">
            <div>
              <p className="text-[11px] tracking-[0.18em] uppercase text-muted-foreground font-medium mb-2">
                Listening room{guildName ? ` · ${guildName}` : ''}
              </p>
              <h2 className="font-display text-[24px] sm:text-[32px] leading-[1.15] text-foreground font-medium">
                {greeting()}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="mt-4 sm:mt-6">
              <label htmlFor="hero-url" className="sr-only">YouTube URL</label>
              <div className="relative">
                <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="hero-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="YouTube の URL を貼り付け"
                  disabled={!onAddUrl}
                  className="w-full h-12 pl-11 pr-28 bg-card border border-border rounded-full text-[14px] placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/40 shadow-sm"
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button type="button" onClick={handlePaste} variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-secondary" aria-label="クリップボードから貼り付け">
                        <Clipboard className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">ペースト</TooltipContent>
                  </Tooltip>
                  <Button
                    type="submit"
                    disabled={!url.trim() || isSubmitting || !onAddUrl}
                    className="h-9 px-4 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground text-[13px] font-medium disabled:opacity-40"
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" />追加</>}
                  </Button>
                </div>
              </div>
            </form>
          </div>

          {/* 右: このサーバーの統計 */}
          <div className="surface p-4 sm:p-6 flex flex-col justify-between md:min-h-[160px]">
            <div className="flex items-start justify-between">
              <p className="text-[11px] tracking-[0.18em] uppercase text-muted-foreground font-medium">この30日</p>
              <Disc3 className="w-4 h-4 text-muted-foreground/60" aria-hidden="true" />
            </div>
            <div className="mt-2">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[34px] sm:text-[48px] leading-none text-foreground tabular-nums">
                  {stats ? stats.total_plays.toLocaleString() : '–'}
                </span>
                <span className="text-sm text-muted-foreground">曲 再生</span>
              </div>
              {stats?.top_tracks?.[0] && (
                <p className="text-[13px] text-muted-foreground mt-2 truncate">
                  いちばん流れた曲: <span className="text-foreground font-medium">{stats.top_tracks[0].title}</span>
                </p>
              )}
            </div>
            <div className="mt-4 flex items-center gap-2 min-h-[28px]">
              {topUsers.length > 0 ? (
                <>
                  <div className="flex -space-x-2">
                    {topUsers.map((u) => (
                      <Avatar key={u.added_by_id} className="w-7 h-7 ring-2 ring-card">
                        {u.added_by_image ? <AvatarImage src={u.added_by_image} alt={u.added_by_name || ''} /> : null}
                        <AvatarFallback className="text-[10px] bg-secondary">{(u.added_by_name || '?').charAt(0)}</AvatarFallback>
                      </Avatar>
                    ))}
                  </div>
                  <span className="text-[12px] text-muted-foreground truncate">
                    {topUsers[0].added_by_name} さんがよく入れています
                  </span>
                </>
              ) : (
                <span className="text-[12px] text-muted-foreground inline-flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" aria-hidden="true" />
                  {guildId ? 'まだ再生履歴がありません' : 'サーバーを選ぶと統計が表示されます'}
                </span>
              )}
            </div>
          </div>
        </div>
      </motion.section>
    </TooltipProvider>
  );
});
ListeningRoomHero.displayName = 'ListeningRoomHero';
