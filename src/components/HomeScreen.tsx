"use client"

import React, { useEffect, useState } from 'react'
import { Track, api } from '@/utils/api'
import { useToast } from '@/hooks/use-toast'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface HomeScreenProps {
  onSelectTrack: (track: Track) => void
}

interface StoredData {
  recommendations: Track[]
  charts: Track[]
  timestamp: number
}

const STORAGE_KEY = 'homeScreenData'
const DATA_EXPIRY_TIME = 24 * 60 * 60 * 1000 // 24 hours in milliseconds

export const HomeScreen: React.FC<HomeScreenProps> = ({ onSelectTrack }) => {
  const [recommendations, setRecommendations] = useState<Track[]>([])
  const [charts, setCharts] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [showAllRecommendations, setShowAllRecommendations] = useState(false)
  const [showAllCharts, setShowAllCharts] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        const storedData = localStorage.getItem(STORAGE_KEY)
        const parsedData: StoredData | null = storedData ? JSON.parse(storedData) : null

        if (parsedData && Date.now() - parsedData.timestamp < DATA_EXPIRY_TIME) {
          // Use stored data if it's not expired
          setRecommendations(parsedData.recommendations)
          setCharts(parsedData.charts)
        } else {
          // Fetch new data if stored data is expired or doesn't exist
          const [recs, ch] = await Promise.all([
            api.getRecommendations(),
            api.getCharts(),
          ])
          setRecommendations(recs)
          setCharts(ch)

          // Store the new data
          const newData: StoredData = {
            recommendations: recs,
            charts: ch,
            timestamp: Date.now()
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newData))
        }
      } catch (error) {
        console.error('データの取得に失敗しました:', error)
        toast({
          title: 'エラー',
          description: 'データの取得に失敗しました。',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [toast])

  const renderTrackItem = (track: Track, key: string) => (
    <motion.div
      key={key}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={() => onSelectTrack(track)}
    >
      <Card className="overflow-hidden cursor-pointer">
        <CardContent className="p-0">
          <img src={track.thumbnail} alt={track.title} className="w-full h-48 object-cover" />
          <div className="p-4">
            <h3 className="font-bold text-lg mb-2 truncate">{track.title}</h3>
            <p className="text-sm text-muted-foreground truncate">{track.artist}</p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )

  const renderSkeletonItem = (key: number) => (
    <Card key={key} className="overflow-hidden">
      <CardContent className="p-0">
        <Skeleton className="w-full h-48" />
        <div className="p-4">
          <Skeleton className="h-6 w-3/4 mb-2" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </CardContent>
    </Card>
  )

  const renderSection = (title: string, items: Track[], showAll: boolean, setShowAll: (show: boolean) => void) => (
    <div className="mb-8 w-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">{title}</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAll(!showAll)}
          className="flex items-center"
        >
          {showAll ? (
            <>
              <span className="mr-2">折りたたむ</span>
              <ChevronUp size={20} />
            </>
          ) : (
            <>
              <span className="mr-2">もっと見る</span>
              <ChevronDown size={20} />
            </>
          )}
        </Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <AnimatePresence>
          {items.slice(0, showAll ? undefined : 4).map((item, index) => (
            <motion.div
              key={`${title}-${index}`}
              initial={index >= 4 ? { opacity: 0, scale: 0.8 } : false}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.3 }}
            >
              {renderTrackItem(item, `${title}-${index}`)}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col items-center justify-start h-full bg-gradient-to-b from-background to-background/80 text-foreground p-4 overflow-auto">
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 w-full">
          {Array.from({ length: 8 }).map((_, index) => renderSkeletonItem(index))}
        </div>
      ) : (
        <>
          {renderSection('おすすめの曲', recommendations, showAllRecommendations, setShowAllRecommendations)}
          {renderSection('チャート', charts, showAllCharts, setShowAllCharts)}
        </>
      )}
    </div>
  )
}