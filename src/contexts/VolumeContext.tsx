import React, { createContext, useState, useContext, useEffect } from 'react';

interface VolumeContextProps {
  volume: number;
  setVolume: (volume: number) => void;
}

const VolumeContext = createContext<VolumeContextProps | undefined>(undefined);

export const useVolume = () => {
  const context = useContext(VolumeContext);
  if (!context) {
    throw new Error('useVolume must be used within a VolumeProvider');
  }
  return context;
};

export const VolumeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [volume, setVolumeState] = useState<number>(1.0);

  useEffect(() => {
    const savedVolume = localStorage.getItem('volume');
    if (savedVolume !== null) {
      setVolumeState(parseFloat(savedVolume));
    }
  }, []);

  const setVolume = (newVolume: number) => {
    setVolumeState(newVolume);
    localStorage.setItem('volume', newVolume.toString());
  };

  return (
    <VolumeContext.Provider value={{ volume, setVolume }}>
      {children}
    </VolumeContext.Provider>
  );
};