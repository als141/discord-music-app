// src/store/usePlayerStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, Track, api, QueueItem, PlayableItem } from '@/utils/api';
import { toast } from '@/hooks/use-toast';
import { createWebSocketConnection, WebSocketData } from '@/utils/websocket';
import React from 'react';

// アクティブなWebSocketコネクション
let wsConnection: { close: () => void } | null = null;

// アクティブなサーバーIDを管理するためのシンプルなゲッター
let getActiveServerId: () => string | null = () => null;

// 外部からアクティブサーバーIDを取得するための関数を設定
export function setActiveServerIdGetter(getter: () => string | null) {
  getActiveServerId = getter;
}

// デバウンス用タイマー
let updateDebounceTimer: NodeJS.Timeout | null = null;
const UPDATE_DEBOUNCE_MS = 50; // 50msのデバウンス

// 操作タイムアウト用タイマー（安全機構）
let pendingOperationTimeoutTimer: NodeJS.Timeout | null = null;
const PENDING_OPERATION_TIMEOUT_MS = 10000; // 10秒後に操作中フラグを強制リセット

// 操作中フラグを安全にリセットするためのタイムアウトを設定
function setPendingOperationWithTimeout() {
  // 既存のタイムアウトをクリア
  if (pendingOperationTimeoutTimer) {
    clearTimeout(pendingOperationTimeoutTimer);
  }

  // 新しいタイムアウトを設定
  pendingOperationTimeoutTimer = setTimeout(() => {
    const store = usePlayerStore.getState();
    if (store.hasPendingOperation) {
      console.warn('[WebSocket] 操作タイムアウト: 操作中フラグを強制リセット');
      store.setPendingOperation(false);
    }
  }, PENDING_OPERATION_TIMEOUT_MS);
}

