import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  PlayIcon, 
  PauseIcon, 
  SkipForwardIcon, 
  SkipBackIcon, 
  ChevronUpIcon, 
  ChevronDownIcon, 
  Volume2Icon, 
  VolumeXIcon, 
  RefreshCwIcon, 
  PlusIcon, 
  Loader2,
  ExternalLink,
  UserIcon 
} from 'lucide-react';
import { Track, api } from '@/utils/api';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Loading } from '@/components/ui/loading';
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
import { usePlayerStore } from '@/store';

// Memoized related track item
const RelatedTrackItem = memo(({ track, onAddToQueue }: { 
  track: Track, 
  onAddToQueue: (track: Track) => Promise<void> 
}) => (
  <motion.div
    key={track.url}
    className="flex items-center p-2 bg-zinc-950 rounded-lg transition-colors duration-200 hover:bg-zinc-900"
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
  >
    <Image 
      src={track.thumbnail} 
      alt={track.title} 
      width={48} 
      height={48} 
      className="rounded-md object-cover"
      unoptimized
    />
    <div className="ml-2 flex-grow overflow-hidden">
      <p className="text-sm font-semibold truncate text-zinc-300">{track.title}</p>
      <p className="text-xs text-zinc-500 truncate">{track.artist}</p>
    </div>
    <Button 
      onClick={() => onAddToQueue(track)} 
      variant="ghost" 
      size="sm" 
      className="text-zinc-300 hover:bg-zinc-800 hover:text-white"
    >
      <PlusIcon className="h-4 w-4 mr-1" />
      <span className="sr-only sm:not-sr-only sm:inline-block">追加</span>
    </Button>
  </motion.div>
));

RelatedTrackItem.displayName = 'RelatedTrackItem';

// Props definition
interface MainPlayerProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSkip: () => void;
  onPrevious: () => void;
  queue: Track[];
  onReorder: (startIndex: number, endIndex: number) => void;
  onDelete: (index: number) => void;
  guildId: string | null;
  onClose: () => void;
  isVisible: boolean;
  isOnDeviceMode: boolean;
  isLoading: boolean;
}

