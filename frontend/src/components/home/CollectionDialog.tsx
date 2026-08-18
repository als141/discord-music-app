'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { Loader2, Plus, ListPlus, Disc3 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { api, SearchItem, Track } from '@/utils/api';

const BULK_LIMIT = 50; // 一度にキューへ入れる上限（ミックスは200曲あるので）

interface Props {
  item: SearchItem | null;
  onClose: () => void;
  onAddTrack: (track: Track) => Promise<void> | void;
}

const typeLabel = (t: string) => ({ playlist: 'プレイリスト', album: 'アルバム', single: 'シングル', ep: 'EP' } as Record<string, string>)[t] || t;

/** ホームのプレイリスト / アルバム / ミックスをタップしたときの曲一覧（1曲ずつ or まとめて追加） */
export const CollectionDialog: React.FC<Props> = ({ item, onClose, onAddTrack }) => {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    setTracks(null); setError(null); setAddedUrls(new Set());
    if (!item?.browseId) return;
    const load = ['album', 'single', 'ep'].includes(item.type) ? api.getAlbumItems(item.browseId) : api.getPlaylistItems(item.browseId);
    load.then((t) => { if (!cancelled) setTracks(t.filter(x => x.url)); })
        .catch(() => { if (!cancelled) setError('曲一覧を取得できませんでした'); });
    return () => { cancelled = true; };
  }, [item]);

  const addOne = async (t: Track) => {
    await onAddTrack(t);
    setAddedUrls(prev => new Set(prev).add(t.url));
  };

  const addBulk = async () => {
    if (!tracks) return;
    const list = tracks.slice(0, BULK_LIMIT);
    setAdding(true);
    try {
      for (const t of list) { await onAddTrack(t); }
      setAddedUrls(prev => { const n = new Set(prev); list.forEach(t => n.add(t.url)); return n; });
      toast({ title: 'キューに追加しました', description: `${list.length} 曲を追加しました${tracks.length > BULK_LIMIT ? `（先頭 ${BULK_LIMIT} 曲）` : ''}` });
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[min(96vw,720px)] max-h-[88dvh] p-0 overflow-hidden rounded-2xl bg-card border-border">
        {item && (
          <>
            <DialogHeader className="px-5 pt-5 pb-4 border-b border-border/60 text-left">
              <div className="flex items-start gap-4">
                <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-secondary flex-shrink-0">
                  {item.thumbnail ? <Image src={item.thumbnail} alt={item.title} fill style={{ objectFit: 'cover' }} unoptimized /> : <Disc3 className="w-8 h-8 m-auto text-muted-foreground" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-muted-foreground mb-0.5">{typeLabel(item.type)}</p>
                  <DialogTitle className="text-lg sm:text-xl font-bold leading-tight line-clamp-2">{item.title}</DialogTitle>
                  <DialogDescription className="text-muted-foreground truncate">{item.artist}</DialogDescription>
                  <div className="mt-2 flex items-center gap-2">
                    <Button size="sm" onClick={addBulk} disabled={!tracks || tracks.length === 0 || adding} className="h-8 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs">
                      {adding ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <ListPlus className="w-3.5 h-3.5 mr-1" />}
                      {tracks && tracks.length > BULK_LIMIT ? `先頭 ${BULK_LIMIT} 曲を追加` : `すべて追加${tracks ? `（${tracks.length}曲）` : ''}`}
                    </Button>
                  </div>
                </div>
              </div>
            </DialogHeader>
            <div className="overflow-y-auto max-h-[calc(88dvh-150px)] px-3 py-3">
              {error ? (
                <p className="text-sm text-muted-foreground text-center py-10">{error}</p>
              ) : !tracks ? (
                <div className="space-y-2 px-2">{Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-2"><Skeleton className="w-11 h-11 rounded-lg" /><div className="flex-1"><Skeleton className="h-4 w-2/3 mb-2" /><Skeleton className="h-3 w-1/3" /></div></div>
                ))}</div>
              ) : tracks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">曲がありません</p>
              ) : (
                <ul className="space-y-0.5">
                  {tracks.map((t, i) => {
                    const done = addedUrls.has(t.url);
                    return (
                      <li key={`${t.url}-${i}`} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-secondary/60 transition-colors">
                        <span className="w-6 text-center text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                        <div className="relative w-11 h-11 rounded-lg overflow-hidden bg-secondary flex-shrink-0">
                          {t.thumbnail ? <Image src={t.thumbnail} alt={t.title} fill style={{ objectFit: 'cover' }} unoptimized /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{t.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{t.artist}</p>
                        </div>
                        <Button size="icon" variant="ghost" onClick={() => addOne(t)} disabled={done} aria-label={`${t.title} をキューに追加`} className={`h-8 w-8 rounded-full ${done ? 'text-muted-foreground' : 'text-primary hover:bg-primary/10'}`}>
                          {done ? <span className="text-[11px]">済</span> : <Plus className="w-4 h-4" />}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
