// src/store/useGuildStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, Server, VoiceChannel } from '@/utils/api';
import { setActiveServerIdGetter } from './usePlayerStore';

interface GuildState {
  // サーバー情報
  mutualServers: Server[];
  inviteServers: Server[];
  activeServerId: string | null;
  activeChannelId: string | null;
  voiceChannels: VoiceChannel[];
  
  // 読み込み状態
  isLoadingServers: boolean;
  serversError: string | null;
  isLoadingChannels: boolean;
  
  // アクション
  setActiveServerId: (serverId: string | null) => void;
  setActiveChannelId: (channelId: string | null) => void;
  fetchMutualServers: () => Promise<void>;
  fetchVoiceChannels: (serverId: string) => Promise<void>;
  inviteBot: (serverId: string) => void;
  joinVoiceChannel: (serverId: string, channelId: string) => Promise<void>;
  disconnectVoiceChannel: (serverId: string) => Promise<void>;
  resetErrors: () => void;
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
      isLoadingServers: false,
      serversError: null,
      isLoadingChannels: false,
      
      // アクティブサーバーの設定
      setActiveServerId: (serverId) => {
        set({ activeServerId: serverId, activeChannelId: null });
        if (serverId) {
          get().fetchVoiceChannels(serverId);
        }
      },
      
      // アクティブチャンネルの設定
      setActiveChannelId: (channelId) => {
        set({ activeChannelId: channelId });
      },
      
      // サーバー一覧の取得
      fetchMutualServers: async () => {
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
          set({ activeChannelId: channelId });
          return Promise.resolve();
        } catch (error) {
          console.error('ボイスチャンネルへの参加に失敗しました:', error);
          return Promise.reject(error);
        }
      },
      
      // ボイスチャンネルから切断
      disconnectVoiceChannel: async (serverId) => {
        try {
          await api.disconnectVoiceChannel(serverId);
          set({ activeServerId: null, activeChannelId: null });
          return Promise.resolve();
        } catch (error) {
          console.error('ボイスチャンネルからの切断に失敗しました:', error);
          return Promise.reject(error);
        }
      },
      
      // エラーのリセット
      resetErrors: () => {
        set({ serversError: null });
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