import React from 'react';
import { motion } from 'framer-motion';
import { Track } from '@/utils/api';
import { X } from 'lucide-react';

interface SearchResultsProps {
  results: Track[];
  onAddToQueue: (track: Track) => Promise<void>;
  onClose: () => void;
}

export const SearchResults: React.FC<SearchResultsProps> = ({ results, onAddToQueue, onClose }) => {
  return (
    <motion.div
      className="fixed inset-0 bg-black bg-opacity-90 z-50 overflow-y-auto pt-16"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="container mx-auto p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">検索結果</h2>
          <button onClick={onClose} className="p-2">
            <X size={24} />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map((track) => (
            <motion.div
              key={track.url}
              className="bg-gray-800 rounded-lg overflow-hidden shadow-lg"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <img src={track.thumbnail} alt={track.title} className="w-full h-48 object-cover" />
              <div className="p-4">
                <h3 className="font-bold text-lg mb-2 truncate">{track.title}</h3>
                <p className="text-gray-400 mb-4">{track.artist}</p>
                <button
                  onClick={() => onAddToQueue(track)}
                  className="w-full bg-blue-500 text-white py-2 rounded-full hover:bg-blue-600 transition-colors"
                >
                  キューに追加
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
};