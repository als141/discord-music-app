'use client';

import React, { createContext, useState, useContext, useRef, ReactNode } from 'react';

interface PlaybackContextProps {
  currentTime: number;
  duration: number;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

const PlaybackContext = createContext<PlaybackContextProps | undefined>(undefined);

export const usePlayback = () => {
  const context = useContext(PlaybackContext);
  if (!context) {
    throw new Error('usePlayback must be used within a PlaybackProvider');
  }
  return context;
};

interface PlaybackProviderProps {
  children: ReactNode;
}

export const PlaybackProvider: React.FC<PlaybackProviderProps> = ({ children }) => {
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  return (
    <PlaybackContext.Provider value={{ currentTime, duration, setCurrentTime, setDuration, audioRef }}>
      {children}
    </PlaybackContext.Provider>
  );
};
