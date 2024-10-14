import React, { useEffect, useState } from 'react'
import { ChatScreen } from './ChatScreen'
import { AIRecommendScreen } from './AIRecommendScreen'
import { PlayableItem, SearchItem, api, QueueItem } from '@/utils/api'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import Image from 'next/image'
import { Play, User, History, Sparkles, BarChart3, Home, MessageSquare, Brain } from 'lucide-react'
import { motion } from 'framer-motion'
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface HomeScreenProps {
  onSelectTrack: (item: PlayableItem) => void;
  guildId: string | null;
  activeTab: string;                        // 追加
  onTabChange: (tab: string) => void;       // 追加
  history: QueueItem[];                     // 追加
  isOnDeviceMode: boolean;                  // 追加
}

interface StoredData {
  recommendations: SearchItem[]
  charts: SearchItem[]
  timestamp: number
}

const STORAGE_KEY = 'homeScreenData'
const DATA_EXPIRY_TIME = 24 * 60 * 60 * 1000 // 24時間（ミリ秒単位）

export const HomeScreen: React.FC<HomeScreenProps> = ({ onSelectTrack, guildId, activeTab, onTabChange }) => {
  const [recommendations, setRecommendations] = useState<SearchItem[]>([])
  const [charts, setCharts] = useState<SearchItem[]>([])
  const [history, setHistory] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()
  const tabs = [
    { id: 'home', label: 'ホーム', icon: <Home className="w-5 h-5" /> },
    { id: 'chat', label: 'チャット', icon: <MessageSquare className="w-5 h-5" /> },
    { id: 'ai-recommend', label: 'AIリコメンド', icon: <Brain className="w-5 h-5" /> },
  ]

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        const storedData = localStorage.getItem(STORAGE_KEY)
        const parsedData: StoredData | null = storedData ? JSON.parse(storedData) : null

        if (parsedData && Date.now() - parsedData.timestamp < DATA_EXPIRY_TIME) {
          setRecommendations(parsedData.recommendations)
          setCharts(parsedData.charts)
        } else {
          const [recs, ch] = await Promise.all([
            api.getRecommendations(),
            api.getCharts(),
          ])
          setRecommendations(recs)
          setCharts(ch)

          const newData: StoredData = {
            recommendations: recs,
            charts: ch,
            timestamp: Date.now()
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newData))
        }
      } catch (error) {
        console.error('データの取得に失敗しました:', error)
        toast({
          title: 'エラー',
          description: 'データの取得に失敗しました。',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [toast])

  useEffect(() => {
    const fetchHistory = async () => {
      if (guildId) {
        try {
          const historyData = await api.getHistory(guildId);
          setHistory(historyData);
        } catch (error) {
          console.error('履歴の取得に失敗しました:', error);
          toast({
            title: 'エラー',
            description: '履歴の取得に失敗しました。',
            variant: 'destructive',
          });
        }
      } else {
        setHistory([]);
      }
    };
    fetchHistory();
  }, [guildId, toast]);

  const renderItem = (item: SearchItem, index: number) => (
    <TooltipProvider key={`item-${index}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="overflow-hidden cursor-pointer h-full bg-card hover:bg-card/80 transition-colors duration-200">
            <CardContent className="p-0 h-full flex flex-col">
              <div className="relative w-full pt-[100%] group">
                <Image 
                  src={item.thumbnail} 
                  alt={item.title} 
                  fill
                  style={{ objectFit: 'cover' }}
                  className="rounded-t-lg"
                  unoptimized
                />
                <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                  <Play className="text-white w-12 h-12" onClick={() => onSelectTrack(item)} />
                </div>
              </div>
              <div className="p-3 flex-grow flex flex-col justify-between bg-card/50 backdrop-blur-sm">
                <h3 className="font-bold text-sm mb-1 line-clamp-2">{item.title}</h3>
                <p className="text-xs text-muted-foreground truncate">{item.artist}</p>
              </div>
            </CardContent>
          </Card>
        </TooltipTrigger>
        <TooltipContent>
          <p>{item.title}</p>
          <p className="text-xs text-muted-foreground">{item.artist}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )

  const renderHistoryItem = (item: QueueItem, index: number) => (
    <TooltipProvider key={`history-${index}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="overflow-hidden cursor-pointer h-full bg-card hover:bg-card/80 transition-colors duration-200">
            <CardContent className="p-0 h-full flex flex-col">
              <div className="relative w-full pt-[100%] group">
                <Image 
                  src={item.track.thumbnail} 
                  alt={item.track.title} 
                  fill
                  style={{ objectFit: 'cover' }}
                  className="rounded-t-lg"
                  unoptimized
                />
                <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                  <Play className="text-white w-12 h-12" onClick={() => onSelectTrack(item.track)} />
                </div>
                {item.track.added_by && item.track.added_by.image && (
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
              </div>
              <div className="p-3 flex-grow flex flex-col justify-between bg-card/50 backdrop-blur-sm">
                <h3 className="font-bold text-sm mb-1 line-clamp-2">{item.track.title}</h3>
                <p className="text-xs text-muted-foreground truncate">{item.track.artist}</p>
              </div>
            </CardContent>
          </Card>
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
  )

  const renderSkeletonItem = (key: number) => (
    <Card key={`skeleton-${key}`} className="overflow-hidden h-full">
      <CardContent className="p-0 h-full">
        <Skeleton className="w-full pt-[100%]" />
        <div className="p-3">
          <Skeleton className="h-4 w-3/4 mb-2" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </CardContent>
    </Card>
  )

  const ScrollableSectionForSearchItems: React.FC<{ 
    title: string; 
    icon: React.ReactNode;
    items: SearchItem[]; 
    renderItem: (item: SearchItem, index: number) => React.ReactNode; 
    reverse?: boolean 
  }> = ({ title, icon, items, renderItem, reverse = false }) => {
    return (
      <div className="mb-8 w-full">
        <div className="flex items-center mb-4">
          <div className="mr-2 p-2 bg-primary/10 rounded-full">
            {icon}
          </div>
          <h2 className="text-2xl font-bold">{title}</h2>
        </div>
        <ScrollArea className="w-full whitespace-nowrap rounded-md border">
          <div className="flex space-x-4 p-4">
            {(reverse ? [...items].reverse() : items).map((item, index) => (
              <div key={index} className="w-[200px] h-[280px]">
                {renderItem(item, index)}
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    );
  };
  
  const ScrollableSectionForQueueItems: React.FC<{ 
    title: string; 
    icon: React.ReactNode;
    items: QueueItem[]; 
    renderItem: (item: QueueItem, index: number) => React.ReactNode; 
    reverse?: boolean 
  }> = ({ title, icon, items, renderItem, reverse = false }) => {
    return (
      <div className="mb-8 w-full">
        <div className="flex items-center mb-4">
          <div className="mr-2 p-2 bg-primary/10 rounded-full">
            {icon}
          </div>
          <h2 className="text-2xl font-bold">{title}</h2>
        </div>
        <ScrollArea className="w-full whitespace-nowrap rounded-md border">
          <div className="flex space-x-4 p-4">
            {(reverse ? [...items].reverse() : items).map((item, index) => (
              <div key={index} className="w-[200px] h-[280px]">
                {renderItem(item, index)}
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-25 flex justify-center py-4 sticky top-0">
        <nav className="flex space-x-1 p-1 rounded-full bg-muted">
          {tabs.map((tab) => (
            <motion.button
              key={tab.id}
              className={`${
                activeTab === tab.id
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground'
              } flex items-center px-4 py-2 text-sm font-medium rounded-full transition-colors duration-200`}
              onClick={() => onTabChange(tab.id)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {tab.icon}
              <span className="ml-2">{tab.label}</span>
            </motion.button>
          ))}
        </nav>
      </div>
      <div className="flex-grow overflow-hidden">
        {activeTab === 'home' && (
          <ScrollArea className="h-full">
            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full p-4">
                {Array.from({ length: 16 }).map((_, index) => renderSkeletonItem(index))}
              </div>
            ) : (
              <div className="p-4">
                {history.length > 0 && guildId && (
                  <ScrollableSectionForQueueItems 
                    title="再生履歴" 
                    icon={<History className="w-6 h-6 text-primary" />}
                    items={history} 
                    renderItem={renderHistoryItem} 
                    reverse={true} 
                  />
                )}
                <ScrollableSectionForSearchItems 
                  title="おすすめの曲" 
                  icon={<Sparkles className="w-6 h-6 text-primary" />}
                  items={recommendations} 
                  renderItem={renderItem} 
                />
                <ScrollableSectionForSearchItems 
                  title="チャート" 
                  icon={<BarChart3 className="w-6 h-6 text-primary" />}
                  items={charts} 
                  renderItem={renderItem} 
                />
              </div>
            )}
          </ScrollArea>
        )}
        {activeTab === 'chat' && <ChatScreen />}
        {activeTab === 'ai-recommend' && <AIRecommendScreen onSelectTrack={onSelectTrack} />}
      </div>
    </div>
  )
}