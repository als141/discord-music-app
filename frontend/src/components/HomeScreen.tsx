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
  Music2,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useInView } from 'react-intersection-observer';
import { ListeningRoomHero } from './home/ListeningRoomHero';
import { useGuildStore } from '@/store';
import { UploadedMusicScreen } from './UploadedMusicScreen';
import ArtistDialog from '@/components/ArtistDialog';

interface HomeScreenProps {
  onSelectTrack: (item: PlayableItem) => void;
  guildId: string | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
  history: QueueItem[];
  onAddUrl?: (url: string) => void;
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
            <div className="relative aspect-square rounded-2xl overflow-hidden bg-secondary/40 border border-border/60 shadow-sm mb-3">
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
        <TooltipContent className="bg-card/95 backdrop-blur-xl border-border shadow-lg">
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
            <div className="relative aspect-square rounded-2xl overflow-hidden bg-secondary/40 border border-border/60 shadow-sm mb-3">
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
        <TooltipContent className="bg-card/95 backdrop-blur-xl border-border shadow-lg">
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



export const HomeScreen: React.FC<HomeScreenProps> = React.memo(({
  onSelectTrack,
  guildId,
  activeTab,
  onTabChange,
  history = [],
  onAddUrl,
}) => {
  const { toast } = useToast();
  const guildName = useGuildStore(s => s.mutualServers.find(g => g.id === guildId)?.name ?? null);
  const cacheTime = useRef<number | null>(null);
  const cachedSections = useRef<Section[] | null>(null);

  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [isArtistDialogOpen, setIsArtistDialogOpen] = useState(false);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);


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
          {/* Listening room hero（見出し + URL 追加 + サーバー統計） */}
          <ListeningRoomHero guildId={guildId} guildName={guildName} onAddUrl={onAddUrl} />

          {/* Recently Played - Apple Music Style */}
          {reversedHistory.length > 0 && guildId && (
            <section key="section-history" className="w-full" aria-labelledby="history-heading">
              <div className="flex items-end justify-between mb-4 sm:mb-5 px-4 sm:px-6">
                <div className="flex items-baseline gap-3">
                  <h2 id="history-heading" className="font-display text-[22px] sm:text-[26px] font-medium text-foreground">
                    最近再生した曲
                  </h2>
                  <span className="text-[11px] tracking-[0.16em] uppercase text-muted-foreground inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" aria-hidden="true" />Recently played
                  </span>
                </div>
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
            return (
            <section key={`section-${index}`} className="w-full" aria-labelledby={`section-heading-${index}`}>
              <div className="flex items-end justify-between mb-4 sm:mb-5 px-4 sm:px-6">
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="font-display text-[13px] text-muted-foreground tabular-nums" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h2 id={`section-heading-${index}`} className="font-display text-[22px] sm:text-[26px] font-medium text-foreground line-clamp-1">
                    {section.title}
                  </h2>
                </div>
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
  }, [history, guildId, guildName, sections, loading, handleSelectTrackCallback, handleArtistClick, onAddUrl]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* タブ: 見出し書体のアンダーラインタブ（左寄せ、余計な装飾なし） */}
      <div className="border-b border-border/70 sticky top-0 z-25 bg-background/85 backdrop-blur-md">
        <div className="px-4 sm:px-6 overflow-x-auto scrollbar-thin">
          <nav className="flex gap-6 sm:gap-8 min-w-max" aria-label="メインナビゲーション" role="tablist">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  className={`relative flex items-center gap-2 py-3.5 text-[15px] transition-colors ${
                    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => onTabChange(tab.id)}
                  role="tab"
                  aria-selected={active}
                  aria-controls={`panel-${tab.id}`}
                  id={`tab-${tab.id}`}
                  aria-label={tab.ariaLabel}
                >
                  <span className={active ? 'text-primary' : ''}>{tab.icon}</span>
                  <span className="font-display text-[17px] font-medium">{tab.label}</span>
                  {active && (
                    <motion.span
                      layoutId="home-tab-underline"
                      className="absolute left-0 right-0 -bottom-px h-[2px] bg-primary rounded-full"
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
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
});

HomeScreen.displayName = 'HomeScreen';

export default HomeScreen;
