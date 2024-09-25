'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Track } from '@/utils/api';
import { PlayIcon, PauseIcon, GripVerticalIcon, ChevronUpIcon, ChevronDownIcon } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import Image from 'next/image';

interface QueueListProps {
  queue: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlayPause: () => void;
  onReorder: (startIndex: number, endIndex: number) => void;
  onClose: () => void;
}

export const QueueList: React.FC<QueueListProps> = ({
  queue,
  currentTrack,
  isPlaying,
  onPlayPause,
  onReorder,
  onClose,
}) => {
  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    onReorder(result.source.index, result.destination.index);
  };

  const truncateText = (text: string | undefined, maxLength: number) => {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex >= 0 && newIndex < queue.length) {
      onReorder(index, newIndex);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 bg-black bg-opacity-90 text-white z-50"
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
    >
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold">次のコンテンツ</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            閉じる
          </button>
        </div>

        <div className="flex items-center p-4 bg-gray-800">
        <Image
                src={currentTrack?.thumbnail || '/default_thumbnail.png'}
                alt={currentTrack?.title || 'No track selected'}
                width={64}
                height={64}
                className="rounded-md"
            />
          <div className="flex-grow overflow-hidden">
            <h3 className="font-semibold truncate">{truncateText(currentTrack?.title, 25)}</h3>
            <p className="text-sm text-gray-400 truncate">{truncateText(currentTrack?.artist, 25)}</p>
          </div>
          <button
            onClick={onPlayPause}
            className="p-2 rounded-full bg-white text-black hover:bg-opacity-80 transition-all duration-200 ml-2"
          >
            {isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
          </button>
        </div>

        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="queue">
            {(provided) => (
              <ul
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="flex-grow overflow-y-auto"
              >
                <AnimatePresence>
                  {queue.map((track, index) => (
                    <Draggable key={`${track.url}-${index}`} draggableId={`${track.url}-${index}`} index={index}>
                      {(provided, snapshot) => (
                        <li
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className={`flex items-center p-4 border-b border-gray-700 ${
                            snapshot.isDragging ? 'bg-gray-700' : ''
                          }`}
                        >
                          <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.2 }}
                            className="flex items-center w-full"
                          >
                            <div className="mr-4">
                              <GripVerticalIcon size={20} className="text-gray-400" />
                            </div>
                            <Image
                                src={track.thumbnail || '/default_thumbnail.png'}
                                alt={track.title}
                                width={48}
                                height={48}
                                className="rounded-md"
                                />
                            <div className="flex-grow overflow-hidden">
                              <h4 className="font-semibold truncate">{truncateText(track.title, 30)}</h4>
                              <p className="text-sm text-gray-400 truncate">{truncateText(track.artist, 30)}</p>
                            </div>
                            <div className="flex flex-col ml-2">
                              {index > 0 && (
                                <button
                                  onClick={() => moveItem(index, 'up')}
                                  className="p-1 text-gray-400 hover:text-white"
                                >
                                  <ChevronUpIcon size={20} />
                                </button>
                              )}
                              {index < queue.length - 1 && (
                                <button
                                  onClick={() => moveItem(index, 'down')}
                                  className="p-1 text-gray-400 hover:text-white"
                                >
                                  <ChevronDownIcon size={20} />
                                </button>
                              )}
                            </div>
                          </motion.div>
                        </li>
                      )}
                    </Draggable>
                  ))}
                </AnimatePresence>
                {provided.placeholder}
              </ul>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    </motion.div>
  );
};
