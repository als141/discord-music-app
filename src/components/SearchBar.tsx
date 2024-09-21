'use client';

import React, { useState } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchIcon, LinkIcon } from "lucide-react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  onAddUrl: (url: string) => void;
  loading: boolean;
}

export function SearchBar({ onSearch, onAddUrl, loading }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query);
  };

  const handleAddUrl = (e: React.FormEvent) => {
    e.preventDefault();
    onAddUrl(url);
    setUrl('');
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="音楽を検索..."
          className="flex-grow"
        />
        <Button type="submit" disabled={loading}>
          <SearchIcon className="mr-2 h-4 w-4" /> 検索
        </Button>
      </form>
      <form onSubmit={handleAddUrl} className="flex gap-2">
        <Input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="YouTubeのURLを入力..."
          className="flex-grow"
        />
        <Button type="submit" variant="secondary" disabled={loading}>
          <LinkIcon className="mr-2 h-4 w-4" /> 追加
        </Button>
      </form>
    </div>
  );
}