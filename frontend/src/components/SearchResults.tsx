// SearchResults.tsx
'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayableItem, SearchItem, Track } from '@/utils/api';
import { X, Search, Music, Disc, PlaySquare, ListMusic, Plus, Loader2, User, Music2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent
} from "@/components/ui/tooltip";
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
  isOnDeviceMode: boolean;
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
    <TooltipProvider delayDuration={300} skipDelayDuration={100}>
      <motion.div
        className="fixed inset-0 bg-background z-50 overflow-hidden flex flex-col"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      >
        {/* Header - Apple Music style frosted glass */}
        <div className="glass border-b border-border/50 py-4 px-4 sm:px-6 z-10">
          <div className="max-w-screen-xl mx-auto">
            {/* Title and close */}
            <div className="flex justify-between items-center mb-4 pl-12 sm:pl-0">
              <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">検索結果</h2>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    className="h-9 w-9 rounded-full hover:bg-black/5"
                  >
                    <X className="h-5 w-5 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="bg-white/95 backdrop-blur-xl border-black/10">
                  <p>閉じる</p>
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Search form - Apple Music style */}
            <form onSubmit={handleSearch}>
              <div className="relative max-w-xl mx-auto">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="曲名、アーティスト名を入力..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 pl-10 pr-20 bg-secondary/80 border-0 rounded-full text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20"
                />
                <Button
                  type="submit"
                  disabled={isLoading}
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 px-4 bg-primary hover:bg-primary/90 text-white rounded-full text-xs font-medium"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '検索'}
                </Button>
              </div>
            </form>
          </div>
        </div>

        {/* Results area - 通常のネイティブスクロール */}
        <div className="flex-grow overflow-y-auto overflow-x-hidden">
          <div className="p-4 sm:p-6 w-full">
            {results.length === 0 ? (
              <motion.div
                className="flex flex-col items-center justify-center py-20"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="w-20 h-20 rounded-full bg-secondary/50 flex items-center justify-center mb-4">
                  <Music2 className="w-10 h-10 text-muted-foreground/50" />
                </div>
                <p className="text-muted-foreground text-center">
                  検索結果がありません
                </p>
                <p className="text-muted-foreground/60 text-sm text-center mt-1">
                  キーワードを入力して検索してください
                </p>
              </motion.div>
            ) : (
              <Tabs defaultValue="all" className="w-full">
                {/* Tab navigation - Apple Music pill style */}
                <div className="relative mb-6 -mx-4 sm:-mx-6 px-4 sm:px-6">
                  <div className="overflow-x-auto scrollbar-thin pb-2 -mx-4 px-4">
                    <TabsList className="inline-flex p-1 rounded-full bg-secondary/60 whitespace-nowrap">
                      <TabsTrigger
                        value="all"
                        className="rounded-full px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground transition-all flex-shrink-0"
                      >
                        {categoryLabels.all}
                      </TabsTrigger>
                      {Object.entries(categorizedResults).map(([category, items]) => (
                        items.length > 0 && (
                          <TabsTrigger
                            key={category}
                            value={category}
                            className="rounded-full px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground transition-all flex-shrink-0"
                          >
                            {categoryLabels[category]}
                            <span className="ml-1 sm:ml-1.5 text-[10px] sm:text-xs opacity-60">({items.length})</span>
                          </TabsTrigger>
                        )
                      ))}
                    </TabsList>
                  </div>
                </div>

                {/* All results tab */}
                <TabsContent value="all" className="space-y-8">
                  {Object.entries(categorizedResults).map(([category, items]) => {
                    if (items.length === 0) return null;

                    return (
                      <section key={category}>
                        <div className="flex justify-between items-center mb-4">
                          <h3 className="text-lg sm:text-xl font-bold text-foreground">
                            {categoryLabels[category]}
                          </h3>
                          {items.length > (category === 'artists' ? 1 : 5) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowMore(prev => ({
                                ...prev,
                                [category]: !prev[category]
                              }))}
                              className="text-primary hover:text-primary/80 hover:bg-primary/5 rounded-full text-sm"
                            >
                              {showMore[category] ? "折りたたむ" : "もっと見る"}
                            </Button>
                          )}
                        </div>
                        <div className="space-y-2 w-full overflow-hidden">
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
                      </section>
                    );
                  })}
                </TabsContent>

                {/* Category-specific tabs */}
                {Object.entries(categorizedResults).map(([category, items]) => (
                  items.length > 0 && (
                    <TabsContent key={category} value={category}>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
            )}
          </div>
        </div>

        {/* Artist Dialog */}
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

// Search result card component - Apple Music style
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
      case 'song': return <Music className="w-3.5 h-3.5" />;
      case 'video': return <PlaySquare className="w-3.5 h-3.5" />;
      case 'album': return <Disc className="w-3.5 h-3.5" />;
      case 'single': return <Disc className="w-3.5 h-3.5" />;
      case 'ep': return <Disc className="w-3.5 h-3.5" />;
      case 'playlist': return <ListMusic className="w-3.5 h-3.5" />;
      case 'artist': return <User className="w-3.5 h-3.5" />;
      default: return <Music className="w-3.5 h-3.5" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch(type) {
      case 'song': return '曲';
      case 'video': return '動画';
      case 'album': return 'アルバム';
      case 'single': return 'シングル';
      case 'ep': return 'EP';
      case 'playlist': return 'プレイリスト';
      case 'artist': return 'アーティスト';
      default: return type;
    }
  };

  return (
    <motion.div
      className="bg-secondary/40 rounded-xl overflow-hidden transition-all duration-200 hover:bg-secondary/60 w-full"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <div className="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 w-full">
        {/* Thumbnail - fixed size */}
        <div className="relative w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0">
          <Image
            src={item.thumbnail}
            alt={item.title}
            fill
            style={{ objectFit: 'cover' }}
            className={`${item.type === 'artist' ? 'rounded-full' : 'rounded-lg'} shadow-sm`}
            unoptimized
          />
        </div>

        {/* Info - MUST shrink with min-w-0 */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-xs sm:text-sm text-foreground truncate leading-tight">
            {item.title}
          </h3>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="inline-flex items-center gap-0.5 text-[9px] sm:text-[10px] text-muted-foreground bg-secondary/80 px-1 sm:px-1.5 py-0.5 rounded-full flex-shrink-0">
              {getItemIcon(item.type)}
              {getTypeLabel(item.type)}
            </span>
            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{item.artist}</p>
          </div>
        </div>

        {/* Actions - fixed size, never shrink */}
        <div className="flex-shrink-0">
          {item.type === 'artist' ? (
            <Button
              size="sm"
              onClick={() => {
                setSelectedArtistId(item.browseId!);
                setIsArtistDialogOpen(true);
              }}
              className="h-7 sm:h-8 px-3 sm:px-4 bg-primary/10 hover:bg-primary/20 text-primary rounded-full text-xs font-medium"
              variant="ghost"
            >
              詳細
            </Button>
          ) : item.type === 'song' || item.type === 'video' ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={() => onAddToQueue(item)}
                  className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-primary hover:bg-primary/90 text-white"
                >
                  <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="bg-white/95 backdrop-blur-xl border-black/10">
                <p>キューに追加</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
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
                        toast({
                          title: "追加しました",
                          description: "全曲をキューに追加しました。",
                        });
                      }
                    }}
                    className="h-7 sm:h-8 px-2 sm:px-3 bg-primary hover:bg-primary/90 text-white rounded-full text-[10px] sm:text-xs font-medium"
                  >
                    <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-0.5 sm:mr-1" />
                    全曲
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="bg-white/95 backdrop-blur-xl border-black/10">
                  <p>全曲をキューに追加</p>
                </TooltipContent>
              </Tooltip>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsExpanded(!isExpanded);
                  if (!playlistTracks[item.browseId!]) {
                    fetchPlaylistTracks(item);
                  }
                }}
                className="h-7 sm:h-8 px-2 sm:px-3 rounded-full text-[10px] sm:text-xs hover:bg-black/5"
              >
                {isExpanded ? '閉じる' : 'トラック'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Expanded track list */}
      {(item.type === 'album' || item.type === 'playlist' || ['album', 'single', 'ep'].includes(item.type)) && (
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="border-t border-border/50"
            >
              <div className="p-3">
                {playlistTracks[item.browseId!] ? (
                  <div className="h-64 overflow-y-auto">
                    <div className="space-y-1">
                      {playlistTracks[item.browseId!].map((track, index) => (
                        <motion.div
                          key={index}
                          className="flex items-center p-2.5 rounded-lg hover:bg-black/5 transition-colors"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.03 }}
                        >
                          <span className="w-6 text-center text-xs text-muted-foreground mr-2">
                            {index + 1}
                          </span>
                          <div className="flex-grow min-w-0">
                            <p className="font-medium text-sm text-foreground line-clamp-1">{track.title}</p>
                            <p className="text-xs text-muted-foreground line-clamp-1">{track.artist}</p>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onAddTrackToQueue(track)}
                                className="h-8 w-8 rounded-full hover:bg-primary/10 text-muted-foreground hover:text-primary"
                              >
                                <Plus className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent className="bg-white/95 backdrop-blur-xl border-black/10">
                              <p>追加</p>
                            </TooltipContent>
                          </Tooltip>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-center items-center py-8">
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