// 接続状態の型定義
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

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
  audioRef: React.RefObject<HTMLAudioElement | null>;

  // WebSocket接続状態（新規追加）
  connectionStatus: ConnectionStatus;
  lastSyncVersion: number;
  lastSyncTimestamp: number;
  hasPendingOperation: boolean;

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

  // 接続状態アクション（新規追加）
  setConnectionStatus: (status: ConnectionStatus) => void;
  setSyncInfo: (version: number, timestamp: number) => void;
  setPendingOperation: (pending: boolean) => void;

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

      // WebSocket接続状態（新規追加）
      connectionStatus: 'disconnected' as ConnectionStatus,
      lastSyncVersion: 0,
      lastSyncTimestamp: 0,
      hasPendingOperation: false,

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

      // 接続状態アクション（新規追加）
      setConnectionStatus: (status) => set({ connectionStatus: status }),
      setSyncInfo: (version, timestamp) => set({
        lastSyncVersion: version,
        lastSyncTimestamp: timestamp
      }),
      setPendingOperation: (pending) => {
        set({ hasPendingOperation: pending });
        if (pending) {
          // 操作中フラグが設定されたらタイムアウトを開始
          setPendingOperationWithTimeout();
        } else {
          // フラグがリセットされたらタイムアウトをクリア
          if (pendingOperationTimeoutTimer) {
            clearTimeout(pendingOperationTimeoutTimer);
            pendingOperationTimeoutTimer = null;
          }
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
      
      // 再生（楽観的更新 + ロールバック）
      play: async () => {
        const { isOnDeviceMode, audioRef, isPlaying } = get();
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

          // 前の状態を保存
          const previousIsPlaying = isPlaying;

          try {
            // 楽観的更新 + タイムアウト設定
            set({ isPlaying: true, hasPendingOperation: true });
            setPendingOperationWithTimeout();

            await api.resumePlayback(activeServerId);
            // 成功したらWebSocket更新で最終状態が来る
            return Promise.resolve();
          } catch (error) {
            console.error('再生開始エラー:', error);

            // エラー時はロールバック + タイムアウトクリア
            if (pendingOperationTimeoutTimer) {
              clearTimeout(pendingOperationTimeoutTimer);
              pendingOperationTimeoutTimer = null;
            }
            set({ isPlaying: previousIsPlaying, hasPendingOperation: false });

            toast({
              title: 'エラー',
              description: '再生の開始に失敗しました。',
              variant: 'destructive',
            });
            return Promise.reject(error);
          }
        }
      },
      
      // 一時停止（楽観的更新 + ロールバック）
      pause: async () => {
        const { isOnDeviceMode, audioRef, isPlaying } = get();
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

          // 前の状態を保存
          const previousIsPlaying = isPlaying;

          try {
            // 楽観的更新 + タイムアウト設定
            set({ isPlaying: false, hasPendingOperation: true });
            setPendingOperationWithTimeout();

            await api.pausePlayback(activeServerId);
            // 成功したらWebSocket更新で最終状態が来る
            return Promise.resolve();
          } catch (error) {
            console.error('一時停止エラー:', error);

            // エラー時はロールバック + タイムアウトクリア
            if (pendingOperationTimeoutTimer) {
              clearTimeout(pendingOperationTimeoutTimer);
              pendingOperationTimeoutTimer = null;
            }
            set({ isPlaying: previousIsPlaying, hasPendingOperation: false });

            toast({
              title: 'エラー',
              description: '再生の一時停止に失敗しました。',
              variant: 'destructive',
            });
            return Promise.reject(error);
          }
        }
      },
      
      // スキップ（楽観的更新 + ロールバック）
      skip: async () => {
        const { isOnDeviceMode, deviceQueue, queue, currentTrack } = get();
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

          // 前の状態を保存（ロールバック用）
          const previousCurrentTrack = currentTrack;
          const previousQueue = [...queue];

          try {
            // 楽観的更新を適用 + タイムアウト設定
            if (queue.length > 0) {
              const nextTrack = queue[0];
              const newQueue = queue.slice(1);
              set({
                currentTrack: nextTrack,
                queue: newQueue,
                hasPendingOperation: true
              });
            } else {
              set({
                currentTrack: null,
                isPlaying: false,
                hasPendingOperation: true
              });
            }
            setPendingOperationWithTimeout();

            await api.skipTrack(activeServerId);
            // 成功したらWebSocket更新で最終状態が来る
            return Promise.resolve();
          } catch (error) {
            console.error('スキップエラー:', error);

            // エラー時はロールバック + タイムアウトクリア
            if (pendingOperationTimeoutTimer) {
              clearTimeout(pendingOperationTimeoutTimer);
              pendingOperationTimeoutTimer = null;
            }
            set({
              currentTrack: previousCurrentTrack,
              queue: previousQueue,
              hasPendingOperation: false
            });

            toast({
              title: 'エラー',
              description: 'スキップに失敗しました。',
              variant: 'destructive',
            });
            return Promise.reject(error);
          }
        }
      },
      
      // 前の曲へ（機能削除 - バグのため）
      previous: async () => {
        // この機能はバグが多いため削除されました
        return Promise.resolve();
      },
      
      // キューに追加（楽観的更新）
      addToQueue: async (item, user) => {
        const { isOnDeviceMode, deviceCurrentTrack, deviceQueue, queue, currentTrack } = get();
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

          // 前の状態を保存（ロールバック用）
          const previousQueue = [...queue];
          const previousCurrentTrack = currentTrack;

          try {
            set({ isLoading: true });

            // 楽観的更新を適用 + タイムアウト設定
            // 現在トラックがない場合は追加したものが現在のトラックになる可能性がある
            if (!currentTrack) {
              set({
                currentTrack: item as Track,
                isMainPlayerVisible: true,
                hasPendingOperation: true
              });
            } else {
              // キューの末尾に追加
              set({
                queue: [...queue, item as Track],
                hasPendingOperation: true
              });
            }
            setPendingOperationWithTimeout();

            await api.addUrl(activeServerId, item.url, user || null);

            toast({
              title: '成功',
              description: `"${item.title}" をキューに追加しました。`,
            });
            set({ isLoading: false });
            // 成功したらWebSocket更新で最終状態が来る
            return Promise.resolve();
          } catch (error) {
            console.error('追加エラー:', error);

            // エラー時はロールバック + タイムアウトクリア
            if (pendingOperationTimeoutTimer) {
              clearTimeout(pendingOperationTimeoutTimer);
              pendingOperationTimeoutTimer = null;
            }
            set({
              queue: previousQueue,
              currentTrack: previousCurrentTrack,
              isLoading: false,
              hasPendingOperation: false
            });

            toast({
              title: 'エラー',
              description: 'キューへの追加に失敗しました。',
              variant: 'destructive',
            });
            return Promise.reject(error);
          }
        }
      },
      
      // キューの並べ替え（楽観的更新 + ロールバック）
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

          // 前の状態を保存（ロールバック用）
          const previousQueue = [...queue];

          try {
            // 楽観的更新を適用 + タイムアウト設定
            const newQueue = Array.from(queue);
            const [movedItem] = newQueue.splice(startIndex, 1);
            newQueue.splice(endIndex, 0, movedItem);

            // 操作中フラグを設定し、楽観的更新を適用
            set({
              queue: newQueue,
              hasPendingOperation: true
            });
            setPendingOperationWithTimeout();

            await api.reorderQueue(activeServerId, startIndex + 1, endIndex + 1);

            // 成功したら操作中フラグをリセット（WebSocket更新で最終状態が来る）
            return Promise.resolve();
          } catch (error) {
            console.error('並べ替えエラー:', error);

            // エラー時はロールバック + タイムアウトクリア
            if (pendingOperationTimeoutTimer) {
              clearTimeout(pendingOperationTimeoutTimer);
              pendingOperationTimeoutTimer = null;
            }
            set({
              queue: previousQueue,
              hasPendingOperation: false
            });

            toast({
              title: 'エラー',
              description: 'キューの並び替えに失敗しました。',
              variant: 'destructive',
            });
            return Promise.reject(error);
          }
        }
      },
      
      // キューからの削除（楽観的更新 + ロールバック）
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

          // 前の状態を保存（ロールバック用）
          const previousQueue = [...queue];
          const removedTrack = queue[index];

          try {
            // 楽観的更新を適用 + タイムアウト設定
            const updatedQueue = [...queue];
            updatedQueue.splice(index, 1);

            // 操作中フラグを設定し、楽観的更新を適用
            set({
              queue: updatedQueue,
              hasPendingOperation: true
            });
            setPendingOperationWithTimeout();

            await api.removeFromQueue(activeServerId, index);

            toast({
              title: '成功',
              description: 'キューから曲を削除しました。',
            });

            // 成功したら操作中フラグをリセット（WebSocket更新で最終状態が来る）
            return Promise.resolve();
          } catch (error) {
            console.error('削除エラー:', error);

            // エラー時はロールバック + タイムアウトクリア
            if (pendingOperationTimeoutTimer) {
              clearTimeout(pendingOperationTimeoutTimer);
              pendingOperationTimeoutTimer = null;
            }
            set({
              queue: previousQueue,
              hasPendingOperation: false
            });

            toast({
              title: 'エラー',
              description: `"${removedTrack?.title || '曲'}"の削除に失敗しました。`,
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
  const playerStore = usePlayerStore.getState();

  // 既存の接続をクリーンアップ
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }

  // デバウンスタイマーをクリア
  if (updateDebounceTimer) {
    clearTimeout(updateDebounceTimer);
    updateDebounceTimer = null;
  }

  // 接続中状態に設定
  playerStore.setConnectionStatus('connecting');

  // 新しい接続を作成
  wsConnection = createWebSocketConnection(
    guildId,
    (data: WebSocketData) => {
      // デバウンス処理：短時間に複数の更新が来た場合は最後のものだけ適用
      if (updateDebounceTimer) {
        clearTimeout(updateDebounceTimer);
      }

      updateDebounceTimer = setTimeout(() => {
        const store = usePlayerStore.getState();

        // バージョンチェック：古い更新は無視
        const newVersion = data.version || 0;
        const newTimestamp = data.timestamp || Date.now();

        // 操作中の場合は更新をスキップ（楽観的更新を維持）
        if (store.hasPendingOperation && newVersion <= store.lastSyncVersion) {
          console.log('[WebSocket] 操作中のため更新をスキップ:', {
            newVersion,
            currentVersion: store.lastSyncVersion
          });
          return;
        }

        // 古いバージョンの更新は無視
        if (newVersion > 0 && newVersion < store.lastSyncVersion) {
          console.log('[WebSocket] 古いバージョンの更新を無視:', {
            newVersion,
            currentVersion: store.lastSyncVersion
          });
          return;
        }

        // 状態を更新
        const queueItems = data.queue || [];
        // @ts-expect-error - Type compatibility issues with queue items
        const current = queueItems.find((item) => item.isCurrent);

        // @ts-expect-error - Type compatibility issues with track data
        store.setCurrentTrack(current?.track || null);
        store.setQueue(
          // @ts-expect-error - Type compatibility issues with queue items
          queueItems.filter((item) => !item.isCurrent).map((item) => item.track)
        );
        store.setIsPlaying(!!data.is_playing);

        if (data.history) {
          // @ts-expect-error - Type compatibility issues with history data
          store.setHistory(data.history);
        }

        // 同期情報を更新
        store.setSyncInfo(newVersion, newTimestamp);

        // 操作完了フラグをリセット
        if (store.hasPendingOperation) {
          store.setPendingOperation(false);
        }
      }, UPDATE_DEBOUNCE_MS);
    },
    {
      onOpen: () => {
        const store = usePlayerStore.getState();
        store.setConnectionStatus('connected');
      },
      onClose: () => {
        const store = usePlayerStore.getState();
        // 意図的な切断でない場合は再接続中として表示
        if (store.connectionStatus === 'connected') {
          store.setConnectionStatus('reconnecting');
        }
      },
      onError: () => {
        const store = usePlayerStore.getState();
        store.setConnectionStatus('error');
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
  // デバウンスタイマーをクリア
  if (updateDebounceTimer) {
    clearTimeout(updateDebounceTimer);
    updateDebounceTimer = null;
  }

  // 操作タイムアウトタイマーをクリア
  if (pendingOperationTimeoutTimer) {
    clearTimeout(pendingOperationTimeoutTimer);
    pendingOperationTimeoutTimer = null;
  }

  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }

  // 接続状態をリセット
  const store = usePlayerStore.getState();
  store.setConnectionStatus('disconnected');
  store.setPendingOperation(false);
}