"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { PlayableItem, SearchItem, api, Section, QueueItem } from '@/utils/api';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
  Trash2,
  Edit
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChatScreen } from './ChatScreen';
import { AIRecommendScreen } from './AIRecommendScreen';
import { VALORANTScreen } from './VALORANTScreen';
import ArtistDialog from '@/components/ArtistDialog';
import { RealtimeScreen } from './RealtimeScreen';
import { UploadDialog } from './UploadDialog';
import { Button } from '@/components/ui/button';
import { useSession } from 'next-auth/react';

interface HomeScreenProps {
  onSelectTrack: (item: PlayableItem) => void;
  guildId: string | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
  history: QueueItem[];
  isOnDeviceMode: boolean;
}

/** DBから取得するアップロード曲の型 */
type UploadedSong = {
  id: string;
  guild_id: string;
  title: string;
  artist: string;
  filename: string;
  thumbnail_filename: string;
  uploader_id: string;
  uploader_name: string;
  full_path: string; // 実際のファイル絶対パス
};

interface VersionInfo {
  version: string;
  buildDate: string;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onSelectTrack,
  guildId,
  activeTab,
  onTabChange,
  history,
  isOnDeviceMode,
}) => {
  const { toast } = useToast();
  const { data: session } = useSession();

  // -------------------------------
  // 既存のステート
  // -------------------------------
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  // アーティスト情報モーダル関連
  const [isArtistDialogOpen, setIsArtistDialogOpen] = useState(false);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);

  // -------------------------------
  // 追加: アップロード関連ステート
  // -------------------------------
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploadedSongs, setUploadedSongs] = useState<UploadedSong[]>([]);

  // -------------------------------
  // バージョン情報（元コードに含まれる）
  // -------------------------------
  const [versionInfo] = useState<VersionInfo>({
    version: 'Ver. 0.8.0',
    buildDate: '2024.12/21',
  });

  // -------------------------------
  // バージョン表示コンポーネント
  // -------------------------------
  const VersionDisplay = () => (
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
  );

  // -------------------------------
  // アップロード済み楽曲の一覧取得
  // -------------------------------
  const fetchUploadedSongs = useCallback(async () => {
    if (!guildId) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/uploaded-audio-list/${guildId}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "アップロード済み楽曲の取得に失敗しました");
      }
      const data: UploadedSong[] = await res.json();
      setUploadedSongs(data);
    } catch (error: any) {
      console.error('アップロード済み楽曲の取得エラー:', error);
      toast({
        title: 'エラー',
        description: error.message,
        variant: 'destructive',
      });
    }
  }, [guildId, toast]);

  // -------------------------------
  // 楽曲削除
  // -------------------------------
  const handleDeleteUploadedSong = async (song: UploadedSong) => {
    if (!session || !session.user || !guildId) return;
    try {
      const params = new URLSearchParams();
      params.append('user_id', session.user.id);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/uploaded-audio-delete/${guildId}/${song.id}?${params.toString()}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "削除に失敗しました。");
      }
      toast({
        title: "削除成功",
        description: `"${song.title}" を削除しました。`,
      });
      fetchUploadedSongs();
    } catch (error: any) {
      toast({
        title: "エラー",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // -------------------------------
  // 楽曲編集（タイトル・アーティスト）
  // -------------------------------
  const handleEditUploadedSong = async (song: UploadedSong) => {
    if (!session || !session.user || !guildId) return;
    const newTitle = prompt("新しいタイトルを入力してください", song.title);
    const newArtist = prompt("新しいアーティスト名を入力してください", song.artist);
    if (!newTitle || !newArtist) {
      return; // キャンセル
    }
    try {
      const formData = new FormData();
      formData.append("title", newTitle);
      formData.append("artist", newArtist);
      formData.append("user_id", session.user.id);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/uploaded-audio-edit/${guildId}/${song.id}`, {
        method: "PUT",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "編集に失敗しました。");
      }
      toast({
        title: "編集成功",
        description: "楽曲情報を更新しました。",
      });
      fetchUploadedSongs();
    } catch (error: any) {
      toast({
        title: "エラー",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // -------------------------------
  // アップロード楽曲を再生キューに追加
  // -------------------------------
  const handleAddUploadedSongToQueue = async (song: UploadedSong) => {
    if (!guildId) {
      toast({
        title: "エラー",
        description: "サーバーが選択されていません。",
        variant: "destructive",
      });
      return;
    }
    const user = session?.user
      ? {
          id: session.user.id,
          name: session.user.name || '',
          image: session.user.image || '',
        }
      : null;
    if (!user) {
      toast({
        title: "エラー",
        description: "ユーザー情報を取得できませんでした。",
        variant: "destructive",
      });
      return;
    }

    // ここで full_path を直接渡す(ローカルファイル再生)
    try {
      await api.addUrl(guildId, song.full_path, user);
      toast({
        title: "成功",
        description: `"${song.title}" をキューに追加しました。`,
      });
    } catch (error: any) {
      toast({
        title: "エラー",
        description: error.message || "キューに追加できませんでした。",
        variant: "destructive",
      });
    }
  };

  // -------------------------------
  // ギルドIDが変わったらアップロード一覧を再取得
  // -------------------------------
  useEffect(() => {
    if (guildId) {
      fetchUploadedSongs();
    } else {
      setUploadedSongs([]);
    }
  }, [guildId, fetchUploadedSongs]);

  // -------------------------------
  // 元々の「selectTrack」などの処理
  // -------------------------------
  const handleSelectTrack = async (item: PlayableItem) => {
    await onSelectTrack(item);
  };

  const handleArtistClick = (artistId: string) => {
    setSelectedArtistId(artistId);
    setIsArtistDialogOpen(true);
  };

  const closeArtistDialog = () => {
    setIsArtistDialogOpen(false);
    setSelectedArtistId(null);
  };

  // -------------------------------
  // タブ定義
  // -------------------------------
  const tabs = [
    { 
      id: 'home', 
      label: { full: 'ホーム', short: 'ホーム' }, 
      icon: <Home className="w-5 h-5" />,
      gradient: 'from-blue-500 to-purple-500'
    },
    { 
      id: 'chat', 
      label: { full: 'チャット', short: '' }, 
      icon: <MessageSquare className="w-5 h-5" />,
      gradient: 'from-green-500 to-teal-500'
    },
    { 
      id: 'ai-recommend', 
      label: { full: 'AIリコメンド', short: 'AI' }, 
      icon: <Brain className="w-5 h-5" />,
      gradient: 'from-purple-500 to-pink-500'
    },
    { 
      id: 'valorant', 
      label: { full: 'VALORANT', short: 'VALO' }, 
      icon: <Target className="w-5 h-5" />,
      gradient: 'from-red-500 to-orange-500'
    },
    { 
      id: 'realtime', 
      label: { full: 'ボイスチャット', short: '' }, 
      icon: <Mic className="w-5 h-5" />,
      gradient: 'from-orange-500 to-yellow-500'
    }
  ];

  // -------------------------------
  // データ取得（おすすめセクション）: 元コード
  // -------------------------------
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const homeSections = await api.getRecommendations();
        setSections(homeSections);
      } catch (error) {
        console.error('データの取得に失敗しました:', error);
        toast({
          title: 'エラー',
          description: 'データの取得に失敗しました。',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [toast]);

  // -------------------------------
  // 再生履歴の取得
  // -------------------------------
  const [localHistory, setLocalHistory] = useState<QueueItem[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
      if (guildId) {
        try {
          const historyData = await api.getHistory(guildId);
          setLocalHistory(historyData);
        } catch (error: any) {
          console.error('履歴の取得に失敗しました:', error);
          toast({
            title: 'エラー',
            description: '履歴の取得に失敗しました。',
            variant: 'destructive',
          });
        }
      } else {
        setLocalHistory([]);
      }
    };
    fetchHistory();
  }, [guildId, toast]);

  // -------------------------------
  // レンダリング用のヘルパー
  // -------------------------------
  const renderItem = useCallback((item: SearchItem, index: number) => (
    <TooltipProvider key={`item-${index}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="overflow-hidden cursor-pointer h-full bg-card hover:bg-card/80 transition-colors duration-200">
            <CardContent className="p-0 h-full flex flex-col">
              <motion.div
                className="relative w-full pt-[100%] group"
                whileHover={{ scale: 1.05 }}
                transition={{ duration: 0.2 }}
              >
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
                  <Play className="text-white w-12 h-12" onClick={() => onSelectTrack(item)} />
                </motion.div>
              </motion.div>
              <div className="p-3 flex-grow flex flex-col justify-between bg-card/50 backdrop-blur-sm">
                <h3 className="font-bold text-sm mb-1 line-clamp-2">{item.title}</h3>
                <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                  {item.artistId ? (
                    <motion.button
                      onClick={() => handleArtistClick(item.artistId!)}
                      className="text-primary hover:text-primary/80 flex items-center gap-1 rounded px-1.5 py-0.5 bg-primary/10 hover:bg-primary/20 transition-colors duration-200"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
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
        </TooltipTrigger>
        <TooltipContent>
          <p>{item.title}</p>
          <p className="text-xs text-muted-foreground">{item.artist}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ), [onSelectTrack, handleArtistClick]);

  const renderHistoryItem = useCallback((item: QueueItem, index: number) => (
    <TooltipProvider key={`history-${index}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="overflow-hidden cursor-pointer h-full bg-card hover:bg-card/80 transition-colors duration-200">
            <CardContent className="p-0 h-full flex flex-col">
              <motion.div
                className="relative w-full pt-[100%] group"
                whileHover={{ scale: 1.05 }}
                transition={{ duration: 0.2 }}
              >
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
                  <Play className="text-white w-12 h-12" onClick={() => onSelectTrack(item.track)} />
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
              </motion.div>
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
  ), [onSelectTrack]);

  // -------------------------------
  // ホーム画面の描画(履歴 + おすすめ + アップロード一覧)
  // -------------------------------
  const renderHomeContent = () => {
    return (
      <ScrollArea className="h-full">
        <div className="p-4">
          {/* 再生履歴 */}
          {localHistory.length > 0 && guildId && (
            <div key="section-history" className="mb-8 w-full">
              <div className="flex items-center mb-4">
                <div className="mr-2 p-2 bg-primary/10 rounded-full">
                  <History className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-2xl font-bold">再生履歴</h2>
              </div>
              <ScrollArea className="w-full whitespace-nowrap rounded-md border">
                <div className="flex space-x-4 p-4">
                  {localHistory.slice().reverse().map((item, idx) => (
                    <div key={idx} className="w-[200px] h-[280px]">
                      {renderHistoryItem(item, idx)}
                    </div>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>
          )}

          {/* アップロードされた楽曲一覧 */}
          <div className="my-8">
            <h2 className="text-xl font-bold mb-3">アップロードされた楽曲一覧</h2>
            {uploadedSongs.length === 0 ? (
              <p className="text-sm text-muted-foreground">まだ楽曲がアップロードされていません。</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {uploadedSongs.map((song) => {
                  const thumbUrl = song.thumbnail_filename
                    ? `${process.env.NEXT_PUBLIC_API_URL}/uploaded_music/${song.thumbnail_filename}`
                    : "/default_thumbnail.png";

                  return (
                    <Card
                      key={song.id}
                      className="overflow-hidden bg-card hover:bg-card/80 transition-colors cursor-pointer relative"
                    >
                      <CardContent className="p-0">
                        <motion.div
                          className="relative w-full pt-[100%] group"
                          whileHover={{ scale: 1.03 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Image
                            src={thumbUrl}
                            alt={song.title}
                            fill
                            style={{ objectFit: 'cover' }}
                            className="rounded-t-lg"
                            unoptimized
                          />
                          <motion.div
                            className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                            initial={{ opacity: 0 }}
                            whileHover={{ opacity: 1 }}
                          >
                            <Play
                              className="text-white w-12 h-12"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddUploadedSongToQueue(song);
                              }}
                            />
                          </motion.div>
                        </motion.div>
                        <div className="p-3">
                          <h3 className="font-bold text-sm mb-1 line-clamp-2">{song.title}</h3>
                          <p className="text-xs text-muted-foreground line-clamp-1">{song.artist}</p>
                          {/* アップローダー */}
                          <p className="text-xs text-muted-foreground mt-2 flex items-center">
                            <User className="w-3 h-3 mr-1" />
                            {song.uploader_name}
                          </p>
                          {/* アップロード者のみ編集・削除ボタン */}
                          {session?.user?.id === song.uploader_id && (
                            <div className="flex space-x-2 mt-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditUploadedSong(song);
                                }}
                              >
                                <Edit className="w-4 h-4 mr-1" />
                                編集
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteUploadedSong(song);
                                }}
                              >
                                <Trash2 className="w-4 h-4 mr-1" />
                                削除
                              </Button>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* おすすめセクション */}
          {sections.map((section, index) => (
            <div key={`section-${index}`} className="mb-8 w-full">
              <div className="flex items-center mb-4">
                <div className="mr-2 p-2 bg-primary/10 rounded-full">
                  <Sparkles className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-2xl font-bold">{section.title}</h2>
              </div>
              <ScrollArea className="w-full whitespace-nowrap rounded-md border">
                <div className="flex space-x-4 p-4">
                  {section.contents.map((item, idx) => (
                    <div key={idx} className="w-[200px] h-[280px]">
                      {renderItem(item, idx)}
                    </div>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>
          ))}
        </div>
      </ScrollArea>
    );
  };

  // -------------------------------
  // フリクションアニメーション設定
  // -------------------------------
  const tabVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
  };

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー部 */}
      <div className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-25 flex flex-col items-center py-4 sticky top-0">
        {/* タブ一覧 */}
        <nav className="flex space-x-1 p-1 rounded-full bg-muted">
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
            >
              {tab.icon}
              <span className="ml-2 hidden sm:inline">{tab.label.full}</span>
              <span className="ml-2 sm:hidden">{tab.label.short}</span>
            </motion.button>
          ))}
        </nav>

        {/* バージョン表示 */}
        <VersionDisplay />

        {/* アップロードボタン (home & guildIdがある時) */}
        {activeTab === 'home' && guildId && (
          <div className="flex items-center mt-2">
            <Button variant="default" onClick={() => setIsUploadDialogOpen(true)}>
              楽曲をアップロード
            </Button>
          </div>
        )}
      </div>

      {/* アップロードダイアログ */}
      <UploadDialog
        isOpen={isUploadDialogOpen}
        onClose={() => setIsUploadDialogOpen(false)}
        guildId={guildId}
        onUploaded={fetchUploadedSongs}
      />

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
              {/* ローディング時のスケルトン */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="w-full aspect-square rounded-lg" />
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={activeTab}
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={tabVariants}
              transition={{ duration: 0.3 }}
              className="h-full overflow-auto"
            >
              {activeTab === 'home' && renderHomeContent()}

              {activeTab === 'chat' && (
                <div className="h-full">
                  <ChatScreen />
                </div>
              )}
              {activeTab === 'ai-recommend' && (
                <div className="h-full">
                  <AIRecommendScreen onSelectTrack={onSelectTrack} />
                </div>
              )}
              {activeTab === 'valorant' && (
                <div className="h-full">
                  <VALORANTScreen />
                </div>
              )}
              {activeTab === 'realtime' && (
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
          onAddTrackToQueue={handleSelectTrack}
          onAddItemToQueue={handleSelectTrack}
        />
      )}
    </div>
  );
};

HomeScreen.displayName = 'HomeScreen';

export default HomeScreen;
