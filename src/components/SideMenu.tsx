import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Server, Mic, ChevronRight, X } from 'lucide-react';
import { Server as ServerType, VoiceChannel } from '@/utils/api';
import { useSwipeable } from 'react-swipeable';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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

const truncateString = (str: string, maxLength: number) => {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
};

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
  const menuRef = useRef<HTMLDivElement>(null);

  const swipeHandlers = useSwipeable({
    onSwipedLeft: onClose,
    trackMouse: true
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  const menuVariants = {
    open: { x: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } },
    closed: { x: '-100%', transition: { type: 'spring', stiffness: 300, damping: 30 } },
  };

  const overlayVariants = {
    open: { opacity: 1 },
    closed: { opacity: 0 },
  };

  return (
    <>
      <motion.div
        initial="closed"
        animate={isOpen ? "open" : "closed"}
        exit="closed"
        variants={overlayVariants}
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
        style={{ display: isOpen ? "block" : "none" }}
      />
      <motion.div
        className="fixed inset-y-0 left-0 w-64 bg-background text-foreground z-50 overflow-y-auto"
        initial="closed"
        animate={isOpen ? "open" : "closed"}
        exit="closed"
        variants={menuVariants}
        {...swipeHandlers}
      >
        <div className="p-4 flex justify-between items-center">
          <h2 className="text-xl font-bold">設定</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={24} />
          </Button>
        </div>
        <div className="p-4 space-y-6">
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center">
              <Server size={20} className="mr-2" /> サーバー
            </h3>
            <ul className="space-y-2">
              {servers.map((server) => (
                <motion.li key={server.id} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => onSelectServer(server.id)}
                          variant={activeServerId === server.id ? "secondary" : "ghost"}
                          className="w-full justify-start"
                        >
                          <span className="truncate">{truncateString(server.name, 20)}</span>
                          {activeServerId === server.id && <ChevronRight size={20} className="ml-auto flex-shrink-0" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{server.name}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </motion.li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center">
              <Mic size={20} className="mr-2" /> ボイスチャンネル
            </h3>
            <ul className="space-y-2">
              {voiceChannels.map((channel) => (
                <motion.li key={channel.id} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => onSelectChannel(channel.id)}
                          variant={activeChannelId === channel.id ? "secondary" : "ghost"}
                          className="w-full justify-start"
                        >
                          <span className="truncate">{truncateString(channel.name, 20)}</span>
                          {activeChannelId === channel.id && <ChevronRight size={20} className="ml-auto flex-shrink-0" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{channel.name}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </motion.li>
              ))}
            </ul>
          </div>
        </div>
      </motion.div>
    </>
  );
};