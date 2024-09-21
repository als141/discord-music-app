'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ServerSelectorProps {
  servers: any[];
  activeServerId: string | null;
  onSelectServer: (serverId: string) => void;
}

export function ServerSelector({ servers, activeServerId, onSelectServer }: ServerSelectorProps) {
  return (
    <Select onValueChange={onSelectServer} value={activeServerId || undefined}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="サーバーを選択してください" />
      </SelectTrigger>
      <SelectContent>
        {servers.map((server) => (
          <SelectItem key={server.id} value={server.id}>
            {server.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default ServerSelector;
