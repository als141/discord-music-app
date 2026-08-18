import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PlayIcon,
  PauseIcon,
  SkipForwardIcon,
  ChevronDownIcon,
  RefreshCwIcon,
  PlusIcon,
  Loader2,
  ExternalLink,
  UserIcon,
  ListMusic,
  Disc3
} from 'lucide-react';
import { Track, api } from '@/utils/api';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose
} from '@/components/ui/drawer';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { QueueList } from './QueueList';
import { useToast } from '@/hooks/use-toast';
import { useSwipeable } from 'react-swipeable';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useSession } from 'next-auth/react';
import { User } from '@/utils/api';
import { Skeleton } from '@/components/ui/skeleton';
import ArtistDialog from '@/components/ArtistDialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Apple Music style related track item
const RelatedTrackItem = memo(({ track, onAddToQueue }: {
  track: Track,
  onAddToQueue: (track: Track) => Promise<void>
}) => (
  <motion.div
    key={track.url}
    className="flex items-center p-3 bg-card border border-border/70 rounded-2xl transition-colors duration-200 hover:bg-secondary/50"
    whileHover={{ scale: 1.01 }}
    whileTap={{ scale: 0.99 }}
  >
    <Image
      src={track.thumbnail}
      alt={track.title}
      width={52}
      height={52}
      className="rounded-lg object-cover shadow-sm"
      unoptimized
    />
    <div className="ml-3 flex-grow overflow-hidden">
      <p className="text-sm font-medium truncate text-foreground">{track.title}</p>
      <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
    </div>
    <Button
      onClick={() => onAddToQueue(track)}
      variant="ghost"
      size="sm"
      className="text-primary hover:bg-primary/10 hover:text-primary rounded-full"
    >
      <PlusIcon className="h-4 w-4" />
      <span className="sr-only sm:not-sr-only sm:inline-block sm:ml-1">追加</span>
    </Button>
  </motion.div>
));

RelatedTrackItem.displayName = 'RelatedTrackItem';

interface MainPlayerProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSkip: () => void;
  queue: Track[];
  onReorder: (startIndex: number, endIndex: number) => void;
  onDelete: (index: number) => void;
  guildId: string | null;
  onClose: () => void;
  isLoading: boolean;
  /**
   * sheet  : モバイル/タブレット向けフルスクリーン表示（閉じるボタン・スワイプ・キューはDrawer）
   * docked : デスクトップ向け右カラム常時表示（閉じるボタンなし・キュー/関連曲をインライン表示）
   */
  variant?: 'sheet' | 'docked';
}

