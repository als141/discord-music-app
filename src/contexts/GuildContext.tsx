// GuildContext.tsx
'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '@/utils/api';
import { Server } from '@/utils/api';
import { useSession } from 'next-auth/react';

interface GuildContextType {
  botServers: Server[];
}

const GuildContext = createContext<GuildContextType>({
  botServers: [],
});

export const useGuilds = () => useContext(GuildContext);

export const GuildProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: session } = useSession();
  const [botServers, setBotServers] = useState<Server[]>([]);
  const [guildsFetched, setGuildsFetched] = useState<boolean>(false);

  useEffect(() => {
    const fetchGuilds = async () => {
      if (session && !guildsFetched) {
        try {
          const botGuilds = await api.getBotGuilds(); // `/servers` エンドポイントを使用

          setBotServers(botGuilds);
          setGuildsFetched(true);
        } catch (error) {
          console.error('Failed to fetch guilds:', error);
        }
      }
    };

    fetchGuilds();
  }, [session]);

  return (
    <GuildContext.Provider value={{ botServers }}>
      {children}
    </GuildContext.Provider>
  );
};
