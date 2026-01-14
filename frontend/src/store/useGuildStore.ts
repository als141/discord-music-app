// src/store/useGuildStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, Server, VoiceChannel } from '@/utils/api';
import { setActiveServerIdGetter } from './usePlayerStore';

const MIN_SERVER_FETCH_INTERVAL_MS = 15000;
let mutualServersRequest: Promise<void> | null = null;
let lastServersFetchAt = 0;

// ボイスステータスポーリング用タイマー
let voiceStatusPollingTimer: NodeJS.Timeout | null = null;
const VOICE_STATUS_POLLING_INTERVAL_MS = 10000; // 10秒間隔でポーリング

interface GuildState {
  // サーバー情報
  mutualServers: Server[];
  inviteServers: Server[];
  activeServerId: string | null;
  activeChannelId: string | null;
  voiceChannels: VoiceChannel[];

  // ボットの実際のボイスチャンネル状態
  botVoiceChannelId: string | null;
  isBotConnected: boolean;

  // 自動接続状態
  hasCheckedAutoConnect: boolean;
  isAutoConnecting: boolean;

  // 読み込み状態
  isLoadingServers: boolean;
  serversError: string | null;
  isLoadingChannels: boolean;
  isLoadingBotStatus: boolean;

  // アクション
  setActiveServerId: (serverId: string | null) => void;
  setActiveChannelId: (channelId: string | null) => void;
  fetchMutualServers: (force?: boolean) => Promise<void>;
  fetchVoiceChannels: (serverId: string) => Promise<void>;
  fetchBotVoiceStatus: (serverId: string) => Promise<void>;
  startVoiceStatusPolling: (serverId: string) => void;
  stopVoiceStatusPolling: () => void;
  inviteBot: (serverId: string) => void;
  joinVoiceChannel: (serverId: string, channelId: string) => Promise<void>;
  disconnectVoiceChannel: (serverId: string) => Promise<void>;
  resetErrors: () => void;
  // 自動接続: ユーザーがボットと同じVCにいる場合、自動的にそのサーバー/チャンネルをアクティブ化
  checkAutoConnect: (userId: string) => Promise<boolean>;
  resetAutoConnectCheck: () => void;
}

