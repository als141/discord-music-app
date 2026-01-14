// QueueList.tsx
"use client"

import React, { useState, useCallback, memo } from 'react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { Track } from '@/utils/api';
import { PlayIcon, PauseIcon, ChevronUpIcon, ChevronDownIcon, TrashIcon, User as UserIcon } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

// アニメーション設定
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
      transition: { staggerChildren: 0.05 } 
    },
    exit: { opacity: 0 }
  } as Variants,
  item: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 }
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

// メモ化された現在再生中のトラックコンポーネント
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
  // テキスト切り詰め用の関数
  const truncateText = (text: string | undefined, maxLength: number) => {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  return (
    <div className="flex items-center p-2 sm:p-4 bg-card" aria-label="現在再生中の曲">
      <Image
        src={track.thumbnail || '/default_thumbnail.png'}
        alt={track.title || 'No track selected'}
        width={48}
        height={48}
        className="rounded-md object-cover w-12 h-12 sm:w-16 sm:h-16 flex-shrink-0"
        unoptimized
      />
      <div className="flex-grow overflow-hidden ml-2 sm:ml-4 min-w-0">
        <h3 className="font-semibold truncate text-sm sm:text-base">{truncateText(track.title, 30)}</h3>
        <p className="text-xs sm:text-sm text-muted-foreground truncate">{truncateText(track.artist, 30)}</p>
        {!isOnDeviceMode && track.added_by && (
          <div className="flex items-center mt-1 sm:mt-2">
            <Avatar className="h-5 w-5 sm:h-6 sm:w-6 mr-1 sm:mr-2">
              {track.added_by.image ? (
                <AvatarImage src={track.added_by.image} alt={track.added_by.name || 'Unknown'} />
              ) : (
                <AvatarFallback><UserIcon className="h-3 w-3 sm:h-4 sm:w-4" /></AvatarFallback>
              )}
            </Avatar>
            <Badge variant="outline" className="text-[10px] sm:text-xs font-normal">
              {track.added_by.name || 'Unknown'}
            </Badge>
          </div>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={onPlayPause}
            variant="ghost"
            size="icon"
            className="ml-1 sm:ml-2 h-8 w-8 sm:h-10 sm:w-10 flex-shrink-0"
            aria-label={isPlaying ? "一時停止" : "再生"}
          >
            {isPlaying ? <PauseIcon className="h-5 w-5 sm:h-6 sm:w-6" /> : <PlayIcon className="h-5 w-5 sm:h-6 sm:w-6" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{isPlaying ? "一時停止" : "再生"}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
});

CurrentTrackItem.displayName = 'CurrentTrackItem';

// メモ化されたキュートラックアイテムコンポーネント
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
  // マウスオーバー状態
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <motion.div
      variants={animations.item}
      layout
      className="flex items-center p-2 sm:p-4 bg-card rounded-lg shadow-sm mb-2 transition-colors duration-150 hover:bg-muted"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid={`queue-item-${index}`}
    >
      <Image
        src={track.thumbnail || '/default_thumbnail.png'}
        alt={track.title}
        width={40}
        height={40}
        className="rounded-md object-cover w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0"
        unoptimized
      />
      <div className="flex-grow overflow-hidden ml-2 sm:ml-4 min-w-0">
        <h4 className="font-semibold truncate text-sm sm:text-base">{track.title}</h4>
        <p className="text-xs sm:text-sm text-muted-foreground truncate">{track.artist}</p>
        {!isOnDeviceMode && track.added_by && (
          <div className="flex items-center mt-1">
            <Avatar className="h-3 w-3 sm:h-4 sm:w-4 mr-1">
              {track.added_by.image ? (
                <AvatarImage src={track.added_by.image} alt={track.added_by.name || 'Unknown'} />
              ) : (
                <AvatarFallback><UserIcon className="h-2 w-2" /></AvatarFallback>
              )}
            </Avatar>
            <span className="text-[10px] sm:text-xs text-muted-foreground truncate">
              {track.added_by.name || 'Unknown'}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center ml-1 sm:ml-4 flex-shrink-0">
        <AnimatePresence>
          {(isHovered || true) && (
            <motion.div
              className="flex space-x-0.5 sm:space-x-1"
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
                    className={`h-7 w-7 sm:h-9 sm:w-9 ${isFirst ? 'opacity-30 cursor-not-allowed' : ''}`}
                  >
                    <ChevronUpIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
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
                    className={`h-7 w-7 sm:h-9 sm:w-9 ${isLast ? 'opacity-30 cursor-not-allowed' : ''}`}
                  >
                    <ChevronDownIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>下に移動</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onDelete}
                    className="text-destructive hover:text-destructive h-7 w-7 sm:h-9 sm:w-9"
                    aria-label={`${track.title}を削除`}
                  >
                    <TrashIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
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

// メインのQueueListコンポーネント
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

  // 移動処理
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

  // 削除処理
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
        className={isEmbedded ? "flex flex-col h-full" : "queue-list"} 
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
              <h2 className="text-xl font-bold">キュー</h2>
              <Button onClick={onClose} variant="ghost">
                閉じる
              </Button>
            </div>
          </motion.div>
        )}

        {/* 現在再生中の曲 */}
        {currentTrack ? (
          <CurrentTrackItem 
            track={currentTrack} 
            isPlaying={isPlaying} 
            onPlayPause={onPlayPause} 
            isOnDeviceMode={isOnDeviceMode} 
          />
        ) : (
          <div className="flex-grow text-center p-6 bg-card">
            <p className="text-muted-foreground">再生中の曲がありません</p>
          </div>
        )}

        {/* キューのヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold">次の曲</h3>
          <Badge variant="outline">
            {queue.length} 曲
          </Badge>
        </div>

        {/* キューのリスト */}
        <div className="flex-grow overflow-y-auto p-4">
          {queue.length === 0 ? (
            <div className="text-center p-6 bg-muted rounded-lg">
              <p className="text-muted-foreground">キューに曲がありません</p>
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