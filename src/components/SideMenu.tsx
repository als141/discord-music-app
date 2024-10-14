import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Server, ChevronRight, X, RefreshCw, Mic, PlusCircle, PhoneOff, LogOut } from 'lucide-react';
import { Server as VoiceChannel } from '@/utils/api';
import { useSwipeable } from 'react-swipeable';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession, signOut } from 'next-auth/react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useGuilds } from '@/contexts/GuildContext';
import { api } from '@/utils/api';
import { useToast } from '@/hooks/use-toast';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  activeServerId: string | null;
  onSelectServer: (serverId: string | null) => void;
  voiceChannels: VoiceChannel[];
  activeChannelId: string | null;
  onSelectChannel: (channelId: string | null) => void;
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
  onInviteBot
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { data: session } = useSession();
  const { mutualServers, inviteServers } = useGuilds();
  const { toast } = useToast();

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

  const handleDisconnect = async () => {
    if (!activeServerId) {
      toast({
        title: "エラー",
        description: "接続しているサーバーがありません。",
        variant: "destructive",
      });
      return;
    }

    try {
      await api.disconnectVoiceChannel(activeServerId);
      toast({
        title: "切断成功",
        description: "ボイスチャンネルから切断しました。",
      });
      onSelectServer(null);
    } catch (error) {
      console.error(error);
      toast({
        title: "エラー",
        description: "ボイスチャンネルからの切断に失敗しました。",
        variant: "destructive",
      });
    }
  };

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
              className="fixed inset-y-0 left-0 w-72 bg-background text-foreground z-50 shadow-lg flex flex-col"
              initial="closed"
              animate="open"
              exit="closed"
              variants={menuVariants}
              {...swipeHandlers}
              ref={menuRef}
            >
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-2xl font-bold">設定</h2>
                <div className="flex items-center space-x-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="ページをリロード">
                        <RefreshCw size={20} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>リロード</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={onClose} aria-label="メニューを閉じる">
                        <X size={20} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>閉じる</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              
              <ScrollArea className="flex-grow px-4 py-6">
                <div className="space-y-8">
                  {/* ユーザー情報 */}
                  {session && (
                    <div className="flex flex-col items-start space-y-4 mb-6">
                      <div className="flex items-center space-x-4 w-full">
                        <Avatar className="w-10 h-10">
                          <AvatarImage src={session.user.image} alt={session.user.name || ''} />
                          <AvatarFallback>{session.user.name?.charAt(0) || 'U'}</AvatarFallback>
                        </Avatar>
                        <div className="flex-grow">
                          <p className="font-medium">{session.user.name}</p>
                          <p className="text-sm text-muted-foreground">{session.user.email}</p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full justify-start"
                        onClick={() => signOut()}
                      >
                        <LogOut size={18} className="mr-2" />
                        ログアウト
                      </Button>
                    </div>
                  )}

                  {/* サーバー一覧 */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center">
                      <Server size={20} className="mr-2" /> サーバー一覧
                    </h3>
                    <div className="space-y-2">
                      {mutualServers.map((server) => (
                        <div key={server.id} className="flex items-center">
                          <Button
                            onClick={() => onSelectServer(server.id)}
                            variant={activeServerId === server.id ? 'default' : 'ghost'}
                            className="flex-grow justify-start"
                          >
                            {server.name}
                          </Button>
                          {activeServerId === server.id && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="ボイスチャンネルから切断"
                                  onClick={handleDisconnect}
                                  className="ml-2"
                                >
                                  <PhoneOff size={18} className="text-red-500" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>ボイスチャンネルから切断</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ボイスチャンネル */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center">
                      <Mic size={20} className="mr-2" /> ボイスチャンネル
                    </h3>
                    <ul className="space-y-2">
                      {voiceChannels.map((channel) => (
                        <motion.li
                          key={channel.id}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          <Button
                            onClick={() => onSelectChannel(channel.id)}
                            variant={activeChannelId === channel.id ? "secondary" : "ghost"}
                            className="w-full justify-start"
                          >
                            <span className="truncate">{channel.name}</span>
                            {activeChannelId === channel.id && (
                              <ChevronRight size={18} className="ml-auto flex-shrink-0" />
                            )}
                          </Button>
                        </motion.li>
                      ))}
                    </ul>
                  </div>

                  {/* 招待する (アコーディオン) */}
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="invite">
                      <AccordionTrigger className="text-lg font-semibold">
                        <div className="flex items-center">
                          <PlusCircle size={20} className="mr-2" /> 招待する
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 mt-2">
                          {inviteServers.map((server) => (
                            <Button
                              key={server.id}
                              onClick={() => onInviteBot(server.id)}
                              variant="outline"
                              className="w-full justify-start"
                            >
                              {server.name}
                            </Button>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </ScrollArea>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </TooltipProvider>
  );
};