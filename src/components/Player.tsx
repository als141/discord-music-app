'use client';

import React from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PlayIcon, PauseIcon, SkipForwardIcon, SkipBackIcon } from "lucide-react";

interface PlayerProps {
  track: any;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSkip: () => void;
  onPrevious: () => void;
  loading: boolean;
}

export function Player({ track, isPlaying, onPlay, onPause, onSkip, onPrevious, loading }: PlayerProps) {
  return (
    <Card>
      <CardContent className="flex items-center justify-center gap-4 p-4">
        <Button variant="outline" size="icon" onClick={onPrevious} disabled={loading}>
           <SkipBackIcon className="h-4 w-4" />
        </Button>
        {isPlaying ? (
          <Button variant="outline" size="icon" onClick={onPause} disabled={loading}>
            <PauseIcon className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="outline" size="icon" onClick={onPlay} disabled={loading}>
            <PlayIcon className="h-4 w-4" />
          </Button>
        )}
        <Button variant="outline" size="icon" onClick={onSkip} disabled={loading}>
          <SkipForwardIcon className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}