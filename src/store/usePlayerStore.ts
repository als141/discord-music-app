// src/store/usePlayerStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, Track, api, QueueItem, PlayableItem } from '@/utils/api';
import { toast } from '@/hooks/use-toast';
import { createWebSocketConnection } from '@/utils/websocket';
import React from 'react';

// アクティブなWebSocketコネクション
let wsConnection: { close: () => void } | null = null;

// アクティブなサーバーIDを管理するためのシンプルなストアインターフェース
interface GuildState {
  activeServerId: string | null;
}

// ストア間の直接依存を避けるための関数
let getActiveServerId: () => string | null = () => null;

// 外部からアクティブサーバーIDを取得するための関数を設定
export function setActiveServerIdGetter(getter: () => string | null) {
  getActiveServerId = getter;
}

interface PlayerState {
  // 再生状態
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  isLoading: boolean;
  history: QueueItem[];
  
  // デバイスモード
  isOnDeviceMode: boolean;
  deviceQueue: Track[];
  deviceCurrentTrack: Track | null;
  deviceIsPlaying: boolean;
  
  // 再生位置
  currentTime: number;
  duration: number;
  volume: number;
  
  // プレイヤーUI状態
  isMainPlayerVisible: boolean;
  
  // 関連トラック
  relatedTracks: Track[];
  isRelatedLoading: boolean;
  
  // オーディオエレメント参照
  audioRef: React.RefObject<HTMLAudioElement>;
  
