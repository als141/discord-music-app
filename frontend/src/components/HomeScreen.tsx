import React, { useEffect, useState, useCallback, useMemo, memo, useRef } from 'react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { PlayableItem, SearchItem, api, Section, QueueItem } from '@/utils/api';
import { useToast } from '@/hooks/use-toast';
import { Loading } from '@/components/ui/loading';
import Image from 'next/image';
import {
  Play,
  User,
  Clock,
  Home,
  ExternalLink,
  Info,
  Music2,
  Disc3,
  ListMusic,
  Radio,
  Headphones,
  Link2,
  Clipboard,
  Plus,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useInView } from 'react-intersection-observer';
import { UploadedMusicScreen } from './UploadedMusicScreen';
import ArtistDialog from '@/components/ArtistDialog';

interface HomeScreenProps {
  onSelectTrack: (item: PlayableItem) => void;
  guildId: string | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
  history: QueueItem[];
  isOnDeviceMode: boolean;
  onAddUrl?: (url: string) => void;
}

interface VersionInfo {
  version: string;
  buildDate: string;
}

// Apple Music style animations
const animations = {
  container: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.03, ease: [0.25, 0.1, 0.25, 1] }
    },
    exit: { opacity: 0 }
  } as Variants,

  item: {
    hidden: { opacity: 0, y: 15 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }
    },
    exit: { opacity: 0, y: -10 }
  } as Variants,

  tabItem: {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }
    },
    exit: { opacity: 0, y: -10 },
  } as Variants
};

