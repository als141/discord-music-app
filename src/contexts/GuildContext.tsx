// GuildContext.tsx
'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { api } from '@/utils/api';
import { Server } from '@/utils/api';
import { useSession } from 'next-auth/react';

interface GuildContextType {
  mutualServers: Server[];
  inviteServers: Server[];
}

const GuildContext = createContext<GuildContextType>({
  mutualServers: [],
  inviteServers: [],
});

export const useGuilds = () => useContext(GuildContext);

export const GuildProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: session } = useSession();
  const [mutualServers, setMutualServers] = useState<Server[]>([]);
  const [inviteServers, setInviteServers] = useState<Server[]>([]);
  const guildsFetched = useRef<boolean>(false);

  useEffect(() => {
    const fetchGuilds = async () => {
      if (session && !guildsFetched.current) {
        try {
          // ボットが参加しているサーバーを取得
          const botGuilds = await api.getBotGuilds(); // `/servers` エンドポイントを使用
          const botGuildIds = new Set(botGuilds.map((guild) => guild.id));

          // ユーザーが参加しているサーバーを取得（サーバーサイドの API 経由）
          const userGuildsResponse = await fetch('/api/discord/userGuilds');

          if (!userGuildsResponse.ok) {
            throw new Error('Failed to fetch user guilds');
          }

          const userGuildsData = await userGuildsResponse.json();

          // 共通のサーバーと招待可能なサーバーを分類
          const mutualGuilds = userGuildsData.filter((guild: Server) => botGuildIds.has(guild.id));
          const guildsWithManageServer = userGuildsData.filter((guild: Server) => {
            if (!guild.permissions) {
              return false;
            }
            // permissionsをBigIntに変換
            const permissions = BigInt(guild.permissions);
            const MANAGE_GUILD = BigInt(0x20); // 'サーバーを管理'の権限ビット
            return (permissions & MANAGE_GUILD) === MANAGE_GUILD;
          });
          const inviteGuilds = guildsWithManageServer.filter((guild: Server) => !botGuildIds.has(guild.id));

          setMutualServers(mutualGuilds);
          setInviteServers(inviteGuilds);
          guildsFetched.current = true;
        } catch (error) {
          console.error('Failed to fetch guilds:', error);
        }
      }
    };

    fetchGuilds();
  }, [session]);

  return (
    <GuildContext.Provider value={{ mutualServers, inviteServers }}>
      {children}
    </GuildContext.Provider>
  );
};