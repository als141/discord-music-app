import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Plus, RefreshCw } from 'lucide-react';
import { Track } from '@/utils/api';
import Image from 'next/image';
import { Skeleton } from '@/components/ui/skeleton';

interface RelatedTracksProps {
  tracks: Track[];
  isLoading: boolean;
  onAddToQueue: (track: Track) => Promise<void>;
  onAddAllToQueue: () => Promise<void>;
  onRefresh: () => void;
}

export const RelatedTracks: React.FC<RelatedTracksProps> = ({
  tracks,
  isLoading,
  onAddToQueue,
  onAddAllToQueue,
  onRefresh,
}) => {
  const renderSkeletons = () => (
    Array(5).fill(0).map((_, index) => (
      <div key={index} className="flex items-center p-2 bg-zinc-950 rounded-lg">
        <Skeleton className="w-12 h-12 rounded-md bg-zinc-900" />
        <div className="ml-2 flex-grow">
          <Skeleton className="h-4 w-3/4 mb-2 bg-zinc-900" />
          <Skeleton className="h-3 w-1/2 bg-zinc-900" />
        </div>
        <Skeleton className="w-16 h-8 rounded-md bg-zinc-900" />
      </div>
    ))
  );

  const renderTrackItem = (track: Track) => (
    <motion.div
      key={track.url}
      className="flex items-center p-2 bg-zinc-950 rounded-lg transition-colors duration-200 hover:bg-zinc-900"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <Image 
        src={track.thumbnail} 
        alt={track.title} 
        width={48} 
        height={48} 
        className="rounded-md"
        unoptimized
      />
      <div className="ml-2 flex-grow overflow-hidden">
        <p className="text-sm font-semibold truncate text-zinc-300">{track.title}</p>
        <p className="text-xs text-zinc-500 truncate">{track.artist}</p>
      </div>
      <Button 
        onClick={() => onAddToQueue(track)} 
        variant="ghost" 
        size="sm" 
        className="text-zinc-300 hover:bg-zinc-800 hover:text-white"
      >
        追加
      </Button>
    </motion.div>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <Button 
          onClick={onAddAllToQueue} 
          disabled={isLoading || tracks.length === 0} 
          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
        >
          <Plus className="mr-2 h-4 w-4" /> 全てキューに追加
        </Button>
        <Button 
          onClick={onRefresh} 
          disabled={isLoading} 
          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
        >
          <RefreshCw className="mr-2 h-4 w-4" /> 関連動画を再取得
        </Button>
      </div>

      <AnimatePresence>
        {isLoading ? (
          renderSkeletons()
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-2"
          >
            {tracks.length > 0 ? (
              tracks.map(renderTrackItem)
            ) : (
              <div className="text-center p-4 text-zinc-400">
                関連する曲が見つかりませんでした
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default RelatedTracks;