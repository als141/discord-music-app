import React, { useEffect, useRef, useState, memo } from 'react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { Server, X, RefreshCw, Mic, PlusCircle, PhoneOff, LogOut, Settings, Info, ChevronRight } from 'lucide-react';
import { VoiceChannel } from '@/utils/api';
import { useSwipeable } from 'react-swipeable';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession, signOut } from 'next-auth/react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useGuildStore } from '@/store/useGuildStore';
import { VOICE_CHAT_ENABLED } from '@/lib/features';

// Animation configuration - Apple-style smooth transitions
const animations = {
  menu: {
    open: { x: 0, transition: { type: 'spring', stiffness: 400, damping: 40 } },
    closed: { x: '-100%', transition: { type: 'spring', stiffness: 400, damping: 40 } },
  } as Variants,

  overlay: {
    open: { opacity: 1 },
    closed: { opacity: 0 },
  } as Variants,

  item: {
    hidden: { opacity: 0, x: -10 },
    visible: (i: number) => ({
      opacity: 1,
      x: 0,
      transition: { delay: i * 0.03, duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }
    }),
  } as Variants
};

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
  onDisconnect: () => void;
  onFetchServers: (force?: boolean) => Promise<void>;
}

// User Profile Component
const UserProfile = memo(() => {
  const { data: session } = useSession();

  if (!session) return null;

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10 ring-2 ring-black/5">
          <AvatarImage src={session.user.image} alt={session.user.name || ''} />
          <AvatarFallback className="bg-primary text-white text-sm font-medium">
            {session.user.name?.charAt(0) || 'U'}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{session.user.name}</p>
          <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="w-full mt-3 h-9 justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/5"
        onClick={() => signOut()}
      >
        <LogOut className="h-4 w-4 mr-2" />
        ログアウト
      </Button>
    </div>
  );
});

UserProfile.displayName = 'UserProfile';

// Server List Item Component
const ServerListItem = memo(({
  server,
  isActive,
  isBotConnected,
  isLoading,
  onSelect,
  onDisconnect,
  index
}: {
  server: { id: string; name: string; icon?: string },
  isActive: boolean,
  isBotConnected: boolean,
  isLoading: boolean,
  onSelect: () => void,
  onDisconnect: () => void,
  index: number
}) => (
  <motion.div
    variants={animations.item}
    custom={index}
    initial="hidden"
    animate="visible"
    className="group"
  >
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ${
        isActive
          ? 'bg-primary/10 text-primary'
          : 'hover:bg-black/5 text-foreground'
      }`}
    >
      <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${
        isActive ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground'
      }`}>
        <Server className="h-4 w-4" />
      </div>
      <span className="flex-1 text-sm font-medium truncate text-left">{server.name}</span>

      {isActive && (
        <div className="flex items-center gap-2">
          {isLoading ? (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-secondary text-muted-foreground text-xs">
              <RefreshCw className="h-3 w-3 animate-spin" />
              <span>確認中</span>
            </div>
          ) : isBotConnected ? (
            <div className="connected-badge">
              接続中
            </div>
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      )}
    </button>

    {isActive && isBotConnected && (
      <div className="ml-11 mt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onDisconnect();
          }}
          className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/5"
        >
          <PhoneOff className="h-3.5 w-3.5 mr-1.5" />
          切断
        </Button>
      </div>
    )}
  </motion.div>
));

ServerListItem.displayName = 'ServerListItem';

