'use client';

import React, { memo, useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { api, HistoryStats } from '@/utils/api';

/** このサーバーの再生統計（30日）— SQLite の再生履歴から */
export const GuildStatsCard = memo(({ guildId }: { guildId: string | null }) => {
  const [stats, setStats] = useState<HistoryStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!guildId) { setStats(null); return; }
    api.getHistoryStats(guildId, 30).then((s) => { if (!cancelled) setStats(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [guildId]);

  const topUsers = stats?.top_users?.slice(0, 4) ?? [];
  const top = stats?.top_tracks?.[0];

  return (
    <div className="surface p-4 sm:p-5 flex flex-col justify-between h-full">
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground font-medium">
        <BarChart3 className="w-4 h-4" aria-hidden="true" />
        この30日の再生
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[34px] sm:text-[40px] font-bold leading-none tracking-tight tabular-nums text-foreground">
          {stats ? stats.total_plays.toLocaleString() : '–'}
        </span>
        <span className="text-sm text-muted-foreground">曲</span>
      </div>
      {top ? (
        <p className="text-[13px] text-muted-foreground mt-2 truncate">
          いちばん流れた曲: <span className="text-foreground font-medium">{top.title}</span>
          <span className="ml-1 tabular-nums">({top.play_count}回)</span>
        </p>
      ) : (
        <p className="text-[13px] text-muted-foreground mt-2">{guildId ? 'まだ再生履歴がありません' : 'サーバーを選ぶと表示されます'}</p>
      )}
      <div className="mt-3 flex items-center gap-2 min-h-[28px]">
        {topUsers.length > 0 && (
          <>
            <div className="flex -space-x-2">
              {topUsers.map((u) => (
                <Avatar key={u.added_by_id} className="w-7 h-7 ring-2 ring-card">
                  {u.added_by_image ? <AvatarImage src={u.added_by_image} alt={u.added_by_name || ''} /> : null}
                  <AvatarFallback className="text-[10px] bg-secondary">{(u.added_by_name || '?').charAt(0)}</AvatarFallback>
                </Avatar>
              ))}
            </div>
            <span className="text-[12px] text-muted-foreground truncate">{topUsers[0].added_by_name} さんがよく入れています</span>
          </>
        )}
      </div>
    </div>
  );
});
GuildStatsCard.displayName = 'GuildStatsCard';
