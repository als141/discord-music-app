import React, { useEffect, useState, useCallback, useMemo, memo, useRef } from 'react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { PlayableItem, SearchItem, api, Section, QueueItem } from '@/utils/api';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Loading } from '@/components/ui/loading';
import Image from 'next/image';
import {
  Play,
  User,
  History,
  Sparkles,
  Home,
  MessageSquare,
  Brain,
  Target,
  Mic,
  ExternalLink,
  Info,
  Music2,
} from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useInView } from 'react-intersection-observer';
import { UploadedMusicScreen } from './UploadedMusicScreen';
import { ChatScreen } from './ChatScreen';
import { AIRecommendScreen } from './AIRecommendScreen';
import { VALORANTScreen } from './VALORANTScreen';
import ArtistDialog from '@/components/ArtistDialog';
import { RealtimeScreen } from './RealtimeScreen';
import { VOICE_CHAT_ENABLED } from '@/lib/features';

interface HomeScreenProps {
  onSelectTrack: (item: PlayableItem) => void;
  guildId: string | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
  history: QueueItem[];
  isOnDeviceMode: boolean;
}

interface VersionInfo {
  version: string;
  buildDate: string;
}

// Framer Motionのアニメーション設定
const animations = {
  container: {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { staggerChildren: 0.05 }
    },
    exit: { opacity: 0 }
  } as Variants,
  
  item: {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 }
  } as Variants,
  
  tabItem: {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
  } as Variants
};

