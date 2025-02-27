import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Play, Plus, ChevronLeft } from 'lucide-react';
import { SearchItem, PlayableItem } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';

interface SearchResultsProps {
  results: SearchItem[];
  onAddToQueue: (item: PlayableItem) => Promise<void>;
  onClose: () => void;
  onSearch: (query: string) => Promise<void>;
  isOnDeviceMode: boolean;
}

export const SearchResults: React.FC<SearchResultsProps> = ({
  results,
  onAddToQueue,
  onClose,
  onSearch,
  isOnDeviceMode
}) => {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [tab, setTab] = useState('all');
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  // フィルター関数
  const filterResults = (items: SearchItem[], filter: string) => {
    if (filter === 'all') return items;
    return items.filter(item => item.type === filter);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!query.trim()) {
      toast({
        title: "検索キーワードが必要です",
        description: "検索するには何か入力してください。",
        variant: "destructive",
      });
      return;
    }
    
    setIsSearching(true);
    try {
      await onSearch(query);
    } catch (error) {
      console.error('検索エラー:', error);
      toast({
        title: "検索エラー",
        description: "検索中にエラーが発生しました。",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };
  
  const handleItemClick = async (item: SearchItem) => {
    try {
      await onAddToQueue(item);
      toast({
        title: "追加しました",
        description: `${item.title} をキューに追加しました。`,
      });
    } catch (error) {
      console.error('追加エラー:', error);
      toast({
        title: "エラー",
        description: "キューへの追加に失敗しました。",
        variant: "destructive",
      });
    }
  };

  // タブに分類されたアイテム
  const songs = filterResults(results, 'song');
  const videos = filterResults(results, 'video');
  const albums = filterResults(results, 'album');
  const playlists = filterResults(results, 'playlist');
  const artists = filterResults(results, 'artist');
  
  // 読み込み中のスケルトン表示
  const renderSkeletons = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      {Array(6).fill(0).map((_, i) => (
        <div key={i} className="bg-card rounded-lg overflow-hidden flex">
          <Skeleton className="w-20 h-20 rounded-l-lg" />
          <div className="p-4 flex-grow">
            <Skeleton className="h-4 w-3/4 mb-2" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <motion.div
      className="fixed inset-0 bg-background z-30 pt-16 pb-16 overflow-hidden flex flex-col"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      transition={{ duration: 0.2 }}
    >
      <div className="py-4 px-4 bg-card/80 backdrop-blur-md border-b sticky top-16 z-20">
        <div className="flex items-center gap-2 mb-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose}
            aria-label="検索結果を閉じる"
          >
            <ChevronLeft size={24} />
          </Button>
          <h2 className="text-xl font-bold">検索結果</h2>
        </div>
        
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-grow">
            <Input
              ref={inputRef}
              type="text"
              placeholder="曲名、アーティスト、アルバムを検索..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              className="pr-10"
            />
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full"
                onClick={() => setQuery('')}
                aria-label="検索をクリア"
              >
                <X size={18} />
              </Button>
            )}
          </div>
          <Button 
            type="submit" 
            disabled={isSearching}
            aria-label="検索"
          >
            <Search size={18} className="mr-2" />
            検索
          </Button>
        </form>
      </div>
      
      <Tabs value={tab} onValueChange={setTab} className="flex-grow flex flex-col overflow-hidden">
        <TabsList className="justify-start px-4 py-2 bg-background/95 backdrop-blur-sm border-b overflow-x-auto no-scrollbar">
          <TabsTrigger value="all">すべて ({results.length})</TabsTrigger>
          <TabsTrigger value="songs">曲 ({songs.length})</TabsTrigger>
          <TabsTrigger value="videos">動画 ({videos.length})</TabsTrigger>
          <TabsTrigger value="albums">アルバム ({albums.length})</TabsTrigger>
          <TabsTrigger value="playlists">プレイリスト ({playlists.length})</TabsTrigger>
          <TabsTrigger value="artists">アーティスト ({artists.length})</TabsTrigger>
        </TabsList>
        
        <ScrollArea className="flex-grow">
          <AnimatePresence mode="wait">
            {isSearching ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {renderSkeletons()}
              </motion.div>
            ) : (
              <>
                <TabsContent value="all" className="m-0 p-4">
                  <ResultsList items={results} onItemClick={handleItemClick} isOnDeviceMode={isOnDeviceMode} />
                </TabsContent>
                <TabsContent value="songs" className="m-0 p-4">
                  <ResultsList items={songs} onItemClick={handleItemClick} isOnDeviceMode={isOnDeviceMode} />
                </TabsContent>
                <TabsContent value="videos" className="m-0 p-4">
                  <ResultsList items={videos} onItemClick={handleItemClick} isOnDeviceMode={isOnDeviceMode} />
                </TabsContent>
                <TabsContent value="albums" className="m-0 p-4">
                  <ResultsList items={albums} onItemClick={handleItemClick} isOnDeviceMode={isOnDeviceMode} />
                </TabsContent>
                <TabsContent value="playlists" className="m-0 p-4">
                  <ResultsList items={playlists} onItemClick={handleItemClick} isOnDeviceMode={isOnDeviceMode} />
                </TabsContent>
                <TabsContent value="artists" className="m-0 p-4">
                  <ResultsList items={artists} onItemClick={handleItemClick} isOnDeviceMode={isOnDeviceMode} />
                </TabsContent>
              </>
            )}
          </AnimatePresence>
        </ScrollArea>
      </Tabs>
    </motion.div>
  );
};

interface ResultsListProps {
  items: SearchItem[];
  onItemClick: (item: SearchItem) => Promise<void>;
  isOnDeviceMode: boolean;
}

const ResultsList: React.FC<ResultsListProps> = ({ items, onItemClick, isOnDeviceMode }) => {
  if (items.length === 0) {
    return (
      <div className="text-center p-8 text-muted-foreground">
        検索結果がありません。
      </div>
    );
  }

  return (
    <motion.div 
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      initial="hidden"
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: 0.05 } },
      }}
    >
      {items.map((item, index) => (
        <motion.div
          key={`${item.url}-${index}`}
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0 },
          }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="bg-card rounded-lg overflow-hidden flex"
        >
          {/* アイテムサムネイル */}
          <div className="relative w-20 h-20 flex-shrink-0">
            <Image
              src={item.thumbnail || '/default-thumbnail.webp'}
              alt={item.title}
              fill
              objectFit="cover"
              unoptimized
            />
          </div>
          
          {/* アイテム情報 */}
          <div className="p-3 flex-grow flex flex-col justify-between">
            <div>
              <h3 className="font-medium text-sm line-clamp-1">{item.title}</h3>
              <p className="text-xs text-muted-foreground line-clamp-1">{item.artist}</p>
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground mt-1 inline-block">
                {item.type === 'song' ? '曲' : 
                 item.type === 'video' ? '動画' : 
                 item.type === 'album' ? 'アルバム' : 
                 item.type === 'playlist' ? 'プレイリスト' : 
                 'アーティスト'}
              </span>
            </div>
            
            {/* アクション */}
            <div className="flex justify-end mt-1">
              {item.type === 'song' || item.type === 'video' ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      onItemClick(item);
                    }}
                    aria-label={`${item.title}をキューに追加`}
                  >
                    <Plus size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      onItemClick(item);
                    }}
                    aria-label={`${item.title}を再生`}
                  >
                    <Play size={16} />
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onItemClick(item);
                  }}
                  disabled={isOnDeviceMode && (item.type === 'album' || item.type === 'playlist' || item.type === 'artist')}
                  className={isOnDeviceMode && (item.type === 'album' || item.type === 'playlist' || item.type === 'artist') ? 'opacity-50 cursor-not-allowed' : ''}
                  aria-label={`${item.title}をキューに追加`}
                >
                  {isOnDeviceMode && (item.type === 'album' || item.type === 'playlist' || item.type === 'artist') ? (
                    'デバイスモードでは利用不可'
                  ) : (
                    <>
                      <Plus size={16} className="mr-1" />
                      追加
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
};