"use client"

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Track } from '@/utils/api'
import { PlayIcon, PauseIcon, ChevronUpIcon, ChevronDownIcon, TrashIcon } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'

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
  const truncateText = (text: string | undefined, maxLength: number) => {
    if (!text) return ''
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text
  }

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex >= 0 && newIndex < queue.length) {
      onReorder(index, newIndex);
    }
  };

  return (
    <div className={isEmbedded ? "flex flex-col h-full" : "queue-list"}>
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

      <div className="flex items-center p-4 bg-card">
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
        <Button
          onClick={onPlayPause}
          variant="ghost"
          size="icon"
          className="ml-2"
        >
          {isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
        </Button>
      </div>

      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="text-lg font-semibold">次の曲</h3>
      </div>

      <div className="flex-grow overflow-y-auto p-4">
        <AnimatePresence>
          {queue.map((track, index) => (
            <div key={`${track.url}-${index}`} className="mb-2">
              <motion.div
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
                className="flex items-center p-4 bg-card rounded-lg shadow-sm"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
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
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveItem(index, 'up')}
                    disabled={index === 0}
                  >
                    <ChevronUpIcon size={20} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveItem(index, 'down')}
                    disabled={index === queue.length - 1}
                  >
                    <ChevronDownIcon size={20} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(index)}
                    className="text-destructive hover:text-destructive"
                  >
                    <TrashIcon size={20} />
                  </Button>
                </div>
              </motion.div>
            </div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}