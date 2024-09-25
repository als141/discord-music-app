'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { api, setupWebSocket } from '@/utils/api';
import { MainPlayer } from './MainPlayer';
import { QueueList } from './QueueList';
import { Header } from './Header';
import { SideMenu } from './SideMenu';
import { SearchResults } from './SearchResults';
import { Server, Track, VoiceChannel, QueueItem } from '@/utils/api';
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from 'lucide-react';

export const MainApp: React.FC = () => {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [servers, setServers] = useState<Server[]>([]);
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

  const wsRef = useRef<WebSocket | null>(null); // useRef をインポート

  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);
      try {
        const [fetchedServers, savedServerId, savedChannelId] = await Promise.all([
          api.getServers(),
          localStorage.getItem('activeServerId'),
          localStorage.getItem('activeChannelId')
        ]);

        setServers(fetchedServers);
        if (savedServerId) {
          setActiveServerId(savedServerId);
          if (savedChannelId) setActiveChannelId(savedChannelId);
        }
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

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const fetchedServers = await api.getServers();
        setServers(fetchedServers);
      } catch (error) {
        console.error("Failed to fetch servers:", error);
        toast({
          title: "エラー",
          description: "サーバー一覧の取得に失敗しました。",
          variant: "destructive",
        });
      }
    };
    fetchServers();

    const savedServerId = localStorage.getItem('activeServerId');
    const savedChannelId = localStorage.getItem('activeChannelId');
    if (savedServerId) {
      setActiveServerId(savedServerId);
      if (savedChannelId) setActiveChannelId(savedChannelId);
    }
  }, [toast]);

  useEffect(() => {
    if (activeServerId) {
      localStorage.setItem('activeServerId', activeServerId);
      
      const fetchVoiceChannels = async () => {
        try {
          const channels = await api.getVoiceChannels(activeServerId);
          setVoiceChannels(channels);
          
          const botStatus = await api.getBotVoiceStatus(activeServerId);
          setBotVoiceChannelId(botStatus); // 修正: botStatus を直接設定
          if (botStatus) setActiveChannelId(botStatus);
        } catch (error) {
          console.error("Failed to fetch voice channels:", error);
          toast({
            title: "エラー",
            description: "ボイスチャンネルの取得に失敗しました。",
            variant: "destructive",
          });
        }
      };
      fetchVoiceChannels();

      // WebSocket 接続の設定
      const ws = setupWebSocket(activeServerId, (data) => {
        const queueItems: QueueItem[] = data.queue;
        const currentTrackItem = queueItems.find(item => item.isCurrent);
        setCurrentTrack(currentTrackItem?.track || null);
        setQueue(queueItems.filter(item => !item.isCurrent).map(item => item.track));
        setIsPlaying(data.is_playing);
      });

      wsRef.current = ws; // WebSocket インスタンスを ref に保存

      return () => {
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
      };
    }
  }, [activeServerId, toast]);

  useEffect(() => {
    if (activeChannelId) {
      localStorage.setItem('activeChannelId', activeChannelId);
    }
  }, [activeChannelId]);

  useEffect(() => {
    const fetchInitialState = async () => {
      if (activeServerId) {
        try {
          const [queueResponse, isPlayingResponse] = await Promise.all([
            api.getQueue(activeServerId),
            api.isPlaying(activeServerId)
          ]);

          if (!Array.isArray(queueResponse)) {
            throw new Error('Invalid queue response');
          }

          const currentTrackItem = queueResponse.find(item => item.isCurrent);
          setCurrentTrack(currentTrackItem?.track || null);
          setQueue(queueResponse.filter(item => !item.isCurrent).map(item => item.track));
          setIsPlaying(isPlayingResponse);
        } catch (error) {
          console.error("Failed to fetch initial state:", error);
          toast({
            title: "エラー",
            description: "初期状態の取得に失敗しました。",
            variant: "destructive",
          });
        }
      }
    };
  
    fetchInitialState();
  }, [activeServerId, toast]);

  const handlePlay = async () => {
    if (activeServerId) {
      try {
        await api.resumePlayback(activeServerId);
        setIsPlaying(true);
      } catch (error) {
        console.error(error); // エラ
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
        console.error(error); // エラーログを出力
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
        console.error(error); // エラーログを出力
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
        console.error(error); // エラ
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
      console.error(error); // エラーロ
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
        console.error(error); // エラーログを出力
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
        // インデックスをサーバー側に合わせるため+1
        await api.reorderQueue(activeServerId, startIndex + 1, endIndex + 1);
      } catch (error) {
        console.error(error); // エラーログを出力
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
        console.error(error); // エラーログを出力
        toast({
          title: "エラー",
          description: "ボイスチャンネルへの参加に失敗しました。",
          variant: "destructive",
        });
      }
    }
  };

  return (
    <div className="h-screen bg-black text-white flex flex-col">
      <Header
        onSearch={handleSearch}
        onAddUrl={handleAddUrl}
        onOpenMenu={() => setIsMenuOpen(true)}
      />
      <AnimatePresence>
        {isMenuOpen && (
          <SideMenu
            isOpen={isMenuOpen}
            onClose={() => setIsMenuOpen(false)}
            servers={servers}
            activeServerId={activeServerId}
            onSelectServer={handleSelectServer}
            voiceChannels={voiceChannels}
            activeChannelId={activeChannelId}
            onSelectChannel={handleSelectChannel}
          />
        )}
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
          />
        ) : (
          <MainPlayer
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            onPlay={handlePlay}
            onPause={handlePause}
            onSkip={handleSkip}
            onPrevious={handlePrevious}
            onQueueOpen={() => setIsQueueOpen(true)}
          />
        )}
      </main>
      <AnimatePresence>
        {isQueueOpen && (
          <QueueList
            queue={queue}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            onPlayPause={isPlaying ? handlePause : handlePlay}
            onReorder={handleReorderQueue}
            onClose={() => setIsQueueOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};