'use client';

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Server, Mic, X, ChevronRight } from 'lucide-react';
import { Server as ServerType, VoiceChannel } from '@/utils/api';
import { useMediaQuery } from 'usehooks-ts';
import { cn } from "@/lib/utils";
import { useSwipeable } from 'react-swipeable';
import { Button } from '@/components/ui/button';

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
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const menuRef = useRef<HTMLDivElement>(null);

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => onClose(),
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
    open: { 
      x: 0,
      transition: { 
        type: 'spring', 
        stiffness: 400, 
        damping: 30,
        duration: 0.2,
        when: "beforeChildren",
        staggerChildren: 0.02
      }
    },
    closed: { 
      x: '-100%',
      transition: { 
        type: 'spring', 
        stiffness: 400, 
        damping: 30,
        duration: 0.2,
        when: "afterChildren",
        staggerChildren: 0.01,
        staggerDirection: -1
      }
    },
  };

  const itemVariants = {
    open: { x: 0, opacity: 1, transition: { duration: 0.1 } },
    closed: { x: -10, opacity: 0, transition: { duration: 0.1 } },
  };

  const overlayVariants = {
    open: { opacity: 1, transition: { duration: 0.2 } },
    closed: { opacity: 0, transition: { duration: 0.2 } },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/50 z-40"
            initial="closed"
            animate="open"
            exit="closed"
            variants={overlayVariants}
            onClick={onClose}
          />
          <motion.div
            {...swipeHandlers}
            className={cn(
              "fixed inset-y-0 left-0 w-full sm:w-80 bg-card text-card-foreground z-50 overflow-hidden flex flex-col",
              isDesktop ? "max-w-xs" : ""
            )}
            initial="closed"
            animate="open"
            exit="closed"
            variants={menuVariants}
          >
            <div ref={menuRef} className="flex flex-col h-full">
              <motion.div variants={itemVariants} className="flex justify-between items-center p-4 border-b border-border">
                <h2 className="text-xl font-bold">設定</h2>
                <Button variant="ghost" size="icon" onClick={onClose}>
                  <X size={24} />
                </Button>
              </motion.div>
              <motion.div className="flex-grow overflow-y-auto p-4 space-y-6">
                <motion.div variants={itemVariants}>
                  <h3 className="text-lg font-semibold mb-3 flex items-center">
                    <Server size={20} className="mr-2" /> サーバー
                  </h3>
                  <ul className="space-y-2">
                    {servers.map((server) => (
                      <motion.li key={server.id} variants={itemVariants}>
                        <Button
                          onClick={() => onSelectServer(server.id)}
                          variant={activeServerId === server.id ? "secondary" : "ghost"}
                          className="w-full justify-start"
                        >
                          <span>{server.name}</span>
                          {activeServerId === server.id && <ChevronRight size={20} className="ml-auto" />}
                        </Button>
                      </motion.li>
                    ))}
                  </ul>
                </motion.div>
                <motion.div variants={itemVariants}>
                  <h3 className="text-lg font-semibold mb-3 flex items-center">
                    <Mic size={20} className="mr-2" /> ボイスチャンネル
                  </h3>
                  <ul className="space-y-2">
                    {voiceChannels.map((channel) => (
                      <motion.li key={channel.id} variants={itemVariants}>
                        <Button
                          onClick={() => onSelectChannel(channel.id)}
                          variant={activeChannelId === channel.id ? "secondary" : "ghost"}
                          className="w-full justify-start"
                        >
                          <span>{channel.name}</span>
                          {activeChannelId === channel.id && <ChevronRight size={20} className="ml-auto" />}
                        </Button>
                      </motion.li>
                    ))}
                  </ul>
                </motion.div>
              </motion.div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}