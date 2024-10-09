'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayableItem, SearchItem, Track } from '@/utils/api';
import { X, Search, Music, Disc, PlaySquare, ListMusic, Plus, Loader2 } from 'lucide-react';
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
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import Image from 'next/image';
import { api } from '@/utils/api';

interface SearchResultsProps {
  results: SearchItem[];
  onAddToQueue: (item: PlayableItem) => Promise<void>;
  onAddTrackToQueue: (track: Track) => Promise<void>;
  onClose: () => void;
  onSearch: (query: string) => Promise<void>;
}

export const SearchResults: React.FC<SearchResultsProps> = ({ results, onAddToQueue, onAddTrackToQueue, onClose, onSearch }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredResults, setFilteredResults] = useState<SearchItem[]>(results);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { ref, inView } = useInView({
    threshold: 0,
  });

  const [playlistTracks, setPlaylistTracks] = useState<{[key: string]: Track[]}>({});
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

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

  const handleAddToQueue = async (item: SearchItem) => {
    try {
      await onAddToQueue(item);
      toast({
        title: "追加しました",
        description: `"${item.title}" をキューに追加しました。`,
      });
    } catch (error) { 
      console.error(error);
      toast({
        title: "エラー",
        description: "キューへの追加に失敗しました。",
        variant: "destructive",
      });
    }
  };

  const handleAddTrackToQueue = async (track: Track) => {
    try {
      await onAddTrackToQueue(track);
      toast({
        title: "追加しました",
        description: `"${track.title}" をキューに追加しました。`,
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "エラー",
        description: "キューへの追加に失敗しました。",
        variant: "destructive",
      });
    }
  };

  const toggleExpand = (browseId: string) => {
    setExpandedItems(prev => 
      prev.includes(browseId) ? prev.filter(id => id !== browseId) : [...prev, browseId]
    );
  };

  const fetchPlaylistTracks = async (item: SearchItem) => {
    if (playlistTracks[item.browseId!]) return;
    
    try {
      let tracks: Track[] = [];
      if (item.type === 'playlist') {
        tracks = await api.getPlaylistItems(item.browseId!);
      } else if (['album', 'single', 'ep'].includes(item.type)) {
        tracks = await api.getAlbumItems(item.browseId!);
      }
      setPlaylistTracks(prev => ({...prev, [item.browseId!]: tracks}));
    } catch (error) {
      console.error(error);
      toast({
        title: "エラー",
        description: "トラックの取得に失敗しました。",
        variant: "destructive",
      });
    }
  };

  const getItemIcon = (type: string) => {
    switch(type) {
      case 'song': return <Music className="w-4 h-4" />;
      case 'video': return <PlaySquare className="w-4 h-4" />;
      case 'album': return <Disc className="w-4 h-4" />;
      case 'playlist': return <ListMusic className="w-4 h-4" />;
      default: return <Music className="w-4 h-4" />;
    }
  };

  return (
    <TooltipProvider>
      <motion.div
        className="fixed inset-0 bg-background/95 backdrop-blur-sm z-50 overflow-hidden flex flex-col"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="bg-background/80 backdrop-blur-md py-4 px-6 shadow-md z-10">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold">検索結果</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="検索結果を閉じる" className="hover:bg-primary/10 transition-colors duration-200">
                  <X size={24} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>閉じる</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <form onSubmit={handleSearch}>
            <div className="flex items-center bg-input rounded-full overflow-hidden shadow-lg transition-all duration-300 hover:shadow-xl focus-within:ring-2 focus-within:ring-primary/50">
              <Input
                type="text"
                placeholder="曲名、アーティスト名を入力..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-grow border-none focus:ring-0 rounded-l-full"
              />
              <Button type="submit" disabled={isLoading} className="rounded-r-full bg-primary hover:bg-primary/90 transition-colors duration-200">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search size={20} />}
              </Button>
            </div>
          </form>
        </div>
        <ScrollArea className="flex-grow overflow-y-auto px-6 pb-6">
          <AnimatePresence>
            <motion.div 
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-6"
              initial="hidden"
              animate="visible"
              exit="hidden"
              variants={{
                visible: { transition: { staggerChildren: 0.07 } },
              }}
            >
              {filteredResults.map((item) => (
                <motion.div
                  key={item.url}
                  variants={{
                    hidden: { y: 20, opacity: 0 },
                    visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 300, damping: 24 } },
                  }}
                  className="bg-card rounded-xl overflow-hidden shadow-lg transition-all duration-300 hover:shadow-2xl hover:-translate-y-1"
                >
                  <div className="relative w-full h-48 group">
                    <Image 
                      src={item.thumbnail} 
                      alt={item.title} 
                      fill
                      objectFit="cover"
                      className="transition-transform duration-300 group-hover:scale-110"
                      unoptimized
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <Badge 
                      variant="secondary" 
                      className="absolute top-2 right-2 text-xs font-semibold px-2 py-1 flex items-center gap-1 bg-black/50 text-white"
                    >
                      {getItemIcon(item.type)}
                      {item.type.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-lg mb-1 line-clamp-1">{item.title}</h3>
                    <p className="text-muted-foreground mb-4 line-clamp-1">{item.artist}</p>
                    {item.type === 'song' || item.type === 'video' ? (
                      <Button
                        onClick={() => handleAddToQueue(item)}
                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground transition-all duration-300 group"
                      >
                        <span className="mr-2">キューに追加</span>
                        <Plus size={16} className="opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={() => handleAddToQueue(item)}
                          className="w-full mb-2 bg-secondary hover:bg-secondary/90 text-secondary-foreground transition-all duration-300 group"
                        >
                          <span className="mr-2">全曲を追加</span>
                          <Plus size={16} className="opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        </Button>
                        <Accordion type="single" collapsible className="w-full">
                          <AccordionItem value={item.browseId!}>
                            <AccordionTrigger 
                              onClick={() => {
                                toggleExpand(item.browseId!);
                                fetchPlaylistTracks(item);
                              }}
                              className="hover:no-underline"
                            >
                              トラックを表示
                            </AccordionTrigger>
                            <AccordionContent>
                              {playlistTracks[item.browseId!] ? (
                                <ScrollArea className="h-64 w-full pr-4">
                                  <div className="space-y-2 mt-2">
                                    {playlistTracks[item.browseId!].map((track, index) => (
                                      <motion.div 
                                        key={index} 
                                        className="flex items-center p-2 rounded-lg hover:bg-muted transition-colors duration-200"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: index * 0.05 }}
                                      >
                                        <div className="flex-grow mr-2">
                                          <p className="text-sm font-semibold line-clamp-1">{track.title}</p>
                                          <p className="text-xs text-muted-foreground line-clamp-1">{track.artist}</p>
                                        </div>
                                        <Button size="sm" variant="ghost" onClick={() => handleAddTrackToQueue(track)} className="hover:bg-primary/10 transition-colors duration-200">
                                          <Plus size={16} />
                                        </Button>
                                      </motion.div>
                                    ))}
                                  </div>
                                  <ScrollBar />
                                </ScrollArea>
                              ) : (
                                <div className="flex justify-center items-center p-4">
                                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                </div>
                              )}
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </>
                    )}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </AnimatePresence>
          {isLoading && (
            <div className="flex justify-center items-center mt-8">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
          )}
          <div ref={ref} style={{ height: '20px' }} />
        </ScrollArea>
      </motion.div>
    </TooltipProvider>
  );
};