  // アクション
  setCurrentTrack: (track: Track | null) => void;
  setQueue: (queue: Track[]) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setIsLoading: (isLoading: boolean) => void;
  setHistory: (history: QueueItem[]) => void;
  setIsMainPlayerVisible: (isVisible: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  toggleDeviceMode: () => void;
  
  // プレイヤー操作
  play: () => Promise<void>;
  pause: () => Promise<void>;
  skip: () => Promise<void>;
  previous: () => Promise<void>;
  addToQueue: (item: PlayableItem, user?: User | null) => Promise<void>;
  reorderQueue: (startIndex: number, endIndex: number) => Promise<void>;
  removeFromQueue: (index: number) => Promise<void>;
  
  // 関連トラック操作
  fetchRelatedTracks: (forceRefresh?: boolean) => Promise<void>;
  setRelatedTracks: (tracks: Track[]) => void;
  setIsRelatedLoading: (isLoading: boolean) => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      // 初期状態
      currentTrack: null,
      queue: [],
      isPlaying: false,
      isLoading: false,
      history: [],
      
      isOnDeviceMode: false,
      deviceQueue: [],
      deviceCurrentTrack: null,
      deviceIsPlaying: false,
      
      currentTime: 0,
      duration: 0,
      volume: 1.0,
      
      isMainPlayerVisible: false,
      
      relatedTracks: [],
      isRelatedLoading: false,
      
      // オーディオ要素への参照
      audioRef: React.createRef<HTMLAudioElement>(),
      
      // 基本的な状態更新アクション
      setCurrentTrack: (track) => set({ currentTrack: track }),
      setQueue: (queue) => set({ queue }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setIsLoading: (isLoading) => set({ isLoading }),
      setHistory: (history) => set({ history }),
      setIsMainPlayerVisible: (isVisible) => set({ isMainPlayerVisible: isVisible }),
      setCurrentTime: (time) => set({ currentTime: time }),
      setDuration: (duration) => set({ duration }),
      setVolume: (volume) => {
        set({ volume });
        // オーディオ要素の音量も更新
        const audioElement = get().audioRef.current;
        if (audioElement) {
          audioElement.volume = volume;
        }
      },
      
      // デバイスモード切り替え
      toggleDeviceMode: () => {
        const { isOnDeviceMode, audioRef } = get();
        // デバイスモードを切り替える前に現在の再生状態をクリア
        if (isOnDeviceMode) {
          const audioElement = audioRef.current;
          if (audioElement) {
            audioElement.pause();
          }
          set({
            isOnDeviceMode: false,
            deviceIsPlaying: false,
            deviceCurrentTrack: null,
            deviceQueue: [],
            isMainPlayerVisible: false
          });
          
          toast({
            title: "サーバーモードに切替",
            description: "Discordサーバーでの音楽再生に切り替えました"
          });
        } else {
          set({
            isOnDeviceMode: true,
            isMainPlayerVisible: false
          });
          
          toast({
            title: "デバイスモードに切替",
            description: "ブラウザでの音楽再生に切り替えました"
          });
        }
      },
      
      // 再生
      play: async () => {
        const { isOnDeviceMode, audioRef } = get();
        const activeServerId = getActiveServerId();
        
        if (isOnDeviceMode) {
          const audioElement = audioRef.current;
          if (!audioElement) return Promise.resolve();
          
          try {
            set({ isLoading: true });
            await audioElement.play();
            set({ deviceIsPlaying: true, isPlaying: true, isLoading: false });
            return Promise.resolve();
          } catch (error) {
            console.error('再生エラー:', error);
            
            // 自動再生ポリシーによる制限
            if (error instanceof Error && error.name === 'NotAllowedError') {
              toast({
                title: '自動再生が制限されています',
                description: '再生するには画面を一度クリックしてください',
                variant: 'destructive',
              });
            }
            
            set({ isLoading: false });
            return Promise.reject(error);
          }
        } else {
          if (!activeServerId) {
            toast({
              title: 'エラー',
              description: 'サーバーが選択されていません。',
              variant: 'destructive',
            });
            return Promise.reject(new Error('サーバーが選択されていません'));
          }
          
          try {
            await api.resumePlayback(activeServerId);
            set({ isPlaying: true });
            return Promise.resolve();
          } catch (error) {
            console.error('再生開始エラー:', error);
            toast({
              title: 'エラー',
              description: '再生の開始に失敗しました。',
              variant: 'destructive',
            });
            return Promise.reject(error);
          }
        }
      },
      
      // 一時停止
      pause: async () => {
        const { isOnDeviceMode, audioRef } = get();
        const activeServerId = getActiveServerId();
        
        if (isOnDeviceMode) {
          const audioElement = audioRef.current;
          if (audioElement) {
            audioElement.pause();
            set({ deviceIsPlaying: false, isPlaying: false });
          }
          return Promise.resolve();
        } else {
          if (!activeServerId) return Promise.resolve();
          
          try {
            await api.pausePlayback(activeServerId);
            set({ isPlaying: false });
            return Promise.resolve();
          } catch (error) {
            console.error('一時停止エラー:', error);
            toast({
              title: 'エラー',
              description: '再生の一時停止に失敗しました。',
              variant: 'destructive',
            });
            return Promise.reject(error);
          }
        }
      },
      
      // スキップ
      skip: async () => {
        const { isOnDeviceMode, deviceQueue } = get();
        const activeServerId = getActiveServerId();
        
        if (isOnDeviceMode) {
          if (deviceQueue.length > 0) {
            const nextTrack = deviceQueue[0];
            const newQueue = deviceQueue.slice(1);
            set({
              deviceCurrentTrack: nextTrack,
              deviceQueue: newQueue,
              currentTrack: nextTrack,
              queue: newQueue
            });
          } else {
            set({
              deviceCurrentTrack: null,
              deviceIsPlaying: false,
              currentTrack: null,
              isPlaying: false
            });
          }
          return Promise.resolve();
        } else {
          if (!activeServerId) return Promise.resolve();
          
          try {
            await api.skipTrack(activeServerId);
            return Promise.resolve();
          } catch (error) {
            console.error('スキップエラー:', error);
            toast({
              title: 'エラー',
              description: 'スキップに失敗しました。',
              variant: 'destructive',
            });
            return Promise.reject(error);
          }
        }
      },
      
      // 前の曲へ
      previous: async () => {
        const { isOnDeviceMode } = get();
        const activeServerId = getActiveServerId();
        
        if (isOnDeviceMode) {
          toast({
            title: 'デバイスモード',
            description: '前の曲機能はデバイスモードではまだ利用できません。',
          });
          return Promise.resolve();
        } else {
          if (!activeServerId) return Promise.resolve();
          
          try {
            await api.previousTrack(activeServerId);
            return Promise.resolve();
          } catch (error) {
            console.error('前の曲エラー:', error);
            toast({
              title: 'エラー', 
              description: '前の曲への移動に失敗しました。',
              variant: 'destructive',
            });
            return Promise.reject(error);
          }
        }
      },
      
      // キューに追加
      addToQueue: async (item, user) => {
        const { isOnDeviceMode, deviceCurrentTrack, deviceQueue } = get();
        const activeServerId = getActiveServerId();
        
        if (isOnDeviceMode) {
          if (!deviceCurrentTrack) {
            set({
              deviceCurrentTrack: item as Track,
              currentTrack: item as Track,
              isMainPlayerVisible: true
            });
            
            toast({
              title: '再生開始',
              description: `"${item.title}" の再生を開始します。`,
            });
          } else {
            const newQueue = [...deviceQueue, item as Track];
            set({
              deviceQueue: newQueue,
              queue: newQueue
            });
            
            toast({
              title: '追加しました',
              description: `"${item.title}" をキューに追加しました。`,
            });
          }
          return Promise.resolve();
        } else {
          if (!activeServerId) {
            toast({
              title: 'エラー',
              description: 'サーバーが選択されていません。',
              variant: 'destructive',
            });
            return Promise.reject(new Error('サーバーが選択されていません'));
          }
          
          try {
            set({ isLoading: true });
            await api.addUrl(activeServerId, item.url, user || null);
            
            toast({
              title: '成功',
              description: `"${item.title}" をキューに追加しました。`,
            });
            set({ isLoading: false });
            return Promise.resolve();
          } catch (error) {
            console.error('追加エラー:', error);
            toast({
              title: 'エラー',
              description: 'キューへの追加に失敗しました。',
              variant: 'destructive',
            });
            set({ isLoading: false });
            return Promise.reject(error);
          }
        }
      },
      
      // キューの並べ替え
      reorderQueue: async (startIndex, endIndex) => {
        const { isOnDeviceMode, deviceQueue, queue } = get();
        const activeServerId = getActiveServerId();
        
        if (isOnDeviceMode) {
          const newQueue = Array.from(deviceQueue);
          const [movedItem] = newQueue.splice(startIndex, 1);
          newQueue.splice(endIndex, 0, movedItem);
          set({
            deviceQueue: newQueue,
            queue: newQueue
          });
          return Promise.resolve();
        } else {
          if (!activeServerId) return Promise.resolve();
          
          try {
            const newQueue = Array.from(queue);
            const [movedItem] = newQueue.splice(startIndex, 1);
            newQueue.splice(endIndex, 0, movedItem);
            set({ queue: newQueue });
            
            await api.reorderQueue(activeServerId, startIndex + 1, endIndex + 1);
            return Promise.resolve();
          } catch (error) {
            console.error('並べ替えエラー:', error);
            toast({
              title: 'エラー',
              description: 'キューの並び替えに失敗しました。',
              variant: 'destructive',
            });
            return Promise.reject(error);
          }
        }
      },
      
      // キューからの削除
      removeFromQueue: async (index) => {
        const { isOnDeviceMode, deviceQueue, queue } = get();
        const activeServerId = getActiveServerId();
        
        if (isOnDeviceMode) {
          const newQueue = Array.from(deviceQueue);
          newQueue.splice(index, 1);
          set({
            deviceQueue: newQueue,
            queue: newQueue
          });
          
          toast({
            title: '成功',
            description: 'キューから曲を削除しました。',
          });
          
          return Promise.resolve();
        } else {
          if (!activeServerId) {
            toast({
              title: 'エラー',
              description: 'サーバーが選択されていません。',
              variant: 'destructive',
            });
            return Promise.reject(new Error('サーバーが選択されていません'));
          }
          
          try {
            await api.removeFromQueue(activeServerId, index);
            
            const updatedQueue = [...queue];
            updatedQueue.splice(index, 1);
            set({ queue: updatedQueue });
            
            toast({
              title: '成功',
              description: 'キューから曲を削除しました。',
            });
            
            return Promise.resolve();
          } catch (error) {
            console.error('削除エラー:', error);
            toast({
              title: 'エラー',
              description: 'キューからの削除に失敗しました。',
              variant: 'destructive',
            });
            return Promise.reject(error);
          }
        }
      },
      
      // 関連トラックの取得
      fetchRelatedTracks: async (forceRefresh = false) => {
        const { currentTrack, relatedTracks } = get();
        if (!currentTrack) return Promise.resolve();
        
        set({ isRelatedLoading: true });
        
        // ビデオIDを抽出
        const videoId = extractVideoId(currentTrack.url);
        if (!videoId) {
          set({ isRelatedLoading: false });
          return Promise.resolve();
        }
        
        // キャッシュをチェック (強制更新でなければ)
        if (!forceRefresh && relatedTracks.length > 0) {
          set({ isRelatedLoading: false });
          return Promise.resolve();
        }
        
        try {
          const tracks = await api.getRelatedSongs(videoId);
          set({ relatedTracks: tracks, isRelatedLoading: false });
          return Promise.resolve();
        } catch (error) {
          console.error('関連動画の取得中にエラーが発生しました:', error);
          toast({
            title: 'エラー',
            description: '関連動画の取得に失敗しました。',
            variant: 'destructive',
          });
          set({ isRelatedLoading: false });
          return Promise.reject(error);
        }
      },
      
      // 関連トラックの設定
      setRelatedTracks: (tracks) => set({ relatedTracks: tracks }),
      setIsRelatedLoading: (isLoading) => set({ isRelatedLoading: isLoading })
    }),
    {
      name: 'player-storage',
      partialize: (state) => ({
        volume: state.volume,
        isOnDeviceMode: state.isOnDeviceMode
      })
    }
  )
);

