// HomeScreen.tsx
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { PlayableItem, SearchItem, api, Section, QueueItem } from '@/utils/api';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import Image from 'next/image';
import { 
  Play, 
  User, 
  History, 
  Sparkles,  
  Home, 
  MessageSquare, 
  Brain,
  Target,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatScreen } from './ChatScreen';
import { AIRecommendScreen } from './AIRecommendScreen';
import { VALORANTScreen } from './VALORANTScreen';
import ArtistDialog from '@/components/ArtistDialog';

interface HomeScreenProps {
  onSelectTrack: (item: PlayableItem) => void;
  guildId: string | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
  isOnDeviceMode: boolean;
  history: QueueItem[];
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onSelectTrack, guildId, activeTab, onTabChange }) => {
  const [sections, setSections] = useState<Section[]>([]);
  const [history, setHistory] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const [isArtistDialogOpen, setIsArtistDialogOpen] = useState(false);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);

  const handleSelectTrack = async (item: PlayableItem) => {
    await onSelectTrack(item);
  };

  const handleArtistClick = (artistId: string) => {
    setSelectedArtistId(artistId);
    setIsArtistDialogOpen(true);
  };

  const closeArtistDialog = () => {
    setIsArtistDialogOpen(false);
    setSelectedArtistId(null);
  };

  const tabs = [
    { 
      id: 'home', 
      label: { full: 'ホーム', short: 'ホーム' }, 
      icon: <Home className="w-5 h-5" />,
      gradient: 'from-blue-500 to-purple-500'
    },
    { 
      id: 'chat', 
      label: { full: 'チャット', short: 'チャット' }, 
      icon: <MessageSquare className="w-5 h-5" />,
      gradient: 'from-green-500 to-teal-500'
    },
    { 
      id: 'ai-recommend', 
      label: { full: 'AIリコメンド', short: 'AI' }, 
      icon: <Brain className="w-5 h-5" />,
      gradient: 'from-purple-500 to-pink-500'
    },
    { 
      id: 'valorant', 
      label: { full: 'VALORANT', short: 'VALO' }, 
      icon: <Target className="w-5 h-5" />,
      gradient: 'from-red-500 to-orange-500'
    }
  ];

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const homeSections = await api.getRecommendations();
        setSections(homeSections);
      } catch (error) {
        console.error('データの取得に失敗しました:', error);
        toast({
          title: 'エラー',
          description: 'データの取得に失敗しました。',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [toast]);

  useEffect(() => {
    const fetchHistory = async () => {
      if (guildId) {
        try {
          const historyData = await api.getHistory(guildId);
          setHistory(historyData);
        } catch (error) {
          console.error('履歴の取得に失敗しました:', error);
          toast({
            title: 'エラー',
            description: '履歴の取得に失敗しました。',
            variant: 'destructive',
          });
        }
      } else {
        setHistory([]);
      }
    };
    fetchHistory();
  }, [guildId, toast]);

  const renderItem = useCallback((item: SearchItem, index: number) => (
    <TooltipProvider key={`item-${index}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="overflow-hidden cursor-pointer h-full bg-card hover:bg-card/80 transition-colors duration-200">
            <CardContent className="p-0 h-full flex flex-col">
              <motion.div
                className="relative w-full pt-[100%] group"
                whileHover={{ scale: 1.05 }}
                transition={{ duration: 0.2 }}
              >
                <Image 
                  src={item.thumbnail} 
                  alt={item.title} 
                  fill
                  style={{ objectFit: 'cover' }}
                  className="rounded-t-lg"
                  unoptimized
                />
                <motion.div
                  className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center"
                  initial={{ opacity: 0 }}
                  whileHover={{ opacity: 1 }}
                >
                  <Play className="text-white w-12 h-12" onClick={() => onSelectTrack(item)} />
                </motion.div>
              </motion.div>
              <div className="p-3 flex-grow flex flex-col justify-between bg-card/50 backdrop-blur-sm">
                <h3 className="font-bold text-sm mb-1 line-clamp-2">{item.title}</h3>
                <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                  {item.artistId ? (
                    <motion.button
                      onClick={() => handleArtistClick(item.artistId!)}
                      className="text-primary hover:text-primary/80 flex items-center gap-1 rounded px-1.5 py-0.5 bg-primary/10 hover:bg-primary/20 transition-colors duration-200"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      {item.artist}
                      <ExternalLink className="w-3 h-3" />
                    </motion.button>
                  ) : (
                    <span>{item.artist}</span>
                  )}
                </p>
              </div>
            </CardContent>
          </Card>
        </TooltipTrigger>
        <TooltipContent>
          <p>{item.title}</p>
          <p className="text-xs text-muted-foreground">{item.artist}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ), [onSelectTrack, handleArtistClick]);

  const renderHistoryItem = useCallback((item: QueueItem, index: number) => (
    <TooltipProvider key={`history-${index}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="overflow-hidden cursor-pointer h-full bg-card hover:bg-card/80 transition-colors duration-200">
            <CardContent className="p-0 h-full flex flex-col">
              <motion.div
                className="relative w-full pt-[100%] group"
                whileHover={{ scale: 1.05 }}
                transition={{ duration: 0.2 }}
              >
                <Image 
                  src={item.track.thumbnail} 
                  alt={item.track.title} 
                  fill
                  style={{ objectFit: 'cover' }}
                  className="rounded-t-lg"
                  unoptimized
                />
                <motion.div
                  className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center"
                  initial={{ opacity: 0 }}
                  whileHover={{ opacity: 1 }}
                >
                  <Play className="text-white w-12 h-12" onClick={() => onSelectTrack(item.track)} />
                </motion.div>
                {item.track.added_by && item.track.added_by.image && (
                  <div className="absolute top-2 right-2 w-8 h-8">
                    <Image
                      src={item.track.added_by.image}
                      alt={item.track.added_by.name || 'User'}
                      width={32}
                      height={32}
                      className="rounded-full border-2 border-white"
                      unoptimized
                    />
                  </div>
                )}
              </motion.div>
              <div className="p-3 flex-grow flex flex-col justify-between bg-card/50 backdrop-blur-sm">
                <h3 className="font-bold text-sm mb-1 line-clamp-2">{item.track.title}</h3>
                <p className="text-xs text-muted-foreground truncate">{item.track.artist}</p>
              </div>
            </CardContent>
          </Card>
        </TooltipTrigger>
        <TooltipContent>
          <p>{item.track.title}</p>
          <p className="text-xs text-muted-foreground">{item.track.artist}</p>
          {item.track.added_by && (
            <p className="text-xs text-muted-foreground mt-1">
              <User className="inline-block w-3 h-3 mr-1" />
              {item.track.added_by.name}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ), [onSelectTrack]);

  const renderSections = useCallback(() => (
    <ScrollArea className="h-full">
      <div className="p-4">
        {history.length > 0 && guildId && (
          <div key="section-history" className="mb-8 w-full">
            <div className="flex items-center mb-4">
              <div className="mr-2 p-2 bg-primary/10 rounded-full">
                <History className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-2xl font-bold">再生履歴</h2>
            </div>
            <ScrollArea className="w-full whitespace-nowrap rounded-md border">
              <div className="flex space-x-4 p-4">
                {history.slice().reverse().map((item, idx) => (
                  <div key={idx} className="w-[200px] h-[280px]">
                    {renderHistoryItem(item, idx)}
                  </div>
                ))}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
        )}
        {sections.map((section, index) => (
          <div key={`section-${index}`} className="mb-8 w-full">
            <div className="flex items-center mb-4">
              <div className="mr-2 p-2 bg-primary/10 rounded-full">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-2xl font-bold">{section.title}</h2>
            </div>
            <ScrollArea className="w-full whitespace-nowrap rounded-md border">
              <div className="flex space-x-4 p-4">
                {section.contents.map((item, idx) => (
                  <div key={idx} className="w-[200px] h-[280px]">
                    {renderItem(item, idx)}
                  </div>
                ))}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
        ))}
      </div>
    </ScrollArea>
  ), [sections, renderItem, history, guildId, renderHistoryItem]);

  const tabVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-25 flex justify-center py-4 sticky top-0">
        <nav className="flex space-x-1 p-1 rounded-full bg-muted">
          {tabs.map((tab) => (
            <motion.button
              key={tab.id}
              className={`flex items-center px-3 sm:px-4 py-2 text-sm font-medium rounded-full transition-all duration-300 ${
                activeTab === tab.id
                  ? `bg-gradient-to-r ${tab.gradient} text-white`
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10'
              }`}
              onClick={() => onTabChange(tab.id)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {tab.icon}
              <span className="ml-2 hidden sm:inline">{tab.label.full}</span>
              <span className="ml-2 sm:hidden">{tab.label.short}</span>
            </motion.button>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {loading && activeTab === 'home' ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full overflow-auto p-4"
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="w-full aspect-square rounded-lg" />
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={activeTab}
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={tabVariants}
              transition={{ duration: 0.3 }}
              className="h-full overflow-auto"
            >
              {activeTab === 'home' && renderSections()}
              {activeTab === 'chat' && (
                <div className="h-full">
                  <ChatScreen />
                </div>
              )}
              {activeTab === 'ai-recommend' && (
                <div className="h-full">
                  <AIRecommendScreen onSelectTrack={onSelectTrack} />
                </div>
              )}
              {activeTab === 'valorant' && (
                <div className="h-full">
                  <VALORANTScreen />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      {/* ArtistDialogをレンダリング */}
      {isArtistDialogOpen && selectedArtistId && (
        <ArtistDialog
          artistId={selectedArtistId}
          isOpen={isArtistDialogOpen}
          onClose={closeArtistDialog}
          onAddTrackToQueue={handleSelectTrack}
          onAddItemToQueue={handleSelectTrack} 
        />
      )}
    </div>
  </div>
  );
};

HomeScreen.displayName = 'HomeScreen';

export default HomeScreen;
