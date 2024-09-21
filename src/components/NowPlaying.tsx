'use client';

import React from 'react';
import { Track } from '@/utils/api';
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface NowPlayingProps {
  track: Track | null;
  isPlaying: boolean;
}

export function NowPlaying({ track, isPlaying }: NowPlayingProps) {
  if (!track) {
    return <div className="text-center text-gray-500">現在再生中の曲はありません。</div>;
  }

  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <Avatar className="w-16 h-16">
          <AvatarImage src={track.thumbnail} alt={track.title} />
          <AvatarFallback>{track.title[0]}</AvatarFallback>
        </Avatar>
        <div>
          <h3 className="text-lg font-bold">{track.title}</h3>
          <p className="text-sm text-gray-500">{track.artist}</p>
          <p className="text-sm text-gray-500">{isPlaying ? '再生中' : '一時停止中'}</p>
        </div>
      </CardContent>
    </Card>
  );
}