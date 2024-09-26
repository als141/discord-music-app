"use client"

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Track } from '@/utils/api'
import { PlayIcon, PauseIcon, ChevronUpIcon, ChevronDownIcon, TrashIcon } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'

interface QueueListProps {
  queue: Track[]
  currentTrack: Track | null
  isPlaying: boolean
  onPlayPause: () => void
  onReorder: (startIndex: number, endIndex: number) => void
  onClose?: () => void
  onDelete: (index: number) => void
  isEmbedded?: boolean
}

export const QueueList: React.FC<QueueListProps> = ({
  queue,
  currentTrack,
  isPlaying,
  onPlayPause,
  onReorder,
  onClose,
  onDelete,
  isEmbedded = false,
}) => {
  const { toast } = useToast()

  const truncateText = (text: string | undefined, maxLength: number) => {
    if (!text) return ''
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text
  }

  const handleMoveItem = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex >= 0 && newIndex < queue.length) {
      onReorder(index, newIndex)
      toast({
        title: "曲を移動しました",
        description: `${direction === 'up' ? '上' : '下'}に移動しました。`,
      })
    }
  }

  const handleDelete = (index: number) => {
    onDelete(index)
    toast({
      title: "曲を削除しました",
      description: "キューから曲を削除しました。",
    })
  }

  return (
    <TooltipProvider>
      <div className={isEmbedded ? "flex flex-col h-full" : "queue-list"} aria-label="再生キュー">
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

        <div className="flex items-center p-4 bg-card" aria-label="現在再生中の曲">
          <Image
            src={currentTrack?.thumbnail || '/default_thumbnail.png'}
            alt={currentTrack?.title || 'No track selected'}
            width={64}
            height={64}
            className="rounded-md"
          />
          <div className="flex-grow overflow-hidden ml-4">
            <h3 className="font-semibold truncate">{truncateText(currentTrack?.title, 25)}</h3>
            <p className="text-sm text-muted-foreground truncate">{truncateText(currentTrack?.artist, 25)}</p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={onPlayPause}
                variant="ghost"
                size="icon"
                className="ml-2"
                aria-label={isPlaying ? "一時停止" : "再生"}
              >
                {isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isPlaying ? "一時停止" : "再生"}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold">次の曲</h3>
        </div>

        <div className="flex-grow overflow-y-auto p-4">
          <AnimatePresence>
            {queue.map((track, index) => (
              <motion.div
                key={`${track.url}-${index}`}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{
                  type: 'spring',
                  stiffness: 500,
                  damping: 30,
                  opacity: { duration: 0.2 }
                }}
                className="flex items-center p-4 bg-card rounded-lg shadow-sm mb-2"
              >
                <Image
                  src={track.thumbnail || '/default_thumbnail.png'}
                  alt={track.title}
                  width={48}
                  height={48}
                  className="rounded-md"
                />
                <div className="flex-grow overflow-hidden ml-4">
                  <h4 className="font-semibold truncate">{truncateText(track.title, 30)}</h4>
                  <p className="text-sm text-muted-foreground truncate">{truncateText(track.artist, 30)}</p>
                </div>
                <div className="flex items-center ml-4">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleMoveItem(index, 'up')}
                        disabled={index === 0}
                        aria-label="上に移動"
                      >
                        <ChevronUpIcon size={20} />
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
                        onClick={() => handleMoveItem(index, 'down')}
                        disabled={index === queue.length - 1}
                        aria-label="下に移動"
                      >
                        <ChevronDownIcon size={20} />
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
                        onClick={() => handleDelete(index)}
                        className="text-destructive hover:text-destructive"
                        aria-label={`${track.title}を削除`}
                      >
                        <TrashIcon size={20} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>削除</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </TooltipProvider>
  )
}