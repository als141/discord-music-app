'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { PlayIcon, PauseIcon, SkipForwardIcon, SkipBackIcon, ChevronUpIcon } from 'lucide-react';
import { Track } from '@/utils/api';

interface MainPlayerProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSkip: () => void;
  onPrevious: () => void;
  onQueueOpen: () => void;
}

export const MainPlayer: React.FC<MainPlayerProps> = ({
  currentTrack,
  isPlaying,
  onPlay,
  onPause,
  onSkip,
  onPrevious,
  onQueueOpen,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (imageRef.current && imageRef.current.complete) {
      setImageLoaded(true);
    }
  }, [currentTrack]);

  if (!currentTrack) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)] bg-gradient-to-b from-gray-900 to-black text-white">
        <p className="text-xl font-semibold">No track selected</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-between h-[calc(100vh-64px)] bg-gradient-to-b from-gray-900 to-black text-white p-4 overflow-hidden">
      <div className="flex-grow flex flex-col items-center justify-center w-full max-w-md">
        <div className="w-full aspect-square rounded-lg overflow-hidden shadow-lg mb-8">
          <motion.img
            ref={imageRef}
            src={currentTrack.thumbnail}
            alt={currentTrack.title}
            className="w-full h-full object-cover"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{
              opacity: imageLoaded ? 1 : 0,
              scale: imageLoaded ? 1 : 0.8,
            }}
            transition={{ duration: 0.5 }}
            onLoad={() => setImageLoaded(true)}
          />
        </div>

        <div className="w-full text-center mb-8">
          <h2 className="text-2xl font-bold truncate">{currentTrack.title}</h2>
          <p className="text-lg text-gray-300">{currentTrack.artist}</p>
        </div>
      </div>

      <div className="w-full">
        <div className="flex justify-center items-center space-x-8 mb-8">
          <button
            onClick={onPrevious}
            className="p-3 rounded-full bg-white bg-opacity-10 hover:bg-opacity-20 transition-all duration-200"
          >
            <SkipBackIcon size={24} />
          </button>
          <button
            onClick={isPlaying ? onPause : onPlay}
            className="p-6 rounded-full bg-white text-black hover:bg-opacity-80 transition-all duration-200"
          >
            {isPlaying ? <PauseIcon size={32} /> : <PlayIcon size={32} />}
          </button>
          <button
            onClick={onSkip}
            className="p-3 rounded-full bg-white bg-opacity-10 hover:bg-opacity-20 transition-all duration-200"
          >
            <SkipForwardIcon size={24} />
          </button>
        </div>

        <motion.button
          onClick={onQueueOpen}
          className="w-full flex items-center justify-center py-3 bg-white bg-opacity-10 rounded-full hover:bg-opacity-20 transition-all duration-200"
          whileHover={{ y: -2 }}
          whileTap={{ y: 0 }}
        >
          <span className="mr-2">次のコンテンツ</span>
          <ChevronUpIcon size={20} />
        </motion.button>
      </div>
    </div>
  );
};