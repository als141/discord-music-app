// src/contexts/MainPlayerContext.tsx
'use client';

import React, { createContext, useState, useEffect, useContext } from 'react';
import { Track } from '@/utils/api';
import { api } from '@/utils/api';
import { useToast } from '@/hooks/use-toast';
import { useSession } from 'next-auth/react';
import { User } from '@/utils/api';


// コンテキストの型定義
interface MainPlayerContextProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  playTrack: (track: Track) => void;
  pauseTrack: () => void;
  skipTrack: () => void;
  previousTrack: () => void;
  queue: Track[];
  reorderQueue: (startIndex: number, endIndex: number) => void;
  deleteFromQueue: (index: number) => void;
}

const MainPlayerContext = createContext<MainPlayerContextProps>({
  currentTrack: null,
  isPlaying: false,
  playTrack: () => {},
  pauseTrack: () => {},
  skipTrack: () => {},
  previousTrack: () => {},
  queue: [],
  reorderQueue: () => {},
  deleteFromQueue: () => {},
});

export const useMainPlayer = () => useContext(MainPlayerContext);

export const MainPlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: session } = useSession();
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queue, setQueue] = useState<Track[]>([]);
  const { toast } = useToast();
  const [activeServerId, setActiveServerId] = useState<string | null>(null);

  // 初期データの取得
  useEffect(() => {
    const savedServerId = localStorage.getItem('activeServerId');
    if (savedServerId) {
      setActiveServerId(savedServerId);
      fetchInitialState(savedServerId);
    }
  }, []);

  const getUserInfo = (): User | null => {
    if (session && session.user) {
      return {
        id: session.user.id,
        name: session.user.name || '',
        image: session.user.image || '',
      };
    }
    return null;
  };  

  // 初期状態の取得関数
  const fetchInitialState = async (guildId: string) => {
    try {
      const [current, fetchedQueue, playing] = await Promise.all([
        api.getCurrentTrack(guildId),
        api.getQueue(guildId),
        api.isPlaying(guildId),
      ]);
      setCurrentTrack(current);
      setQueue(fetchedQueue.map(item => item.track));
      setIsPlaying(playing);
    } catch (error) {
      console.error('初期状態の取得に失敗しました:', error);
      toast({
        title: 'エラー',
        description: '初期状態の取得に失敗しました。',
        variant: 'destructive',
      });
    }
  };

  // 楽曲の再生
  const playTrack = async (track: Track) => {
    if (!activeServerId) {
      toast({
        title: 'エラー',
        description: 'アクティブなサーバーが選択されていません。',
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
      await api.playTrack(activeServerId, track, user);
      setCurrentTrack(track);
      setIsPlaying(true);
      // キューに追加
      setQueue(prev => [...prev, track]);
    } catch (error) {
      console.error('再生に失敗しました:', error);
      toast({
        title: 'エラー',
        description: '再生に失敗しました。',
        variant: 'destructive',
      });
    }
  };
  

  // 楽曲の一時停止
  const pauseTrack = async () => {
    if (!activeServerId) return;
    try {
      await api.pausePlayback(activeServerId);
      setIsPlaying(false);
    } catch (error) {
      console.error('一時停止に失敗しました:', error);
      toast({
        title: 'エラー',
        description: '一時停止に失敗しました。',
        variant: 'destructive',
      });
    }
  };

  // 楽曲のスキップ
  const skipTrack = async () => {
    if (!activeServerId) return;
    try {
      await api.skipTrack(activeServerId);
      // 次の曲を取得
      const newCurrent = queue[0] || null;
      setCurrentTrack(newCurrent);
      setQueue(prev => prev.slice(1));
      setIsPlaying(true);
    } catch (error) {
      console.error('スキップに失敗しました:', error);
      toast({
        title: 'エラー',
        description: 'スキップに失敗しました。',
        variant: 'destructive',
      });
    }
  };

  // 前の楽曲への移動
  const previousTrack = async () => {
    if (!activeServerId) return;
    try {
      await api.previousTrack(activeServerId);
      // 適切なロジックで前の曲を設定
      // ここでは仮に最初の曲を再設定
      const prevTrack = queue[0] || null;
      setCurrentTrack(prevTrack);
      setIsPlaying(true);
    } catch (error) {
      console.error('前の曲への移動に失敗しました:', error);
      toast({
        title: 'エラー',
        description: '前の曲への移動に失敗しました。',
        variant: 'destructive',
      });
    }
  };

  // キューの並び替え
  const reorderQueue = async (startIndex: number, endIndex: number) => {
    if (!activeServerId) return;
    try {
      const reorderedQueue = Array.from(queue);
      const [moved] = reorderedQueue.splice(startIndex, 1);
      reorderedQueue.splice(endIndex, 0, moved);
      setQueue(reorderedQueue);
      await api.reorderQueue(activeServerId, startIndex, endIndex);
    } catch (error) {
      console.error('キューの並び替えに失敗しました:', error);
      toast({
        title: 'エラー',
        description: 'キューの並び替えに失敗しました。',
        variant: 'destructive',
      });
    }
  };

  // キューから楽曲を削除
  const deleteFromQueue = async (index: number) => {
    if (!activeServerId) return;
    try {
      await api.removeFromQueue(activeServerId, index);
      setQueue(prev => prev.filter((_, i) => i !== index));
    } catch (error) {
      console.error('キューからの削除に失敗しました:', error);
      toast({
        title: 'エラー',
        description: 'キューからの削除に失敗しました。',
        variant: 'destructive',
      });
    }
  };

  return (
    <MainPlayerContext.Provider
      value={{
        currentTrack,
        isPlaying,
        playTrack,
        pauseTrack,
        skipTrack,
        previousTrack,
        queue,
        reorderQueue,
        deleteFromQueue,
      }}
    >
      {children}
    </MainPlayerContext.Provider>
  );
};
