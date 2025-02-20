"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import {
  Play,
  User,
  Music2,
  Search,
  SortAsc,
  ChevronDown,
  Edit3,
  Trash2,
  MoreVertical,
} from 'lucide-react';
import { api } from '@/utils/api';
import { UploadDialog } from './UploadDialog';

type UploadedSong = {
  id: string;
  guild_id: string;
  title: string;
  artist: string;
  filename: string;
  thumbnail_filename: string;
  uploader_id: string;
  uploader_name: string;
  full_path: string;
  uploaded_at?: string;
};

interface UploadedMusicScreenProps {
  guildId: string | null;
}

// 検索入力をメモ化
const SearchInput = React.memo(
  ({ value, onChange }: { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) => (
    <div className="relative w-full sm:w-[200px]">
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder="Search songs..."
        className="w-full px-3 py-2 rounded-lg border bg-background shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
    </div>
  )
);

SearchInput.displayName = 'SearchInput';

// コンポーネント定義
export const UploadedMusicScreen: React.FC<UploadedMusicScreenProps> = ({ guildId }) => {
  const { toast } = useToast();
  const { data: session } = useSession();
  const baseURL = process.env.NEXT_PUBLIC_API_URL || "";

  // ステート
  const [songs, setSongs] = useState<UploadedSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchValue, setSearchValue] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title' | 'artist'>('newest');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  // 楽曲一覧を取得
  const fetchSongs = useCallback(async () => {
    if (!guildId) return;
    setLoading(true);
    try {
      const res = await fetch(`${baseURL}/uploaded-audio-list/${guildId}`);
      if (!res.ok) throw new Error('楽曲一覧の取得に失敗しました');
      const data = await res.json();
      setSongs(Array.isArray(data) ? data : []);
    } catch {
      toast({
        title: 'エラー',
        description: '楽曲一覧の取得に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [guildId, baseURL, toast]);

  useEffect(() => {
    fetchSongs();
  }, [fetchSongs]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
  }, []);

  // キューに追加
  const handlePlaySong = useCallback(async (song: UploadedSong) => {
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
    try {
      await api.addUrl(guildId, song.full_path, user);
      toast({
        title: "成功",
        description: `"${song.title}" をキューに追加しました。`,
      });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : '未知のエラーが発生しました。';
      toast({
        title: "エラー",
        description: errorMsg || "キューに追加できませんでした。",
        variant: "destructive",
      });
    }
  }, [guildId, session, toast]);

  const handleDeleteSong = useCallback(async (song: UploadedSong) => {
    if (!session?.user?.id || !guildId) return;
    if (!confirm('この楽曲を削除してもよろしいですか？')) return;
    try {
      const params = new URLSearchParams({ user_id: session.user.id });
      const res = await fetch(
        `${baseURL}/uploaded-audio-delete/${guildId}/${song.id}?${params.toString()}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('楽曲の削除に失敗しました');
      toast({ title: '成功', description: `"${song.title}" を削除しました。` });
      fetchSongs();
    } catch {
      toast({
        title: 'エラー',
        description: '楽曲の削除に失敗しました。',
        variant: 'destructive',
      });
    }
  }, [session, guildId, baseURL, toast, fetchSongs]);

  const handleEditSong = useCallback(async (song: UploadedSong) => {
    if (!session?.user?.id || !guildId) return;
    const newTitle = prompt('新しいタイトルを入力してください:', song.title);
    const newArtist = prompt('新しいアーティスト名を入力してください:', song.artist);
    if (!newTitle || !newArtist) return;
    try {
      const formData = new FormData();
      formData.append('title', newTitle);
      formData.append('artist', newArtist);
      formData.append('user_id', session.user.id);

      const res = await fetch(
        `${baseURL}/uploaded-audio-edit/${guildId}/${song.id}`,
        { method: 'PUT', body: formData }
      );
      if (!res.ok) throw new Error('楽曲情報の更新に失敗しました');
      toast({ title: '成功', description: '楽曲情報を更新しました。' });
      fetchSongs();
    } catch {
      toast({
        title: 'エラー',
        description: '楽曲情報の更新に失敗しました。',
        variant: 'destructive',
      });
    }
  }, [session, guildId, baseURL, toast, fetchSongs]);

  // フィルタリングとソート
  const filteredAndSortedSongs = React.useMemo(() => {
    return songs
      .filter(song => {
        const lower = searchValue.toLowerCase();
        return (
          song.title.toLowerCase().includes(lower) ||
          song.artist.toLowerCase().includes(lower) ||
          song.uploader_name.toLowerCase().includes(lower)
        );
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'title':
            return a.title.localeCompare(b.title);
          case 'artist':
            return a.artist.localeCompare(b.artist);
          case 'oldest':
            return (a.uploaded_at || '').localeCompare(b.uploaded_at || '');
          case 'newest':
          default:
            return (b.uploaded_at || '').localeCompare(a.uploaded_at || '');
        }
      });
  }, [songs, searchValue, sortBy]);

  const listItemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
  };

  return (
    <div className="h-full flex flex-col">
      {/* ヘッダー部 */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="container mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Music2 className="w-6 h-6" />
            <h1 className="text-2xl font-bold">Uploaded Music</h1>
            <Badge variant="secondary" className="ml-2">
              {filteredAndSortedSongs.length} songs
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <SearchInput value={searchValue} onChange={handleSearchChange} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <SortAsc className="w-4 h-4" />
                  Sort
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSortBy('newest')}>
                  Newest First
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('oldest')}>
                  Oldest First
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('title')}>
                  By Title
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('artist')}>
                  By Artist
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            >
              {viewMode === 'grid' ? 'List View' : 'Grid View'}
            </Button>
            <Button variant="default" onClick={() => setIsUploadDialogOpen(true)}>
              Upload Music
            </Button>
          </div>
        </div>
      </div>

      {/* アップロードダイアログ */}
      <UploadDialog
        isOpen={isUploadDialogOpen}
        onClose={() => setIsUploadDialogOpen(false)}
        guildId={guildId}
        onUploaded={fetchSongs}
      />

      {/* メインコンテンツ */}
      <ScrollArea className="flex-1">
        <div className="container mx-auto px-4 py-6">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="h-48 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </div>
          ) : (
            <AnimatePresence>
              {filteredAndSortedSongs.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-center py-12"
                >
                  <Music2 className="w-12 h-12 mx-auto text-muted-foreground" />
                  <p className="mt-4 text-lg text-muted-foreground">
                    No songs found. Try adjusting your search or upload some music!
                  </p>
                </motion.div>
              ) : viewMode === 'grid' ? (
                <motion.div
                  key="grid"
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  variants={listItemVariants}
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                >
                  {filteredAndSortedSongs.map((song) => (
                    <motion.div
                      key={song.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="group relative bg-card rounded-lg overflow-hidden shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer"
                    >
                      <div className="aspect-square relative">
                        <Image
                          src={song.thumbnail_filename 
                                ? `${baseURL}/uploaded_music/${song.thumbnail_filename}` 
                                : "/default_thumbnail.png"}
                          alt={song.title}
                          fill
                          className="object-cover transition-transform duration-300 group-hover:scale-105"
                          unoptimized
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                          <Button
                            size="lg"
                            className="rounded-full"
                            onClick={() => handlePlaySong(song)}
                          >
                            <Play className="w-6 h-6" />
                          </Button>
                        </div>
                      </div>
                      <div className="p-4">
                        <h3 className="font-semibold text-lg line-clamp-1">{song.title}</h3>
                        <p className="text-muted-foreground line-clamp-1">{song.artist}</p>
                        <div className="mt-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">{song.uploader_name}</span>
                          </div>
                          {session?.user?.id === song.uploader_id && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleEditSong(song)}>
                                  <Edit3 className="w-4 h-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleDeleteSong(song)}
                                  className="text-destructive"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="list"
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  variants={listItemVariants}
                  className="space-y-2"
                >
                  {filteredAndSortedSongs.map((song) => (
                    <motion.div
                      key={song.id}
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className="flex items-center gap-4 p-3 bg-card rounded-lg hover:bg-accent transition-all duration-200 group cursor-pointer"
                      onClick={() => handlePlaySong(song)}
                    >
                      <div className="flex-shrink-0 w-16 h-16 relative">
                        <Image
                          src={song.thumbnail_filename 
                                ? `${baseURL}/uploaded_music/${song.thumbnail_filename}` 
                                : "/default_thumbnail.png"}
                          alt={song.title}
                          fill
                          className="object-cover rounded-md"
                          unoptimized
                        />
                      </div>
                      <div className="flex-grow min-w-0">
                        <h3 className="font-semibold line-clamp-1">{song.title}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-1">{song.artist}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <User className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{song.uploader_name}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlaySong(song);
                          }}
                        >
                          <Play className="w-4 h-4" />
                        </Button>
                        {session?.user?.id === song.uploader_id && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEditSong(song)}>
                                <Edit3 className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDeleteSong(song)}
                                className="text-destructive"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

UploadedMusicScreen.displayName = 'UploadedMusicScreen';
