"use client"

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Link, Menu, Clipboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface HeaderProps {
  onSearch: (query: string) => void
  onAddUrl: (url: string) => void
  onOpenMenu: () => void
}

export const Header: React.FC<HeaderProps> = ({ onSearch, onAddUrl, onOpenMenu }) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [url, setUrl] = useState('')
  const [isSearchActive, setIsSearchActive] = useState(false)
  const [isUrlActive, setIsUrlActive] = useState(false)
  const [searchHistory, setSearchHistory] = useState<string[]>([])

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
      const updatedHistory = [searchQuery, ...searchHistory.filter(q => q !== searchQuery)].slice(0, 10)
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
    }
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      setUrl(text)
    } catch (err) {
      console.error('クリップボードからの読み取りに失敗しました: ', err)
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

  return (
    <header className="bg-card text-card-foreground p-4 fixed top-0 left-0 right-0 z-10">
      <div className="flex items-center justify-between">
        <Button onClick={onOpenMenu} variant="ghost" size="icon">
          <Menu size={24} />
        </Button>
        <div className="flex space-x-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setIsSearchActive(!isSearchActive)
              setIsUrlActive(false)
            }}
          >
            <Search size={20} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setIsUrlActive(!isUrlActive)
              setIsSearchActive(false)
            }}
          >
            <Link size={20} />
          </Button>
        </div>
      </div>
      <AnimatePresence>
        {isSearchActive && (
          <motion.form
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-4"
            onSubmit={handleSearch}
          >
            <div className="relative">
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="検索..."
                className="w-full pr-10"
              />
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 transform -translate-y-1/2"
              >
                <Search size={20} />
              </Button>
            </div>
            {searchHistory.length > 0 && (
              <div className="mt-2 bg-background rounded-lg overflow-hidden">
                {searchHistory.map((query, index) => (
                  <Button
                    key={index}
                    onClick={() => handleSelectHistoryItem(query)}
                    variant="ghost"
                    className="w-full justify-start"
                  >
                    {query}
                  </Button>
                ))}
              </div>
            )}
          </motion.form>
        )}
        {isUrlActive && (
          <motion.form
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-4"
            onSubmit={handleAddUrl}
          >
            <div className="relative">
              <Input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="URLを入力..."
                className="w-full pr-20"
              />
              <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex">
                <Button
                  type="button"
                  onClick={handlePaste}
                  variant="ghost"
                  size="icon"
                  className="mr-1"
                >
                  <Clipboard size={20} />
                </Button>
                <Button type="submit" variant="ghost" size="icon">
                  <Link size={20} />
                </Button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </header>
  )
}