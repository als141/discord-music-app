// MainApp.tsx
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, setupWebSocket, PlayableItem } from '@/utils/api';
import { MainPlayer } from './MainPlayer';
import { Header } from './Header';
import { SideMenu } from './SideMenu';
import { SearchResults } from './SearchResults';
import { Track, VoiceChannel, QueueItem, SearchItem } from '@/utils/api';
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from 'lucide-react';
import { HomeScreen } from './HomeScreen';
import { PlayIcon, PauseIcon } from 'lucide-react';
import { Button } from './ui/button';
import { useSwipeable } from 'react-swipeable';
import { useSession, signIn } from 'next-auth/react';
import { useGuilds } from '@/contexts/GuildContext';
import Image from 'next/image';
import { User } from '@/utils/api';
import { usePlayback } from '@/contexts/PlaybackContext';
import { VolumeProvider, useVolume } from '@/contexts/VolumeContext';
import { IntroPage } from './IntroPage';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

// BigIntのJSONシリアライズの設定
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
  const { setCurrentTime, setDuration, audioRef } = usePlayback()
  const { mutualServers } = useGuilds(); // botServersをmutualServersに変更
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);

  // activeServerId と activeChannelId の状態を管理
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);

  const [isOnDeviceMode, setIsOnDeviceMode] = useState(false);

  // オンデバイス用のキューと再生状態を管理
  const [deviceQueue, setDeviceQueue] = useState<Track[]>([]);
  const [deviceCurrentTrack, setDeviceCurrentTrack] = useState<Track | null>(null);
  const [deviceIsPlaying, setDeviceIsPlaying] = useState(false);
  const { volume } = useVolume(); // 音量を取得

  const [voiceChannels, setVoiceChannels] = useState<VoiceChannel[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]); // 型を修正
  const [isSearchActive, setIsSearchActive] = useState(false);
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isMainPlayerVisible, setIsMainPlayerVisible] = useState(false);
  const [homeActiveTab, setHomeActiveTab] = useState<string>('home');
  const [history, setHistory] = useState<QueueItem[]>([])
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const initializeApp = () => {
      if (typeof window !== 'undefined') {
        // ブラウザで実行されている場合のみlocalStorageにアクセス
        const savedServerId = localStorage.getItem('activeServerId');
        const savedChannelId = localStorage.getItem('activeChannelId');

        if (savedServerId) {
          setActiveServerId(savedServerId);
        }
        if (savedChannelId) {
          setActiveChannelId(savedChannelId);
        }
      }
    };

    initializeApp();
  }, []);

  // activeServerId の変更時に localStorage に保存
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (activeServerId) {
        localStorage.setItem('activeServerId', activeServerId);
      } else {
        localStorage.removeItem('activeServerId');
      }
    }
  }, [activeServerId]);

  // activeChannelId の変更時に localStorage に保存
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (activeChannelId) {
        localStorage.setItem('activeChannelId', activeChannelId);
      } else {
        localStorage.removeItem('activeChannelId');
      }
    }
  }, [activeChannelId]);
  
  // 楽曲が変更されたときの処理を修正
  useEffect(() => {
    if (deviceCurrentTrack) {
      setIsLoading(true); // ローディング開始
      const playPromise = audioRef.current?.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setDeviceIsPlaying(true);
            setIsLoading(false); // ローディング終了
          })
          .catch((error) => {
            console.error('再生エラー:', error);
            setIsLoading(false);
          });
      }
    }
  }, [deviceCurrentTrack]);

  useEffect(() => {
    if (isOnDeviceMode && audioRef?.current) {
      audioRef.current.volume = volume;
    }
  }, [volume, isOnDeviceMode]);

  // オンデバイス用の再生関数を修正
  const handleDevicePlay = () => {
    setIsLoading(true); // ローディング開始
    const playPromise = audioRef.current?.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setDeviceIsPlaying(true);
          setIsLoading(false); // ローディング終了
        })
        .catch((error) => {
          console.error('再生エラー:', error);
          setIsLoading(false);
        });
    }
  };
  
  const handleDevicePause = () => {
    audioRef.current?.pause();
    setDeviceIsPlaying(false);
  };

  const handleDeviceSkip = () => {
    if (deviceQueue.length > 0) {
      const nextTrack = deviceQueue[0];
      setDeviceCurrentTrack(nextTrack);
      setDeviceQueue(deviceQueue.slice(1));
    } else {
      setDeviceCurrentTrack(null);
      setDeviceIsPlaying(false);
    }
  };

  const handleDevicePrevious = () => {
    // 必要に応じて実装
  };

  // オンデバイスモードのときに再生位置を管理
  useEffect(() => {
    if (isOnDeviceMode && audioRef?.current) {
      const audio = audioRef.current;
      const updateTime = () => {
        setCurrentTime(audio.currentTime);
      };
      const updateDuration = () => {
        setDuration(audio.duration);
      };
      audio.addEventListener('timeupdate', updateTime);
      audio.addEventListener('durationchange', updateDuration);
      return () => {
        audio.removeEventListener('timeupdate', updateTime);
        audio.removeEventListener('durationchange', updateDuration);
      };
    }
  }, [isOnDeviceMode, audioRef, setCurrentTime, setDuration]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      const handleCanPlay = () => {
        setIsLoading(false); // ローディング終了
      };
  
      audio.addEventListener('canplay', handleCanPlay);
  
      return () => {
        audio.removeEventListener('canplay', handleCanPlay);
      };
    }
  }, [audioRef]);

  // 楽曲を追加する関数を修正
  const handleDeviceAddToQueue = async (item: PlayableItem) => {
    if (!deviceCurrentTrack) {
      setDeviceCurrentTrack(item);
      // ローディング状態は useEffect 内で管理される
    } else {
      setDeviceQueue([...deviceQueue, item]);
      toast({
        title: "成功",
        description: `"${item.title}" をキューに追加しました。`,
      });
    }
  };

  useEffect(() => {
    const fetchServerData = async () => {
      if (activeServerId) {
        setIsLoading(true);
        try {
          const [channels, botStatus, queueResponse, isPlayingResponse] = await Promise.all([
            api.getVoiceChannels(activeServerId),
            api.getBotVoiceStatus(activeServerId),
            api.getQueue(activeServerId),
            api.isPlaying(activeServerId)
          ]);

          setVoiceChannels(channels);
          if (botStatus) setActiveChannelId(botStatus);

          const currentTrackItem = queueResponse.find(item => item.isCurrent);
          setCurrentTrack(currentTrackItem?.track || null);
          setQueue(queueResponse.filter(item => !item.isCurrent).map(item => item.track));
          setIsPlaying(isPlayingResponse);

          // WebSocketの設定
          if (wsRef.current) {
            wsRef.current.close();
          }
          const ws = setupWebSocket(activeServerId, (data) => {
            const queueItems: QueueItem[] = data.queue;
            const currentTrackItem = queueItems.find(item => item.isCurrent);
            setCurrentTrack(currentTrackItem?.track || null);
            setQueue(queueItems.filter(item => !item.isCurrent).map(item => item.track));
            setIsPlaying(data.is_playing);
            setHistory(data.history);
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
      }
    };

    fetchServerData();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [activeServerId, toast]);
  
  // ユーザー情報を取得する関数を作成
  const getUserInfo = (): User | null => {
    if (session && session.user) {
      return {
        id: session.user.id,
        name: session.user.name || '',
        image: session.user.image || '',
      };
    }
    return null;
  };

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
    onSwipedRight: () => setIsMenuOpen(false),
    trackMouse: true,
    delta: 50,
  });
  
  const miniPlayerSwipeHandlers = useSwipeable({
    onSwipedUp: () => setIsMainPlayerVisible(true),
    delta: 50,
    trackMouse: false
  });

  const handleAddToQueue = async (item: PlayableItem) => {
    if (activeServerId) {
      const user = getUserInfo();
      if (!user) {
        toast({
          title: "エラー",
          description: "ユーザー情報を取得できませんでした。",
          variant: "destructive",
        });
        return;
      }
      try {
        setIsLoading(true);
        await api.addUrl(activeServerId, item.url, user);
        toast({
          title: "成功",
          description: `"${item.title}" をキューに追加しました。`,
        });
      } catch (error) {
        console.error(error);
        toast({
          title: "エラー",
          description: "キューへの追加に失敗しました。",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    } else {
      toast({
        title: "エラー",
        description: "サーバーが選択されていません。",
        variant: "destructive",
      });
    }
  };
  
  const handleAddTrackToQueue = async (track: Track) => {
    if (activeServerId) {
      const user = getUserInfo();
      if (!user) {
        toast({
          title: "エラー",
          description: "ユーザー情報を取得できませんでした。",
          variant: "destructive",
        });
        return;
      }
      try {
        await api.addUrl(activeServerId, track.url, user);
        toast({
          title: "成功",
          description: "曲がキューに追加されました。",
        });
      } catch (error) {
        console.error(error);
        toast({
          title: "エラー",
          description: "キューへの追加に失敗しました。",
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
      setSearchResults(results); // results の型は SearchItem[]
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
      const user = getUserInfo();
      if (!user) {
        toast({
          title: "エラー",
          description: "ユーザー情報を取得できませんでした。",
          variant: "destructive",
        });
        return;
      }
      try {
        await api.addUrl(activeServerId, url, user);
        toast({
          title: "成功",
          description: "URLが追加されました。",
        });
      } catch (error) {
        // エラーハンドリング
        console.error(error);
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

  const handleSelectServer = (serverId: string | null) => { // string | null に変更
    if (serverId) {
      const serverExists = mutualServers.some((server) => server.id === serverId);
      if (serverExists) {
        setActiveServerId(serverId);
        setActiveChannelId(null);
      } else {
        toast({
          title: "エラー",
          description: "選択したサーバーは利用できません。",
          variant: "destructive",
        });
      }
    } else {
      // サーバーをnullに設定（切断後）
      setActiveServerId(null);
      setActiveChannelId(null);
    }
  };
  

  const handleSelectChannel = (channelId: string | null) => {
    if (channelId) {
      // 非同期処理を内部でハンドリング
      api.joinVoiceChannel(activeServerId!, channelId)
        .then(() => {
          setActiveChannelId(channelId);
          toast({
            title: "成功",
            description: "ボイスチャネルに参加しました。",
          });
          // 必要に応じて追加のロジック
        })
        .catch((error) => {
          console.error('ボイスチャネルへの参加に失敗しました:', error);
          toast({
            title: "エラー",
            description: "ボイスチャネルへの参加に失敗しました。",
            variant: "destructive",
          });
        });
    } else {
      // `null` の場合の処理
      setActiveChannelId(null);
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

  // 認証状態のチェックとUIの表示
  if (status === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (status === 'unauthenticated' || !session) {
    return (
      <IntroPage />
    );
  }

  return (
    <VolumeProvider>
    <div className="h-screen bg-background text-foreground flex flex-col" {...swipeHandlers}>
      <Header
        onSearch={handleSearch}
        onAddUrl={handleAddUrl}
        onOpenMenu={() => setIsMenuOpen(true)}
        isOnDeviceMode={isOnDeviceMode}
        onToggleDeviceMode={() => setIsOnDeviceMode(!isOnDeviceMode)}
      />
      <AnimatePresence>
        {!isOnDeviceMode && (
          <SideMenu
            isOpen={isMenuOpen}
            onClose={handleCloseMenu}
            activeServerId={activeServerId}
            onSelectServer={handleSelectServer}
            voiceChannels={voiceChannels}
            activeChannelId={activeChannelId}
            onSelectChannel={handleSelectChannel}
            onRefresh={handleRefresh}
            onInviteBot={handleInviteBot}
          />
        )}
      </AnimatePresence>
      <main className="flex-grow overflow-hidden pt-16">
        {isSearchActive ? (
          <SearchResults
            results={searchResults}
            onAddToQueue={isOnDeviceMode ? handleDeviceAddToQueue : handleAddToQueue}
            onAddTrackToQueue={isOnDeviceMode ? handleDeviceAddToQueue : handleAddTrackToQueue}
            onClose={() => setIsSearchActive(false)}
            onSearch={handleSearch}
            isOnDeviceMode={isOnDeviceMode}
          />
        ) : isOnDeviceMode ? (
          <>
            <AnimatePresence>
              {isMainPlayerVisible && (
                <MainPlayer
                  currentTrack={deviceCurrentTrack}
                  isPlaying={deviceIsPlaying}
                  onPlay={handleDevicePlay}
                  onPause={handleDevicePause}
                  onSkip={handleDeviceSkip}
                  onPrevious={handleDevicePrevious}
                  queue={deviceQueue}
                  onReorder={(startIndex, endIndex) => {
                    const newQueue = Array.from(deviceQueue);
                    const [movedItem] = newQueue.splice(startIndex, 1);
                    newQueue.splice(endIndex, 0, movedItem);
                    setDeviceQueue(newQueue);
                  }}
                  onDelete={(index) => {
                    const newQueue = Array.from(deviceQueue);
                    newQueue.splice(index, 1);
                    setDeviceQueue(newQueue);
                  }}
                  guildId={null}
                  onClose={() => setIsMainPlayerVisible(false)}
                  isVisible={isMainPlayerVisible}
                  isOnDeviceMode={isOnDeviceMode}
                  audioRef={audioRef}
                  handleDeviceAddToQueue={handleDeviceAddToQueue}
                  isLoading={isLoading}
                />
              )}
            </AnimatePresence>
            {!isMainPlayerVisible && (
              <HomeScreen
                onSelectTrack={(item: PlayableItem) => {
                  handleDeviceAddToQueue(item);
                  setIsMainPlayerVisible(true);
                }}
                guildId={null}
                activeTab={homeActiveTab}
                onTabChange={(tab) => setHomeActiveTab(tab)}
                history={[]}
                isOnDeviceMode={isOnDeviceMode}
              />
            )}
          </>
        ) : (
          <>
            {isLoading ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
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
                      isOnDeviceMode={isOnDeviceMode}
                      handleDeviceAddToQueue={handleDeviceAddToQueue}
                      isLoading={isLoading}
                    />
                  )}
                </AnimatePresence>
                {!isMainPlayerVisible && (
                  <HomeScreen
                    onSelectTrack={(item: PlayableItem) => {
                      handleAddToQueue(item);
                      setIsMainPlayerVisible(true);
                    }}
                    guildId={activeServerId}
                    activeTab={homeActiveTab}
                    onTabChange={(tab) => setHomeActiveTab(tab)}
                    history={history}
                    isOnDeviceMode={isOnDeviceMode}
                  />
                )}
              </>
            )}
          </>
        )}
      </main>
      {((currentTrack && !isMainPlayerVisible && !isOnDeviceMode) || (deviceCurrentTrack && !isMainPlayerVisible && isOnDeviceMode)) && homeActiveTab !== 'chat' && homeActiveTab !== 'ai-recommend' && (
        <motion.div
          className="fixed bottom-0 left-0 right-0 bg-card p-4 flex items-center cursor-pointer"
          onClick={() => setIsMainPlayerVisible(true)}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ duration: 0.3 }}
          {...miniPlayerSwipeHandlers}
        >
          <Image 
            src={isOnDeviceMode ? deviceCurrentTrack!.thumbnail : currentTrack!.thumbnail} 
            alt={isOnDeviceMode ? deviceCurrentTrack!.title : currentTrack!.title} 
            width={48} 
            height={48} 
            className="object-cover rounded-md flex-shrink-0"
            unoptimized
          />
          <div className="ml-4 flex-grow min-w-0 mr-4">
            <h4 className="font-semibold truncate">{isOnDeviceMode ? deviceCurrentTrack!.title : currentTrack!.title}</h4>
            <p className="text-muted-foreground truncate">{isOnDeviceMode ? deviceCurrentTrack!.artist : currentTrack!.artist}</p>
          </div>
          <Button
            variant="ghost" 
            className="flex-shrink-0"
            onClick={(e) => { 
              e.stopPropagation(); 
              if (isOnDeviceMode) {
                if (deviceIsPlaying) {
                  handleDevicePause();
                } else {
                  handleDevicePlay();
                }
              } else {
                if (isPlaying) {
                  handlePause();
                } else {
                  handlePlay();
                }
              }
            }}
          >
            {(isOnDeviceMode ? deviceIsPlaying : isPlaying) ? <PauseIcon /> : <PlayIcon />}
          </Button>
        </motion.div>
      )}
      {/* オーディオ要素をオンデバイスモードのときのみレンダリング */}
      {isOnDeviceMode && (
      <audio
        ref={audioRef}
        src={
          deviceCurrentTrack?.url
            ? `${API_URL}/stream?url=${encodeURIComponent(deviceCurrentTrack.url)}`
            : undefined
        }
        onEnded={handleDeviceSkip}
        onPlay={() => setDeviceIsPlaying(true)}
        onPause={() => setDeviceIsPlaying(false)}
        autoPlay
      />
    )}
    </div>
    </VolumeProvider>
  );
};