// メモ化したトラックカードコンポーネント
const TrackCard = memo(({ 
  item, 
  onSelectTrack, 
  onArtistClick 
}: { 
  item: SearchItem, 
  onSelectTrack: (item: PlayableItem) => void,
  onArtistClick: (artistId: string) => void
}) => {
  // カード表示のインタラクション検知
  const [ref, inView] = useInView({
    triggerOnce: true,
    threshold: 0.1
  });
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.div
            ref={ref}
            variants={animations.item}
            className="overflow-hidden cursor-pointer h-full bg-card hover:bg-card/80 transition-colors duration-200"
          >
            <Card className="h-full border-0 overflow-hidden">
              <CardContent className="p-0 h-full flex flex-col">
                <div className="relative w-full pt-[100%] group">
                  {inView && (
                    <>
                      <Image
                        src={item.thumbnail}
                        alt={item.title}
                        fill
                        style={{ objectFit: 'cover' }}
                        className="rounded-t-lg"
                        unoptimized
                      />
                      <motion.div
                        className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center"
                        initial={{ opacity: 0 }}
                        whileHover={{ opacity: 1 }}
                      >
                        <Play 
                          className="text-white w-12 h-12" 
                          onClick={() => onSelectTrack(item)} 
                          role="button"
                          aria-label={`${item.title}を再生`}
                        />
                      </motion.div>
                    </>
                  )}
                </div>
                <div className="p-3 flex-grow flex flex-col justify-between bg-card/50 backdrop-blur-sm">
                  <h3 className="font-bold text-sm mb-1 line-clamp-2">{item.title}</h3>
                  <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                    {item.artistId ? (
                      <motion.button
                        onClick={() => onArtistClick(item.artistId!)}
                        className="text-primary hover:text-primary/80 flex items-center gap-1 rounded px-1.5 py-0.5 bg-primary/10 hover:bg-primary/20 transition-colors duration-200"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        aria-label={`${item.artist}の詳細を表示`}
                      >
                        {item.artist}
                        <ExternalLink className="w-3 h-3" />
                      </motion.button>
                    ) : (
                      <span>{item.artist}</span>
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{item.title}</p>
          <p className="text-xs text-muted-foreground">{item.artist}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

TrackCard.displayName = 'TrackCard';

// メモ化した履歴カードコンポーネント
const HistoryCard = memo(({ 
  item, 
  onSelectTrack 
}: { 
  item: QueueItem, 
  onSelectTrack: (item: PlayableItem) => void 
}) => {
  const [ref, inView] = useInView({
    triggerOnce: true,
    threshold: 0.1
  });
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.div
            ref={ref}
            variants={animations.item}
            className="overflow-hidden cursor-pointer h-full bg-card hover:bg-card/80 transition-colors duration-200"
          >
            <Card className="h-full border-0 overflow-hidden">
              <CardContent className="p-0 h-full flex flex-col">
                <div className="relative w-full pt-[100%] group">
                  {inView && (
                    <>
                      <Image
                        src={item.track.thumbnail}
                        alt={item.track.title}
                        fill
                        style={{ objectFit: 'cover' }}
                        className="rounded-t-lg"
                        unoptimized
                      />
                      <motion.div
                        className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center"
                        initial={{ opacity: 0 }}
                        whileHover={{ opacity: 1 }}
                      >
                        <Play 
                          className="text-white w-12 h-12" 
                          onClick={() => onSelectTrack(item.track)} 
                          role="button"
                          aria-label={`${item.track.title}を再生`}
                        />
                      </motion.div>
                      {item.track.added_by?.image && (
                        <div className="absolute top-2 right-2 w-8 h-8">
                          <Image
                            src={item.track.added_by.image}
                            alt={item.track.added_by.name || 'User'}
                            width={32}
                            height={32}
                            className="rounded-full border-2 border-white"
                            unoptimized
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="p-3 flex-grow flex flex-col justify-between bg-card/50 backdrop-blur-sm">
                  <h3 className="font-bold text-sm mb-1 line-clamp-2">{item.track.title}</h3>
                  <p className="text-xs text-muted-foreground truncate">{item.track.artist}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{item.track.title}</p>
          <p className="text-xs text-muted-foreground">{item.track.artist}</p>
          {item.track.added_by && (
            <p className="text-xs text-muted-foreground mt-1">
              <User className="inline-block w-3 h-3 mr-1" />
              {item.track.added_by.name}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

HistoryCard.displayName = 'HistoryCard';

// バージョン表示コンポーネント
const VersionDisplay = memo(({ versionInfo }: { versionInfo: VersionInfo }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center justify-center text-xs text-muted-foreground hover:text-foreground transition-colors duration-200 py-2">
          <Info className="w-3 h-3 mr-1" />
          <span>{versionInfo.version}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>Version: {versionInfo.version}</p>
        <p>Build Date: {versionInfo.buildDate}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
));

VersionDisplay.displayName = 'VersionDisplay';

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onSelectTrack,
  guildId,
  activeTab,
  onTabChange,
  history = [],
  isOnDeviceMode,
}) => {
  const { toast } = useToast();
  const cacheTime = useRef<number | null>(null);
  const cachedSections = useRef<Section[] | null>(null);

  // 状態管理
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [isArtistDialogOpen, setIsArtistDialogOpen] = useState(false);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);

  // バージョン情報
  const [versionInfo] = useState<VersionInfo>({
    version: 'Ver. 0.9.0',
    buildDate: '2025.2.28',
  });
  
  // 曲の選択処理
  const handleSelectTrackCallback = useCallback(async (item: PlayableItem) => {
    await onSelectTrack(item);
  }, [onSelectTrack]);

  // アーティスト詳細表示
  const handleArtistClick = useCallback((artistId: string) => {
    setSelectedArtistId(artistId);
    setIsArtistDialogOpen(true);
  }, []);

  // アーティストダイアログ閉じる
  const closeArtistDialog = useCallback(() => {
    setIsArtistDialogOpen(false);
    setSelectedArtistId(null);
  }, []);

  // おすすめデータの取得
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // キャッシュチェック - 10分間有効
        const now = Date.now();
        if (
          cachedSections.current && 
          cacheTime.current && 
          now - cacheTime.current < 10 * 60 * 1000
        ) {
          setSections(cachedSections.current);
          setLoading(false);
          return;
        }
        
        const homeSections = await api.getRecommendations();
        
        // キャッシュ更新
        cachedSections.current = homeSections;
        cacheTime.current = now;
        
        setSections(homeSections);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error 
          ? error.message 
          : '未知のエラーが発生しました。';
        
        console.error('データの取得に失敗しました:', errorMsg);
        
        toast({
          title: 'エラー',
          description: 'おすすめデータの取得に失敗しました。',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [toast]);

  // タブ定義
  const tabs = useMemo(() => {
    const baseTabs = [
      { 
        id: 'home', 
        label: { full: 'ホーム', short: '' }, 
        icon: <Home className="w-5 h-5" />,
        gradient: 'from-blue-500 to-purple-500',
        ariaLabel: 'ホーム画面を表示'
      },
      { 
        id: 'uploaded-music', 
        label: { full: 'ライブラリ', short: '' }, 
        icon: <Music2 className="w-5 h-5" />,
        gradient: 'from-violet-500 to-indigo-500',
        ariaLabel: 'ライブラリ画面を表示'
      },
      { 
        id: 'chat', 
        label: { full: 'チャット', short: '' }, 
        icon: <MessageSquare className="w-5 h-5" />,
        gradient: 'from-green-500 to-teal-500',
        ariaLabel: 'チャット画面を表示'
      },
      { 
        id: 'ai-recommend', 
        label: { full: 'AIリコメンド', short: '' }, 
        icon: <Brain className="w-5 h-5" />,
        gradient: 'from-purple-500 to-pink-500',
        ariaLabel: 'AIリコメンド画面を表示'
      },
      { 
        id: 'valorant', 
        label: { full: 'VALORANT', short: '' }, 
        icon: <Target className="w-5 h-5" />,
        gradient: 'from-red-500 to-orange-500',
        ariaLabel: 'VALORANT画面を表示'
      },
    ];

    if (VOICE_CHAT_ENABLED) {
      baseTabs.push({ 
        id: 'realtime', 
        label: { full: 'ボイスチャット', short: '' }, 
        icon: <Mic className="w-5 h-5" />,
        gradient: 'from-orange-500 to-yellow-500',
        ariaLabel: 'ボイスチャット画面を表示'
      });
    }

    return baseTabs;
  }, []);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      onTabChange('home');
    }
  }, [activeTab, onTabChange, tabs]);

  // ホーム画面の描画(履歴 + おすすめ)
  const renderHomeContent = useCallback(() => {
    const reversedHistory = [...history].reverse();
    
    return (
      <ScrollArea className="h-full">
        <div className="p-4 space-y-10">
          {/* 再生履歴 */}
          {reversedHistory.length > 0 && guildId && (
            <section key="section-history" className="w-full" aria-labelledby="history-heading">
              <div className="flex items-center mb-4">
                <div className="mr-2 p-2 bg-primary/10 rounded-full">
                  <History className="w-6 h-6 text-primary" />
                </div>
                <h2 id="history-heading" className="text-2xl font-bold">再生履歴</h2>
              </div>
              <ScrollArea className="w-full whitespace-nowrap rounded-md border">
                <motion.div 
                  className="flex space-x-4 p-4" 
                  variants={animations.container}
                  initial="hidden"
                  animate="visible"
                >
                  {reversedHistory.map((item, idx) => (
                    <motion.div key={`history-${idx}`} className="w-[200px] h-[280px]" variants={animations.item}>
                      <HistoryCard item={item} onSelectTrack={handleSelectTrackCallback} />
                    </motion.div>
                  ))}
                </motion.div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </section>
          )}

          {/* おすすめセクション */}
          {sections.map((section, index) => (
            <section key={`section-${index}`} className="w-full" aria-labelledby={`section-heading-${index}`}>
              <div className="flex items-center mb-4">
                <div className="mr-2 p-2 bg-primary/10 rounded-full">
                  <Sparkles className="w-6 h-6 text-primary" />
                </div>
                <h2 id={`section-heading-${index}`} className="text-2xl font-bold">{section.title}</h2>
              </div>
              <ScrollArea className="w-full whitespace-nowrap rounded-md border">
                <motion.div 
                  className="flex space-x-4 p-4"
                  variants={animations.container}
                  initial="hidden"
                  animate="visible"
                >
                  {section.contents.map((item, idx) => (
                    <motion.div key={`item-${idx}`} className="w-[200px] h-[280px]" variants={animations.item}>
                      <TrackCard 
                        item={item} 
                        onSelectTrack={handleSelectTrackCallback} 
                        onArtistClick={handleArtistClick} 
                      />
                    </motion.div>
                  ))}
                </motion.div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </section>
          ))}
        </div>
      </ScrollArea>
    );
  }, [history, guildId, sections, handleSelectTrackCallback, handleArtistClick]);

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー部 */}
      <div className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-25 flex flex-col items-center py-4 sticky top-0">
        {/* タブ一覧 */}
        <nav 
          className="flex space-x-1 p-1 rounded-full bg-muted"
          aria-label="メインナビゲーション"
          role="tablist"
        >
          {tabs.map((tab) => (
            <motion.button
              key={tab.id}
              className={`flex items-center px-3 sm:px-4 py-2 text-sm font-medium rounded-full transition-all duration-300 ${
                activeTab === tab.id
                  ? `bg-gradient-to-r ${tab.gradient} text-white`
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10'
              }`}
              onClick={() => onTabChange(tab.id)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
              aria-label={tab.ariaLabel}
            >
              {tab.icon}
              <span className="ml-2 hidden sm:inline">{tab.label.full}</span>
              <span className="ml-2 sm:hidden">{tab.label.short}</span>
            </motion.button>
          ))}
        </nav>

        {/* バージョン表示 */}
        <VersionDisplay versionInfo={versionInfo} />

        {/* デバイスモードの表示 */}
        {isOnDeviceMode && (
          <div 
            className="mt-2 text-sm text-muted-foreground px-3 py-1 rounded-full bg-primary/5"
            role="status"
            aria-live="polite"
          >
            デバイスモードで動作中
          </div>
        )}
      </div>

      {/* メイン表示領域 */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {loading && activeTab === 'home' ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full overflow-auto p-4"
            >
              <Loading size="large" text="コンテンツを読み込み中..." />
            </motion.div>
          ) : (
            <motion.div
              key={activeTab}
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={animations.tabItem}
              transition={{ duration: 0.3 }}
              className="h-full overflow-auto"
              role="tabpanel"
              id={`panel-${activeTab}`}
              aria-labelledby={`tab-${activeTab}`}
            >
              {activeTab === 'home' && renderHomeContent()}

              {activeTab === 'uploaded-music' && (
                <div className="h-full">
                  <UploadedMusicScreen guildId={guildId} />
                </div>
              )}
              {activeTab === 'chat' && (
                <div className="h-full">
                  <ChatScreen />
                </div>
              )}
              {activeTab === 'ai-recommend' && (
                <div className="h-full">
                  <AIRecommendScreen onSelectTrack={handleSelectTrackCallback} />
                </div>
              )}
              {activeTab === 'valorant' && (
                <div className="h-full">
                  <VALORANTScreen />
                </div>
              )}
              {VOICE_CHAT_ENABLED && activeTab === 'realtime' && (
                <div className="h-full">
                  <RealtimeScreen />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* アーティスト詳細ダイアログ */}
      {isArtistDialogOpen && selectedArtistId && (
        <ArtistDialog
          artistId={selectedArtistId}
          isOpen={isArtistDialogOpen}
          onClose={closeArtistDialog}
          onAddTrackToQueue={handleSelectTrackCallback}
          onAddItemToQueue={handleSelectTrackCallback}
        />
      )}
    </div>
  );
};

HomeScreen.displayName = 'HomeScreen';

export default HomeScreen;
