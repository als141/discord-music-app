// QueueList.tsx
"use client"

import React, { useState, useCallback, memo } from 'react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { Track } from '@/utils/api';
import { PlayIcon, PauseIcon, ChevronUpIcon, ChevronDownIcon, TrashIcon, User as UserIcon, Music2 } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

// Apple Music style animations
const animations = {
  container: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 }
  },
  list: {
    initial: { opacity: 0 },
    animate: {
      opacity: 1,
      transition: { staggerChildren: 0.04 }
    },
    exit: { opacity: 0 }
  } as Variants,
  item: {
    initial: { opacity: 0, y: 12 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }
    },
    exit: { opacity: 0, y: -12 }
  } as Variants
};

interface QueueListProps {
  queue: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlayPause: () => void;
  onReorder: (startIndex: number, endIndex: number) => void;
  onClose?: () => void;
  onDelete: (index: number) => void;
  isEmbedded?: boolean;
  isOnDeviceMode?: boolean;
}

// Current track component - Apple Music style
const CurrentTrackItem = memo(({
  track,
  isPlaying,
  onPlayPause,
  isOnDeviceMode
}: {
  track: Track;
  isPlaying: boolean;
  onPlayPause: () => void;
  isOnDeviceMode: boolean;
}) => {
  const truncateText = (text: string | undefined, maxLength: number) => {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  return (
    <div className="flex items-center p-4 bg-primary/5 rounded-xl mx-4 mb-4" aria-label="現在再生中の曲">
      <div className="relative">
        <Image
          src={track.thumbnail || '/default_thumbnail.png'}
          alt={track.title || 'No track selected'}
          width={56}
          height={56}
          className="rounded-lg object-cover w-14 h-14 shadow-md"
          unoptimized
        />
        {/* Playing indicator */}
        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center shadow-sm">
          {isPlaying ? (
            <motion.div
              className="flex items-center gap-0.5"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ repeat: Infinity, duration: 1 }}
            >
              <span className="w-0.5 h-2 bg-white rounded-full" />
              <span className="w-0.5 h-3 bg-white rounded-full" />
              <span className="w-0.5 h-2 bg-white rounded-full" />
            </motion.div>
          ) : (
            <Music2 className="w-2.5 h-2.5 text-white" />
          )}
        </div>
      </div>

      <div className="flex-grow overflow-hidden ml-4 min-w-0">
        <h3 className="font-semibold text-foreground truncate text-sm sm:text-base">
          {truncateText(track.title, 35)}
        </h3>
        <p className="text-xs sm:text-sm text-muted-foreground truncate">
          {truncateText(track.artist, 30)}
        </p>
        {!isOnDeviceMode && track.added_by && (
          <div className="flex items-center mt-2">
            <Avatar className="h-5 w-5 mr-1.5">
              {track.added_by.image ? (
                <AvatarImage src={track.added_by.image} alt={track.added_by.name || 'Unknown'} />
              ) : (
                <AvatarFallback className="bg-primary/10"><UserIcon className="h-2.5 w-2.5 text-primary" /></AvatarFallback>
              )}
            </Avatar>
            <span className="text-[11px] text-muted-foreground">
              {track.added_by.name || 'Unknown'}
            </span>
          </div>
        )}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={onPlayPause}
            variant="ghost"
            size="icon"
            className="ml-2 h-10 w-10 rounded-full bg-primary/10 hover:bg-primary/20 text-primary"
            aria-label={isPlaying ? "一時停止" : "再生"}
          >
            {isPlaying ? (
              <PauseIcon className="h-5 w-5" fill="currentColor" />
            ) : (
              <PlayIcon className="h-5 w-5 ml-0.5" fill="currentColor" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="bg-white/95 backdrop-blur-xl border-black/10">
          <p>{isPlaying ? "一時停止" : "再生"}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
});

CurrentTrackItem.displayName = 'CurrentTrackItem';

// Queue track item - Apple Music style
const QueueTrackItem = memo(({
  track,
  index,
  isLast,
  isFirst,
  onMoveUp,
  onMoveDown,
  onDelete,
  isOnDeviceMode
}: {
  track: Track;
  index: number;
  isLast: boolean;
  isFirst: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  isOnDeviceMode: boolean;
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      variants={animations.item}
      layout
      className="flex items-center p-3 bg-secondary/40 rounded-xl transition-colors duration-200 hover:bg-secondary/60"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid={`queue-item-${index}`}
    >
      {/* Track number */}
      <div className="w-6 text-center text-sm font-medium text-muted-foreground mr-2">
        {index + 1}
      </div>

      <Image
        src={track.thumbnail || '/default_thumbnail.png'}
        alt={track.title}
        width={48}
        height={48}
        className="rounded-lg object-cover w-12 h-12 shadow-sm"
        unoptimized
      />

      <div className="flex-grow overflow-hidden ml-3 min-w-0">
        <h4 className="font-medium text-foreground truncate text-sm">{track.title}</h4>
        <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
        {!isOnDeviceMode && track.added_by && (
          <div className="flex items-center mt-1">
            <Avatar className="h-4 w-4 mr-1">
              {track.added_by.image ? (
                <AvatarImage src={track.added_by.image} alt={track.added_by.name || 'Unknown'} />
              ) : (
                <AvatarFallback className="bg-primary/10"><UserIcon className="h-2 w-2 text-primary" /></AvatarFallback>
              )}
            </Avatar>
            <span className="text-[10px] text-muted-foreground truncate">
              {track.added_by.name || 'Unknown'}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center ml-2 flex-shrink-0">
        <AnimatePresence>
          {(isHovered || true) && (
            <motion.div
              className="flex items-center gap-0.5"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onMoveUp}
                    disabled={isFirst}
                    aria-label="上に移動"
                    className={`h-8 w-8 rounded-full hover:bg-black/5 ${isFirst ? 'opacity-30 cursor-not-allowed' : ''}`}
                  >
                    <ChevronUpIcon className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="bg-white/95 backdrop-blur-xl border-black/10">
                  <p>上に移動</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onMoveDown}
                    disabled={isLast}
                    aria-label="下に移動"
                    className={`h-8 w-8 rounded-full hover:bg-black/5 ${isLast ? 'opacity-30 cursor-not-allowed' : ''}`}
                  >
                    <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="bg-white/95 backdrop-blur-xl border-black/10">
                  <p>下に移動</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onDelete}
                    className="h-8 w-8 rounded-full hover:bg-destructive/10 text-destructive/70 hover:text-destructive"
                    aria-label={`${track.title}を削除`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="bg-white/95 backdrop-blur-xl border-black/10">
                  <p>削除</p>
                </TooltipContent>
              </Tooltip>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});

QueueTrackItem.displayName = 'QueueTrackItem';

// Main QueueList component
export const QueueList: React.FC<QueueListProps> = ({
  queue,
  currentTrack,
  isPlaying,
  onPlayPause,
  onReorder,
  onClose,
  onDelete,
  isEmbedded = false,
  isOnDeviceMode = false,
}) => {
  const { toast } = useToast();

  const handleMoveItem = useCallback((index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex >= 0 && newIndex < queue.length) {
      onReorder(index, newIndex);

      toast({
        title: "曲を移動しました",
        description: `${direction === 'up' ? '上' : '下'}に移動しました。`,
      });
    }
  }, [queue.length, onReorder, toast]);

  const handleDelete = useCallback((index: number) => {
    onDelete(index);

    toast({
      title: "曲を削除しました",
      description: "キューから曲を削除しました。",
    });
  }, [onDelete, toast]);

  return (
    <TooltipProvider>
      <div
        className={isEmbedded ? "flex flex-col h-full bg-background" : "queue-list bg-background"}
        aria-label="再生キュー"
        role="region"
      >
        {!isEmbedded && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="flex flex-col h-full"
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-xl font-bold text-foreground">キュー</h2>
              <Button
                onClick={onClose}
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
              >
                閉じる
              </Button>
            </div>
          </motion.div>
        )}

        {/* Current track */}
        {currentTrack ? (
          <CurrentTrackItem
            track={currentTrack}
            isPlaying={isPlaying}
            onPlayPause={onPlayPause}
            isOnDeviceMode={isOnDeviceMode}
          />
        ) : (
          <div className="flex-grow text-center p-8 mx-4 mb-4 bg-secondary/30 rounded-xl">
            <Music2 className="w-10 h-10 mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-muted-foreground text-sm">再生中の曲がありません</p>
          </div>
        )}

        {/* Queue header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <h3 className="text-sm font-semibold text-foreground">次に再生</h3>
          <span className="text-xs text-muted-foreground px-2 py-1 rounded-full bg-secondary/60">
            {queue.length} 曲
          </span>
        </div>

        {/* Queue list */}
        <div className="flex-grow overflow-y-auto p-4 space-y-2">
          {queue.length === 0 ? (
            <div className="text-center py-10 bg-secondary/30 rounded-xl">
              <Music2 className="w-10 h-10 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">キューに曲がありません</p>
              <p className="text-muted-foreground/60 text-xs mt-1">曲を追加してください</p>
            </div>
          ) : (
            <motion.div
              variants={animations.list}
              initial="initial"
              animate="animate"
              exit="exit"
              className="space-y-2"
            >
              {queue.map((track, index) => (
                <QueueTrackItem
                  key={`${track.url}-${index}`}
                  track={track}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === queue.length - 1}
                  onMoveUp={() => handleMoveItem(index, 'up')}
                  onMoveDown={() => handleMoveItem(index, 'down')}
                  onDelete={() => handleDelete(index)}
                  isOnDeviceMode={isOnDeviceMode}
                />
              ))}
            </motion.div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};
