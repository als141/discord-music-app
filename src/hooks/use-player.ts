import { useState, useCallback, useRef } from 'react';
import { Track, PlayableItem, api } from '@/utils/api';
import { useToast } from '@/hooks/use-toast';
import { useSession } from 'next-auth/react';
import { User } from '@/utils/api';

interface PlayerHookOptions {
  /**
   * サーバーID
   */
  guildId: string | null;
  
  /**
   * デバイスモードかどうか
   */
  isOnDeviceMode: boolean;
  
  /**
   * オーディオ要素の参照
   */
  audioRef?: React.RefObject<HTMLAudioElement>;
  
  /**
   * 画面に表示中のプレイヤーかどうか
   */
  isVisible?: boolean;
}

interface PlayerHookResult {
  // 再生状態
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  isLoading: boolean;
  
  // 関連トラック
  relatedTracks: Track[];
  isRelatedLoading: boolean;
  
  // 操作関数
  play: () => Promise<void>;
  pause: () => Promise<void>;
  skip: () => Promise<void>;
  previous: () => Promise<void>;
  addToQueue: (item: PlayableItem) => Promise<void>;
  reorderQueue: (startIndex: number, endIndex: number) => Promise<void>;
  removeFromQueue: (index: number) => Promise<void>;
  fetchRelatedTracks: (forceRefresh?: boolean) => Promise<void>;
  
  // アーティスト情報
  handleArtistClick: (artistName: string) => Promise<void>;
  isArtistDialogOpen: boolean;
  setIsArtistDialogOpen: (open: boolean) => void;
  selectedArtistId: string | null;
  isArtistLoading: boolean;
}

/**
 * 音楽プレイヤー機能のためのカスタムフック
 * サーバーモードとデバイスモードの両方に対応
 */
