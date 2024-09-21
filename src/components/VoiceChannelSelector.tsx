'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface VoiceChannelSelectorProps {
  channels: any[];
  onSelectChannel: (channelId: string) => void;
}

export function VoiceChannelSelector({ channels, onSelectChannel }: VoiceChannelSelectorProps) {
  return (
    <Select onValueChange={onSelectChannel}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="ボイスチャンネルを選択してください" />
      </SelectTrigger>
      <SelectContent>
        {channels.map((channel) => (
          <SelectItem key={channel.id} value={channel.id}>
            {channel.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default VoiceChannelSelector;
