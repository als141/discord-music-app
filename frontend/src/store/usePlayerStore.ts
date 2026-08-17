// src/store/usePlayerStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, Track, api, QueueItem, PlayableItem } from '@/utils/api';
import { toast } from '@/hooks/use-toast';
import { createWebSocketConnection, WebSocketData, WebSocketHandle } from '@/utils/websocket';

// アクティブなWebSocketコネクション
let wsConnection: WebSocketHandle | null = null;
// WebSocket が切れている間の REST フォールバックポーリング
let fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
const FALLBACK_POLL_INTERVAL_MS = 10000; // 切断中は10秒ごとに /player-state で同期
let currentGuildId: string | null = null;

// アクティブなサーバーIDを管理するためのシンプルなゲッター
let getActiveServerId: () => string | null = () => null;

// 外部からアクティブサーバーIDを取得するための関数を設定
export function setActiveServerIdGetter(getter: () => string | null) {
  getActiveServerId = getter;
}

// デバウンス用タイマー
let updateDebounceTimer: NodeJS.Timeout | null = null;
const UPDATE_DEBOUNCE_MS = 150; // 150msのデバウンス（バースト更新をまとめる）

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

  // プレイヤーUI状態
  isMainPlayerVisible: boolean;

  // 関連トラック
  relatedTracks: Track[];
  isRelatedLoading: boolean;

  // WebSocket接続状態（新規追加）
  connectionStatus: ConnectionStatus;
  lastSyncVersion: number;
  lastSyncTimestamp: number;
  /** サーバー側 MusicPlayer の世代ID。変わったら version 比較をリセットする */
  lastSyncEpoch: string | null;
  hasPendingOperation: boolean;

  // アクション
  setCurrentTrack: (track: Track | null) => void;
  setQueue: (queue: Track[]) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setIsLoading: (isLoading: boolean) => void;
  setHistory: (history: QueueItem[]) => void;
  setIsMainPlayerVisible: (isVisible: boolean) => void;

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

      isMainPlayerVisible: false,

      relatedTracks: [],
      isRelatedLoading: false,

      // WebSocket接続状態（新規追加）
      connectionStatus: 'disconnected' as ConnectionStatus,
      lastSyncVersion: 0,
      lastSyncTimestamp: 0,
      lastSyncEpoch: null,
      hasPendingOperation: false,

      // 基本的な状態更新アクション
      setCurrentTrack: (track) => set({ currentTrack: track }),
      setQueue: (queue) => set({ queue }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setIsLoading: (isLoading) => set({ isLoading }),
      setHistory: (history) => set({ history }),
      setIsMainPlayerVisible: (isVisible) => set({ isMainPlayerVisible: isVisible }),

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
      
      // 再生（楽観的更新 + ロールバック）
      play: async () => {
        const { isPlaying } = get();
        const activeServerId = getActiveServerId();

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
      },
      
      // 一時停止（楽観的更新 + ロールバック）
      pause: async () => {
        const { isPlaying } = get();
        const activeServerId = getActiveServerId();

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
      },
      
      // スキップ（楽観的更新 + ロールバック）
      skip: async () => {
        const { queue, currentTrack } = get();
        const activeServerId = getActiveServerId();

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
      },
      
      // 前の曲へ（機能削除 - バグのため）
      previous: async () => {
        // この機能はバグが多いため削除されました
        return Promise.resolve();
      },
      
      // キューに追加（楽観的更新）
      addToQueue: async (item, user) => {
        const { queue, currentTrack } = get();
        const activeServerId = getActiveServerId();

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
      },
      
      // キューの並べ替え（楽観的更新 + ロールバック）
      reorderQueue: async (startIndex, endIndex) => {
        const { queue } = get();
        const activeServerId = getActiveServerId();

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
      },
      
      // キューからの削除（楽観的更新 + ロールバック）
      removeFromQueue: async (index) => {
        const { queue } = get();
        const activeServerId = getActiveServerId();

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
      partialize: () => ({})
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

  currentGuildId = guildId;
  stopFallbackPolling();

  // 接続中状態に設定。ギルドが変わるので version/epoch はリセット
  playerStore.setConnectionStatus('connecting');
  usePlayerStore.setState({ lastSyncVersion: 0, lastSyncEpoch: null, hasPendingOperation: false });

  // 新しい接続を作成
  wsConnection = createWebSocketConnection(
    guildId,
    (data: WebSocketData) => {
      // デバウンス処理：短時間に複数の更新が来た場合は最後のものだけ適用
      if (updateDebounceTimer) {
        clearTimeout(updateDebounceTimer);
      }

      updateDebounceTimer = setTimeout(() => {
        applyServerState(data, 'websocket');
      }, UPDATE_DEBOUNCE_MS);
    },
    {
      onOpen: () => {
        const store = usePlayerStore.getState();
        store.setConnectionStatus('connected');
        stopFallbackPolling();
        // 接続直後にサーバーが初期状態を送ってくる。version 比較はそこでリセットされる（epoch 判定）
      },
      onClose: () => {
        const store = usePlayerStore.getState();
        // 意図的な切断でない場合は再接続中として表示し、REST ポーリングで補完
        if (store.connectionStatus !== 'disconnected') {
          store.setConnectionStatus('reconnecting');
        }
        startFallbackPolling(guildId);
      },
      onError: () => {
        // 詳細は onClose → 再接続に任せる。トーストは出さない（頻発すると邪魔）。
        // 接続状態はヘッダーのインジケータで表示する
      }
    }
  );

  return wsConnection;
}

/**
 * サーバーから受け取ったプレイヤー状態をストアに反映する（WebSocket / REST 共通）。
 *
 * バージョン管理:
 * - epoch（MusicPlayer の世代ID）が変わっていたら bot 再起動 / VC 再参加なので無条件に受け入れて version をリセット
 * - 同じ epoch で version が古い更新は無視
 * - 操作中（楽観的更新中）は、同じ epoch で version が進んでいない更新だけスキップ
 */
function applyServerState(data: WebSocketData, source: 'websocket' | 'rest') {
  const store = usePlayerStore.getState();

  const newVersion = data.version || 0;
  const newTimestamp = data.timestamp || Date.now();
  const newEpoch = (data.epoch as string | null | undefined) ?? null;
  const epochChanged = newEpoch !== store.lastSyncEpoch;

  if (!epochChanged) {
    // 操作中の場合は、進んでいない更新をスキップ（楽観的更新を維持）
    if (store.hasPendingOperation && newVersion <= store.lastSyncVersion) {
      return;
    }
    // 古いバージョンの更新は無視（同じ世代内のみ比較）
    if (newVersion > 0 && newVersion < store.lastSyncVersion) {
      return;
    }
    // REST ポーリングは WebSocket と競合しうるので、同じ version の再適用はしない
    if (source === 'rest' && newVersion > 0 && newVersion === store.lastSyncVersion) {
      return;
    }
  }

  // 状態を一括更新（1回のset()で全フィールドを更新し、再レンダリングを最小化）
  const queueItems = data.queue || [];
  // @ts-expect-error - Type compatibility issues with queue items
  const current = queueItems.find((item: { isCurrent: boolean }) => item.isCurrent);

  const batchUpdate: Record<string, unknown> = {
    // @ts-expect-error - Type compatibility issues with track data
    currentTrack: current?.track || null,
    // @ts-expect-error - Type compatibility issues with queue items
    queue: queueItems.filter((item: { isCurrent: boolean }) => !item.isCurrent).map((item: { track: Track }) => item.track),
    isPlaying: !!data.is_playing,
    lastSyncVersion: newVersion,
    lastSyncTimestamp: newTimestamp,
    lastSyncEpoch: newEpoch,
  };

  if (data.history) {
    batchUpdate.history = data.history;
  }

  if (store.hasPendingOperation) {
    batchUpdate.hasPendingOperation = false;
    if (pendingOperationTimeoutTimer) {
      clearTimeout(pendingOperationTimeoutTimer);
      pendingOperationTimeoutTimer = null;
    }
  }

  usePlayerStore.setState(batchUpdate);
}

/** WebSocket が切れている間、タブが見えているときだけ REST で状態を取りに行く */
function startFallbackPolling(guildId: string) {
  if (fallbackPollTimer) return;
  const poll = async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (currentGuildId !== guildId) return;
    if (wsConnection?.isOpen()) { stopFallbackPolling(); return; }
    try {
      const state = await api.getPlayerState(guildId);
      if (state && currentGuildId === guildId && !wsConnection?.isOpen()) {
        applyServerState(state, 'rest');
      }
    } catch {
      // ネットワーク断など。次回に任せる
    }
  };
  fallbackPollTimer = setInterval(poll, FALLBACK_POLL_INTERVAL_MS);
}

function stopFallbackPolling() {
  if (fallbackPollTimer) {
    clearInterval(fallbackPollTimer);
    fallbackPollTimer = null;
  }
}

/** 手動で状態の再同期を要求する（プルリフレッシュ等） */
export function requestPlayerSync() {
  if (wsConnection?.isOpen()) {
    wsConnection.requestSync();
  } else if (currentGuildId) {
    api.getPlayerState(currentGuildId).then((state) => { if (state) applyServerState(state, 'rest'); }).catch(() => {});
  }
}

// WebSocket接続をクリーンアップする関数
export function cleanupWebSocket() {
  currentGuildId = null;
  stopFallbackPolling();
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