export const MainPlayer: React.FC<MainPlayerProps> = ({
  currentTrack,
  isPlaying,
  onPlay,
  onPause,
  onSkip,
  onPrevious,
  queue,
  onReorder,
  onDelete,
  guildId,
  onClose,
  isVisible,
  isOnDeviceMode,
  isLoading,
}) => {
  const { data: session } = useSession();
  const { currentTime, duration, volume, setVolume, audioRef } = usePlayerStore();
  const { toast } = useToast();
  
  // ローカル状態
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('queue');
  
  // Artist Dialog 状態
  const [isArtistDialogOpen, setIsArtistDialogOpen] = useState(false);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);
  const [isArtistLoading, setIsArtistLoading] = useState(false);
  
  // 関連トラック状態
  const [relatedTracks, setRelatedTracks] = useState<Track[]>([]);
  const [isRelatedLoading, setIsRelatedLoading] = useState(false);

  // Reset image loaded state when track changes
  useEffect(() => {
    setImageLoaded(false);
  }, [currentTrack?.thumbnail]);

  // Check if image is already loaded when ref is set
  useEffect(() => {
    if (imageRef.current && imageRef.current.complete) {
      setImageLoaded(true);
    }
  }, [currentTrack]);

  // Set media session metadata
  useEffect(() => {
    if ('mediaSession' in navigator && currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: 'Album Name',
        artwork: [{ src: currentTrack.thumbnail, sizes: '512x512', type: 'image/png' }],
      });
      
      // Media session action handlers
      navigator.mediaSession.setActionHandler('play', onPlay);
      navigator.mediaSession.setActionHandler('pause', onPause);
      navigator.mediaSession.setActionHandler('previoustrack', onPrevious);
      navigator.mediaSession.setActionHandler('nexttrack', onSkip);
    }
  }, [currentTrack, onPlay, onPause, onPrevious, onSkip]);

  // Artist info retrieval
  const handleArtistClick = async (artistName: string) => {
    setIsArtistLoading(true);
    try {
      // Check for cached artist ID
      const cachedArtistId = localStorage.getItem(`artistId_${artistName}`);
      if (cachedArtistId) {
        setSelectedArtistId(cachedArtistId);
        setIsArtistDialogOpen(true);
        setIsArtistLoading(false);
        return;
      }
      
      // Search for artist
      const searchResults = await api.search(artistName, 'artists');
      if (searchResults.length > 0) {
        const artist = searchResults[0];
        if (artist.browseId) {
          setSelectedArtistId(artist.browseId);
          setIsArtistDialogOpen(true);
          // Cache the ID
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

  // Extract videoId from URL
  const extractVideoId = useCallback((url: string) => {
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/)
    return match ? match[1] : null
  }, []);

  // Load related tracks when tab is selected
  useEffect(() => {
    const fetchRelatedTracks = async () => {
      if (!currentTrack) return;
      
      setIsRelatedLoading(true);
      
      // ビデオIDを抽出
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
    
    if (currentTrack && isDrawerOpen && activeTab === 'related') {
      fetchRelatedTracks();
    }
  }, [currentTrack, isDrawerOpen, activeTab, extractVideoId, toast]);

  // Add track to queue
  const handleAddToQueue = async (track: Track) => {
    if (!guildId && !isOnDeviceMode) {
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
  
    if (!user && !isOnDeviceMode) {
      toast({
        title: "エラー",
        description: "ログインが必要です。",
        variant: "destructive",
      });
      return;
    }
    
    try {
      if (isOnDeviceMode) {
        // デバイスモードの場合は直接キューに追加
        await usePlayerStore.getState().addToQueue(track, null);
      } else if (guildId) {
        // サーバーモードの場合はAPIを使用
        await api.addUrl(guildId, track.url, user);
        toast({
          title: '成功',
          description: '曲がキューに追加されました。',
        });
      }
    } catch (error) {
      console.error('曲の追加中にエラーが発生しました:', error);
      toast({
        title: 'エラー',
        description: '曲の追加に失敗しました。',
        variant: 'destructive',
      });
    }
  };

  // Add all related tracks to queue
  const handleAddAllToQueue = async () => {
    try {
      setIsRelatedLoading(true);
      
      // Add tracks sequentially
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

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const seekBar = e.currentTarget;
    const rect = seekBar.getBoundingClientRect();
    const seekPosition = (e.clientX - rect.left) / rect.width;
    const newTime = seekPosition * duration;
    
    if (audioRef?.current) {
      audioRef.current.currentTime = newTime;
      usePlayerStore.getState().setCurrentTime(newTime);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
  };

  // Render loading skeletons
  const renderSkeletons = () => (
    Array(5).fill(0).map((_, index) => (
      <div key={index} className="flex items-center p-2 bg-zinc-950 rounded-lg">
        <Skeleton className="w-12 h-12 rounded-md bg-zinc-900" />
        <div className="ml-2 flex-grow">
          <Skeleton className="h-4 w-3/4 mb-2 bg-zinc-900" />
          <Skeleton className="h-3 w-1/2 bg-zinc-900" />
        </div>
        <Skeleton className="w-16 h-8 rounded-md bg-zinc-900" />
      </div>
    ))
  );

  // Swipe gesture handlers
  const swipeHandlers = useSwipeable({
    onSwipedDown: () => onClose(),
    onSwipedUp: () => setIsDrawerOpen(true),
    trackTouch: true,
    trackMouse: false,
    preventScrollOnSwipe: true,
  });

  const drawerSwipeHandlers = useSwipeable({
    onSwipedLeft: () => setActiveTab('related'),
    onSwipedRight: () => setActiveTab('queue'),
    trackTouch: true,
    trackMouse: false,
  });

  return (
    <TooltipProvider>
      <motion.div
        {...swipeHandlers}
        className="flex flex-col items-center justify-between h-full bg-gradient-to-b from-gray-900 to-black text-white p-4 overflow-hidden relative"
        initial={{ opacity: 0, y: "100%" }}
        animate={{ opacity: isVisible ? 1 : 0, y: isVisible ? 0 : "100%" }}
        exit={{ opacity: 0, y: "100%" }}
        transition={{ duration: 0.3 }}
        role="region"
        aria-label="音楽プレイヤー"
      >
        <Button
          onClick={onClose}
          className="absolute top-4 left-4 z-10 bg-black bg-opacity-50 hover:bg-opacity-70 transition-all duration-200"
          variant="ghost"
          size="icon"
          aria-label="プレイヤーを閉じる"
        >
          <ChevronDownIcon size={35}/>
        </Button>
        
        <div className="flex-grow flex flex-col items-center justify-center w-full max-w-md pt-16 sm:pt-8">
          {/* Album artwork */}
          <motion.div
            className="w-full max-w-[80vw] sm:max-w-[50vw] aspect-square rounded-lg overflow-hidden shadow-lg mb-4 sm:mb-8 relative"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            {currentTrack && (
              <Image
                ref={imageRef}
                src={currentTrack.thumbnail || '/default_thumbnail.webp'}
                alt={currentTrack.title || '選択された曲はありません'}
                fill
                style={{ objectFit: 'cover' }}
                onLoad={() => setImageLoaded(true)}
                className={`z-0 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                unoptimized
              />
            )}
            
            <AnimatePresence>
              {!imageLoaded && (
                <motion.div
                  className="absolute inset-0 bg-gray-800 flex items-center justify-center"
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <Loading size="medium" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Track information */}
          <motion.div
            className="w-full text-center mb-4 sm:mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h2 className="text-xl sm:text-2xl font-bold truncate mb-2" title={currentTrack?.title}>
              {currentTrack?.title || 'タイトルなし'}
            </h2>
            
            {currentTrack?.artist ? (
              <motion.div
                className="inline-flex items-center justify-center max-w-[90%]"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <button
                  onClick={() => handleArtistClick(currentTrack.artist)}
                  disabled={isArtistLoading}
                  className="group relative inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-all duration-200"
                  aria-label={`${currentTrack.artist}の詳細を表示`}
                >
                  {isArtistLoading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span className="text-gray-300">読み込み中...</span>
                    </div>
                  ) : (
                    <>
                      <span className="text-base sm:text-lg text-primary max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                        {currentTrack.artist}
                      </span>
                      <ExternalLink className="w-4 h-4 text-primary transform translate-x-[1px] group-hover:scale-110 transition-transform" />
                    </>
                  )}
                </button>
              </motion.div>
            ) : (
              <p className="text-base sm:text-lg text-gray-300 mt-1 sm:mt-2">
                {currentTrack?.artist || 'アーティスト不明'}
              </p>
            )}
          </motion.div>

          {/* Artist dialog */}
          {isArtistDialogOpen && selectedArtistId && (
            <ArtistDialog
              artistId={selectedArtistId}
              isOpen={isArtistDialogOpen}
              onClose={() => setIsArtistDialogOpen(false)}
              onAddTrackToQueue={handleAddToQueue}
              onAddItemToQueue={async (item) => {
                // Check if item is a Track
                if ('url' in item && 'title' in item && 'artist' in item && 'thumbnail' in item) {
                  await handleAddToQueue(item as Track);
                } else {
                  console.warn('Unsupported item type:', item);
                }
              }}
            />
          )}
          
          {/* Track uploader info */}
          {!isOnDeviceMode && currentTrack?.added_by && (
            <div className="flex items-center mt-4">
              <Avatar>
                {currentTrack.added_by.image ? (
                  <AvatarImage src={currentTrack.added_by.image} alt={currentTrack.added_by.name || 'Unknown'} />
                ) : (
                  <AvatarFallback><UserIcon className="h-4 w-4" /></AvatarFallback>
                )}
              </Avatar>
              <span className="ml-2">
                {currentTrack.added_by.name || 'Unknown'}さんが追加
              </span>
            </div>
          )}
          
          {/* Player controls for on-device mode */}
          {isOnDeviceMode && (
            <div className="w-full max-w-md px-4 mt-8">
              {/* Progress bar */}
              <div className="mb-4">
                <div className="relative pt-1">
                  <div className="flex mb-2 items-center justify-between text-xs text-gray-400">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                  <div 
                    className="relative h-1 bg-gray-700 rounded-full cursor-pointer"
                    onClick={handleSeek}
                    role="slider"
                    aria-valuemin={0}
                    aria-valuemax={duration}
                    aria-valuenow={currentTime}
                    aria-label="再生位置"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      // Allow keyboard control of slider
                      if (!audioRef?.current) return;
                      
                      const step = duration / 20;
                      let newTime = currentTime;
                      
                      if (e.key === 'ArrowRight') {
                        newTime = Math.min(duration, currentTime + step);
                      } else if (e.key === 'ArrowLeft') {
                        newTime = Math.max(0, currentTime - step);
                      } else {
                        return;
                      }
                      
                      audioRef.current.currentTime = newTime;
                      usePlayerStore.getState().setCurrentTime(newTime);
                      e.preventDefault();
                    }}
                  >
                    <motion.div 
                      className="absolute top-0 left-0 h-full bg-white rounded-full"
                      style={{ width: `${(currentTime / duration) * 100}%` }}
                      initial={{ width: 0 }}
                      animate={{ width: `${(currentTime / duration) * 100}%` }}
                      transition={{ duration: 0.1 }}
                    />
                    <motion.div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md"
                      style={{ left: `calc(${(currentTime / duration) * 100}% - 6px)` }}
                      initial={{ left: 0 }}
                      animate={{ left: `calc(${(currentTime / duration) * 100}% - 6px)` }}
                      transition={{ duration: 0.1 }}
                    />
                  </div>
                </div>
              </div>
              
              {/* Volume control */}
              <div className="flex items-center mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setVolume(volume === 0 ? 1 : 0)}
                  className="mr-2 text-white hover:text-gray-300"
                  aria-label={volume === 0 ? "ミュート解除" : "ミュート"}
                >
                  {volume === 0 ? <VolumeXIcon size={20} /> : <Volume2Icon size={20} />}
                </Button>
                <div className="relative flex-grow">
                  <div className="h-1 bg-gray-700 rounded-full">
                    <motion.div 
                      className="absolute top-0 left-0 h-full bg-white rounded-full"
                      style={{ width: `${volume * 100}%` }}
                      initial={{ width: 0 }}
                      animate={{ width: `${volume * 100}%` }}
                      transition={{ duration: 0.1 }}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={handleVolumeChange}
                    className="absolute top-0 left-0 w-full h-1 opacity-0 cursor-pointer"
                    aria-label="音量"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Player controls */}
        <div className="w-full max-w-md">
          <div className="flex justify-center items-center space-x-4 sm:space-x-8 mb-4 sm:mb-8">
            <Tooltip>
              <TooltipTrigger asChild>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={onPrevious}
                  className="p-3 rounded-full bg-white bg-opacity-10 hover:bg-opacity-20 transition-all duration-200"
                  aria-label="前の曲へ"
                >
                  <SkipBackIcon size={24} />
                </motion.button>
              </TooltipTrigger>
              <TooltipContent>
                <p>前の曲へ</p>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <motion.button
                  whileHover={{ scale: isLoading ? 1 : 1.1 }}
                  whileTap={{ scale: isLoading ? 1 : 0.9 }}
                  onClick={isLoading ? undefined : isPlaying ? onPause : onPlay}
                  className={`p-6 rounded-full ${
                    isLoading ? 'bg-gray-500' : 'bg-white text-black'
                  } hover:bg-opacity-80 transition-all duration-200`}
                  disabled={isLoading}
                  aria-label={isLoading ? "読み込み中" : isPlaying ? "一時停止" : "再生"}
                >
                  {isLoading ? (
                    <Loader2 className="animate-spin" size={32} />
                  ) : isPlaying ? (
                    <PauseIcon size={32} />
                  ) : (
                    <PlayIcon size={32} />
                  )}
                </motion.button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isLoading ? "読み込み中" : isPlaying ? "一時停止" : "再生"}</p>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={onSkip}
                  className="p-3 rounded-full bg-white bg-opacity-10 hover:bg-opacity-20 transition-all duration-200"
                  aria-label="次の曲へ"
                >
                  <SkipForwardIcon size={24} />
                </motion.button>
              </TooltipTrigger>
              <TooltipContent>
                <p>次の曲へ</p>
              </TooltipContent>
            </Tooltip>
          </div>
          
          {/* Queue toggle button */}
          <motion.button
            className="mt-2 sm:mt-6 flex flex-col items-center cursor-pointer w-full"
            onClick={() => setIsDrawerOpen(true)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            aria-expanded={isDrawerOpen}
            aria-controls="queue-drawer"
          >
            <motion.div
              className="flex items-center justify-center bg-white bg-opacity-10 rounded-full p-1 sm:p-2 mb-1 sm:mb-2"
              animate={{ y: [0, -5, 0] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            >
              <ChevronUpIcon size={20} />
            </motion.div>
            <span className="text-xs sm:text-sm text-white text-opacity-70">
              キューを表示
            </span>
          </motion.button>
        </div>

        {/* Queue drawer */}
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerContent 
            {...drawerSwipeHandlers} 
            className="bg-zinc-950 text-zinc-200 border-t border-zinc-800"
            id="queue-drawer"
          >
            <DrawerHeader>
              <DrawerTitle className="text-xl font-bold text-zinc-200">キュー</DrawerTitle>
              <DrawerDescription className="text-zinc-400">
                現在のキューと関連動画
              </DrawerDescription>
            </DrawerHeader>
            
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-zinc-900">
                <TabsTrigger 
                  value="queue" 
                  className="data-[state=active]:bg-zinc-800 text-zinc-300"
                  aria-controls="queue-panel"
                >
                  キュー
                </TabsTrigger>
                <TabsTrigger 
                  value="related" 
                  className="data-[state=active]:bg-zinc-800 text-zinc-300"
                  aria-controls="related-panel"
                >
                  関連動画
                </TabsTrigger>
              </TabsList>
              
              <TabsContent 
                value="queue" 
                className="mt-4 overflow-y-auto pb-20" 
                style={{ height: 'calc(100vh - 300px)' }}
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
                  isOnDeviceMode={isOnDeviceMode}
                />
              </TabsContent>
              
              <TabsContent 
                value="related" 
                className="mt-4 overflow-y-auto space-y-4 pb-20" 
                style={{ height: 'calc(100vh - 300px)' }}
                id="related-panel"
                role="tabpanel"
              >
                <div className="flex justify-between">
                  <Button 
                    onClick={handleAddAllToQueue} 
                    disabled={isRelatedLoading || relatedTracks.length === 0} 
                    className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                  >
                    <PlusIcon className="mr-2 h-4 w-4" /> 全てキューに追加
                  </Button>
                  <Button 
                    onClick={() => {
                      setIsRelatedLoading(true);
                      if (currentTrack) {
                        const videoId = extractVideoId(currentTrack.url);
                        if (videoId) {
                          api.getRelatedSongs(videoId)
                            .then(tracks => {
                              setRelatedTracks(tracks);
                              setIsRelatedLoading(false);
                            })
                            .catch(error => {
                              console.error('関連トラック取得エラー:', error);
                              setIsRelatedLoading(false);
                              toast({
                                title: 'エラー',
                                description: '関連動画の取得に失敗しました。',
                                variant: 'destructive',
                              });
                            });
                        } else {
                          setIsRelatedLoading(false);
                        }
                      } else {
                        setIsRelatedLoading(false);
                      }
                    }} 
                    disabled={isRelatedLoading} 
                    className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                  >
                    <RefreshCwIcon className={`mr-2 h-4 w-4 ${isRelatedLoading ? 'animate-spin' : ''}`} /> 再取得
                  </Button>
                </div>
                <AnimatePresence mode="wait">
                  {isRelatedLoading ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-2"
                      key="skeletons"
                    >
                      {renderSkeletons()}
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="space-y-2"
                      key="related-tracks"
                    >
                      {relatedTracks.length === 0 ? (
                        <div className="text-center py-10 text-zinc-400">
                          関連する曲が見つかりませんでした
                        </div>
                      ) : (
                        relatedTracks.map(track => (
                          <RelatedTrackItem 
                            key={track.url} 
                            track={track} 
                            onAddToQueue={handleAddToQueue} 
                          />
                        ))
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </TabsContent>
            </Tabs>
            
            <DrawerFooter>
              <DrawerClose asChild>
                <Button 
                  variant="outline" 
                  className="w-full bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 border-zinc-700"
                >
                  閉じる
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </motion.div>
    </TooltipProvider>
  );
};