'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, setupWebSocket } from '@/utils/api';
import { MainPlayer } from './MainPlayer';
import { QueueList } from './QueueList';
import { Header } from './Header';
import { SideMenu } from './SideMenu';
import { SearchResults } from './SearchResults';
import { Server, Track, VoiceChannel, QueueItem } from '@/utils/api';
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from 'lucide-react';
import { HomeScreen } from './HomeScreen';
import { PlayIcon, PauseIcon} from 'lucide-react';
import { Button } from './ui/button';
import { useSwipeable } from 'react-swipeable';
import { useSession, signIn } from 'next-auth/react'; // 追加

declare global {
  interface BigInt {
    toJSON: () => string;
  }
}

BigInt.prototype.toJSON = function() {
  return this.toString();
};

export const MainApp: React.FC = () => {
  const { data: session, status } = useSession(); 
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [voiceChannels, setVoiceChannels] = useState<VoiceChannel[]>([]);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const { toast } = useToast();
  const [botVoiceChannelId, setBotVoiceChannelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMainPlayerVisible, setIsMainPlayerVisible] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [availableServers, setAvailableServers] = useState<Server[]>([]);
  const [invitableServers, setInvitableServers] = useState<Server[]>([]);

  useEffect(() => {
    const fetchGuilds = async () => {
      if (session) {
        try {
          const [userGuilds, botGuilds] = await Promise.all([
            api.getUserGuilds(),
            api.getBotGuilds(),
          ]);
  
          const availableServers = userGuilds.filter(userGuild => 
            botGuilds.some(botGuild => botGuild.id === userGuild.id)
          );
  
          const invitableServers = userGuilds.filter(userGuild => 
            !botGuilds.some(botGuild => botGuild.id === userGuild.id) && 
            userGuild.permissions !== undefined &&
            (BigInt(userGuild.permissions) & 0x20n) === 0x20n
          );
  
          setAvailableServers(availableServers);
          setInvitableServers(invitableServers);
  
          // savedServerId を取得
          const savedServerId = localStorage.getItem('activeServerId');
          const savedChannelId = localStorage.getItem('activeChannelId');
  
          // savedServerId が availableServers の中にあるか確認
          if (savedServerId && availableServers.some(server => server.id === savedServerId)) {
            setActiveServerId(savedServerId);
            if (savedChannelId) setActiveChannelId(savedChannelId);
          } else if (availableServers.length > 0) {
            // ない場合は、デフォルトで最初のサーバーを選択
            setActiveServerId(availableServers[0].id);
          }
        } catch (error) {
          console.error('Failed to fetch guilds:', error);
        }
      }
    };
  
    fetchGuilds();
  }, [session]);

  // activeServerId の変更時に保存
useEffect(() => {
  if (activeServerId) {
    localStorage.setItem('activeServerId', activeServerId);
  } else {
    localStorage.removeItem('activeServerId');
  }
}, [activeServerId]);

// activeChannelId の変更時に保存
useEffect(() => {
  if (activeChannelId) {
    localStorage.setItem('activeChannelId', activeChannelId);
  } else {
    localStorage.removeItem('activeChannelId');
  }
}, [activeChannelId]);
  
  
  const handleInviteBot = (serverId: string) => {
    const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
    const permissions = '8'; // 必要に応じて調整
    const scopes = 'bot';
    
    const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=${scopes}&permissions=${permissions}&guild_id=${serverId}`;
    
    window.open(inviteUrl, '_blank');
  };

  const handleCloseMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);
  
  const handleRefresh = useCallback(() => {
    window.location.reload();
  }, []);
  
  const swipeHandlers = useSwipeable({
    onSwipedRight: () => setIsMenuOpen(true),
    trackMouse: true,
    delta: 50,
  });
  
  const miniPlayerSwipeHandlers = useSwipeable({
    onSwipedUp: () => setIsMainPlayerVisible(true),
    delta: 50,
    trackMouse: false
  });
  
  const handleAddTrackToQueue = async (track: Track) => {
    if (activeServerId) {
      try {
        await api.addUrl(activeServerId, track.url);
        toast({
          title: "成功",
          description: "曲がキューに追加されました。",
        });
      } catch (error) {
        console.error(error);
        toast({
          title: "エラー",
          description: "曲の追加に失敗しました。",
          variant: "destructive",
        });
      }
    } else {
      toast({
        title: "エラー",
        description: "サーバーが選択されていません。",
        variant: "destructive",
      });
    }
  };
  
  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);
      try {
        // `fetchedServers` と `api.getServers()` を削除
        // `savedServerId` と `savedChannelId` の取得も `fetchGuilds` 内に移動
      } catch (error) {
        console.error("Failed to fetch initial data:", error);
        toast({
          title: "エラー",
          description: "初期データの取得に失敗しました。",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
  
    fetchInitialData();
  }, [toast]);
  
  
  useEffect(() => {
    if (activeServerId) {
      const fetchServerData = async () => {
        setIsLoading(true);
        try {
          const [channels, botStatus, queueResponse, isPlayingResponse] = await Promise.all([
            api.getVoiceChannels(activeServerId),
            api.getBotVoiceStatus(activeServerId),
            api.getQueue(activeServerId),
            api.isPlaying(activeServerId)
          ]);
          
          setVoiceChannels(channels);
          setBotVoiceChannelId(botStatus);
          if (botStatus) setActiveChannelId(botStatus);
          
          const currentTrackItem = queueResponse.find(item => item.isCurrent);
          setCurrentTrack(currentTrackItem?.track || null);
          setQueue(queueResponse.filter(item => !item.isCurrent).map(item => item.track));
          setIsPlaying(isPlayingResponse);
          
          const ws = setupWebSocket(activeServerId, (data) => {
            const queueItems: QueueItem[] = data.queue;
            const currentTrackItem = queueItems.find(item => item.isCurrent);
            setCurrentTrack(currentTrackItem?.track || null);
            setQueue(queueItems.filter(item => !item.isCurrent).map(item => item.track));
            setIsPlaying(data.is_playing);
          });
          
          wsRef.current = ws;
        } catch (error) {
          console.error("Failed to fetch server data:", error);
          toast({
            title: "エラー",
            description: "サーバーデータの取得に失敗しました。",
            variant: "destructive",
          });
        } finally {
          setIsLoading(false);
        }
      };
      
      fetchServerData();
      
      return () => {
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
      };
    }
  }, [activeServerId, toast]);
  
  const handlePlay = async () => {
    if (activeServerId) {
      try {
        await api.resumePlayback(activeServerId);
        setIsPlaying(true);
      } catch (error) {
        console.error(error);
        toast({
          title: "エラー",
          description: "再生の開始に失敗しました。",
          variant: "destructive",
        });
      }
    }
  };
  
  const handlePause = async () => {
    if (activeServerId) {
      try {
        await api.pausePlayback(activeServerId);
        setIsPlaying(false);
      } catch (error) {
        console.error(error);
        toast({
          title: "エラー",
          description: "再生の一時停止に失敗しました。",
          variant: "destructive",
        });
      }
    }
  };
  
  const handleSkip = async () => {
    if (activeServerId) {
      try {
        await api.skipTrack(activeServerId);
      } catch (error) {
        console.error(error);
        toast({
          title: "エラー",
          description: "スキップに失敗しました。",
          variant: "destructive",
        });
      }
    }
  };
  
  const handlePrevious = async () => {
    if (activeServerId) {

      try {
        await api.previousTrack(activeServerId);
      } catch (error) {
        console.error(error);
        toast({
          title: "エラー",
          description: "前の曲への移動に失敗しました。",
          variant: "destructive",
        });
      }
    }
  };

  const handleSearch = async (query: string) => {
    try {
      const results = await api.search(query);
      setSearchResults(results);
      setIsSearchActive(true);
    } catch (error) {
      console.error(error);
      toast({
        title: "エラー",
        description: "検索に失敗しました。",
        variant: "destructive",
      });
    }
  };

  const handleAddUrl = async (url: string) => {
    if (activeServerId) {
      try {
        await api.addUrl(activeServerId, url);
        toast({
          title: "成功",
          description: "URLが追加されました。",
        });
      } catch (error) {
        console.error(error);
        toast({
          title: "エラー",
          description: "URLの追加に失敗しました。",
          variant: "destructive",
        });
      }
    }
  };

  const handleReorderQueue = async (startIndex: number, endIndex: number) => {
    if (activeServerId) {
      try {
        const newQueue = Array.from(queue);
        const [reorderedItem] = newQueue.splice(startIndex, 1);
        newQueue.splice(endIndex, 0, reorderedItem);
        setQueue(newQueue);
        await api.reorderQueue(activeServerId, startIndex + 1, endIndex + 1);
      } catch (error) {
        console.error(error);
        toast({
          title: "エラー",
          description: "キューの並び替えに失敗しました。",
          variant: "destructive",
        });
        const originalQueue = Array.from(queue);
        setQueue(originalQueue);
      }
    }
  };

  const handleSelectServer = (serverId: string) => {
    setActiveServerId(serverId);
    setActiveChannelId(null);
  };

  const handleSelectChannel = async (channelId: string) => {
    if (activeServerId && channelId !== botVoiceChannelId) {
      try {
        await api.joinVoiceChannel(activeServerId, channelId);
        setActiveChannelId(channelId);
        setBotVoiceChannelId(channelId);
        toast({
          title: "成功",
          description: "ボイスチャンネルに参加しました。",
        });
      } catch (error) {
        console.error(error);
        toast({
          title: "エラー",
          description: "ボイスチャンネルへの参加に失敗しました。",
          variant: "destructive",
        });
      }
    }
  };

  const handleDeleteFromQueue = async (index: number) => {
    if (activeServerId) {
      try {
        await api.removeFromQueue(activeServerId, index);
        const updatedQueue = [...queue];
        updatedQueue.splice(index, 1);
        setQueue(updatedQueue);
        toast({
          title: "成功",
          description: "キューから曲を削除しました。",
        });
      } catch (error) {
        console.error('キューからの削除中にエラーが発生しました:', error);
        toast({
          title: 'エラー',
          description: 'キューからの削除に失敗しました。',
          variant: 'destructive',
        });
      }
    }
  };

  // status が 'loading' の場合は、ローディングUIを表示
  if (status === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  // status が 'unauthenticated' の場合は、ログインUIを表示
  if (status === 'unauthenticated' || !session) {
    return (
      <div className="h-screen flex flex-col items-center justify-center">
        <Button onClick={() => signIn('discord')}>Discordでログイン</Button>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background text-foreground flex flex-col" {...swipeHandlers}>
      <Header
        onSearch={handleSearch}
        onAddUrl={handleAddUrl}
        onOpenMenu={() => setIsMenuOpen(true)}
      />
      <AnimatePresence>
        <SideMenu
          isOpen={isMenuOpen}
          onClose={handleCloseMenu}
          activeServerId={activeServerId}
          onSelectServer={handleSelectServer}
          voiceChannels={voiceChannels}
          activeChannelId={activeChannelId}
          onSelectChannel={handleSelectChannel}
          onRefresh={handleRefresh}
          availableServers={availableServers}
          invitableServers={invitableServers}
          onInviteBot={handleInviteBot}
        />
      </AnimatePresence>
      <main className="flex-grow overflow-hidden pt-16">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : isSearchActive ? (
          <SearchResults
            results={searchResults}
            onAddToQueue={async (track: Track) => {
              if (activeServerId) {
                try {
                  setIsLoading(true);
                  await api.playTrack(activeServerId, track);
                  setIsSearchActive(false);
                  toast({
                    title: "成功",
                    description: "曲がキューに追加されました。",
                  });
                } catch (error) {
                  console.error(error);
                  toast({
                    title: "エラー",
                    description: "曲の追加に失敗しました。",
                    variant: "destructive",
                  });
                } finally {
                  setIsLoading(false);
                }
              }
            }}
            onClose={() => setIsSearchActive(false)}
            onSearch={handleSearch}
          />
        ) : (
          <>
            <AnimatePresence>
              {isMainPlayerVisible && (
                <MainPlayer
                  currentTrack={currentTrack}
                  isPlaying={isPlaying}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onSkip={handleSkip}
                  onPrevious={handlePrevious}
                  queue={queue}
                  onReorder={handleReorderQueue}
                  onDelete={handleDeleteFromQueue}
                  guildId={activeServerId}
                  onClose={() => setIsMainPlayerVisible(false)}
                  isVisible={isMainPlayerVisible}
                />
              )}
            </AnimatePresence>
            {!isMainPlayerVisible && (
              <HomeScreen
                onSelectTrack={(track: Track) => {
                  handleAddTrackToQueue(track);
                  setIsMainPlayerVisible(true);
                }}
              />
            )}
          </>
        )}
      </main>
      {currentTrack && !isMainPlayerVisible && (
        <motion.div
          className="fixed bottom-0 left-0 right-0 bg-card p-4 flex items-center cursor-pointer"
          onClick={() => setIsMainPlayerVisible(true)}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ duration: 0.3 }}
          {...miniPlayerSwipeHandlers}
        >
          <img src={currentTrack.thumbnail} alt={currentTrack.title} className="w-12 h-12 object-cover rounded-md" />
          <div className="ml-4 flex-grow">
            <h4 className="font-semibold truncate">{currentTrack.title}</h4>
            <p className="text-muted-foreground truncate">{currentTrack.artist}</p>
          </div>
          <Button
            variant="ghost" 
            onClick={(e) => { 
              e.stopPropagation(); 
              if (isPlaying) {
                handlePause();
              } else {
                handlePlay();
              }
            }}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </Button>
        </motion.div>
      )}
      <AnimatePresence>
        {isQueueOpen && (
          <QueueList
            queue={queue}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            onPlayPause={isPlaying ? handlePause : handlePlay}
            onReorder={handleReorderQueue}
            onClose={() => setIsQueueOpen(false)}
            onDelete={handleDeleteFromQueue}
          />
        )}
      </AnimatePresence>
    </div>
  );
};