// Apple Music style track card
const TrackCard = memo(({
  item,
  onSelectTrack,
  onArtistClick
}: {
  item: SearchItem,
  onSelectTrack: (item: PlayableItem) => void,
  onArtistClick: (artistId: string) => void
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
            className="group cursor-pointer"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          >
            {/* Album Art Container */}
            <div className="relative aspect-square rounded-xl overflow-hidden bg-secondary/30 shadow-sm mb-3">
              {inView && (
                <>
                  <Image
                    src={item.thumbnail}
                    alt={item.title}
                    fill
                    style={{ objectFit: 'cover' }}
                    className="transition-transform duration-500 group-hover:scale-105"
                    unoptimized
                  />
                  {/* Hover Play Overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-300 flex items-center justify-center">
                    <motion.button
                      onClick={() => onSelectTrack(item)}
                      className="apple-play-button opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-300"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      aria-label={`${item.title}を再生`}
                    >
                      <Play className="w-6 h-6 text-white fill-white ml-0.5" />
                    </motion.button>
                  </div>
                </>
              )}
            </div>

            {/* Track Info */}
            <div className="px-1">
              <h3 className="font-semibold text-[13px] text-foreground leading-tight line-clamp-2 mb-1">
                {item.title}
              </h3>
              <p className="text-[12px] text-muted-foreground truncate">
                {item.artistId ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onArtistClick(item.artistId!);
                    }}
                    className="hover:text-primary transition-colors inline-flex items-center gap-1"
                    aria-label={`${item.artist}の詳細を表示`}
                  >
                    {item.artist}
                    <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                  </button>
                ) : (
                  <span>{item.artist}</span>
                )}
              </p>
            </div>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent className="bg-white/95 backdrop-blur-xl border-black/10 shadow-lg">
          <p className="font-medium text-foreground">{item.title}</p>
          <p className="text-xs text-muted-foreground">{item.artist}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

TrackCard.displayName = 'TrackCard';

// Apple Music style history card
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
            className="group cursor-pointer"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          >
            {/* Album Art Container */}
            <div className="relative aspect-square rounded-xl overflow-hidden bg-secondary/30 shadow-sm mb-3">
              {inView && (
                <>
                  <Image
                    src={item.track.thumbnail}
                    alt={item.track.title}
                    fill
                    style={{ objectFit: 'cover' }}
                    className="transition-transform duration-500 group-hover:scale-105"
                    unoptimized
                  />
                  {/* User Badge */}
                  {item.track.added_by?.image && (
                    <div className="absolute top-2 right-2">
                      <Image
                        src={item.track.added_by.image}
                        alt={item.track.added_by.name || 'User'}
                        width={28}
                        height={28}
                        className="rounded-full border-2 border-white shadow-md"
                        unoptimized
                      />
                    </div>
                  )}
                  {/* Hover Play Overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-300 flex items-center justify-center">
                    <motion.button
                      onClick={() => onSelectTrack(item.track)}
                      className="apple-play-button opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-300"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      aria-label={`${item.track.title}を再生`}
                    >
                      <Play className="w-6 h-6 text-white fill-white ml-0.5" />
                    </motion.button>
                  </div>
                </>
              )}
            </div>

            {/* Track Info */}
            <div className="px-1">
              <h3 className="font-semibold text-[13px] text-foreground leading-tight line-clamp-2 mb-1">
                {item.track.title}
              </h3>
              <p className="text-[12px] text-muted-foreground truncate">
                {item.track.artist}
              </p>
            </div>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent className="bg-white/95 backdrop-blur-xl border-black/10 shadow-lg">
          <p className="font-medium text-foreground">{item.track.title}</p>
          <p className="text-xs text-muted-foreground">{item.track.artist}</p>
          {item.track.added_by && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <User className="w-3 h-3" />
              {item.track.added_by.name}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

HistoryCard.displayName = 'HistoryCard';

// Version display component
const VersionDisplay = memo(({ versionInfo }: { versionInfo: VersionInfo }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center justify-center text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors duration-200 py-1">
          <Info className="w-3 h-3 mr-1" />
          <span>{versionInfo.version}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="bg-white/95 backdrop-blur-xl border-black/10 shadow-lg">
        <p>Version: {versionInfo.version}</p>
        <p>Build Date: {versionInfo.buildDate}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
));

VersionDisplay.displayName = 'VersionDisplay';

// URL Add Card - Apple Music inspired floating card
const URLAddCard = memo(({
  onAddUrl,
  isOnDeviceMode
}: {
  onAddUrl: (url: string) => void;
  isOnDeviceMode: boolean;
}) => {
  const [url, setUrl] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      toast({
        title: "ペーストしました",
        description: "URLを入力欄に貼り付けました",
      });
    } catch (err) {
      console.error('クリップボードからの読み取りに失敗しました: ', err);
      toast({
        title: "エラー",
        description: "クリップボードからの読み取りに失敗しました",
        variant: "destructive",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsSubmitting(true);
    try {
      await onAddUrl(url);
      setUrl('');
    } finally {
      setIsSubmitting(false);
    }
  };

  // デバイスモードでは表示しない
  if (isOnDeviceMode) return null;

  return (
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0.1 }}
        className="px-4 sm:px-6 mb-6"
      >
      <div
        className={`
          relative overflow-hidden rounded-2xl
          bg-gradient-to-br from-white via-white to-rose-50/30
          border transition-all duration-300
          ${isFocused
            ? 'border-primary/30 shadow-lg shadow-primary/5'
            : 'border-black/[0.04] shadow-sm'
          }
        `}
      >
        {/* Decorative gradient orb */}
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-gradient-to-br from-primary/10 via-rose-400/10 to-orange-300/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-gradient-to-tr from-violet-400/10 to-primary/5 rounded-full blur-xl pointer-events-none" />

        <div className="relative p-4 sm:p-5">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 via-primary to-rose-600 shadow-md shadow-primary/20">
              <Link2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-foreground tracking-tight">
                URLから追加
              </h3>
              <p className="text-[12px] text-muted-foreground">
                YouTube URLを貼り付けて曲を追加
              </p>
            </div>
          </div>

          {/* Input Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="https://youtube.com/watch?v=..."
                className={`
                  w-full h-12 pl-4 pr-24
                  bg-secondary/60 hover:bg-secondary/80
                  border-0 rounded-xl
                  text-[14px] placeholder:text-muted-foreground/60
                  transition-all duration-200
                  focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:bg-white
                `}
              />

              {/* Action buttons inside input */}
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      onClick={handlePaste}
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-lg hover:bg-black/5 active:bg-black/10 transition-colors"
                    >
                      <Clipboard className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-foreground text-background text-xs px-2 py-1">
                    ペースト
                  </TooltipContent>
                </Tooltip>

                <Button
                  type="submit"
                  disabled={!url.trim() || isSubmitting}
                  size="sm"
                  className={`
                    h-9 px-4 rounded-lg font-medium text-[13px]
                    bg-primary hover:bg-primary/90 active:bg-primary/80
                    text-white shadow-sm
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-all duration-200
                  `}
                >
                  {isSubmitting ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    >
                      <Sparkles className="h-4 w-4" />
                    </motion.div>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Plus className="h-4 w-4" />
                      追加
                    </span>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
      </motion.div>
    </TooltipProvider>
  );
});

URLAddCard.displayName = 'URLAddCard';

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onSelectTrack,
  guildId,
  activeTab,
  onTabChange,
  history = [],
  isOnDeviceMode,
  onAddUrl,
}) => {
  const { toast } = useToast();
  const cacheTime = useRef<number | null>(null);
  const cachedSections = useRef<Section[] | null>(null);

  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [isArtistDialogOpen, setIsArtistDialogOpen] = useState(false);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);

  const [versionInfo] = useState<VersionInfo>({
    version: 'Ver. 0.9.0',
    buildDate: '2025.2.28',
  });

  const handleSelectTrackCallback = useCallback(async (item: PlayableItem) => {
    await onSelectTrack(item);
  }, [onSelectTrack]);

  const handleArtistClick = useCallback((artistId: string) => {
    setSelectedArtistId(artistId);
    setIsArtistDialogOpen(true);
  }, []);

  const closeArtistDialog = useCallback(() => {
    setIsArtistDialogOpen(false);
    setSelectedArtistId(null);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

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

  // Tab definitions - Apple Music style
  const tabs = useMemo(() => [
    {
      id: 'home',
      label: 'ホーム',
      icon: <Home className="w-4 h-4" />,
      ariaLabel: 'ホーム画面を表示'
    },
    {
      id: 'uploaded-music',
      label: 'ライブラリ',
      icon: <Music2 className="w-4 h-4" />,
      ariaLabel: 'ライブラリ画面を表示'
    },
  ], []);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      onTabChange('home');
    }
  }, [activeTab, onTabChange, tabs]);

  // Home content renderer
  const renderHomeContent = useCallback(() => {
    const reversedHistory = [...history].reverse();

    return (
      <div className="h-full overflow-y-auto overflow-x-hidden bg-background">
        <div className="py-4 sm:py-6 space-y-8 sm:space-y-10">
          {/* URL Add Card - Apple Music Style */}
          {onAddUrl && !isOnDeviceMode && (
            <URLAddCard onAddUrl={onAddUrl} isOnDeviceMode={isOnDeviceMode} />
          )}

          {/* Recently Played - Apple Music Style */}
          {reversedHistory.length > 0 && guildId && (
            <section key="section-history" className="w-full" aria-labelledby="history-heading">
              <div className="flex items-center justify-between mb-4 sm:mb-5 px-4 sm:px-6">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-pink-500 flex items-center justify-center shadow-sm">
                    <Clock className="w-4 h-4 text-white" />
                  </div>
                  <h2 id="history-heading" className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                    最近再生した曲
                  </h2>
                </div>
                <button className="text-sm font-medium text-primary hover:text-primary/80 transition-colors">
                  すべて見る
                </button>
              </div>

              {/* Horizontal scroll container */}
              <div className="horizontal-scroll-container gap-4 sm:gap-5">
                <div className="w-4 sm:w-6 flex-shrink-0" aria-hidden="true" />
                {reversedHistory.map((item, idx) => (
                  <div
                    key={`history-${idx}`}
                    className="w-[150px] min-w-[150px] sm:w-[175px] sm:min-w-[175px] md:w-[190px] md:min-w-[190px]"
                  >
                    <HistoryCard item={item} onSelectTrack={handleSelectTrackCallback} />
                  </div>
                ))}
                <div className="w-4 sm:w-6 flex-shrink-0" aria-hidden="true" />
              </div>
            </section>
          )}

          {/* Recommendation sections - Apple Music Style */}
          {sections.map((section, index) => {
            // セクションごとに異なるグラデーションカラーを使用
            const gradients = [
              'from-rose-500 to-orange-400',      // 温かみのあるレッド→オレンジ
              'from-violet-500 to-purple-400',    // バイオレット→パープル
              'from-cyan-500 to-blue-400',        // シアン→ブルー
              'from-emerald-500 to-teal-400',     // エメラルド→ティール
              'from-amber-500 to-yellow-400',     // アンバー→イエロー
            ];
            const gradient = gradients[index % gradients.length];

            // セクションごとのアイコン
            const icons = [
              <Music2 key="music" className="w-4 h-4 text-white" />,
              <Disc3 key="disc" className="w-4 h-4 text-white" />,
              <ListMusic key="list" className="w-4 h-4 text-white" />,
              <Radio key="radio" className="w-4 h-4 text-white" />,
              <Headphones key="headphones" className="w-4 h-4 text-white" />,
            ];
            const icon = icons[index % icons.length];

            return (
            <section key={`section-${index}`} className="w-full" aria-labelledby={`section-heading-${index}`}>
              <div className="flex items-center justify-between mb-4 sm:mb-5 px-4 sm:px-6">
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow-sm`}>
                    {icon}
                  </div>
                  <h2 id={`section-heading-${index}`} className="text-lg sm:text-xl font-bold tracking-tight text-foreground line-clamp-1">
                    {section.title}
                  </h2>
                </div>
                <button className="text-sm font-medium text-primary hover:text-primary/80 transition-colors">
                  すべて見る
                </button>
              </div>

              {/* Horizontal scroll container */}
              <div className="horizontal-scroll-container gap-4 sm:gap-5">
                <div className="w-4 sm:w-6 flex-shrink-0" aria-hidden="true" />
                {section.contents.map((item, idx) => (
                  <div
                    key={`item-${idx}`}
                    className="w-[150px] min-w-[150px] sm:w-[175px] sm:min-w-[175px] md:w-[190px] md:min-w-[190px]"
                  >
                    <TrackCard
                      item={item}
                      onSelectTrack={handleSelectTrackCallback}
                      onArtistClick={handleArtistClick}
                    />
                  </div>
                ))}
                <div className="w-4 sm:w-6 flex-shrink-0" aria-hidden="true" />
              </div>
            </section>
            );
          })}

          {/* Empty state */}
          {sections.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-20 px-4">
              <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mb-4">
                <Music2 className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-center">
                おすすめの曲がありません
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }, [history, guildId, sections, loading, handleSelectTrackCallback, handleArtistClick, onAddUrl, isOnDeviceMode]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header with tabs - Apple Music style */}
      <div className="glass-subtle border-b border-border/50 z-25 flex flex-col items-center py-3 sm:py-4 sticky top-0">
        {/* Tab Navigation */}
        <div className="w-full max-w-full px-3 sm:px-4 overflow-x-auto scrollbar-thin">
          <nav
            className="flex space-x-1 p-1 rounded-full bg-secondary/60 w-fit mx-auto min-w-max"
            aria-label="メインナビゲーション"
            role="tablist"
          >
            {tabs.map((tab) => (
              <motion.button
                key={tab.id}
                className={`flex items-center gap-1.5 px-4 sm:px-5 py-2 text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-white text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => onTabChange(tab.id)}
                whileHover={{ scale: activeTab === tab.id ? 1 : 1.02 }}
                whileTap={{ scale: 0.98 }}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`panel-${tab.id}`}
                id={`tab-${tab.id}`}
                aria-label={tab.ariaLabel}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </motion.button>
            ))}
          </nav>
        </div>

        {/* Version display */}
        <VersionDisplay versionInfo={versionInfo} />

        {/* Device mode indicator */}
        {isOnDeviceMode && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 text-xs text-muted-foreground px-3 py-1.5 rounded-full bg-secondary/80 flex items-center gap-1.5"
            role="status"
            aria-live="polite"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            デバイスモードで動作中
          </motion.div>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {loading && activeTab === 'home' ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full overflow-auto p-6 flex items-center justify-center"
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
              className="h-full overflow-auto"
              role="tabpanel"
              id={`panel-${activeTab}`}
              aria-labelledby={`tab-${activeTab}`}
            >
              {activeTab === 'home' && renderHomeContent()}

              {activeTab === 'uploaded-music' && (
                <div className="h-full bg-background">
                  <UploadedMusicScreen guildId={guildId} />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Artist dialog */}
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
