// GuildContext.tsx
'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { Server } from '@/utils/api';
import { useGuildStore } from '@/store/useGuildStore';

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
  const { mutualServers, inviteServers } = useGuildStore();
  const value = useMemo(
    () => ({ mutualServers, inviteServers }),
    [mutualServers, inviteServers]
  );

  return (
    <GuildContext.Provider value={value}>
      {children}
    </GuildContext.Provider>
  );
};
