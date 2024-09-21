'use client';

import React, { useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { QueueItem } from '@/utils/api';

interface QueueProps {
  queue: QueueItem[];
  onReorderQueue: (newQueue: QueueItem[]) => Promise<void>;
}

const QueueItemComponent = ({
  item,
  index,
  totalItems,
  onMoveUp,
  onMoveDown,
  isFirstItem,
}: {
  item: QueueItem;
  index: number;
  totalItems: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirstItem: boolean;
}) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className="flex items-center gap-4 p-4 border-b last:border-b-0 bg-white/80 backdrop-blur-sm hover:bg-white/90 transition-all duration-300"
    >
      <img
        src={item.track.thumbnail}
        alt={item.track.title}
        className="w-12 h-12 object-cover rounded-md shadow-sm"
      />
      <div className="flex-grow">
        <h3 className="font-semibold text-purple-900">{item.track.title}</h3>
        <p className="text-sm text-purple-600">{item.track.artist}</p>
      </div>
      {item.isCurrent && <span className="text-green-500 font-medium mr-2">再生中</span>}
      {!isFirstItem && (
        <div className="flex flex-col">
          {index !== 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-purple-600 hover:text-purple-800 hover:bg-purple-100"
              onClick={onMoveUp}
              aria-label={`Move ${item.track.title} up`}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
          )}
          {index !== totalItems - 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-purple-600 hover:text-purple-800 hover:bg-purple-100"
              onClick={onMoveDown}
              aria-label={`Move ${item.track.title} down`}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </motion.div>
  );
};

export function Queue({ queue: initialQueue, onReorderQueue }: QueueProps) {
  const [queue, setQueue] = useState(initialQueue);

  const moveItem = (fromIndex: number, toIndex: number) => {
    const newQueue = [...queue];
    const [movedItem] = newQueue.splice(fromIndex, 1);
    newQueue.splice(toIndex, 0, movedItem);
    setQueue(newQueue);
    onReorderQueue(newQueue);
  };

  return (
    <Card className="w-full max-w-md mx-auto bg-gradient-to-br from-purple-100 to-indigo-100 rounded-xl shadow-lg">
      <CardContent className="p-4">
        <h2 className="text-2xl font-bold mb-4 text-center text-purple-800">Music Queue</h2>
        {queue.length === 0 ? (
          <p className="text-center text-purple-600">キューに曲がありません。</p>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <AnimatePresence initial={false}>
              {queue.map((item, index) => (
                <QueueItemComponent
                  key={item.track.url}
                  item={item}
                  index={index}
                  totalItems={queue.length}
                  onMoveUp={() => moveItem(index, index - 1)}
                  onMoveDown={() => moveItem(index, index + 1)}
                  isFirstItem={index === 0}
                />
              ))}
            </AnimatePresence>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default Queue;
