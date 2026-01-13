// MainApp.tsx
// 'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, PlayableItem, SearchItem } from '@/utils/api';
import { MainPlayer } from './MainPlayer';
import { Header } from './Header';
import { SideMenu } from './SideMenu';
import { SearchResults } from './SearchResults';
import { useToast } from "@/hooks/use-toast";
import { Loading } from '@/components/ui/loading';
import { PlayIcon, PauseIcon } from 'lucide-react';
import { Button } from './ui/button';
import { useSwipeable } from 'react-swipeable';
import { useSession } from 'next-auth/react';
import { User } from '@/utils/api';
import Image from 'next/image';
import { IntroPage } from './IntroPage';
import { ErrorBoundary } from './ErrorBoundary';
import { HomeScreen } from './HomeScreen';
import { useGuildStore, usePlayerStore, setupWebSocket, cleanupWebSocket } from '@/store';
import { VOICE_CHAT_ENABLED } from '@/lib/features';

// API URL の取得
const API_URL = process.env.NEXT_PUBLIC_API_URL;

// BigIntのJSONシリアライズの設定
declare global {
  interface BigInt {
    toJSON: () => string;
  }
}

BigInt.prototype.toJSON = function() {
  return this.toString();
};

// 主要なアプリケーションコンポーネント
export const MainApp: React.FC = () => {
  // セッション情報
  const { data: session, status } = useSession(); 
  const { toast } = useToast();
  
  // Zustand ストアから状態を取得
  const {
    activeServerId, activeChannelId, voiceChannels, setActiveServerId, setActiveChannelId,
    fetchMutualServers, fetchVoiceChannels, inviteBot,
    joinVoiceChannel, disconnectVoiceChannel,
    fetchBotVoiceStatus, stopVoiceStatusPolling
  } = useGuildStore();
  
  const {
    currentTrack, queue, isPlaying, isLoading, history,
    isOnDeviceMode, deviceQueue, deviceCurrentTrack, deviceIsPlaying,
    isMainPlayerVisible, setIsMainPlayerVisible,
    play, pause, skip, previous, 
    addToQueue, reorderQueue, removeFromQueue,
    toggleDeviceMode, audioRef
  } = usePlayerStore();

  // UI の状態
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [homeActiveTab, setHomeActiveTab] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('homeActiveTab') || 'home';
    }
    return 'home';
  });
  
  // WebSocket 参照
  const wsConnectionRef = useRef<{ close: () => void } | null>(null);

  // サーバー一覧の初期取得（認証済みのときのみ）
  useEffect(() => {
    if (status === 'authenticated') {
      fetchMutualServers();
    }
  }, [fetchMutualServers, status]);

  // 初回マウント時に保存されているactiveServerIdのボイス状態を取得
  const initialLoadRef = useRef(false);
  useEffect(() => {
    if (status === 'authenticated' && activeServerId && !initialLoadRef.current) {
      initialLoadRef.current = true;
      // 保存されているactiveServerIdがある場合、ボイスチャンネルとボットステータスを取得
      fetchVoiceChannels(activeServerId);
      fetchBotVoiceStatus(activeServerId);
    }
  }, [status, activeServerId, fetchVoiceChannels, fetchBotVoiceStatus]);

  // ローカルストレージから状態を復元
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedHomeTab = localStorage.getItem('homeActiveTab');
      if (savedHomeTab) {
        setHomeActiveTab(savedHomeTab);
      }
    }

    return () => {
      cleanupWebSocket();
      stopVoiceStatusPolling();
    };
  }, [stopVoiceStatusPolling]);
  
  // activeServerId 変更時にWebSocketを設定
  // Note: ボイスチャンネルとボットステータスの取得は setActiveServerId 内で行われる
  useEffect(() => {
    if (activeServerId) {
      // WebSocketの設定
      if (wsConnectionRef.current) {
        wsConnectionRef.current.close();
      }
      wsConnectionRef.current = setupWebSocket(activeServerId);
    }

    return () => {
      if (wsConnectionRef.current) {
        wsConnectionRef.current.close();
        wsConnectionRef.current = null;
      }
    };
  }, [activeServerId]);

  // homeActiveTab の変更時に localStorage に保存
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('homeActiveTab', homeActiveTab);
    }
  }, [homeActiveTab]);
  
  // Track が変わった時にロード開始  
  useEffect(() => {
    if (deviceCurrentTrack && audioRef?.current) {
      audioRef.current.volume = usePlayerStore.getState().volume;
    }
  }, [deviceCurrentTrack, audioRef]);

  // メニューを閉じる
  const handleCloseMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);
  
  // ページをリロードする
  const handleRefresh = useCallback(() => {
    window.location.reload();
  }, []);
  
  // スワイプハンドラー
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => setIsMenuOpen(false),
    trackMouse: true,
    delta: 50,
  });
  
  // ミニプレイヤースワイプハンドラー
  const miniPlayerSwipeHandlers = useSwipeable({
    onSwipedUp: () => setIsMainPlayerVisible(true),
    delta: 50,
    trackMouse: false
  });

  // ユーザー情報を取得する関数
  const getUserInfo = useCallback((): User | null => {
    if (session && session.user) {
      return {
        id: session.user.id,
        name: session.user.name || '',
        image: session.user.image || '',
      };
    }
    return null;
  }, [session]);
  
  // URLを追加
  const handleAddUrl = useCallback(async (url: string) => {
    if (isOnDeviceMode) {
      toast({
        title: "エラー",
        description: "デバイスモードではURLの直接追加はサポートされていません。",
        variant: "destructive",
      });
      return;
    }
    
    if (!activeServerId) {
      toast({
        title: "エラー",
        description: "サーバーが選択されていません。",
        variant: "destructive",
      });
      return;
    }
    
    const user = getUserInfo();
    
    try {
      await api.addUrl(activeServerId, url, user);
      
      toast({
        title: "成功",
        description: "URLが追加されました。",
      });
    } catch (error) {
      console.error('URLの追加に失敗しました:', error);
      toast({
        title: "エラー",
        description: "URLの追加に失敗しました。",
        variant: "destructive",
      });
    }
  }, [activeServerId, isOnDeviceMode, toast, getUserInfo]);

  // 検索
  const handleSearch = useCallback(async (query: string) => {
    try {
      const results = await api.search(query);
      setSearchResults(results);
      setIsSearchActive(true);
    } catch (error) {
      console.error(error);
      toast({
        title: "エラー",
        description: "検索に失敗しました。",
        variant: "destructive",
      });
    }
  }, [toast]);

  // ミニプレイヤーを表示すべきかどうか
  const shouldShowMiniPlayer = useMemo(() => {
    return (
      (currentTrack || deviceCurrentTrack) && 
      !isMainPlayerVisible && 
      homeActiveTab !== 'chat' && 
      homeActiveTab !== 'uploaded-music' && 
      homeActiveTab !== 'ai-recommend' && 
      homeActiveTab !== 'valorant' && 
      homeActiveTab !== 'realtime'
    );
  }, [currentTrack, deviceCurrentTrack, isMainPlayerVisible, homeActiveTab]);

  // ローディング表示
  if (status === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loading size="large" text="読み込み中..." />
      </div>
    );
  }

  // 未認証の場合
  if (status === 'unauthenticated' || !session) {
    return <IntroPage />;
  }

  // メインのレンダリング
  return (
    <ErrorBoundary>
      <div className="h-screen bg-background text-foreground flex flex-col" {...swipeHandlers}>
        {/* ヘッダー */}
        <Header
          onSearch={handleSearch}
          onAddUrl={handleAddUrl}
          onOpenMenu={() => setIsMenuOpen(true)}
          isOnDeviceMode={isOnDeviceMode}
          onToggleDeviceMode={toggleDeviceMode}
        />
        
        {/* サイドメニュー */}
        <AnimatePresence>
          {!isOnDeviceMode && (
            <SideMenu
              isOpen={isMenuOpen}
              onClose={handleCloseMenu}
              activeServerId={activeServerId}
              onSelectServer={setActiveServerId}
              voiceChannels={voiceChannels}
              activeChannelId={activeChannelId}
              onSelectChannel={(channelId) => {
                if (channelId && activeServerId) {
                  joinVoiceChannel(activeServerId, channelId);
                } else {
                  setActiveChannelId(null);
                }
              }}
              onRefresh={handleRefresh}
              onInviteBot={inviteBot}
              onDisconnect={() => {
                if (activeServerId) {
                  disconnectVoiceChannel(activeServerId);
                }
              }}
              onFetchServers={fetchMutualServers}
            />
          )}
        </AnimatePresence>
        
        {/* メインコンテンツ */}
        <main className="flex-grow overflow-hidden pt-16">
          {isSearchActive ? (
            // 検索結果
            <SearchResults
              results={searchResults}
              onAddToQueue={(item) => addToQueue(item, getUserInfo())}
              onAddTrackToQueue={(track) => addToQueue(track, getUserInfo())}
              onClose={() => setIsSearchActive(false)}
              onSearch={handleSearch}
              isOnDeviceMode={isOnDeviceMode}
            />
          ) : isOnDeviceMode ? (
            // デバイスモード
            <>
              <AnimatePresence>
                {isMainPlayerVisible && (
                  <MainPlayer
                    currentTrack={deviceCurrentTrack}
                    isPlaying={deviceIsPlaying}
                    onPlay={play}
                    onPause={pause}
                    onSkip={skip}
                    onPrevious={previous}
                    queue={deviceQueue}
                    onReorder={reorderQueue}
                    onDelete={removeFromQueue}
                    guildId={null}
                    onClose={() => setIsMainPlayerVisible(false)}
                    isVisible={isMainPlayerVisible}
                    isOnDeviceMode={isOnDeviceMode}
                    isLoading={isLoading}
                  />
                )}
              </AnimatePresence>
              
              {!isMainPlayerVisible && (
                <HomeScreen
                  onSelectTrack={(item: PlayableItem) => {
                    addToQueue(item, getUserInfo());
                    setIsMainPlayerVisible(true);
                  }}
                  guildId={null}
                  activeTab={homeActiveTab}
                  onTabChange={(tab) => setHomeActiveTab(tab)}
                  history={[]}
                  isOnDeviceMode={isOnDeviceMode}
                />
              )}
            </>
          ) : (
            // サーバーモード
            <>
              {isLoading && !isMainPlayerVisible ? (
                <div className="h-full flex items-center justify-center">
                  <Loading size="large" text="サーバーに接続中..." />
                </div>
              ) : (
                <>
                  <AnimatePresence>
                    {isMainPlayerVisible && (
                      <MainPlayer
                        currentTrack={currentTrack}
                        isPlaying={isPlaying}
                        onPlay={play}
                        onPause={pause}
                        onSkip={skip}
                        onPrevious={previous}
                        queue={queue}
                        onReorder={reorderQueue}
                        onDelete={removeFromQueue}
                        guildId={activeServerId}
                        onClose={() => setIsMainPlayerVisible(false)}
                        isVisible={isMainPlayerVisible}
                        isOnDeviceMode={isOnDeviceMode}
                        isLoading={isLoading}
                      />
                    )}
                  </AnimatePresence>
                  
                  {!isMainPlayerVisible && (
                    <HomeScreen
                      onSelectTrack={(item: PlayableItem) => {
                        addToQueue(item, getUserInfo());
                        setIsMainPlayerVisible(true);
                      }}
                      guildId={activeServerId}
                      activeTab={homeActiveTab}
                      onTabChange={(tab) => setHomeActiveTab(tab)}
                      history={history}
                      isOnDeviceMode={isOnDeviceMode}
                    />
                  )}
                </>
              )}
            </>
          )}
        </main>
        
        {/* ミニプレイヤー */}
        {shouldShowMiniPlayer && (
          <motion.div
            className="fixed bottom-0 left-0 right-0 bg-card p-4 flex items-center cursor-pointer"
            onClick={() => setIsMainPlayerVisible(true)}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.3 }}
            {...miniPlayerSwipeHandlers}
          >
            <Image 
              src={isOnDeviceMode ? deviceCurrentTrack!.thumbnail : currentTrack!.thumbnail} 
              alt={isOnDeviceMode ? deviceCurrentTrack!.title : currentTrack!.title} 
              width={48} 
              height={48} 
              className="object-cover rounded-md flex-shrink-0"
              unoptimized
            />
            <div className="ml-4 flex-grow min-w-0 mr-4">
              <h4 className="font-semibold truncate">
                {isOnDeviceMode ? deviceCurrentTrack!.title : currentTrack!.title}
              </h4>
              <p className="text-muted-foreground truncate">
                {isOnDeviceMode ? deviceCurrentTrack!.artist : currentTrack!.artist}
              </p>
            </div>
            <Button
              variant="ghost" 
              className="flex-shrink-0"
              onClick={(e) => { 
                e.stopPropagation(); 
                if (isPlaying) {
                  pause();
                } else {
                  play();
                }
              }}
              aria-label={isPlaying ? "一時停止" : "再生"}
            >
              {isPlaying ? (
                <PauseIcon className="h-6 w-6" />
              ) : (
                <PlayIcon className="h-6 w-6" />
              )}
            </Button>
          </motion.div>
        )}
        
        {/* オーディオ要素 */}
        {isOnDeviceMode && (
          <audio
            ref={audioRef}
            src={
              deviceCurrentTrack?.url
                ? `${API_URL}/stream?url=${encodeURIComponent(deviceCurrentTrack.url)}`
                : undefined
            }
            onEnded={skip}
            onPlay={() => usePlayerStore.getState().setIsPlaying(true)}
            onPause={() => usePlayerStore.getState().setIsPlaying(false)}
            onError={(e) => {
              console.error('オーディオエラー:', e);
              toast({
                title: "再生エラー",
                description: "音声の再生中にエラーが発生しました。",
                variant: "destructive",
              });
              skip();
            }}
            autoPlay
          />
        )}
      </div>
    </ErrorBoundary>
  );
};
