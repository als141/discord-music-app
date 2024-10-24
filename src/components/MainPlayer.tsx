// MainPlayer.tsx
"use client"

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PlayIcon, PauseIcon, SkipForwardIcon, SkipBackIcon, ChevronUpIcon, ChevronDownIcon, Volume2Icon, VolumeXIcon, RefreshCwIcon, PlusIcon } from 'lucide-react'
import { Track, api } from '@/utils/api'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose } from '@/components/ui/drawer'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { QueueList } from './QueueList'
import { useToast } from '@/hooks/use-toast'
import { useSwipeable } from 'react-swipeable'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useSession } from 'next-auth/react'
import { User } from '@/utils/api'
import { Loader2 } from 'lucide-react';
import { usePlayback } from '@/contexts/PlaybackContext';
import { useVolume } from '@/contexts/VolumeContext';
import { Skeleton } from '@/components/ui/skeleton'
import ArtistDialog from '@/components/ArtistDialog';

interface MainPlayerProps {
  currentTrack: Track | null
  isPlaying: boolean
  onPlay: () => void
  onPause: () => void
  onSkip: () => void
  onPrevious: () => void
  queue: Track[]
  onReorder: (startIndex: number, endIndex: number) => void
  onDelete: (index: number) => void
  guildId: string | null
  onClose: () => void
  isVisible: boolean
  isOnDeviceMode: boolean // 追加
  audioRef?: React.RefObject<HTMLAudioElement> // 追加
  handleDeviceAddToQueue: (track: Track) => Promise<void>;
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
  handleDeviceAddToQueue,
  isLoading
}) => {
  const { data: session } = useSession()
  const { currentTime, duration, setCurrentTime, setDuration, audioRef } = usePlayback();
  const [imageLoaded, setImageLoaded] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [relatedTracks, setRelatedTracks] = useState<Track[]>([])
  const [isRelatedLoading, setIsRelatedLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('queue')
  const { volume, setVolume } = useVolume();
  const { toast } = useToast()
  const [isArtistDialogOpen, setIsArtistDialogOpen] = useState(false);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);
  const [isArtistLoading, setIsArtistLoading] = useState(false);

  useEffect(() => {
    if (imageRef.current && imageRef.current.complete) {
      setImageLoaded(true)
    }
  }, [currentTrack])

  useEffect(() => {
    if ('mediaSession' in navigator && currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: 'Album Name', // 必要に応じて
        artwork: [
          { src: currentTrack.thumbnail, sizes: '512x512', type: 'image/png' },
        ],
      });
  
      navigator.mediaSession.setActionHandler('play', onPlay);
      navigator.mediaSession.setActionHandler('pause', onPause);
      navigator.mediaSession.setActionHandler('previoustrack', onPrevious);
      navigator.mediaSession.setActionHandler('nexttrack', onSkip);
    }
  }, [currentTrack, onPlay, onPause, onPrevious, onSkip]);

  useEffect(() => {
    const fetchRelatedTracks = async () => {
      if (currentTrack) {
        const videoId = extractVideoId(currentTrack.url)
        if (videoId) {
          try {
            const tracks = await api.getRelatedSongs(videoId)
            setRelatedTracks(tracks)
          } catch (error) {
            console.error('関連動画の取得中にエラーが発生しました:', error)
            toast({
              title: 'エラー',
              description: '関連動画の取得に失敗しました。',
              variant: 'destructive',
            })
          }
        }
      }
    }

    if (currentTrack) {
      fetchRelatedTracks()
    }
  }, [currentTrack?.url, toast])

  const handleArtistClick = async (artistName: string) => {
    setIsArtistLoading(true);
    try {
      // キャッシュの確認
      const cachedArtistId = localStorage.getItem(`artistId_${artistName}`);
      if (cachedArtistId) {
        setSelectedArtistId(cachedArtistId);
        setIsArtistDialogOpen(true);
        return;
      }
      // アーティスト名で検索
      const searchResults = await api.search(artistName, 'artists');
      if (searchResults.length > 0) {
        const artist = searchResults[0];
        if (artist.browseId) {
          setSelectedArtistId(artist.browseId);
          setIsArtistDialogOpen(true);
          // キャッシュに保存
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

  const extractVideoId = (url: string) => {
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/)
    return match ? match[1] : null
  };

  const getCachedTracks = useCallback((videoId: string) => {
    const cachedData = localStorage.getItem(`relatedTracks_${videoId}`);
    if (cachedData) {
      const { tracks, timestamp } = JSON.parse(cachedData);
      // キャッシュの有効期限を1時間とする
      if (Date.now() - timestamp < 3600000) {
        return tracks;
      }
    }
    return null;
  }, []);

  const setCachedTracks = useCallback((videoId: string, tracks: Track[]) => {
    localStorage.setItem(`relatedTracks_${videoId}`, JSON.stringify({
      tracks,
      timestamp: Date.now()
    }));
  }, []);

  const fetchRelatedTracks = useCallback(async (forceRefresh = false) => {
    if (currentTrack) {
      setIsRelatedLoading(true);
      const videoId = extractVideoId(currentTrack.url);
      if (videoId) {
        if (!forceRefresh) {
          const cachedTracks = getCachedTracks(videoId);
          if (cachedTracks) {
            setRelatedTracks(cachedTracks);
            setIsRelatedLoading(false);
            return;
          }
        }
        try {
          const tracks = await api.getRelatedSongs(videoId);
          setRelatedTracks(tracks);
          setCachedTracks(videoId, tracks);
        } catch (error) {
          console.error('関連動画の取得中にエラーが発生しました:', error);
          toast({
            title: 'エラー',
            description: '関連動画の取得に失敗しました。',
            variant: 'destructive',
          });
        } finally {
          setIsRelatedLoading(false);
        }
      }
    }
  }, [currentTrack, getCachedTracks, setCachedTracks, toast]);

  useEffect(() => {
    if (currentTrack && isDrawerOpen && activeTab === 'related') {
      const videoId = extractVideoId(currentTrack.url);
      if (videoId) {
        const cachedTracks = getCachedTracks(videoId);
        if (cachedTracks) {
          setRelatedTracks(cachedTracks);
        } else {
          fetchRelatedTracks();
        }
      }
    }
  }, [currentTrack, isDrawerOpen, activeTab, getCachedTracks, fetchRelatedTracks])

  const handleAddAllToQueue = async () => {
    try {
      setIsRelatedLoading(true); // ローディング状態を設定
  
      // 全てのトラックを並行して追加
      await Promise.all(relatedTracks.map(track => handleAddToQueue(track)));
  
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
      setIsRelatedLoading(false); // ローディング状態を解除
    }
  };

  const handleRefreshRelatedTracks = () => {
    fetchRelatedTracks(true);
  };

  const formatTime = (time: number) => {
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
      setCurrentTime(newTime);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (isOnDeviceMode && audioRef?.current) {
      audioRef.current.volume = newVolume;
    }
  };


  const handleAddToQueue = async (track: Track) => {
    if (isOnDeviceMode) {
      await handleDeviceAddToQueue(track);
    } else {
      if (!guildId) {
        toast({
          title: 'エラー',
          description: 'サーバーが選択されていません。',
          variant: 'destructive',
        })
        return
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
        await api.addUrl(guildId, track.url, user)
        toast({
          title: '成功',
          description: '曲がキューに追加されました。',
        })
      } catch (error) {
        console.error('曲の追加中にエラーが発生しました:', error)
        toast({
          title: 'エラー',
          description: '曲の追加に失敗しました。',
          variant: 'destructive',
        })
      }
    }
  }


  const renderRelatedTrackItem = (track: Track) => (
    <motion.div
      key={track.url}
      className="flex items-center p-2 bg-zinc-950 rounded-lg transition-colors duration-200 hover:bg-zinc-900"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <Image src={track.thumbnail} alt={track.title} width={48} height={48} className="rounded-md" />
      <div className="ml-2 flex-grow overflow-hidden">
        <p className="text-sm font-semibold truncate text-zinc-300">{track.title}</p>
        <p className="text-xs text-zinc-500 truncate">{track.artist}</p>
      </div>
      <Button onClick={() => handleAddToQueue(track)} variant="ghost" size="sm" className="text-zinc-300 hover:bg-zinc-800 hover:text-white">
        追加
      </Button>
    </motion.div>
  );

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

  const swipeHandlers = useSwipeable({
    onSwipedDown: () => onClose(),
    onSwipedUp: () => setIsDrawerOpen(true),
    trackTouch: true,
    trackMouse: false,
  })

  const drawerSwipeHandlers = useSwipeable({
    onSwipedLeft: () => setActiveTab('related'),
    onSwipedRight: () => setActiveTab('queue'),
    trackTouch: true,
    trackMouse: false,
  })

  useEffect(() => {
    if (isOnDeviceMode && audioRef?.current) {
      const audio = audioRef.current;
      const updateTime = () => {
        setCurrentTime(audio.currentTime);
      };
      const updateDuration = () => {
        setDuration(audio.duration);
      };
      audio.addEventListener('timeupdate', updateTime);
      audio.addEventListener('durationchange', updateDuration);
      return () => {
        audio.removeEventListener('timeupdate', updateTime);
        audio.removeEventListener('durationchange', updateDuration);
      };
    }
  }, [isOnDeviceMode, audioRef]);

  return (
    <motion.div
      {...swipeHandlers}
      className="flex flex-col items-center justify-between h-full bg-gradient-to-b from-gray-900 to-black text-white p-4 overflow-hidden relative"
      initial={{ opacity: 0, y: "100%" }}
      animate={{ opacity: isVisible ? 1 : 0, y: isVisible ? 0 : "100%" }}
      exit={{ opacity: 0, y: "100%" }}
      transition={{ duration: 0.3 }}
    >
      <Button
        onClick={onClose}
        className="absolute top-4 left-4 z-0 bg-black bg-opacity-50 hover:bg-opacity-70 transition-all duration-200"
        variant="ghost"
        size="icon"
      >
        <ChevronDownIcon size={35}/>
      </Button>
      <div className="flex-grow flex flex-col items-center justify-center w-full max-w-md pt-16 sm:pt-8">
        <motion.div
          className="w-full max-w-[80vw] sm:max-w-[50vw] aspect-square rounded-lg overflow-hidden shadow-lg mb-4 sm:mb-8 relative"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <Image
            ref={imageRef}
            src={currentTrack?.thumbnail || '/default_thumbnail.webp'}
            alt={currentTrack?.title || 'No track selected'}
            fill
            style={{ objectFit: 'cover' }}
            onLoad={() => setImageLoaded(true)}
            className="z-0"
            unoptimized
          />
          <AnimatePresence>
            {!imageLoaded && (
              <motion.div
                className="absolute inset-0 bg-gray-800 flex items-center justify-center"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </motion.div>
            )}
          </AnimatePresence>
          </motion.div>

          <motion.div
            className="w-full text-center mb-4 sm:mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h2 className="text-xl sm:text-2xl font-bold truncate mb-2">{currentTrack?.title}</h2>
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
                >
                  {isArtistLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-primary/50 border-t-primary rounded-full animate-spin" />
                      <span className="text-gray-300">読み込み中...</span>
                    </div>
                  ) : (
                    <>
                      <span className="text-base sm:text-lg text-primary max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                        {currentTrack.artist}
                      </span>
                      <span className="flex-shrink-0">
                        <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                          <svg
                            className="w-3 h-3 text-primary transform translate-x-[1px] group-hover:scale-110 transition-transform"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                        </div>
                      </span>
                    </>
                  )}
                </button>
              </motion.div>
            ) : (
              <p className="text-base sm:text-lg text-gray-300 mt-1 sm:mt-2">{currentTrack?.artist}</p>
            )}
          </motion.div>

          {isArtistDialogOpen && selectedArtistId && (
            <ArtistDialog
              artistId={selectedArtistId}
              isOpen={isArtistDialogOpen}
              onClose={() => setIsArtistDialogOpen(false)}
              onAddTrackToQueue={handleAddToQueue}
              onAddItemToQueue={async (item) => {
                // itemが Track 型の場合のみ handleAddToQueue を呼び出す
                if ('url' in item && 'title' in item && 'artist' in item && 'thumbnail' in item) {
                  await handleAddToQueue(item as Track);
                } else {
                  console.warn('Unsupported item type:', item);
                }
              }}
            />
          )}
        {/* オンデバイスモードでない場合のみ表示 */}
        {!isOnDeviceMode && currentTrack?.added_by && (
          <div className="flex items-center mt-4">
            <Avatar>
              {currentTrack.added_by.image ? (
                <AvatarImage src={currentTrack.added_by.image} alt={currentTrack.added_by.name || 'Unknown'} />
              ) : (
                <AvatarFallback>U</AvatarFallback>
              )}
            </Avatar>
            <span className="ml-2">
              {currentTrack.added_by.name || 'Unknown'}さんが追加
            </span>
          </div>
        )}
        {/* オンデバイスモードのときは再生バーを表示 */}
        {isOnDeviceMode && (
        <div className="w-full max-w-md px-4 mt-8">
          <div className="mb-4">
            <div className="relative pt-1">
              <div className="flex mb-2 items-center justify-between text-xs text-gray-400">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
              <div 
                className="relative h-1 bg-gray-700 rounded-full cursor-pointer"
                onClick={handleSeek}
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
          
          <div className="flex items-center mt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVolume(volume === 0 ? 1 : 0)}
              className="mr-2 text-white hover:text-gray-300"
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
              />
            </div>
          </div>
        </div>
      )}
          </div>
          <div className="w-full max-w-md">
          <div className="flex justify-center items-center space-x-4 sm:space-x-8 mb-4 sm:mb-8">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onPrevious}
            className="p-3 rounded-full bg-white bg-opacity-10 hover:bg-opacity-20 transition-all duration-200"
          >
            <SkipBackIcon size={24} />
          </motion.button>
          <motion.button
          whileHover={{ scale: isLoading ? 1 : 1.1 }}
          whileTap={{ scale: isLoading ? 1 : 0.9 }}
          onClick={isLoading ? undefined : isPlaying ? onPause : onPlay}
          className={`p-6 rounded-full ${
            isLoading ? 'bg-gray-500' : 'bg-white text-black'
          } hover:bg-opacity-80 transition-all duration-200`}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="animate-spin" size={32} />
          ) : isPlaying ? (
            <PauseIcon size={32} />
          ) : (
            <PlayIcon size={32} />
          )}
        </motion.button>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onSkip}
            className="p-3 rounded-full bg-white bg-opacity-10 hover:bg-opacity-20 transition-all duration-200"
          >
            <SkipForwardIcon size={24} />
          </motion.button>
          </div>
        <motion.div
          className="mt-2 sm:mt-6 flex flex-col items-center cursor-pointer"
          onClick={() => setIsDrawerOpen(true)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <motion.div
            className="flex items-center justify-center bg-white bg-opacity-10 rounded-full p-1 sm:p-2 mb-1 sm:mb-2"
            animate={{ y: [0, -5, 0] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
          >
            <ChevronUpIcon size={20} />
          </motion.div>
          <span className="text-xs sm:text-sm text-white text-opacity-70">コンテンツを表示</span>
        </motion.div>
      </div>


      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <DrawerContent {...drawerSwipeHandlers} className="bg-zinc-950 text-zinc-200 border-t border-zinc-800">
          <DrawerHeader>
            <DrawerTitle className="text-xl font-bold text-zinc-200">コンテンツ</DrawerTitle>
            <DrawerDescription className="text-zinc-400">キューと関連動画</DrawerDescription>
          </DrawerHeader>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-zinc-900">
              <TabsTrigger value="queue" className="data-[state=active]:bg-zinc-800 text-zinc-300">キュー</TabsTrigger>
              <TabsTrigger value="related" className="data-[state=active]:bg-zinc-800 text-zinc-300">関連動画</TabsTrigger>
            </TabsList>
            <TabsContent value="queue" className="mt-4 overflow-y-auto" style={{ height: 'calc(100vh - 300px)' }}>
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
            <TabsContent value="related" className="mt-4 overflow-y-auto space-y-4" style={{ height: 'calc(100vh - 300px)' }}>
              <div className="flex justify-between">
                <Button 
                  onClick={handleAddAllToQueue} 
                  disabled={isRelatedLoading || relatedTracks.length === 0} 
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                >
                  <PlusIcon className="mr-2 h-4 w-4" /> 全てキューに追加
                </Button>
                <Button 
                  onClick={handleRefreshRelatedTracks} 
                  disabled={isRelatedLoading} 
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                >
                  <RefreshCwIcon className="mr-2 h-4 w-4" /> 関連動画を再取得
                </Button>
              </div>
              <AnimatePresence>
                {isRelatedLoading ? (
                  renderSkeletons()
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-2"
                  >
                    {relatedTracks.map(renderRelatedTrackItem)}
                  </motion.div>
                )}
              </AnimatePresence>
            </TabsContent>
          </Tabs>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 border-zinc-700">
                閉じる
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </motion.div>
  )
}