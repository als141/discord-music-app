'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Track } from '@/utils/api';
import { X, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useInView } from 'react-intersection-observer';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ExtendedTrackインターフェースを定義
interface ExtendedTrack extends Track {
  type?: 'song' | 'video';
}

interface SearchResultsProps {
  results: ExtendedTrack[];
  onAddToQueue: (track: ExtendedTrack) => Promise<void>;
  onClose: () => void;
  onSearch: (query: string) => Promise<void>;
}

export const SearchResults: React.FC<SearchResultsProps> = ({ results, onAddToQueue, onClose, onSearch }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredResults, setFilteredResults] = useState<ExtendedTrack[]>(results);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { ref } = useInView({
    threshold: 0,
  });
  
  useEffect(() => {
    setFilteredResults(results);
  }, [results]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setIsLoading(true);
      await onSearch(searchQuery);
      setIsLoading(false);
    }
  };

  const handleAddToQueue = async (track: ExtendedTrack) => {
    try {
      await onAddToQueue(track);
      toast({
        title: "追加しました",
        description: `"${track.title}" をキューに追加しました。`,
      });
    } catch (error) { 
      console.error(error) // エラー内容をコンソールに出力
      toast({
        title: "エラー",
        description: "キューへの追加に失敗しました。",
        variant: "destructive",
      });
    }
  };

  return (
    <TooltipProvider>
      <motion.div
        className="fixed inset-0 bg-background/95 backdrop-blur-sm z-50 overflow-y-auto pt-16"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="container mx-auto p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold">検索結果</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="検索結果を閉じる">
                  <X size={24} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>閉じる</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <form onSubmit={handleSearch} className="mb-4 flex items-center">
            <Input
              type="text"
              placeholder="曲名、アーティスト名を入力..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-grow mr-2"
            />
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Searching...' : <Search size={20} />}
            </Button>
          </form>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {filteredResults.map((track) => (
                <motion.div
                  key={track.url}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.3 }}
                  className="bg-card rounded-lg overflow-hidden shadow-lg"
                >
                  <img src={track.thumbnail} alt={track.title} className="w-full h-48 object-cover" />
                  <div className="p-4">
                    <h3 className="font-bold text-lg mb-2 truncate">{track.title}</h3>
                    <p className="text-muted-foreground mb-4 truncate">{track.artist}</p>
                    <Button
                      onClick={() => handleAddToQueue(track)}
                      className="w-full"
                    >
                      キューに追加
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {isLoading && (
            <div className="flex justify-center items-center mt-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
          )}
          <div ref={ref} style={{ height: '20px' }} />
        </div>
      </motion.div>
    </TooltipProvider>
  );
};