export const MainPlayer: React.FC<MainPlayerProps> = React.memo(({
  currentTrack,
  isPlaying,
  onPlay,
  onPause,
  onSkip,
  queue,
  onReorder,
  onDelete,
  guildId,
  onClose,
  isLoading,
  variant = 'sheet',
}) => {
  const isDocked = variant === 'docked';
  const { data: session } = useSession();
  const { toast } = useToast();

  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('queue');

  const [isArtistDialogOpen, setIsArtistDialogOpen] = useState(false);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);
  const [isArtistLoading, setIsArtistLoading] = useState(false);

  const [relatedTracks, setRelatedTracks] = useState<Track[]>([]);
  const [isRelatedLoading, setIsRelatedLoading] = useState(false);

  useEffect(() => {
    setImageLoaded(false);
  }, [currentTrack?.thumbnail]);

  useEffect(() => {
    if (imageRef.current && imageRef.current.complete) {
      setImageLoaded(true);
    }
  }, [currentTrack]);

  useEffect(() => {
    if ('mediaSession' in navigator && currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        artwork: currentTrack.thumbnail ? [{ src: currentTrack.thumbnail, sizes: '512x512', type: 'image/png' }] : [],
      });

      navigator.mediaSession.setActionHandler('play', onPlay);
      navigator.mediaSession.setActionHandler('pause', onPause);
      navigator.mediaSession.setActionHandler('nexttrack', onSkip);
    }

    return () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
      }
    };
  }, [currentTrack, onPlay, onPause, onSkip]);

  const handleArtistClick = async (artistName: string) => {
    setIsArtistLoading(true);
    try {
      const cachedArtistId = localStorage.getItem(`artistId_${artistName}`);
      if (cachedArtistId) {
        setSelectedArtistId(cachedArtistId);
        setIsArtistDialogOpen(true);
        setIsArtistLoading(false);
        return;
      }

      const searchResults = await api.search(artistName, 'artists');
      if (searchResults.length > 0) {
        const artist = searchResults[0];
        if (artist.browseId) {
          setSelectedArtistId(artist.browseId);
          setIsArtistDialogOpen(true);
          localStorage.setItem(`artistId_${artistName}`, artist.browseId);
        } else {
          toast({
            title: 'エラー',
            description: 'アーティスト情報を取得できませんでした。',
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: 'エラー',
          description: 'アーティストが見つかりませんでした。',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('アーティスト情報の取得に失敗しました:', error);
      toast({
        title: 'エラー',
        description: 'アーティスト情報の取得に失敗しました。',
        variant: 'destructive',
      });
    } finally {
      setIsArtistLoading(false);
    }
  };

  const extractVideoId = useCallback((url: string) => {
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/)
    return match ? match[1] : null
  }, []);

  useEffect(() => {
    const fetchRelatedTracks = async () => {
      if (!currentTrack) return;

      setIsRelatedLoading(true);

      const videoId = extractVideoId(currentTrack.url);
      if (!videoId) {
        setIsRelatedLoading(false);
        return;
      }

      try {
        const tracks = await api.getRelatedSongs(videoId);
        setRelatedTracks(tracks);
      } catch (error) {
        console.error('エラー: 関連動画の取得に失敗しました', error);
        toast({
          title: 'エラー',
          description: '関連動画の取得に失敗しました。',
          variant: 'destructive',
        });
      } finally {
        setIsRelatedLoading(false);
      }
    };

    const isPanelOpen = isDocked || isDrawerOpen;
    if (currentTrack && isPanelOpen && activeTab === 'related') {
      fetchRelatedTracks();
    }
  }, [currentTrack, isDrawerOpen, isDocked, activeTab, extractVideoId, toast]);

  const handleAddToQueue = async (track: Track) => {
    if (!guildId) {
      toast({
        title: 'エラー',
        description: 'サーバーが選択されていません。',
        variant: 'destructive',
      });
      return;
    }

    const user: User | null = session && session.user ? {
      id: session.user.id,
      name: session.user.name || '',
      image: session.user.image || '',
    } : null;

    if (!user) {
      toast({
        title: "エラー",
        description: "ログインが必要です。",
        variant: "destructive",
      });
      return;
    }

    try {
      await api.addUrl(guildId, track.url, user);
      toast({
        title: '成功',
        description: '曲がキューに追加されました。',
      });
    } catch (error) {
      console.error('曲の追加中にエラーが発生しました:', error);
      toast({
        title: 'エラー',
        description: '曲の追加に失敗しました。',
        variant: 'destructive',
      });
    }
  };

  const handleAddAllToQueue = async () => {
    try {
      setIsRelatedLoading(true);

      for (const track of relatedTracks) {
        await handleAddToQueue(track);
      }

      toast({
        title: '成功',
        description: '全ての関連動画をキューに追加しました。',
      });
    } catch (error) {
      console.error('キューへの追加中にエラーが発生しました:', error);
      toast({
        title: 'エラー',
        description: '一部の動画をキューに追加できませんでした。',
        variant: 'destructive',
      });
    } finally {
      setIsRelatedLoading(false);
    }
  };

  const renderSkeletons = () => (
    Array(5).fill(0).map((_, index) => (
      <div key={index} className="flex items-center p-3 bg-secondary/40 rounded-xl">
        <Skeleton className="w-[52px] h-[52px] rounded-lg" />
        <div className="ml-3 flex-grow">
          <Skeleton className="h-4 w-3/4 mb-2" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="w-16 h-8 rounded-full" />
      </div>
    ))
  );

  const swipeHandlers = useSwipeable({
    onSwipedDown: () => { if (!isDocked) onClose(); },
    onSwipedUp: () => { if (!isDocked) setIsDrawerOpen(true); },
    trackTouch: !isDocked,
    trackMouse: false,
    preventScrollOnSwipe: !isDocked,
  });

  const drawerSwipeHandlers = useSwipeable({
    onSwipedLeft: () => setActiveTab('related'),
    onSwipedRight: () => setActiveTab('queue'),
    trackTouch: true,
    trackMouse: false,
  });

  const handleRefreshRelated = () => {
    if (!currentTrack) return;
    const videoId = extractVideoId(currentTrack.url);
    if (!videoId) return;
    setIsRelatedLoading(true);
    api.getRelatedSongs(videoId)
      .then(tracks => setRelatedTracks(tracks))
      .catch(error => {
        console.error('関連トラック取得エラー:', error);
        toast({
          title: 'エラー',
          description: '関連動画の取得に失敗しました。',
          variant: 'destructive',
        });
      })
      .finally(() => setIsRelatedLoading(false));
  };

  // ---- 部品: アートワーク ----
  const artwork = (
    <motion.div
      className={`${isDocked ? 'player-artwork-docked' : 'player-artwork-sheet'} rounded-2xl overflow-hidden relative flex-shrink-0`}
      initial={{ scale: 0.94, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1] }}
      style={{
        // 影は下方向に伸ばしすぎない（曲名の背景に色が被って見えていた）
        boxShadow: '0 14px 32px -16px color-mix(in oklab, var(--color-primary) 30%, rgba(0,0,0,0.35)), 0 4px 12px -6px rgba(0, 0, 0, 0.18)'
      }}
    >
      {currentTrack && (
        <Image
          ref={imageRef}
          src={currentTrack.thumbnail || '/default_thumbnail.webp'}
          alt={currentTrack.title || '選択された曲はありません'}
          fill
          sizes="(min-width: 1024px) 320px, 80vw"
          style={{ objectFit: 'cover' }}
          onLoad={() => setImageLoaded(true)}
          className={`z-0 transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          unoptimized
        />
      )}
      <AnimatePresence>
        {(!imageLoaded || !currentTrack) && (
          <motion.div
            className="absolute inset-0 bg-secondary flex items-center justify-center"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Disc3 className={`w-16 h-16 text-muted-foreground ${currentTrack ? 'animate-spin' : 'opacity-40'}`} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  // ---- 部品: 曲情報 ----
  const trackInfo = (
    <motion.div
      className="w-full text-center px-2 min-w-0"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <h2
        className={`font-display ${isDocked ? 'text-[20px] xl:text-[22px]' : 'text-[24px] sm:text-[28px]'} font-medium text-foreground truncate mb-1.5 leading-tight`}
        title={currentTrack?.title}
      >
        {currentTrack?.title || '再生中の曲はありません'}
      </h2>

      {currentTrack?.artist ? (
        <div className="flex justify-center max-w-full">
          <button
            onClick={() => handleArtistClick(currentTrack.artist)}
            disabled={isArtistLoading}
            className="group inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-primary/25 text-primary hover:bg-primary/8 transition-all duration-200 max-w-full"
            aria-label={`${currentTrack.artist}の詳細を表示`}
          >
            {isArtistLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-muted-foreground text-sm">読み込み中...</span>
              </>
            ) : (
              <>
                <span className={`${isDocked ? 'text-sm' : 'text-base sm:text-lg'} text-primary font-medium truncate`}>
                  {currentTrack.artist}
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-primary opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </>
            )}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {currentTrack ? 'アーティスト不明' : 'ホームや検索から曲を追加してください'}
        </p>
      )}

      {currentTrack?.added_by && (
        <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Avatar className="w-4 h-4">
            {currentTrack.added_by.image ? (
              <AvatarImage src={currentTrack.added_by.image} alt={currentTrack.added_by.name || 'Unknown'} />
            ) : (
              <AvatarFallback className="bg-primary/10"><UserIcon className="h-2.5 w-2.5 text-primary" /></AvatarFallback>
            )}
          </Avatar>
          <span className="truncate">{currentTrack.added_by.name || 'Unknown'}さんが追加</span>
        </div>
      )}
    </motion.div>
  );

  // ---- 部品: 再生コントロール ----
  const controls = (
    <div className={`flex justify-center items-center ${isDocked ? 'gap-6' : 'gap-8 sm:gap-10'}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            whileHover={{ scale: isLoading ? 1 : 1.05 }}
            whileTap={{ scale: isLoading ? 1 : 0.95 }}
            onClick={isLoading ? undefined : isPlaying ? onPause : onPlay}
            className={`apple-play-button ${isDocked ? 'w-16 h-16' : 'w-[72px] h-[72px] sm:w-20 sm:h-20'}`}
            disabled={isLoading || !currentTrack}
            aria-label={isLoading ? "読み込み中" : isPlaying ? "一時停止" : "再生"}
          >
            {isLoading ? (
              <Loader2 className="animate-spin w-8 h-8 text-white" />
            ) : isPlaying ? (
              <PauseIcon className="w-8 h-8 text-white" fill="white" />
            ) : (
              <PlayIcon className="w-8 h-8 text-white ml-1" fill="white" />
            )}
          </motion.button>
        </TooltipTrigger>
        <TooltipContent className="bg-card/95 backdrop-blur-xl border-border">
          <p>{isLoading ? "読み込み中" : isPlaying ? "一時停止" : "再生"}</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onSkip}
            disabled={!currentTrack}
            className="p-4 rounded-full bg-card border border-border shadow-sm hover:bg-secondary transition-all duration-200 disabled:opacity-40"
            aria-label="次の曲へ"
          >
            <SkipForwardIcon size={24} className="text-foreground" />
          </motion.button>
        </TooltipTrigger>
        <TooltipContent className="bg-card/95 backdrop-blur-xl border-border">
          <p>次の曲へ</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );

  // ---- 部品: キュー / 関連曲 タブ（Drawer とドッキングパネルで共用） ----
  const panelTabs = (panelHeightStyle?: React.CSSProperties) => (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-3 flex-shrink-0">
        <TabsList className="grid w-full grid-cols-2 bg-secondary/70 p-1 rounded-full">
          <TabsTrigger
            value="queue"
            className="rounded-full data-[state=active]:bg-card data-[state=active]:shadow-sm text-foreground font-medium"
            aria-controls="queue-panel"
          >
            キュー{queue.length > 0 ? ` (${queue.length})` : ''}
          </TabsTrigger>
          <TabsTrigger
            value="related"
            className="rounded-full data-[state=active]:bg-card data-[state=active]:shadow-sm text-foreground font-medium"
            aria-controls="related-panel"
          >
            関連曲
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="queue"
        className="mt-3 flex-1 min-h-0 overflow-y-auto data-[state=inactive]:hidden"
        style={panelHeightStyle}
        id="queue-panel"
        role="tabpanel"
      >
        <QueueList
          queue={queue}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          onPlayPause={isPlaying ? onPause : onPlay}
          onReorder={onReorder}
          onClose={() => setIsDrawerOpen(false)}
          onDelete={onDelete}
          isEmbedded
          showCurrentTrack={!isDocked}
        />
      </TabsContent>

      <TabsContent
        value="related"
        className="mt-3 flex-1 min-h-0 overflow-y-auto space-y-3 px-4 pb-6 data-[state=inactive]:hidden"
        style={panelHeightStyle}
        id="related-panel"
        role="tabpanel"
      >
        <div className="flex flex-wrap gap-2 justify-between">
          <Button
            onClick={handleAddAllToQueue}
            disabled={isRelatedLoading || relatedTracks.length === 0}
            size="sm"
            className="bg-primary hover:bg-primary/90 text-white rounded-full text-xs sm:text-sm"
          >
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            全て追加
          </Button>
          <Button
            onClick={handleRefreshRelated}
            disabled={isRelatedLoading || !currentTrack}
            size="sm"
            variant="outline"
            className="rounded-full text-xs sm:text-sm border-border"
          >
            <RefreshCwIcon className={`mr-1 h-3.5 w-3.5 ${isRelatedLoading ? 'animate-spin' : ''}`} />
            再取得
          </Button>
        </div>
        <AnimatePresence mode="wait">
          {isRelatedLoading ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3" key="skeletons">
              {renderSkeletons()}
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-3" key="related-tracks">
              {relatedTracks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Disc3 className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">{currentTrack ? '関連する曲が見つかりませんでした' : '曲を再生すると関連曲が表示されます'}</p>
                </div>
              ) : (
                relatedTracks.map(track => (
                  <RelatedTrackItem key={track.url} track={track} onAddToQueue={handleAddToQueue} />
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </TabsContent>
    </Tabs>
  );

  const artistDialog = isArtistDialogOpen && selectedArtistId && (
    <ArtistDialog
      artistId={selectedArtistId}
      isOpen={isArtistDialogOpen}
      onClose={() => setIsArtistDialogOpen(false)}
      onAddTrackToQueue={handleAddToQueue}
      onAddItemToQueue={async (item) => {
        if ('url' in item && 'title' in item && 'artist' in item && 'thumbnail' in item) {
          await handleAddToQueue(item as Track);
        } else {
          console.warn('Unsupported item type:', item);
        }
      }}
    />
  );

  // ================= docked（デスクトップ右カラム） =================
  if (isDocked) {
    return (
      <TooltipProvider>
        <div
          className="flex flex-col h-full min-h-0 w-full"
          role="region"
          aria-label="再生中"
        >
          <div className="flex flex-col items-center gap-4 px-6 pt-6 pb-5 flex-shrink-0">
            <p className="self-start text-[11px] tracking-[0.18em] uppercase text-muted-foreground font-medium -mb-1">Now playing</p>
            {artwork}
            {trackInfo}
            {controls}
          </div>
          <div className="flex-1 min-h-0 flex flex-col border-t border-border/70 bg-card/60">
            {panelTabs()}
          </div>
          {artistDialog}
        </div>
      </TooltipProvider>
    );
  }

  // ================= sheet（モバイル/タブレット フルスクリーン） =================
  return (
    <TooltipProvider>
      <div
        {...swipeHandlers}
        className="accent-wash grain flex flex-col items-center h-full overflow-hidden relative px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        role="region"
        aria-label="音楽プレイヤー"
      >
        {/* 上部バー: 閉じるボタン + ラベル */}
        <div className="w-full flex items-center justify-between h-12 flex-shrink-0">
          <Button
            onClick={onClose}
            className="rounded-full bg-card border border-border shadow-sm hover:bg-secondary text-foreground"
            variant="ghost"
            size="icon"
            aria-label="プレイヤーを閉じる"
          >
            <ChevronDownIcon size={26}/>
          </Button>
          <span className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">Now playing</span>
          <div className="w-10" aria-hidden="true" />
        </div>

        {/* 本体: 縦画面=縦積み / 横長の低い画面=左右2カラム（CSS: .player-sheet-body） */}
        <div className="player-sheet-body flex-1 min-h-0 w-full">
          <div className="player-sheet-art flex items-center justify-center min-h-0">
            {artwork}
          </div>
          <div className="player-sheet-side flex flex-col items-center justify-center min-h-0 min-w-0 gap-4">
            {trackInfo}
            <div className="flex flex-col items-center gap-3 flex-shrink-0">
              {controls}
              <motion.button
                className="flex items-center justify-center bg-card border border-border shadow-sm rounded-full px-5 py-2 gap-2"
                onClick={() => setIsDrawerOpen(true)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                aria-expanded={isDrawerOpen}
                aria-controls="queue-drawer"
              >
                <ListMusic size={18} className="text-foreground" />
                <span className="text-sm font-medium text-foreground">
                  キュー{queue.length > 0 ? `（${queue.length}）` : ''}・関連曲
                </span>
              </motion.button>
            </div>
          </div>
        </div>

        {artistDialog}

        {/* Queue drawer - Apple Music style */}
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerContent
            {...drawerSwipeHandlers}
            className="bg-background border-t border-border max-h-[88dvh]"
            id="queue-drawer"
          >
            <DrawerHeader className="border-b border-border/50 pb-3">
              <DrawerTitle className="text-xl font-bold text-foreground">再生キュー</DrawerTitle>
              <DrawerDescription className="text-muted-foreground">
                次に再生される曲と関連曲
              </DrawerDescription>
            </DrawerHeader>

            {panelTabs({ height: 'min(calc(100vh - 280px), calc(100dvh - 280px))' })}

            <DrawerFooter className="border-t border-border/50 pt-3">
              <DrawerClose asChild>
                <Button
                  variant="outline"
                  className="w-full rounded-full border-border hover:bg-secondary/60"
                >
                  閉じる
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </div>
    </TooltipProvider>
  );
});

MainPlayer.displayName = 'MainPlayer';
