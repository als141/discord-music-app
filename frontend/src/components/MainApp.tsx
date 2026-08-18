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
import { PlayIcon, PauseIcon, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { useSwipeable } from 'react-swipeable';
import { useSession } from 'next-auth/react';
import { User } from '@/utils/api';
import Image from 'next/image';
import { IntroPage } from './IntroPage';
import { ErrorBoundary } from './ErrorBoundary';
import { HomeScreen } from './HomeScreen';
import { useGuildStore, usePlayerStore, setupWebSocket, cleanupWebSocket } from '@/store';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useArtworkAccent } from '@/hooks/use-artwork-accent';

// API URL の取得

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
    fetchBotVoiceStatus, stopVoiceStatusPolling,
    checkAutoConnect, hasCheckedAutoConnect, isAutoConnecting
  } = useGuildStore();
  
  const {
    currentTrack, queue, isPlaying, isLoading, isBuffering, history,
    isMainPlayerVisible, setIsMainPlayerVisible,
    play, pause, skip,
    addToQueue, reorderQueue, removeFromQueue,
  } = usePlayerStore();

  // レイアウト: lg 以上は Now Playing パネルを右にドッキング
  const isDesktop = useIsDesktop();
  // 再生中アートワークの色でアクセントを染める
  useArtworkAccent(currentTrack?.thumbnail);

  // UI の状態
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [lastSearchQuery, setLastSearchQuery] = useState('');
  const searchSeqRef = useRef(0);
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

  // 自動接続チェック: ユーザーがボットと同じVCにいる場合、自動的にそのサーバー/チャンネルをアクティブ化
  // これにより、ユーザーBが既にユーザーAと同じVCにいる場合、手動でチャンネルを選択する必要がなくなる
  useEffect(() => {
    const performAutoConnect = async () => {
      if (status === 'authenticated' && session?.user?.id && !hasCheckedAutoConnect && !isAutoConnecting) {
        const autoConnected = await checkAutoConnect(session.user.id);
        if (autoConnected) {
          toast({
            title: "自動接続",
            description: "ボイスチャンネルに自動的に接続しました。",
          });
        }
      }
    };

    performAutoConnect();
  }, [status, session?.user?.id, hasCheckedAutoConnect, isAutoConnecting, checkAutoConnect, toast]);

  // 初回マウント時に保存されているactiveServerIdのボイス状態を取得
  // 自動接続が成功しなかった場合のみ実行
  const initialLoadRef = useRef(false);
  useEffect(() => {
    if (status === 'authenticated' && activeServerId && !initialLoadRef.current && hasCheckedAutoConnect) {
      initialLoadRef.current = true;
      // 保存されているactiveServerIdがある場合、ボイスチャンネルとボットステータスを取得
      fetchVoiceChannels(activeServerId);
      fetchBotVoiceStatus(activeServerId);
    }
  }, [status, activeServerId, fetchVoiceChannels, fetchBotVoiceStatus, hasCheckedAutoConnect]);

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
  }, [activeServerId, toast, getUserInfo]);

  // 検索
  const handleSearch = useCallback(async (query: string) => {
    const seq = ++searchSeqRef.current;
    // 先にオーバーレイを開いてスケルトンを出す（結果待ちの間に画面が固まって見えないように）
    setIsSearchActive(true);
    setIsSearching(true);
    setLastSearchQuery(query);
    setSearchResults([]);
    try {
      const results = await api.search(query);
      // 連打時は最後の検索だけ反映（古い応答が新しい結果を上書きしないように）
      if (seq !== searchSeqRef.current) return;
      setSearchResults(results);
    } catch (error) {
      if (seq !== searchSeqRef.current) return;
      console.error(error);
      setSearchResults([]);
      toast({
        title: "エラー",
        description: "検索に失敗しました。",
        variant: "destructive",
      });
    } finally {
      if (seq === searchSeqRef.current) setIsSearching(false);
    }
  }, [toast]);

  // ミニプレイヤーを表示すべきかどうか
  const shouldShowMiniPlayer = useMemo(() => {
    return (
      !isDesktop &&
      currentTrack && 
      !isMainPlayerVisible && 
      homeActiveTab !== 'chat' && 
      homeActiveTab !== 'uploaded-music' && 
      homeActiveTab !== 'ai-recommend' && 
      homeActiveTab !== 'valorant' && 
      homeActiveTab !== 'realtime'
    );
  }, [isDesktop, currentTrack, isMainPlayerVisible, homeActiveTab]);

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

  // フルスクリーンプレイヤー（sheet）はモバイル/タブレットのみ。デスクトップは右カラムに常時表示
  const showSheetPlayer = !isDesktop && isMainPlayerVisible;

  const homeScreen = (
    <HomeScreen
      onSelectTrack={(item: PlayableItem) => {
        addToQueue(item, getUserInfo());
        if (!isDesktop) setIsMainPlayerVisible(true);
      }}
      guildId={activeServerId}
      activeTab={homeActiveTab}
      onTabChange={(tab) => setHomeActiveTab(tab)}
      history={history}
      onAddUrl={handleAddUrl}
    />
  );

  const playerProps = {
    currentTrack,
    isPlaying,
    onPlay: play,
    onPause: pause,
    onSkip: skip,
    queue,
    onReorder: reorderQueue,
    onDelete: removeFromQueue,
    guildId: activeServerId,
    onClose: () => setIsMainPlayerVisible(false),
    // 楽観的更新中 or サーバー側で音源準備中はスピナー
    isLoading: isLoading || isBuffering,
  };

  // メインのレンダリング
  return (
    <ErrorBoundary>
      <div className="app-shell bg-background text-foreground" {...swipeHandlers}>
        {/* ヘッダー */}
        <Header
          onSearch={handleSearch}
          onAddUrl={handleAddUrl}
          onOpenMenu={() => setIsMenuOpen(true)}
        />

        {/* サイドメニュー */}
        <AnimatePresence>
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
        </AnimatePresence>

        {/* ボディ: 左=メインコンテンツ / 右=Now Playing（lg以上） */}
        <div className="flex-1 min-h-0 flex pt-14">
          {/* メインカラム */}
          <main
            className="relative flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden"
            style={{ '--bottom-inset': shouldShowMiniPlayer ? '76px' : '0px' } as React.CSSProperties}
            aria-label="メインコンテンツ"
          >
            {/* ホーム画面は常にマウント（タブ状態・スクロール位置を維持） */}
            <div
              className={`h-full pb-[var(--bottom-inset)] ${showSheetPlayer || isSearchActive ? 'invisible' : ''}`}
              aria-hidden={showSheetPlayer || isSearchActive}
            >
              {homeScreen}
            </div>

            {/* 検索結果オーバーレイ（メインカラム内に収める） */}
            {isSearchActive && (
              <SearchResults
                results={searchResults}
                onAddToQueue={(item) => addToQueue(item, getUserInfo())}
                onAddTrackToQueue={(track) => addToQueue(track, getUserInfo())}
                onClose={() => setIsSearchActive(false)}
                onSearch={handleSearch}
                isSearching={isSearching}
                lastQuery={lastSearchQuery}
              />
            )}

            {/* フルスクリーンプレイヤー（モバイル/タブレット）
                常にマウントしたまま translateY で出し入れする（AnimatePresence の exit 待ちで
                白い残骸が残る問題を避ける。Drawer の状態も維持できる） */}
            {!isDesktop && (
              <motion.div
                className="absolute inset-0 z-40 bg-background"
                initial={false}
                animate={{ y: showSheetPlayer ? 0 : '100%' }}
                transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
                style={{ pointerEvents: showSheetPlayer ? 'auto' : 'none' }}
                aria-hidden={!showSheetPlayer}
                inert={!showSheetPlayer}
              >
                <MainPlayer {...playerProps} variant="sheet" />
              </motion.div>
            )}
          </main>

          {/* Now Playing パネル（デスクトップ） */}
          {isDesktop && (
            <aside className="now-playing-aside hidden lg:flex flex-col min-h-0" aria-label="再生中パネル">
              <MainPlayer {...playerProps} variant="docked" />
            </aside>
          )}
        </div>

        {/* ミニプレイヤー（モバイル/タブレット） */}
        <AnimatePresence>
          {shouldShowMiniPlayer && (
            <motion.div
              className="mobile-player fixed bottom-0 left-0 right-0 z-40 flex items-center cursor-pointer"
              onClick={() => setIsMainPlayerVisible(true)}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.3 }}
              role="button"
              tabIndex={0}
              aria-label="プレイヤーを開く"
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsMainPlayerVisible(true); }}
              {...miniPlayerSwipeHandlers}
            >
              <Image
                src={currentTrack!.thumbnail || '/default_thumbnail.webp'}
                alt={currentTrack!.title}
                width={48}
                height={48}
                className="object-cover rounded-md flex-shrink-0"
                style={{ width: 48, height: 48 }}
                unoptimized
              />
              <div className="ml-3 flex-grow min-w-0 mr-3">
                <h4 className="font-semibold truncate text-sm">
                  {currentTrack!.title}
                </h4>
                <p className="text-muted-foreground truncate text-xs">
                  {currentTrack!.artist}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0 rounded-full h-10 w-10"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isPlaying) {
                    pause();
                  } else {
                    play();
                  }
                }}
                aria-label={isBuffering ? "読み込み中" : isPlaying ? "一時停止" : "再生"}
                disabled={isBuffering}
              >
                {isBuffering ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : isPlaying ? (
                  <PauseIcon className="h-6 w-6" />
                ) : (
                  <PlayIcon className="h-6 w-6" />
                )}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
};
