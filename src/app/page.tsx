"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { api, setupWebSocket } from '@/utils/api';
import { NowPlaying } from '@/components/NowPlaying';
import { Player } from '@/components/Player';
import { Queue } from '@/components/Queue';
import { SearchBar } from '@/components/SearchBar';
import { ServerSelector } from '@/components/ServerSelector';
import { VoiceChannelSelector } from '@/components/VoiceChannelSelector';
import { Server, Track, QueueItem, VoiceChannel } from '@/utils/api';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";


export default function Home() {
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [voiceChannels, setVoiceChannels] = useState<VoiceChannel[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const { toast } = useToast();

  const fetchServers = useCallback(async () => {
    try {
      const data = await api.getServers();
      setServers(data);
    } catch (error) {
      toast({
        title: "エラー",
        description: "サーバー一覧の取得に失敗しました。",
        variant: "destructive",
      });
    }
  }, [toast]);

  const fetchVoiceChannels = useCallback(async (serverId: string) => {
    try {
      const channels = await api.getVoiceChannels(serverId);
      setVoiceChannels(channels);
    } catch (error) {
      toast({
        title: "エラー",
        description: "ボイスチャンネルの取得に失敗しました。",
        variant: "destructive",
      });
    }
  }, [toast]);

  const fetchInitialData = useCallback(async (serverId: string) => {
    try {
      setLoading(true);
      const [track, queueData, playing] = await Promise.all([
        api.getCurrentTrack(serverId),
        api.getQueue(serverId),
        api.isPlaying(serverId),
      ]);
      setCurrentTrack(track);
      setQueue(queueData);
      setIsPlaying(playing);
    } catch (error) {
      toast({
        title: "エラー",
        description: "初期データの取得に失敗しました。",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const fetchInitial = async () => {
      await fetchServers();
      const storedServerId = localStorage.getItem('activeServerId');
      if (storedServerId) {
        setActiveServerId(storedServerId);
      }
    };
    fetchInitial();
  }, [fetchServers]);

  useEffect(() => {
    if (activeServerId) {
      localStorage.setItem('activeServerId', activeServerId);
      fetchVoiceChannels(activeServerId);
      fetchInitialData(activeServerId);

      const newWs = setupWebSocket(activeServerId, (data) => {
        setCurrentTrack(data.current_track);
        setQueue(data.queue);
        setIsPlaying(data.is_playing);
        setIsProcessing(false);
      });

      setWs(newWs);

      return () => {
        if (newWs) {
          newWs.close();
        }
      };
    }
  }, [activeServerId, fetchVoiceChannels, fetchInitialData]);

  const handleSearch = async (query: string) => {
    try {
      setLoading(true);
      const results = await api.search(query);
      setSearchResults(results);
    } catch (error) {
      toast({
        title: "エラー",
        description: "検索に失敗しました。",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddToQueue = async (track: Track) => {
    if (activeServerId !== null) {
      try {
        setIsProcessing(true);
        await api.playTrack(activeServerId, track);
        toast({
          title: "処理中",
          description: "曲をキューに追加しています。しばらくお待ちください。",
        });
      } catch (error) {
        toast({
          title: "エラー",
          description: "曲の追加中にエラーが発生しました。",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleAddUrl = async (url: string) => {
    if (activeServerId !== null) {
      try {
        setIsProcessing(true);
        await api.addUrl(activeServerId, url);
        toast({
          title: "処理中",
          description: "URLを処理しています。しばらくお待ちください。",
        });
      } catch (error) {
        toast({
          title: "エラー",
          description: "URLの追加中にエラーが発生しました。",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handlePlay = async () => {
    if (activeServerId !== null) {
      try {
        setIsProcessing(true);
        await api.resumePlayback(activeServerId);
        setIsPlaying(true);
      } catch (error) {
        toast({
          title: "エラー",
          description: "再生の開始に失敗しました。",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handlePause = async () => {
    if (activeServerId !== null) {
      try {
        setIsProcessing(true);
        await api.pausePlayback(activeServerId);
        setIsPlaying(false);
      } catch (error) {
        toast({
          title: "エラー",
          description: "再生の一時停止に失敗しました。",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleSkip = async () => {
    if (activeServerId !== null) {
      try {
        setIsProcessing(true);
        await api.skipTrack(activeServerId);
      } catch (error) {
        toast({
          title: "エラー",
          description: "スキップに失敗しました。",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleSelectChannel = async (channelId: string) => {
    if (activeServerId !== null) {
      try {
        setIsProcessing(true);
        await api.joinVoiceChannel(activeServerId, channelId);
        toast({
          title: "成功",
          description: "ボイスチャンネルに参加しました。",
        });
      } catch (error) {
        toast({
          title: "エラー",
          description: "ボイスチャンネルへの参加に失敗しました。",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handlePrevious = async () => {
    if (activeServerId !== null) {
      try {
        setIsProcessing(true);
        await api.previousTrack(activeServerId);
      } catch (error) {
        toast({
          title: "エラー",
          description: "前の曲への移動に失敗しました。",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    }
  };

  // handleReorderQueue関数の修正
  const handleReorderQueue = async (newQueue: QueueItem[]) => {
    // startIndexとendIndexを計算
    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < queue.length; i++) {
      if (queue[i].track.url !== newQueue[i].track.url) {
        const movedItem = queue[i];
        startIndex = i;
        endIndex = newQueue.findIndex(item => item.track.url === movedItem.track.url);
        break;
      }
    }

    if (startIndex !== -1 && endIndex !== -1) {
      setQueue(newQueue);

      if (activeServerId !== null) {
        try {
          setIsProcessing(true);
          await api.reorderQueue(activeServerId, startIndex, endIndex);
          toast({
            title: "成功",
            description: "キューの順序を変更しました。",
          });
        } catch (error) {
          toast({
            title: "エラー",
            description: "キューの順序変更に失敗しました。",
            variant: "destructive",
          });
        } finally {
          setIsProcessing(false);
        }
      }
    } else {
      console.error("キューの順序変更を検出できませんでした。");
    }
  };
  

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-4">Discord Music Player</h1>
      
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>サーバー選択</CardTitle>
          <CardDescription>音楽を再生するDiscordサーバーを選択してください</CardDescription>
        </CardHeader>
        <CardContent>
          <ServerSelector
            servers={servers}
            activeServerId={activeServerId}
            onSelectServer={setActiveServerId}
          />
        </CardContent>
      </Card>

      {activeServerId && (
        <>
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>ボイスチャンネル</CardTitle>
              <CardDescription>参加するボイスチャンネルを選択してください</CardDescription>
            </CardHeader>
            <CardContent>
              <VoiceChannelSelector channels={voiceChannels} onSelectChannel={handleSelectChannel} />
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>音楽検索</CardTitle>
              <CardDescription>曲を検索するか、YouTubeのURLを直接追加できます</CardDescription>
            </CardHeader>
            <CardContent>
              <SearchBar onSearch={handleSearch} onAddUrl={handleAddUrl} loading={loading} />
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>検索結果</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                {loading ? (
                  Array(5).fill(0).map((_, index) => (
                    <div key={index} className="flex items-center gap-4 mb-4">
                      <Skeleton className="w-12 h-12 rounded" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-[200px]" />
                        <Skeleton className="h-4 w-[150px]" />
                      </div>
                    </div>
                  ))
                ) : (
                  searchResults.map((track, index) => (
                    <div key={index} className="flex items-center gap-4 mb-4">
                      <img
                        src={track.thumbnail || 'default_thumbnail_url'}
                        alt={track.title}
                        className="w-12 h-12 object-cover rounded"
                      />
                      <div>
                        <h3 className="font-bold">{track.title}</h3>
                        <p className="text-sm text-gray-500">{track.artist}</p>
                      </div>
                      <Button
                        onClick={() => handleAddToQueue(track)}
                        disabled={isProcessing}
                        className="ml-auto"
                      >
                        {isProcessing ? "追加中..." : "追加"}
                      </Button>
                    </div>
                  ))
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>再生中</CardTitle>
            </CardHeader>
            <CardContent>
              <NowPlaying track={currentTrack} isPlaying={isPlaying} />
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>プレイヤーコントロール</CardTitle>
            </CardHeader>
            <CardContent>
              <Player
                track={currentTrack}
                isPlaying={isPlaying}
                onPlay={handlePlay}
                onPause={handlePause}
                onSkip={handleSkip}
                onPrevious={handlePrevious}
                loading={isProcessing}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>再生キュー</CardTitle>
                </CardHeader>
                <CardContent>
                  <Queue queue={queue} onReorderQueue={handleReorderQueue} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}