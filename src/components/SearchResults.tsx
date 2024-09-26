import React from 'react';
import { motion } from 'framer-motion';
import { Track } from '@/utils/api';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SearchResultsProps {
  results: Track[];
  onAddToQueue: (track: Track) => Promise<void>;
  onClose: () => void;
}

export const SearchResults: React.FC<SearchResultsProps> = ({ results, onAddToQueue, onClose }) => {
  return (
    <motion.div
      className="fixed inset-0 bg-background/95 backdrop-blur-sm z-50 overflow-y-auto pt-16"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="container mx-auto p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">検索結果</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={24} />
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map((track) => (
            <motion.div
              key={track.url}
              className="bg-card rounded-lg overflow-hidden shadow-lg"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <img src={track.thumbnail} alt={track.title} className="w-full h-48 object-cover" />
              <div className="p-4">
                <h3 className="font-bold text-lg mb-2 truncate">{track.title}</h3>
                <p className="text-muted-foreground mb-4">{track.artist}</p>
                <Button
                  onClick={() => onAddToQueue(track)}
                  className="w-full"
                >
                  キューに追加
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}