'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Server, Mic, X } from 'lucide-react';
import { Server as ServerType, VoiceChannel } from '@/utils/api';

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  servers: ServerType[];
  activeServerId: string | null;
  onSelectServer: (serverId: string) => void;
  voiceChannels: VoiceChannel[];
  activeChannelId: string | null;
  onSelectChannel: (channelId: string) => void;
}

export const SideMenu: React.FC<SideMenuProps> = ({
  isOpen,
  onClose,
  servers,
  activeServerId,
  onSelectServer,
  voiceChannels,
  activeChannelId,
  onSelectChannel,
}) => {
  return (
    <motion.div
      className="fixed inset-y-0 left-0 w-64 bg-gray-900 text-white z-50 overflow-y-auto"
      initial={{ x: '-100%' }}
      animate={{ x: isOpen ? 0 : '-100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
    >
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <h2 className="text-xl font-bold">設定</h2>
        <button onClick={onClose} className="p-1">
          <X size={24} />
        </button>
      </div>
      <div className="p-4">
        <h3 className="text-lg font-semibold mb-2 flex items-center">
          <Server size={20} className="mr-2" /> サーバー
        </h3>
        <ul className="space-y-2 mb-6">
          {servers.map((server) => (
            <li key={server.id}>
              <button
                onClick={() => onSelectServer(server.id)}
                className={`w-full text-left p-2 rounded ${
                  activeServerId === server.id ? 'bg-blue-500' : 'hover:bg-gray-800'
                }`}
              >
                {server.name}
              </button>
            </li>
          ))}
        </ul>
        <h3 className="text-lg font-semibold mb-2 flex items-center">
          <Mic size={20} className="mr-2" /> ボイスチャンネル
        </h3>
        <ul className="space-y-2">
          {voiceChannels.map((channel) => (
            <li key={channel.id}>
              <button
                onClick={() => onSelectChannel(channel.id)}
                className={`w-full text-left p-2 rounded ${
                  activeChannelId === channel.id ? 'bg-green-500' : 'hover:bg-gray-800'
                }`}
              >
                {channel.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
};