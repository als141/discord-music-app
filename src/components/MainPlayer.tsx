// MainPlayer.tsx
"use client"

import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PlayIcon, PauseIcon, SkipForwardIcon, SkipBackIcon, ChevronUpIcon, ChevronDownIcon, Volume2Icon, VolumeXIcon } from 'lucide-react'
import { Track, api } from '@/utils/api'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose } from '@/components/ui/drawer'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { QueueList } from './QueueList'
import { useToast } from '@/hooks/use-toast'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { useSwipeable } from 'react-swipeable'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useSession } from 'next-auth/react'
import { User } from '@/utils/api'
import { Loader2 } from 'lucide-react';
import { usePlayback } from '@/contexts/PlaybackContext';
import { useVolume } from '@/contexts/VolumeContext';

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
  const [activeTab, setActiveTab] = useState('queue')
  const { volume, setVolume } = useVolume();
  const { toast } = useToast()

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

  const extractVideoId = (url: string) => {
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/)
    return match ? match[1] : null
  }

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
      // オンデバイスモードの場合
      await handleDeviceAddToQueue(track); // この関数をMainAppから渡す必要があります
      toast({
        title: '成功',
        description: `"${track.title}" をキューに追加しました。`,
      });
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
    <ContextMenu key={track.url}>
      <ContextMenuTrigger>
        <motion.div
          className="flex items-center p-2 hover:bg-muted rounded-lg transition-colors duration-200"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Image src={track.thumbnail} alt={track.title} width={48} height={48} className="rounded-md" />
          <div className="ml-2 flex-grow overflow-hidden">
            <p className="text-sm font-semibold truncate">{track.title}</p>
            <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
          </div>
          <Button onClick={() => handleAddToQueue(track)} variant="ghost" size="sm">
            追加
          </Button>
        </motion.div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => {/* 次のキューに追加 */}}>
          次のキューに追加
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => {/* キューの最後に追加 */}}>
          キューの最後に追加
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => window.open(track.url, '_blank')}>
          Youtubeでリンクを開く
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => {/* 関連動画を表示 */}}>
          関連動画を表示する
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )

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
            <h2 className="text-xl sm:text-2xl font-bold truncate">{currentTrack?.title}</h2>
            <p className="text-base sm:text-lg text-gray-300 mt-1 sm:mt-2">{currentTrack?.artist}</p>
            </motion.div>
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
        <DrawerContent {...drawerSwipeHandlers}>
          <DrawerHeader>
            <DrawerTitle>コンテンツ</DrawerTitle>
            <DrawerDescription>キューと関連動画</DrawerDescription>
          </DrawerHeader>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="queue">キュー</TabsTrigger>
              <TabsTrigger value="related">関連動画</TabsTrigger>
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
                isOnDeviceMode={isOnDeviceMode} // 追加
              />
            </TabsContent>
            <TabsContent value="related" className="mt-4 overflow-y-auto" style={{ height: 'calc(100vh - 300px)' }}>
              <motion.div
                className="space-y-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ staggerChildren: 0.05 }}
              >
                {relatedTracks.map(renderRelatedTrackItem)}
              </motion.div>
            </TabsContent>
          </Tabs>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">閉じる</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </motion.div>
  )
}
