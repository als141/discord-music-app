import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Server as ServerIcon, Mic, ChevronRight, X, RefreshCw } from 'lucide-react';
import { Server as VoiceChannel } from '@/utils/api';
import { Server } from '@/utils/api';
import { useSwipeable } from 'react-swipeable';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession, signOut } from 'next-auth/react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  availableServers: Server[]; // 追加
  invitableServers: Server[]; // 追加
  activeServerId: string | null;
  onSelectServer: (serverId: string) => void;
  voiceChannels: VoiceChannel[];
  activeChannelId: string | null;
  onSelectChannel: (channelId: string) => void;
  onRefresh: () => void;
  onInviteBot: (serverId: string) => void;
}

export const SideMenu: React.FC<SideMenuProps> = ({
  isOpen,
  onClose,
  activeServerId,
  onSelectServer,
  voiceChannels,
  activeChannelId,
  onSelectChannel,
  onRefresh,
  onInviteBot,
  invitableServers,
  availableServers,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { data: session } = useSession();

  const swipeHandlers = useSwipeable({
    onSwipedLeft: onClose,
    trackMouse: true,
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
    <TooltipProvider>
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial="closed"
              animate="open"
              exit="closed"
              variants={overlayVariants}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={onClose}
            />
            <motion.div
              className="fixed inset-y-0 left-0 w-64 bg-background text-foreground z-50 shadow-lg"
              initial="closed"
              animate="open"
              exit="closed"
              variants={menuVariants}
              {...swipeHandlers}
            >
              <div className="flex items-center justify-between p-4 border-b h-16">
              <h2 className="text-xl font-bold">設定</h2>
                <div className="flex items-center">
                  {session && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="ユーザーメニュー">
                          <Avatar className="w-8 h-8">
                            <AvatarImage src={`https://cdn.discordapp.com/avatars/${session.user.id}/${session.user.image}.png`} alt={session.user.name || ''} />
                            <AvatarFallback>{session.user.name?.charAt(0) || 'U'}</AvatarFallback>
                          </Avatar>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => signOut()}>ログアウト</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="ページをリロード">
                        <RefreshCw size={24} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>リロード</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={onClose} aria-label="メニューを閉じる">
                        <X size={24} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>閉じる</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <ScrollArea className="h-[calc(100vh-5rem)] p-4">
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-3 flex items-center">
            <ServerIcon size={20} className="mr-2" /> 利用可能なサーバー
          </h3>
          <ul className="space-y-2">
            {availableServers.map((server: Server) => (
              <motion.li
                key={server.id}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Button
                  onClick={() => onSelectServer(server.id)}
                  variant={activeServerId === server.id ? "secondary" : "ghost"}
                  className="w-full justify-start"
                >
                  <span className="truncate">{server.name}</span>
                  {activeServerId === server.id && (
                    <ChevronRight size={20} className="ml-auto flex-shrink-0" />
                  )}
                </Button>
              </motion.li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-lg font-semibold mb-3 flex items-center">
            <ServerIcon size={20} className="mr-2" /> ボットを招待できるサーバー
          </h3>
          <ul className="space-y-2">
            {invitableServers.map((server: Server) => (
              <motion.li
                key={server.id}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Button
                  onClick={() => onInviteBot(server.id)}
                  variant="ghost"
                  className="w-full justify-start"
                >
                  <span className="truncate">{server.name}</span>
                  <span className="ml-auto flex-shrink-0 text-blue-500">招待</span>
                </Button>
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
                        <motion.li
                          key={channel.id}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          <Button
                            onClick={() => onSelectChannel(channel.id)}
                            variant={activeChannelId === channel.id ? "secondary" : "ghost"}
                            className="w-full justify-start"
                          >
                            <span className="truncate">{channel.name}</span>
                            {activeChannelId === channel.id && (
                              <ChevronRight size={20} className="ml-auto flex-shrink-0" />
                            )}
                          </Button>
                        </motion.li>
                      ))}
                    </ul>
                  </div>
                </div>
              </ScrollArea>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </TooltipProvider>
  );
};