// URLからビデオIDを抽出するヘルパー関数
function extractVideoId(url: string): string | null {
  const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/)
  return match ? match[1] : null
}

// WebSocketを設定する関数
export function setupWebSocket(guildId: string) {
  // 既存の接続をクリーンアップ
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }
  
  // 新しい接続を作成
  const { createWebSocketConnection } = require('@/utils/websocket');
  wsConnection = createWebSocketConnection(
    guildId,
    (data: any) => {
      const playerStore = usePlayerStore.getState();
      
      const queueItems = data.queue || [];
      const current = queueItems.find((item: QueueItem) => item.isCurrent);
      
      playerStore.setCurrentTrack(current?.track || null);
      playerStore.setQueue(queueItems
        .filter((item: QueueItem) => !item.isCurrent)
        .map((item: QueueItem) => item.track));
      playerStore.setIsPlaying(data.is_playing);
      
      if (data.history) {
        playerStore.setHistory(data.history);
      }
    },
    {
      onError: () => {
        toast({
          title: "接続エラー",
          description: "サーバーとの接続が一時的に切断されました。自動的に再接続します。",
          variant: "destructive",
        });
      }
    }
  );
  
  return wsConnection;
}

// WebSocket接続をクリーンアップする関数
export function cleanupWebSocket() {
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }
}