import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayIcon, PauseIcon, SkipForwardIcon, SkipBackIcon, ChevronUpIcon } from 'lucide-react';
import { Track } from '@/utils/api';
import Image from 'next/image';

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

  const containerVariants = {
    hidden: { opacity: 0, y: 50 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  const imageVariants = {
    hidden: { scale: 0.8, opacity: 0 },
    visible: { scale: 1, opacity: 1, transition: { duration: 0.5 } },
  };

  if (!currentTrack) {
    return (
      <motion.div
        className="flex flex-col items-center justify-center h-full bg-gradient-to-b from-gray-900 to-black text-white p-4"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <p className="text-xl font-semibold">再生中のトラックはありません</p>
        <p className="text-gray-400 mt-2">キューに曲を追加してください</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="flex flex-col items-center justify-between h-full bg-gradient-to-b from-gray-900 to-black text-white p-4 overflow-hidden"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <div className="flex-grow flex flex-col items-center justify-center w-full max-w-md">
        <motion.div
          className="w-full aspect-square rounded-lg overflow-hidden shadow-lg mb-8 relative"
          variants={imageVariants}
        >
          <Image
            ref={imageRef}
            src={currentTrack.thumbnail}
            alt={currentTrack.title}
            layout="fill"
            objectFit="cover"
            onLoad={() => setImageLoaded(true)}
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
          className="w-full text-center mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h2 className="text-2xl font-bold truncate">{currentTrack.title}</h2>
          <p className="text-lg text-gray-300 mt-2">{currentTrack.artist}</p>
        </motion.div>
      </div>

      <div className="w-full max-w-md">
        <div className="flex justify-center items-center space-x-8 mb-8">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onPrevious}
            className="p-3 rounded-full bg-white bg-opacity-10 hover:bg-opacity-20 transition-all duration-200"
          >
            <SkipBackIcon size={24} />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={isPlaying ? onPause : onPlay}
            className="p-6 rounded-full bg-white text-black hover:bg-opacity-80 transition-all duration-200"
          >
            {isPlaying ? <PauseIcon size={32} /> : <PlayIcon size={32} />}
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
    </motion.div>
  );
};