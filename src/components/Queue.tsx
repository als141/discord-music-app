'use client'

import React from 'react'
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { ChevronUp, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface Track {
  url: string
  title: string
  artist: string
  thumbnail: string
}

interface QueueItem {
  track: Track
  isCurrent: boolean
  position: number
}

interface QueueProps {
  queue: QueueItem[]
  onReorderQueue: (newQueue: QueueItem[]) => void
}

const QueueItemComponent = ({ 
  item, 
  index, 
  isFirst, 
  isLast, 
  onMoveUp, 
  onMoveDown 
}: { 
  item: QueueItem
  index: number
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className="flex items-center gap-4 p-2 border-b last:border-b-0"
    >
      <img
        src={item.track.thumbnail}
        alt={item.track.title}
        className="w-12 h-12 object-cover rounded"
      />
      <div className="flex-grow">
        <h3 className="font-semibold">{item.track.title}</h3>
        <p className="text-sm text-muted-foreground">{item.track.artist}</p>
      </div>
      {item.isCurrent && <span className="text-primary mr-2">再生中</span>}
      <div className="flex flex-col">
        {!isFirst && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMoveUp}
            aria-label={`Move ${item.track.title} up`}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
        )}
        {!isLast && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMoveDown}
            aria-label={`Move ${item.track.title} down`}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        )}
      </div>
    </motion.div>
  )
}

export function Queue({ queue, onReorderQueue }: QueueProps) {
  const moveItem = (fromIndex: number, toIndex: number) => {
    const newQueue = [...queue]
    const [movedItem] = newQueue.splice(fromIndex, 1)
    newQueue.splice(toIndex, 0, movedItem)
    onReorderQueue(newQueue)
  }

  return (
    <Card>
      <CardContent className="p-4">
        {queue.length === 0 ? (
          <p className="text-center text-muted-foreground">キューに曲がありません。</p>
        ) : (
          <ScrollArea className="h-[300px]">
            <AnimatePresence initial={false}>
              {queue.map((item, index) => (
                <QueueItemComponent
                  key={item.track.url}
                  item={item}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === queue.length - 1}
                  onMoveUp={() => moveItem(index, index - 1)}
                  onMoveDown={() => moveItem(index, index + 1)}
                />
              ))}
            </AnimatePresence>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}