// Voice Channel Item Component
const VoiceChannelItem = memo(({
  channel,
  isActive,
  isBotInChannel,
  onClick,
  index
}: {
  channel: VoiceChannel,
  isActive: boolean,
  isBotInChannel: boolean,
  onClick: () => void,
  index: number
}) => (
  <motion.button
    variants={animations.item}
    custom={index}
    initial="hidden"
    animate="visible"
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 ${
      isBotInChannel
        ? 'bg-green-50 text-green-700'
        : isActive
        ? 'bg-primary/5 text-primary'
        : 'hover:bg-black/5 text-foreground'
    }`}
  >
    <Mic className={`h-4 w-4 ${isBotInChannel ? 'text-green-600' : isActive ? 'text-primary' : 'text-muted-foreground'}`} />
    <span className="flex-1 text-sm font-medium truncate text-left">{channel.name}</span>
    {isBotInChannel && (
      <div className="connected-badge">
        接続中
      </div>
    )}
  </motion.button>
));

VoiceChannelItem.displayName = 'VoiceChannelItem';

// Info Panel Component
const InfoPanel = memo(() => (
  <div className="mx-4 mb-4 p-4 rounded-xl bg-secondary/50">
    <div className="flex items-start gap-3">
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 flex-shrink-0">
        <Info className="w-4 h-4 text-primary" />
      </div>
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-1">ヒント</h4>
        <p className="text-xs text-muted-foreground leading-relaxed">
          ボットが応答しない場合は、サーバーを再選択するか、再ログインしてください。
        </p>
      </div>
    </div>
  </div>
));

InfoPanel.displayName = 'InfoPanel';

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
  onDisconnect,
  onFetchServers
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { data: session } = useSession();
  const { toast } = useToast();
  const [botVersion] = useState<string>('v1.0.0');

  const {
    mutualServers,
    inviteServers,
    isLoadingServers,
    serversError,
    isBotConnected,
    botVoiceChannelId,
    isLoadingBotStatus
  } = useGuildStore();

  const swipeHandlers = useSwipeable({
    onSwipedLeft: onClose,
    trackMouse: true,
    delta: 50,
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

  const handleFetchServers = async () => {
    try {
      await onFetchServers(true);
      toast({
        title: "更新完了",
        description: "サーバー一覧を更新しました",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "エラーが発生しました";
      toast({
        title: "エラー",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  return (
    <TooltipProvider>
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Overlay */}
            <motion.div
              initial="closed"
              animate="open"
              exit="closed"
              variants={animations.overlay}
              className="fixed inset-0 bg-black/30 z-40 backdrop-blur-sm"
              onClick={onClose}
            />

            {/* Sidebar Panel */}
            <motion.div
              className="fixed inset-y-0 left-0 w-80 bg-background z-50 shadow-2xl flex flex-col"
              initial="closed"
              animate="open"
              exit="closed"
              variants={animations.menu}
              {...swipeHandlers}
              ref={menuRef}
              role="dialog"
              aria-label="サイドメニュー"
              aria-modal="true"
            >
              {/* Header */}
              <div className="flex items-center justify-between h-14 px-4 border-b border-border">
                <h2 className="text-lg font-bold text-foreground">設定</h2>
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onRefresh}
                        className="h-8 w-8 rounded-full hover:bg-black/5"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>リロード</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="h-8 w-8 rounded-full hover:bg-black/5"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>閉じる</p></TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {/* User Profile */}
              {session && <UserProfile />}

              {/* Content Area */}
              <ScrollArea className="flex-1">
                <div className="py-4">
                  {/* Server List Section */}
                  <div className="px-4 mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        サーバー
                      </h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleFetchServers}
                        disabled={isLoadingServers}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <RefreshCw className={`h-3 w-3 mr-1 ${isLoadingServers ? 'animate-spin' : ''}`} />
                        更新
                      </Button>
                    </div>

                    {serversError && (
                      <div className="p-3 mb-3 rounded-lg bg-destructive/5 border border-destructive/10">
                        <p className="text-xs text-destructive mb-2">{serversError}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleFetchServers}
                          disabled={isLoadingServers}
                          className="h-7 text-xs border-destructive/20 text-destructive hover:bg-destructive/5"
                        >
                          再取得
                        </Button>
                      </div>
                    )}

                    {isLoadingServers ? (
                      <div className="flex items-center justify-center py-8">
                        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
                        <span className="text-sm text-muted-foreground">読み込み中...</span>
                      </div>
                    ) : mutualServers.length === 0 ? (
                      <div className="text-center py-6 px-4 rounded-lg bg-secondary/50">
                        <p className="text-sm text-muted-foreground">
                          サーバーがありません
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {mutualServers.map((server, index) => (
                          <ServerListItem
                            key={server.id}
                            server={server}
                            isActive={activeServerId === server.id}
                            isBotConnected={activeServerId === server.id && isBotConnected}
                            isLoading={activeServerId === server.id && isLoadingBotStatus}
                            onSelect={() => onSelectServer(server.id)}
                            onDisconnect={onDisconnect}
                            index={index}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Voice Channels Section */}
                  {VOICE_CHAT_ENABLED && activeServerId && voiceChannels.length > 0 && (
                    <div className="px-4 mb-6">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        ボイスチャンネル
                      </h3>
                      <div className="space-y-1">
                        {voiceChannels.map((channel, index) => (
                          <VoiceChannelItem
                            key={channel.id}
                            channel={channel}
                            isActive={activeChannelId === channel.id}
                            isBotInChannel={botVoiceChannelId === channel.id}
                            onClick={() => onSelectChannel(channel.id)}
                            index={index}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Invite Section */}
                  {inviteServers.length > 0 && (
                    <div className="px-4 mb-6">
                      <Accordion type="single" collapsible>
                        <AccordionItem value="invite" className="border-0">
                          <AccordionTrigger className="py-2 hover:no-underline">
                            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              <PlusCircle className="h-3.5 w-3.5 text-primary" />
                              <span>ボットを招待</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-1 pt-2">
                              {inviteServers.map((server, index) => (
                                <motion.button
                                  key={server.id}
                                  variants={animations.item}
                                  custom={index}
                                  initial="hidden"
                                  animate="visible"
                                  onClick={() => onInviteBot(server.id)}
                                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-primary/5 text-foreground transition-colors"
                                >
                                  <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10">
                                    <PlusCircle className="h-3.5 w-3.5 text-primary" />
                                  </div>
                                  <span className="text-sm font-medium truncate">{server.name}</span>
                                </motion.button>
                              ))}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </div>
                  )}

                  {/* Settings Section */}
                  <div className="px-4 mb-6">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                      設定
                    </h3>
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-secondary/50">
                      <div className="flex items-center gap-2">
                        <Settings className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-foreground">バージョン</span>
                      </div>
                      <span className="text-xs font-medium text-muted-foreground bg-white px-2 py-1 rounded-full">
                        {botVersion}
                      </span>
                    </div>
                  </div>

                  {/* Info Panel */}
                  <InfoPanel />
                </div>
              </ScrollArea>

              {/* Footer */}
              <div className="p-4 border-t border-border text-center">
                <p className="text-xs text-muted-foreground">
                  Irina Music &copy; 2025
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </TooltipProvider>
  );
};
