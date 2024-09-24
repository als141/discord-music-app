import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Link, Menu, Clipboard } from 'lucide-react';

interface HeaderProps {
  onSearch: (query: string) => void;
  onAddUrl: (url: string) => void;
  onOpenMenu: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onSearch, onAddUrl, onOpenMenu }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [url, setUrl] = useState('');
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isUrlActive, setIsUrlActive] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  useEffect(() => {
    // ローカルストレージから検索履歴を読み込む
    const history = localStorage.getItem('searchHistory');
    if (history) {
      setSearchHistory(JSON.parse(history));
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim() !== '') {
      onSearch(searchQuery);

      // 検索履歴を更新
      const updatedHistory = [searchQuery, ...searchHistory.filter(q => q !== searchQuery)].slice(0, 10);
      setSearchHistory(updatedHistory);
      localStorage.setItem('searchHistory', JSON.stringify(updatedHistory));

      // 入力をリセットし、バーを閉じる
      setSearchQuery('');
      setIsSearchActive(false);
    }
  };

  const handleAddUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim() !== '') {
      onAddUrl(url);

      // 入力をリセットし、バーを閉じる
      setUrl('');
      setIsUrlActive(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch (err) {
      console.error('クリップボードからの読み取りに失敗しました: ', err);
    }
  };

  const handleSelectHistoryItem = (query: string) => {
    setSearchQuery(query);
    onSearch(query);

    // 検索履歴を更新して選択した項目を先頭に移動
    const updatedHistory = [query, ...searchHistory.filter(q => q !== query)];
    setSearchHistory(updatedHistory);
    localStorage.setItem('searchHistory', JSON.stringify(updatedHistory));

    // 入力をリセットし、バーを閉じる
    setSearchQuery('');
    setIsSearchActive(false);
  };

  return (
    <header className="bg-gray-900 text-white p-4 fixed top-0 left-0 right-0 z-10">
      <div className="flex items-center justify-between">
        <button onClick={onOpenMenu} className="p-2">
          <Menu size={24} />
        </button>
        <div className="flex space-x-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              setIsSearchActive(!isSearchActive);
              setIsUrlActive(false);
            }}
            className="p-2 bg-gray-800 rounded-full"
          >
            <Search size={20} />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              setIsUrlActive(!isUrlActive);
              setIsSearchActive(false);
            }}
            className="p-2 bg-gray-800 rounded-full"
          >
            <Link size={20} />
          </motion.button>
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
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="検索..."
                className="w-full bg-gray-800 text-white rounded-full py-2 px-4 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1"
              >
                <Search size={20} />
              </button>
            </div>
            {/* 検索履歴を表示 */}
            {searchHistory.length > 0 && (
              <div className="mt-2 bg-gray-800 rounded-lg overflow-hidden">
                {searchHistory.map((query, index) => (
                  <button
                    key={index}
                    onClick={() => handleSelectHistoryItem(query)}
                    className="w-full text-left px-4 py-2 hover:bg-gray-700"
                  >
                    {query}
                  </button>
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
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="URLを入力..."
                className="w-full bg-gray-800 text-white rounded-full py-2 px-4 pr-20 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex">
                <button
                  type="button"
                  onClick={handlePaste}
                  className="p-1 mr-1 bg-gray-700 rounded-full"
                >
                  <Clipboard size={20} />
                </button>
                <button type="submit" className="p-1 bg-blue-500 rounded-full">
                  <Link size={20} />
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </header>
  );
};