export function usePlayer({
  guildId,
  isOnDeviceMode,
  audioRef,
}: PlayerHookOptions): PlayerHookResult {
  const { toast } = useToast();
  const { data: session } = useSession();
  
  // プレイヤーの状態
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // 関連トラック
  const [relatedTracks, setRelatedTracks] = useState<Track[]>([]);
  const [isRelatedLoading, setIsRelatedLoading] = useState(false);
  
  // アーティスト情報
  const [isArtistDialogOpen, setIsArtistDialogOpen] = useState(false);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);
  const [isArtistLoading, setIsArtistLoading] = useState(false);
  
  // キャッシュ参照
  const trackCacheRef = useRef<Map<string, Track[]>>(new Map());
  const artistCacheRef = useRef<Map<string, string>>(new Map());
  
  // 再生開始
  const play = useCallback(async () => {
    if (isOnDeviceMode) {
      if (!audioRef?.current) return;
      
      setIsLoading(true);
      
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (error) {
        console.error('再生エラー:', error);
        
        // 自動再生ポリシーによる制限
        if (error instanceof Error && error.name === 'NotAllowedError') {
          toast({
            title: '自動再生が制限されています',
            description: '再生するにはページ上で操作してください。',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'エラー',
            description: '再生の開始に失敗しました。',
            variant: 'destructive',
          });
        }
      } finally {
        setIsLoading(false);
      }
    } else {
      if (!guildId) {
        toast({
          title: 'エラー',
          description: 'サーバーが選択されていません。',
          variant: 'destructive',
        });
        return;
      }
      
      try {
        await api.resumePlayback(guildId);
        setIsPlaying(true);
      } catch (error) {
        console.error('再生開始エラー:', error);
        toast({
          title: 'エラー',
          description: '再生の開始に失敗しました。',
          variant: 'destructive',
        });
      }
    }
  }, [isOnDeviceMode, audioRef, guildId, toast]);
  
  // 一時停止
  const pause = useCallback(async () => {
    if (isOnDeviceMode) {
      if (audioRef?.current) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    } else {
      if (!guildId) return;
      
      try {
        await api.pausePlayback(guildId);
        setIsPlaying(false);
      } catch (error) {
        console.error('一時停止エラー:', error);
        toast({
          title: 'エラー',
          description: '再生の一時停止に失敗しました。',
          variant: 'destructive',
        });
      }
    }
  }, [isOnDeviceMode, audioRef, guildId, toast]);
  
  // スキップ
  const skip = useCallback(async () => {
    if (isOnDeviceMode) {
      if (queue.length > 0) {
        const nextTrack = queue[0];
        setCurrentTrack(nextTrack);
        setQueue(prev => prev.slice(1));
      } else {
        setCurrentTrack(null);
        setIsPlaying(false);
      }
    } else {
      if (!guildId) return;
      
      try {
        await api.skipTrack(guildId);
      } catch (error) {
        console.error('スキップエラー:', error);
        toast({
          title: 'エラー',
          description: 'スキップに失敗しました。',
          variant: 'destructive',
        });
      }
    }
  }, [isOnDeviceMode, queue, guildId, toast]);
  
  // 前の曲へ
  const previous = useCallback(async () => {
    if (isOnDeviceMode) {
      toast({
        title: 'デバイスモード',
        description: '前の曲機能はデバイスモードではまだ利用できません。',
      });
    } else {
      if (!guildId) return;
      
      try {
        await api.previousTrack(guildId);
      } catch (error) {
        console.error('前の曲エラー:', error);
        toast({
          title: 'エラー', 
          description: '前の曲への移動に失敗しました。',
          variant: 'destructive',
        });
      }
    }
  }, [isOnDeviceMode, guildId, toast]);
  
  // キューに追加
  const addToQueue = useCallback(async (item: PlayableItem) => {
    if (isOnDeviceMode) {
      if (!currentTrack) {
        setCurrentTrack(item as Track);
        
        toast({
          title: '再生開始',
          description: `"${item.title}" の再生を開始します。`,
        });
      } else {
        setQueue(prev => [...prev, item as Track]);
        
        toast({
          title: '追加しました',
          description: `"${item.title}" をキューに追加しました。`,
        });
      }
    } else {
      if (!guildId) {
        toast({
          title: 'エラー',
          description: 'サーバーが選択されていません。',
          variant: 'destructive',
        });
        return;
      }
      
      const user = getUserInfo();
      if (!user) {
        toast({
          title: 'エラー',
          description: 'ユーザー情報を取得できませんでした。',
          variant: 'destructive',
        });
        return;
      }
      
      try {
        setIsLoading(true);
        await api.addUrl(guildId, item.url, user);
        
        toast({
          title: '成功',
          description: `"${item.title}" をキューに追加しました。`,
        });
      } catch (error) {
        console.error('追加エラー:', error);
        toast({
          title: 'エラー',
          description: 'キューへの追加に失敗しました。',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    }
  }, [isOnDeviceMode, currentTrack, guildId, session, toast]);
  
  // キューの並べ替え
  const reorderQueue = useCallback(async (startIndex: number, endIndex: number) => {
    if (isOnDeviceMode) {
      const newQueue = Array.from(queue);
      const [movedItem] = newQueue.splice(startIndex, 1);
      newQueue.splice(endIndex, 0, movedItem);
      setQueue(newQueue);
    } else {
      if (!guildId) return;
      
      try {
        const newQueue = Array.from(queue);
        const [movedItem] = newQueue.splice(startIndex, 1);
        newQueue.splice(endIndex, 0, movedItem);
        setQueue(newQueue);
        
        await api.reorderQueue(guildId, startIndex + 1, endIndex + 1);
      } catch (error) {
        console.error('並べ替えエラー:', error);
        toast({
          title: 'エラー',
          description: 'キューの並び替えに失敗しました。',
          variant: 'destructive',
        });
        
        // エラー時に元のキューに戻す
        // ここでは何もしない (WebSocket接続があれば自動的に更新される)
      }
    }
  }, [isOnDeviceMode, queue, guildId, toast]);
  
  // キューからの削除
  const removeFromQueue = useCallback(async (index: number) => {
    if (isOnDeviceMode) {
      const newQueue = Array.from(queue);
      newQueue.splice(index, 1);
      setQueue(newQueue);
      
      toast({
        title: '成功',
        description: 'キューから曲を削除しました。',
      });
    } else {
      if (!guildId) return;
      
      try {
        await api.removeFromQueue(guildId, index);
        
        const updatedQueue = [...queue];
        updatedQueue.splice(index, 1);
        setQueue(updatedQueue);
        
        toast({
          title: '成功',
          description: 'キューから曲を削除しました。',
        });
      } catch (error) {
        console.error('削除エラー:', error);
        toast({
          title: 'エラー',
          description: 'キューからの削除に失敗しました。',
          variant: 'destructive',
        });
      }
    }
  }, [isOnDeviceMode, queue, guildId, toast]);
  
  // 関連トラックの取得
  const fetchRelatedTracks = useCallback(async (forceRefresh = false) => {
    if (!currentTrack) return;
    
    setIsRelatedLoading(true);
    
    // ビデオIDを抽出
    const videoId = extractVideoId(currentTrack.url);
    if (!videoId) {
      setIsRelatedLoading(false);
      return;
    }
    
    // キャッシュをチェック (強制更新でなければ)
    if (!forceRefresh && trackCacheRef.current.has(videoId)) {
      setRelatedTracks(trackCacheRef.current.get(videoId) || []);
      setIsRelatedLoading(false);
      return;
    }
    
    try {
      const tracks = await api.getRelatedSongs(videoId);
      
      // キャッシュを更新
      trackCacheRef.current.set(videoId, tracks);
      
      setRelatedTracks(tracks);
    } catch (error) {
      console.error('関連動画の取得中にエラーが発生しました:', error);
      toast({
        title: 'エラー',
        description: '関連動画の取得に失敗しました。',
        variant: 'destructive',
      });
    } finally {
      setIsRelatedLoading(false);
    }
  }, [currentTrack, toast]);
  
  // アーティスト情報取得
  const handleArtistClick = useCallback(async (artistName: string) => {
    setIsArtistLoading(true);
    
    try {
      // キャッシュをチェック
      if (artistCacheRef.current.has(artistName)) {
        const cachedId = artistCacheRef.current.get(artistName);
        if (cachedId) {
          setSelectedArtistId(cachedId);
          setIsArtistDialogOpen(true);
          return;
        }
      }
      
      // 検索実行
      const searchResults = await api.search(artistName, 'artists');
      
      if (searchResults.length > 0) {
        const artist = searchResults[0];
        
        if (artist.browseId) {
          setSelectedArtistId(artist.browseId);
          setIsArtistDialogOpen(true);
          
          // キャッシュに保存
          artistCacheRef.current.set(artistName, artist.browseId);
        } else {
          toast({
            title: 'エラー',
            description: 'アーティスト情報を取得できませんでした。',
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: 'エラー',
          description: 'アーティストが見つかりませんでした。',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('アーティスト情報の取得に失敗しました:', error);
      toast({
        title: 'エラー',
        description: 'アーティスト情報の取得に失敗しました。',
        variant: 'destructive',
      });
    } finally {
      setIsArtistLoading(false);
    }
  }, [toast]);
  
  // ユーザー情報取得
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
  
  // URLからビデオIDを抽出するヘルパー関数
  const extractVideoId = (url: string) => {
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/)
    return match ? match[1] : null
  };
  
  return {
    // 状態
    currentTrack,
    queue,
    isPlaying,
    isLoading,
    
    // 関連トラック
    relatedTracks,
    isRelatedLoading,
    
    // 操作関数
    play,
    pause,
    skip,
    previous,
    addToQueue,
    reorderQueue,
    removeFromQueue,
    fetchRelatedTracks,
    
    // アーティスト情報
    handleArtistClick,
    isArtistDialogOpen,
    setIsArtistDialogOpen,
    selectedArtistId,
    isArtistLoading,
  };
}