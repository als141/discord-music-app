import React, { useEffect, useRef, useState, memo } from 'react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { Server, ChevronRight, X, RefreshCw, Mic, PlusCircle, PhoneOff, LogOut, Settings, Info } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useGuildStore } from '@/store/useGuildStore';
import { VOICE_CHAT_ENABLED } from '@/lib/features';

// アニメーション設定
const animations = {
  menu: {
    open: { x: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } },
    closed: { x: '-100%', transition: { type: 'spring', stiffness: 300, damping: 30 } },
  } as Variants,
  
  overlay: {
    open: { opacity: 1 },
    closed: { opacity: 0 },
  } as Variants,
  
  item: {
    hidden: { opacity: 0, y: 20 },
    visible: (i: number) => ({ 
      opacity: 1, 
      y: 0, 
      transition: { delay: i * 0.05, duration: 0.2 } 
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

// メモ化したヘッダーコンポーネント
const MenuHeader = memo(({ 
  onClose, 
  onRefresh 
}: { 
  onClose: () => void, 
  onRefresh: () => void 
}) => (
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
));

MenuHeader.displayName = 'MenuHeader';

// メモ化したユーザープロファイルコンポーネント
const UserProfile = memo(() => {
  const { data: session } = useSession();
  
  if (!session) return null;
  
  return (
    <div className="flex flex-col items-start space-y-4 mb-6">
      <div className="flex items-center space-x-4 w-full">
        <Avatar className="w-10 h-10">
          <AvatarImage src={session.user.image} alt={session.user.name || ''} />
          <AvatarFallback>{session.user.name?.charAt(0) || 'U'}</AvatarFallback>
        </Avatar>
        <div className="flex-grow">
          <p className="font-medium">{session.user.name || 'Unknown User'}</p>
          <p className="text-sm text-muted-foreground truncate">{session.user.email || ''}</p>
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
  );
});

UserProfile.displayName = 'UserProfile';

// メモ化したサーバーリストアイテムコンポーネント
const ServerListItem = memo(({ 
  server, 
  isActive, 
  onSelect, 
  onDisconnect 
}: { 
  server: { id: string; name: string; icon?: string }, 
  isActive: boolean, 
  onSelect: () => void, 
  onDisconnect: () => void 
}) => (
  <div className="flex items-center my-1">
    <Button
      onClick={onSelect}
      variant={isActive ? 'default' : 'ghost'}
      className="flex-grow justify-start group relative gap-2"
      aria-pressed={isActive}
    >
      <Server size={16} className={isActive ? 'text-primary-foreground' : 'text-muted-foreground'} />
      <span className="truncate">{server.name}</span>
      {isActive && (
        <Badge variant="secondary" className="ml-2 bg-primary-foreground/20 text-primary-foreground">
          接続中
        </Badge>
      )}
    </Button>
    {VOICE_CHAT_ENABLED && isActive && (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="ボイスチャンネルから切断"
            onClick={onDisconnect}
            className="ml-2 hover:bg-destructive/10 hover:text-destructive"
          >
            <PhoneOff size={18} className="text-destructive" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>ボイスチャンネルから切断</p>
        </TooltipContent>
      </Tooltip>
    )}
  </div>
));

ServerListItem.displayName = 'ServerListItem';

// メモ化したボイスチャンネルリストアイテムコンポーネント
const VoiceChannelItem = memo(({ 
  channel, 
  isActive, 
  onClick 
}: { 
  channel: VoiceChannel, 
  isActive: boolean, 
  onClick: () => void 
}) => (
  <motion.li
    variants={animations.item}
    custom={parseInt(channel.id) % 100} // 少し順番をずらすための工夫
    initial="hidden"
    animate="visible"
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
  >
    <Button
      onClick={onClick}
      variant={isActive ? "secondary" : "ghost"}
      className="w-full justify-start group relative"
      aria-pressed={isActive}
    >
      <Mic size={16} className={`mr-2 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
      <span className="truncate">{channel.name}</span>
      {isActive && (
        <ChevronRight size={18} className="ml-auto flex-shrink-0 text-primary" />
      )}
    </Button>
  </motion.li>
));

VoiceChannelItem.displayName = 'VoiceChannelItem';

// メモ化したインフォメーションパネルコンポーネント
const InfoPanel = memo(() => (
  <Card className="mt-8 p-4 bg-primary/5 border-primary/10">
    <div className="flex items-start gap-3">
      <Info className="w-6 h-6 text-primary shrink-0 mt-1" />
      <div className="space-y-2">
        <h3 className="font-medium">サービス情報</h3>
        <p className="text-sm text-muted-foreground">
          ボットが応答しない場合は、サーバーセレクターで再接続するか、再ログインしてみてください。
        </p>
      </div>
    </div>
  </Card>
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
  const [botVersion, setBotVersion] = useState<string | null>(null);

  // サーバー一覧の状態
  const { mutualServers, inviteServers, isLoadingServers, serversError } = useGuildStore();

  // スワイプ処理用
  const swipeHandlers = useSwipeable({
    onSwipedLeft: onClose,
    trackMouse: true,
    delta: 50,
  });  

  // クリックアウトサイド処理
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

  // ボタンバージョン取得の模倣
  useEffect(() => {
    if (isOpen && !botVersion) {
      // 実際のアプリでは適切なAPIエンドポイントから取得するべき
      setBotVersion('v1.2.3');
    }
  }, [isOpen, botVersion]);

  // サーバー一覧の再取得
  const handleFetchServers = async () => {
    try {
      await onFetchServers(true);
      toast({
        title: "成功",
        description: "サーバー一覧を更新しました。",
      });
    } catch (error) {
      // Using the error variable
      const errorMessage = error instanceof Error ? error.message : "不明なエラーが発生しました";
      toast({
        title: "エラー",
        description: `サーバー一覧の取得に失敗しました: ${errorMessage}`,
        variant: "destructive",
      });
    }
  };

  return (
    <TooltipProvider>
      <AnimatePresence>
        {isOpen && (
          <>
            {/* オーバーレイ */}
            <motion.div
              initial="closed"
              animate="open"
              exit="closed"
              variants={animations.overlay}
              className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
              onClick={onClose}
              aria-hidden="true"
            />
            
            {/* メインメニュー */}
            <motion.div
              className="fixed inset-y-0 left-0 w-80 bg-background text-foreground z-50 shadow-lg flex flex-col"
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
              {/* ヘッダー */}
              <MenuHeader onClose={onClose} onRefresh={onRefresh} />
              
              {/* コンテンツエリア */}
              <ScrollArea className="flex-grow px-4 py-6">
                <div className="space-y-8">
                  {/* ユーザー情報 */}
                  {session && <UserProfile />}

                  {/* サーバー一覧 */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-semibold flex items-center">
                        <Server size={20} className="mr-2" /> サーバー一覧
                      </h3>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={handleFetchServers}
                        disabled={isLoadingServers}
                      >
                        <RefreshCw size={16} className={`mr-1 ${isLoadingServers ? 'animate-spin' : ''}`} />
                        更新
                      </Button>
                    </div>
                    
                    {serversError && (
                      <div className="text-center p-3 mb-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                        <p className="text-destructive text-sm">
                          {serversError}
                        </p>
                        <Button 
                          variant="destructive" 
                          size="sm" 
                          className="mt-2"
                          onClick={handleFetchServers}
                          disabled={isLoadingServers}
                        >
                          <RefreshCw size={16} className={`mr-1 ${isLoadingServers ? 'animate-spin' : ''}`} />
                          再取得
                        </Button>
                      </div>
                    )}
                    
                    {isLoadingServers ? (
                      <div className="flex justify-center p-4">
                        <div className="flex items-center">
                          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                          <span>サーバー一覧を取得中...</span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {mutualServers.length === 0 ? (
                          <div className="text-center p-4 bg-muted rounded-lg">
                            <p className="text-muted-foreground text-sm">
                              利用可能なサーバーがありません。再ログインしてみてください。
                            </p>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="mt-2"
                              onClick={handleFetchServers}
                            >
                              <RefreshCw size={16} className="mr-1" />
                              再取得
                            </Button>
                          </div>
                        ) : (
                          mutualServers.map((server) => (
                            <ServerListItem
                              key={server.id}
                              server={server}
                              isActive={activeServerId === server.id}
                              onSelect={() => onSelectServer(server.id)}
                              onDisconnect={onDisconnect}
                            />
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* ボイスチャンネル */}
                  {VOICE_CHAT_ENABLED && activeServerId && (
                    <div>
                      <h3 className="text-lg font-semibold mb-3 flex items-center">
                        <Mic size={20} className="mr-2" /> ボイスチャンネル
                      </h3>
                      
                      {voiceChannels.length === 0 ? (
                        <div className="text-center p-4 bg-muted rounded-lg">
                          <p className="text-muted-foreground text-sm">
                            利用可能なボイスチャンネルがありません
                          </p>
                        </div>
                      ) : (
                        <ul className="space-y-2">
                          {voiceChannels.map((channel) => (
                            <VoiceChannelItem
                              key={channel.id}
                              channel={channel}
                              isActive={activeChannelId === channel.id}
                              onClick={() => onSelectChannel(channel.id)}
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* 招待する (アコーディオン) */}
                  {inviteServers.length > 0 && (
                    <Accordion type="single" collapsible className="w-full">
                      <AccordionItem value="invite" className="border-b-0">
                        <AccordionTrigger className="py-2 group">
                          <div className="flex items-center text-lg font-semibold">
                            <PlusCircle size={20} className="mr-2 text-primary group-hover:text-primary/80" /> 
                            <span className="group-hover:text-primary/80">招待する</span>
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
                                <Server size={16} className="mr-2 text-muted-foreground" />
                                {server.name}
                              </Button>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                  
                  {/* 設定セクション */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center">
                      <Settings size={20} className="mr-2" /> 設定
                    </h3>
                    
                    <div className="space-y-2">
                      <Card className="p-3 bg-muted/50">
                        <div className="flex justify-between items-center">
                          <span className="text-sm">Botバージョン</span>
                          <Badge variant="outline">{botVersion || 'Loading...'}</Badge>
                        </div>
                      </Card>
                    </div>
                  </div>
                  
                  {/* 情報パネル */}
                  <InfoPanel />
                </div>
              </ScrollArea>
              
              {/* フッター情報 */}
              <div className="p-4 border-t text-center text-xs text-muted-foreground">
                {session && (
                  <p>ログイン: {session.user.name}</p>
                )}
                <p className="mt-1">© 2025 Irina Music</p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </TooltipProvider>
  );
};
