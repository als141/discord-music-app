// SearchResults.tsx
'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayableItem, SearchItem, Track } from '@/utils/api';
import { X, Search, Music, Disc, PlaySquare, ListMusic, Plus, Loader2, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import Image from 'next/image';
import { api } from '@/utils/api';
import ArtistDialog from '@/components/ArtistDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SearchResultsProps {
  results: SearchItem[];
  onAddToQueue: (item: PlayableItem) => Promise<void>;
  onAddTrackToQueue: (track: Track) => Promise<void>;
  onClose: () => void;
  onSearch: (query: string) => Promise<void>;
  isOnDeviceMode: boolean; // 追加
}

export const SearchResults: React.FC<SearchResultsProps> = ({ results, onAddToQueue, onAddTrackToQueue, onClose, onSearch }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [playlistTracks, setPlaylistTracks] = useState<{[key: string]: Track[]}>({});
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);
  const [isArtistDialogOpen, setIsArtistDialogOpen] = useState(false);
  const [showMore, setShowMore] = useState<{ [key: string]: boolean }>({
    artists: false,
    songs: false,
    videos: false,
    albums: false,
    playlists: false
  });

  const categoryLabels: { [key: string]: string } = {
    all: 'すべて',
    songs: '曲',
    videos: '動画',
    albums: 'アルバム',
    artists: 'アーティスト',
    playlists: 'プレイリスト'
  };

  const categorizedResults = {
    artists: results.filter(item => item.type === 'artist'),
    songs: results.filter(item => item.type === 'song'),
    videos: results.filter(item => item.type === 'video'),
    albums: results.filter(item => ['album', 'single', 'ep'].includes(item.type)),
    playlists: results.filter(item => item.type === 'playlist')
  };

  const getVisibleItems = (category: string, items: SearchItem[]) => {
    if (showMore[category]) {
      return items;
    }
    if (category === 'artists') {
      return items.slice(0, 1);
    }
    return items.slice(0, 5);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setIsLoading(true);
      await onSearch(searchQuery);
      setIsLoading(false);
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
          {/* 既存のヘッダー部分 */}
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold">検索結果</h2>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X size={24} />
            </Button>
          </div>
          {/* 検索フォーム */}
          <form onSubmit={handleSearch} className="mb-4">
            <div className="flex items-center bg-input rounded-full overflow-hidden shadow-lg">
              <Input
                type="text"
                placeholder="曲名、アーティスト名を入力..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-grow border-none"
              />
              <Button type="submit" disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search size={20} />}
              </Button>
            </div>
          </form>
        </div>

        <ScrollArea className="flex-grow">
          <div className="p-6">
            <Tabs defaultValue="all" className="w-full">
              <div className="relative">
                <ScrollArea className="w-full whitespace-nowrap pb-2 mb-2">
                  <TabsList className="inline-flex h-9 items-center justify-start rounded-lg p-1 text-muted-foreground">
                    <TabsTrigger 
                      value="all"
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow"
                    >
                      {categoryLabels.all}
                    </TabsTrigger>
                    {Object.entries(categorizedResults).map(([category, items]) => (
                      items.length > 0 && (
                        <TabsTrigger 
                          key={category}
                          value={category}
                          className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow"
                        >
                          {categoryLabels[category]} ({items.length})
                        </TabsTrigger>
                      )
                    ))}
                  </TabsList>
                  <ScrollBar orientation="horizontal" className="invisible" />
                </ScrollArea>
              </div>

              <TabsContent value="all">
                {Object.entries(categorizedResults).map(([category, items]) => {
                  if (items.length === 0) return null;
                  
                  return (
                    <div key={category} className="mb-8">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-semibold">{categoryLabels[category]}</h3>
                        {items.length > (category === 'artists' ? 1 : 5) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowMore(prev => ({
                              ...prev,
                              [category]: !prev[category]
                            }))}
                            className="text-sm"
                          >
                            {showMore[category] ? "折りたたむ" : `もっと見る (${items.length})`}
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        {getVisibleItems(category, items).map((item, index) => (
                          <SearchResultCard
                            key={`${item.url}-${index}`}
                            item={item}
                            onAddToQueue={onAddToQueue}
                            onAddTrackToQueue={onAddTrackToQueue}
                            playlistTracks={playlistTracks}
                            setPlaylistTracks={setPlaylistTracks}
                            setSelectedArtistId={setSelectedArtistId}
                            setIsArtistDialogOpen={setIsArtistDialogOpen}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </TabsContent>

              {Object.entries(categorizedResults).map(([category, items]) => (
                items.length > 0 && (
                  <TabsContent key={category} value={category}>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {items.map((item, index) => (
                        <SearchResultCard
                          key={`${item.url}-${index}`}
                          item={item}
                          onAddToQueue={onAddToQueue}
                          onAddTrackToQueue={onAddTrackToQueue}
                          playlistTracks={playlistTracks}
                          setPlaylistTracks={setPlaylistTracks}
                          setSelectedArtistId={setSelectedArtistId}
                          setIsArtistDialogOpen={setIsArtistDialogOpen}
                        />
                      ))}
                    </div>
                  </TabsContent>
                )
              ))}
            </Tabs>
          </div>
        </ScrollArea>

        {selectedArtistId && (
          <ArtistDialog
            artistId={selectedArtistId}
            isOpen={isArtistDialogOpen}
            onClose={() => setIsArtistDialogOpen(false)}
            onAddTrackToQueue={onAddTrackToQueue}
            onAddItemToQueue={onAddToQueue}
          />
        )}
      </motion.div>
    </TooltipProvider>
  );
};

// SearchResultCard コンポーネントを分離して可読性を向上
interface SearchResultCardProps {
  item: SearchItem;
  onAddToQueue: (item: PlayableItem) => Promise<void>;
  onAddTrackToQueue: (track: Track) => Promise<void>;
  playlistTracks: {[key: string]: Track[]};
  setPlaylistTracks: React.Dispatch<React.SetStateAction<{[key: string]: Track[]}>>;
  setSelectedArtistId: (id: string) => void;
  setIsArtistDialogOpen: (open: boolean) => void;
}

const SearchResultCard: React.FC<SearchResultCardProps> = ({
  item,
  onAddToQueue,
  onAddTrackToQueue,
  playlistTracks,
  setPlaylistTracks,
  setSelectedArtistId,
  setIsArtistDialogOpen
}) => {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);
  
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
      case 'artist': return <User className="w-4 h-4" />;
      default: return <Music className="w-4 h-4" />;
    }
  };

  return (
    <motion.div
      className="bg-card rounded-lg shadow hover:shadow-md transition-all duration-300"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex p-2 items-center">
        <div className="relative w-12 h-12 flex-shrink-0">
          <Image 
            src={item.thumbnail} 
            alt={item.title} 
            fill
            style={{ objectFit: 'cover' }}
            className="rounded-md"
            unoptimized
          />
          <Badge 
            variant="secondary" 
            className="absolute -top-1 -right-1 text-[10px] font-semibold px-1 py-0.5 flex items-center gap-0.5 bg-black/50 text-white"
          >
            {getItemIcon(item.type)}
            <span className="hidden sm:inline">{item.type.toUpperCase()}</span>
          </Badge>
        </div>

        <div className="flex-grow px-3 min-w-0">
          <h3 className="font-bold text-base line-clamp-1">{item.title}</h3>
          <p className="text-sm text-muted-foreground line-clamp-1">{item.artist}</p>
        </div>

        <div className="flex-shrink-0 ml-2">
          {item.type === 'artist' ? (
            <Button
              size="sm"
              onClick={() => {
                setSelectedArtistId(item.browseId!);
                setIsArtistDialogOpen(true);
              }}
              variant="ghost"
              className="h-8"
            >
              詳細を見る
            </Button>
          ) : item.type === 'song' || item.type === 'video' ? (
            <Button
              size="sm"
              onClick={() => onAddToQueue(item)}
              variant="ghost"
              className="h-8"
            >
              <Plus className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">追加</span>
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  if (!playlistTracks[item.browseId!]) {
                    await fetchPlaylistTracks(item);
                  }
                  if (playlistTracks[item.browseId!]) {
                    for (const track of playlistTracks[item.browseId!]) {
                      await onAddTrackToQueue(track);
                    }
                  }
                }}
                variant="ghost"
                className="h-8"
              >
                <Plus className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">全曲追加</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsExpanded(!isExpanded);
                  if (!playlistTracks[item.browseId!]) {
                    fetchPlaylistTracks(item);
                  }
                }}
                className="h-8"
              >
                トラック表示
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* アルバム/プレイリストのトラックリスト */}
      {(item.type === 'album' || item.type === 'playlist' || ['album', 'single', 'ep'].includes(item.type)) && (
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-border"
            >
              <div className="p-2">
                {playlistTracks[item.browseId!] ? (
                  <ScrollArea className="h-64">
                    {playlistTracks[item.browseId!].map((track, index) => (
                      <div 
                        key={index}
                        className="flex items-center p-2 hover:bg-muted rounded-lg"
                      >
                        <div className="flex-grow min-w-0">
                          <p className="font-semibold text-sm line-clamp-1">{track.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1">{track.artist}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onAddTrackToQueue(track)}
                          className="h-8"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </ScrollArea>
                ) : (
                  <div className="flex justify-center items-center p-4">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </motion.div>
  );
};