// 永続化対応のGuildストア
export const useGuildStore = create<GuildState>()(
  persist(
    (set, get) => ({
      // 初期状態
      mutualServers: [],
      inviteServers: [],
      activeServerId: null,
      activeChannelId: null,
      voiceChannels: [],

      // ボットの実際のボイスチャンネル状態
      botVoiceChannelId: null,
      isBotConnected: false,

      // 自動接続状態
      hasCheckedAutoConnect: false,
      isAutoConnecting: false,

      isLoadingServers: false,
      serversError: null,
      isLoadingChannels: false,
      isLoadingBotStatus: false,

      // アクティブサーバーの設定
      setActiveServerId: (serverId) => {
        // 前のサーバーのポーリングを停止
        get().stopVoiceStatusPolling();

        set({
          activeServerId: serverId,
          activeChannelId: null,
          botVoiceChannelId: null,
          isBotConnected: false
        });

        if (serverId) {
          // ボイスチャンネル一覧を取得
          get().fetchVoiceChannels(serverId);
          // ボットのボイスステータスを取得
          get().fetchBotVoiceStatus(serverId);
          // ポーリングを開始
          get().startVoiceStatusPolling(serverId);
        }
      },
      
      // アクティブチャンネルの設定
      setActiveChannelId: (channelId) => {
        set({ activeChannelId: channelId });
      },
      
      // サーバー一覧の取得
      fetchMutualServers: async (force = false) => {
        const now = Date.now();
        if (mutualServersRequest) {
          return mutualServersRequest;
        }
        if (!force && lastServersFetchAt && now - lastServersFetchAt < MIN_SERVER_FETCH_INTERVAL_MS) {
          return;
        }

        mutualServersRequest = (async () => {
          try {
            set({ isLoadingServers: true, serversError: null });

            // ボットが参加しているサーバーを取得
            const botGuilds = await api.getBotGuilds();
            const botGuildIds = new Set(botGuilds.map((guild) => guild.id));

            // ユーザーが参加しているサーバーを取得
            const userGuildsResponse = await fetch('/api/discord/userGuilds');

            if (!userGuildsResponse.ok) {
              throw new Error('ユーザーのサーバー一覧の取得に失敗しました');
            }

            const userGuildsData = await userGuildsResponse.json();

            // 共通のサーバーと招待可能なサーバーを分類
            const mutualGuilds = userGuildsData.filter((guild: Server) => botGuildIds.has(guild.id));

            const guildsWithManageServer = userGuildsData.filter((guild: Server) => {
              if (!guild.permissions) return false;
              const permissions = BigInt(guild.permissions);
              const MANAGE_GUILD = BigInt(0x20); // 'サーバーを管理'の権限ビット
              return (permissions & MANAGE_GUILD) === MANAGE_GUILD;
            });

            const inviteGuilds = guildsWithManageServer.filter((guild: Server) => !botGuildIds.has(guild.id));

            set({
              mutualServers: mutualGuilds,
              inviteServers: inviteGuilds,
              isLoadingServers: false
            });
          } catch (error) {
            console.error('サーバー一覧の取得中にエラーが発生しました:', error);
            set({
              isLoadingServers: false,
              serversError: error instanceof Error ? error.message : '不明なエラーが発生しました'
            });
          } finally {
            lastServersFetchAt = Date.now();
          }
        })();

        try {
          await mutualServersRequest;
        } finally {
          mutualServersRequest = null;
        }
      },
      
      // ボイスチャンネル一覧の取得
      fetchVoiceChannels: async (serverId) => {
        try {
          set({ isLoadingChannels: true });
          const channels = await api.getVoiceChannels(serverId);
          set({ voiceChannels: channels, isLoadingChannels: false });
        } catch (error) {
          console.error('ボイスチャンネルの取得中にエラーが発生しました:', error);
          set({ isLoadingChannels: false });
        }
      },

      // ボットのボイスチャンネル状態を取得
      fetchBotVoiceStatus: async (serverId) => {
        try {
          set({ isLoadingBotStatus: true });
          const channelId = await api.getBotVoiceStatus(serverId);

          set({
            botVoiceChannelId: channelId,
            isBotConnected: channelId !== null,
            activeChannelId: channelId, // 実際のボットの状態と同期
            isLoadingBotStatus: false
          });
        } catch (error) {
          console.error('ボットのボイスステータス取得中にエラーが発生しました:', error);
          set({
            botVoiceChannelId: null,
            isBotConnected: false,
            isLoadingBotStatus: false
          });
        }
      },

      // ボイスステータスのポーリングを開始
      startVoiceStatusPolling: (serverId) => {
        // 既存のポーリングを停止
        if (voiceStatusPollingTimer) {
          clearInterval(voiceStatusPollingTimer);
        }

        // 定期的にボイスステータスをチェック
        voiceStatusPollingTimer = setInterval(() => {
          const currentServerId = get().activeServerId;
          if (currentServerId === serverId) {
            get().fetchBotVoiceStatus(serverId);
          } else {
            // サーバーが変わった場合はポーリングを停止
            get().stopVoiceStatusPolling();
          }
        }, VOICE_STATUS_POLLING_INTERVAL_MS);
      },

      // ボイスステータスのポーリングを停止
      stopVoiceStatusPolling: () => {
        if (voiceStatusPollingTimer) {
          clearInterval(voiceStatusPollingTimer);
          voiceStatusPollingTimer = null;
        }
      },

      // ボットを招待
      inviteBot: (serverId) => {
        const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
        const permissions = '8';
        const scopes = 'bot';
        
        if (!clientId) {
          console.error('Discord Client IDが設定されていません');
          return;
        }
        
        const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=${scopes}&permissions=${permissions}&guild_id=${serverId}`;
        window.open(inviteUrl, '_blank');
      },
      
      // ボイスチャンネルに参加
      joinVoiceChannel: async (serverId, channelId) => {
        try {
          await api.joinVoiceChannel(serverId, channelId);
          // 参加成功後、ボット状態を更新
          set({
            activeChannelId: channelId,
            botVoiceChannelId: channelId,
            isBotConnected: true
          });
          return Promise.resolve();
        } catch (error) {
          console.error('ボイスチャンネルへの参加に失敗しました:', error);
          return Promise.reject(error);
        }
      },

      // ボイスチャンネルから切断
      disconnectVoiceChannel: async (serverId) => {
        // ポーリングを停止
        get().stopVoiceStatusPolling();

        try {
          await api.disconnectVoiceChannel(serverId);
          // 切断成功後、状態をリセット
          set({
            activeServerId: null,
            activeChannelId: null,
            botVoiceChannelId: null,
            isBotConnected: false,
            voiceChannels: []
          });
          return Promise.resolve();
        } catch (error) {
          console.error('ボイスチャンネルからの切断に失敗しました:', error);
          return Promise.reject(error);
        }
      },
      
      // エラーのリセット
      resetErrors: () => {
        set({ serversError: null });
      },

      // 自動接続チェック
      // ユーザーがボットと同じVCにいる場合、そのサーバー/チャンネルを自動的にアクティブ化する
      checkAutoConnect: async (userId: string) => {
        // 既にチェック済み or チェック中の場合はスキップ
        if (get().hasCheckedAutoConnect || get().isAutoConnecting) {
          return false;
        }

        set({ isAutoConnecting: true });

        try {
          // バックエンドから自動接続情報を取得
          const { guildId, channelId } = await api.getAutoConnectInfo(userId);

          if (guildId && channelId) {
            console.log(`自動接続: ユーザーがボットと同じVCにいます (guild: ${guildId}, channel: ${channelId})`);

            // サーバーとチャンネルをアクティブ化
            // setActiveServerIdを直接呼ぶと初期化処理が走るので、直接stateを設定
            set({
              activeServerId: guildId,
              activeChannelId: channelId,
              botVoiceChannelId: channelId,
              isBotConnected: true,
              hasCheckedAutoConnect: true,
              isAutoConnecting: false
            });

            // ボイスチャンネル一覧を取得
            get().fetchVoiceChannels(guildId);
            // ポーリングを開始
            get().startVoiceStatusPolling(guildId);

            return true;
          }

          set({ hasCheckedAutoConnect: true, isAutoConnecting: false });
          return false;
        } catch (error) {
          console.error('自動接続チェック中にエラーが発生しました:', error);
          set({ hasCheckedAutoConnect: true, isAutoConnecting: false });
          return false;
        }
      },

      // 自動接続チェックをリセット（ログアウト時などに使用）
      resetAutoConnectCheck: () => {
        set({ hasCheckedAutoConnect: false, isAutoConnecting: false });
      }
    }),
    {
      name: 'guild-storage', // ローカルストレージのキー
      partialize: (state) => ({
        activeServerId: state.activeServerId,
        activeChannelId: state.activeChannelId,
      }), // 永続化する状態を限定
    }
  )
);

// Player storeにアクティブサーバーIDの取得関数を登録
setActiveServerIdGetter(() => useGuildStore.getState().activeServerId);
