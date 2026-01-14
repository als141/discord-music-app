"use client"

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Link as LinkIcon, Menu, Clipboard, X, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { useSession, signIn, signOut } from 'next-auth/react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

interface HeaderProps {
  onSearch: (query: string) => void
  onAddUrl: (url: string) => void
  onOpenMenu: () => void
  isOnDeviceMode: boolean
  onToggleDeviceMode: () => void
}

export const Header: React.FC<HeaderProps> = ({
  onSearch,
  onAddUrl,
  onOpenMenu,
  isOnDeviceMode,
  onToggleDeviceMode
}) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [url, setUrl] = useState('')
  const [isSearchActive, setIsSearchActive] = useState(false)
  const [isUrlActive, setIsUrlActive] = useState(false)
  const [searchHistory, setSearchHistory] = useState<string[]>([])
  const { toast } = useToast()
  const { data: session } = useSession()

  useEffect(() => {
    const history = localStorage.getItem('searchHistory')
    if (history) {
      setSearchHistory(JSON.parse(history))
    }
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim() !== '') {
      onSearch(searchQuery)
      const updatedHistory = [searchQuery, ...searchHistory.filter(q => q !== searchQuery)].slice(0, 5)
      setSearchHistory(updatedHistory)
      localStorage.setItem('searchHistory', JSON.stringify(updatedHistory))
      setSearchQuery('')
      setIsSearchActive(false)
    }
  }

  const handleAddUrl = (e: React.FormEvent) => {
    e.preventDefault()
    if (url.trim() !== '') {
      onAddUrl(url)
      setUrl('')
      setIsUrlActive(false)
      toast({
        title: "追加しました",
        description: "曲がキューに追加されました",
      })
    }
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      setUrl(text)
      toast({
        title: "ペーストしました",
        description: "URLを入力欄に貼り付けました",
      })
    } catch (err) {
      console.error('クリップボードからの読み取りに失敗しました: ', err)
      toast({
        title: "エラー",
        description: "クリップボードからの読み取りに失敗しました",
        variant: "destructive",
      })
    }
  }

  const handleSelectHistoryItem = (query: string) => {
    setSearchQuery(query)
    onSearch(query)
    const updatedHistory = [query, ...searchHistory.filter(q => q !== query)]
    setSearchHistory(updatedHistory)
    localStorage.setItem('searchHistory', JSON.stringify(updatedHistory))
    setSearchQuery('')
    setIsSearchActive(false)
  }

  const closeAllPanels = () => {
    setIsSearchActive(false)
    setIsUrlActive(false)
  }

  return (
    <TooltipProvider>
      {/* Apple Music Style Frosted Glass Header */}
      <header className="fixed top-0 left-0 right-0 z-50 h-14 glass border-b border-black/5">
        <div className="flex items-center justify-between h-full px-4 max-w-screen-2xl mx-auto">
          {/* Left Section - Menu Button */}
          <div className="flex items-center gap-2">
            {!isOnDeviceMode && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={onOpenMenu}
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full hover:bg-black/5 text-foreground"
                    aria-label="メニューを開く"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>メニュー</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Center Section - Logo/Title (optional) */}
          <div className="absolute left-1/2 -translate-x-1/2 hidden sm:block">
            <span className="text-sm font-semibold text-foreground tracking-tight">
              Music
            </span>
          </div>

          {/* Right Section - Actions */}
          <div className="flex items-center gap-1">
            {/* Device Mode Toggle */}
            <div className="hidden sm:flex items-center gap-2 mr-2 px-3 py-1.5 rounded-full bg-secondary/60">
              <Switch
                id="device-mode"
                checked={isOnDeviceMode}
                onCheckedChange={onToggleDeviceMode}
                className="data-[state=checked]:bg-primary"
              />
              <Label
                htmlFor="device-mode"
                className="text-xs font-medium text-muted-foreground cursor-pointer"
              >
                デバイス
              </Label>
            </div>

            {/* Search Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setIsSearchActive(!isSearchActive)
                    setIsUrlActive(false)
                  }}
                  className={`h-9 w-9 rounded-full transition-colors ${
                    isSearchActive
                      ? 'bg-primary text-white hover:bg-primary/90'
                      : 'hover:bg-black/5 text-foreground'
                  }`}
                  aria-label="検索"
                >
                  <Search className="h-[18px] w-[18px]" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>検索</p>
              </TooltipContent>
            </Tooltip>

            {/* URL Add Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setIsUrlActive(!isUrlActive)
                    setIsSearchActive(false)
                  }}
                  className={`h-9 w-9 rounded-full transition-colors ${
                    isUrlActive
                      ? 'bg-primary text-white hover:bg-primary/90'
                      : 'hover:bg-black/5 text-foreground'
                  }`}
                  aria-label="URLを追加"
                >
                  <LinkIcon className="h-[18px] w-[18px]" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>URLを追加</p>
              </TooltipContent>
            </Tooltip>

            {/* User Menu */}
            {session ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full ml-1 hover:bg-black/5"
                    aria-label="ユーザーメニュー"
                  >
                    <Avatar className="h-7 w-7 ring-2 ring-white/20">
                      <AvatarImage src={session.user.image} alt={session.user.name || ''} />
                      <AvatarFallback className="bg-primary text-white text-xs font-medium">
                        {session.user.name?.charAt(0) || 'U'}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-56 bg-white/95 backdrop-blur-xl border-black/10 shadow-xl rounded-xl"
                >
                  <div className="px-3 py-2">
                    <p className="text-sm font-medium text-foreground">{session.user.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
                  </div>
                  <DropdownMenuSeparator className="bg-black/5" />
                  <DropdownMenuItem
                    onClick={() => signOut()}
                    className="text-destructive focus:text-destructive cursor-pointer"
                  >
                    ログアウト
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                onClick={() => signIn('discord')}
                size="sm"
                className="h-8 px-4 bg-primary hover:bg-primary/90 text-white rounded-full text-xs font-medium"
              >
                ログイン
              </Button>
            )}
          </div>
        </div>

        {/* Search Panel - Apple Music Style */}
        <AnimatePresence>
          {isSearchActive && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="absolute top-full left-0 right-0 glass border-b border-black/5 shadow-lg"
            >
              <form onSubmit={handleSearch} className="max-w-screen-2xl mx-auto px-4 py-3">
                <div className="relative max-w-xl mx-auto">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="曲名、アーティスト、アルバムを検索"
                    className="w-full h-10 pl-10 pr-10 bg-secondary/80 border-0 rounded-lg text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20"
                    autoFocus
                  />
                  {searchQuery && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full hover:bg-black/5"
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>

                {/* Search History */}
                {searchHistory.length > 0 && !searchQuery && (
                  <div className="max-w-xl mx-auto mt-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2 px-1">最近の検索</p>
                    <div className="space-y-0.5">
                      {searchHistory.map((query, index) => (
                        <button
                          key={index}
                          onClick={() => handleSelectHistoryItem(query)}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-black/5 transition-colors text-left"
                        >
                          <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="text-sm text-foreground truncate">{query}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* URL Input Panel */}
        <AnimatePresence>
          {isUrlActive && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="absolute top-full left-0 right-0 glass border-b border-black/5 shadow-lg"
            >
              <form onSubmit={handleAddUrl} className="max-w-screen-2xl mx-auto px-4 py-3">
                <div className="relative max-w-xl mx-auto">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="YouTube URLを入力"
                    className="w-full h-10 pl-10 pr-24 bg-secondary/80 border-0 rounded-lg text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20"
                    autoFocus
                  />
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          onClick={handlePaste}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full hover:bg-black/5"
                        >
                          <Clipboard className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>ペースト</p>
                      </TooltipContent>
                    </Tooltip>
                    <Button
                      type="submit"
                      size="sm"
                      className="h-8 px-3 bg-primary hover:bg-primary/90 text-white rounded-full text-xs font-medium"
                    >
                      追加
                    </Button>
                  </div>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Backdrop overlay when panels are open */}
      <AnimatePresence>
        {(isSearchActive || isUrlActive) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/20 z-40"
            onClick={closeAllPanels}
          />
        )}
      </AnimatePresence>
    </TooltipProvider>
  )
}
