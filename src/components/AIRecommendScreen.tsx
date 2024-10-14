import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence, useMotionValue, useAnimation, PanInfo } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PlayableItem } from '@/utils/api'
import { Brain, ThumbsUp, ThumbsDown, Sparkles } from 'lucide-react'
import Image from 'next/image'
import { Progress } from '@/components/ui/progress'

interface AIRecommendScreenProps {
  onSelectTrack: (item: PlayableItem) => void
}

const genres = ['J-POP', 'アニソン', 'ボカロ', 'K-POP', 'ロック', 'EDM']
const moods = ['アップテンポ', 'チル', 'エモーショナル', 'ダンサブル']

const mockArtists = [
  { id: '1', name: 'Artist 1', image: '/api/placeholder/100/100' },
  { id: '2', name: 'Artist 2', image: '/api/placeholder/100/100' },
  { id: '3', name: 'Artist 3', image: '/api/placeholder/100/100' },
  { id: '4', name: 'Artist 4', image: '/api/placeholder/100/100' },
  { id: '5', name: 'Artist 5', image: '/api/placeholder/100/100' },
  // 必要に応じて追加
]

const mockTracks: PlayableItem[] = [
  { title: 'Track 1', artist: 'Artist 1', thumbnail: '/api/placeholder/300/300', url: '' },
  { title: 'Track 2', artist: 'Artist 2', thumbnail: '/api/placeholder/300/300', url: '' },
  { title: 'Track 3', artist: 'Artist 3', thumbnail: '/api/placeholder/300/300', url: '' },
  { title: 'Track 4', artist: 'Artist 4', thumbnail: '/api/placeholder/300/300', url: '' },
  { title: 'Track 5', artist: 'Artist 5', thumbnail: '/api/placeholder/300/300', url: '' },
  // 必要に応じて追加
]

export const AIRecommendScreen: React.FC<AIRecommendScreenProps> = ({ onSelectTrack }) => {
  const [step, setStep] = useState<'intro' | 'genre' | 'mood' | 'artists' | 'matching' | 'recommendations'>('intro')
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [selectedMoods, setSelectedMoods] = useState<string[]>([])
  const [selectedArtists, setSelectedArtists] = useState<string[]>([])
  const [currentTrack, setCurrentTrack] = useState<PlayableItem | null>(null)
  const [recommendations, setRecommendations] = useState<PlayableItem[]>([])
  const [progress, setProgress] = useState(0)
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null)
  const [usedTracks, setUsedTracks] = useState<PlayableItem[]>([])

  useEffect(() => {
    if (step === 'matching' && !currentTrack) {
      const nextTrack = getNextTrack()
      setCurrentTrack(nextTrack)
    }
  }, [step])

  const getNextTrack = () => {
    const remainingTracks = mockTracks.filter(track => !usedTracks.includes(track))
    if (remainingTracks.length === 0) {
      // すべての楽曲を使い切った場合、使用済みリストをリセット
      setUsedTracks([])
      return mockTracks[Math.floor(Math.random() * mockTracks.length)]
    } else {
      const nextTrack = remainingTracks[Math.floor(Math.random() * remainingTracks.length)]
      setUsedTracks(prev => [...prev, nextTrack])
      return nextTrack
    }
  }

  const handleGenreSelection = (genre: string) => {
    setSelectedGenres(prev => prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre])
  }

  const handleMoodSelection = (mood: string) => {
    setSelectedMoods(prev => prev.includes(mood) ? prev.filter(m => m !== mood) : [...prev, mood])
  }

  const handleArtistSelection = (artistId: string) => {
    setSelectedArtists(prev => prev.includes(artistId) ? prev.filter(a => a !== artistId) : [...prev, artistId])
  }

  const renderIntro = () => (
    <motion.div
      key="intro"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50 }}
      className="text-center p-8"
    >
      <Sparkles className="w-24 h-24 text-primary mx-auto mb-8" />
      <h2 className="text-4xl font-bold mb-6 text-white">AIリコメンドへようこそ！</h2>
      <p className="text-xl mb-8 text-gray-300">あなたの好みに合わせて音楽をお探しします。いくつかの質問に答えてください。</p>
      <Button onClick={() => setStep('genre')} size="lg" className="px-8 py-4 text-lg rounded-full bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 transition-all duration-300">
        始めましょう
      </Button>
    </motion.div>
  )

  const renderGenreSelection = () => (
    <motion.div
      key="genre"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50 }}
      className="p-8"
    >
      <h2 className="text-3xl font-bold mb-6 text-white">好きなジャンルを選んでください</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {genres.map(genre => (
          <Button
            key={genre}
            onClick={() => handleGenreSelection(genre)}
            variant={selectedGenres.includes(genre) ? 'default' : 'outline'}
            className="h-24 text-lg rounded-xl transition-all duration-300 hover:scale-105"
          >
            {genre}
          </Button>
        ))}
      </div>
      <Button
        className="mt-8 px-8 py-4 text-lg rounded-full bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 transition-all duration-300"
        onClick={() => setStep('mood')}
        disabled={selectedGenres.length === 0}
      >
        次へ
      </Button>
    </motion.div>
  )

  const renderMoodSelection = () => (
    <motion.div
      key="mood"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50 }}
      className="p-8"
    >
      <h2 className="text-3xl font-bold mb-6 text-white">好きな雰囲気を選んでください</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {moods.map(mood => (
          <Button
            key={mood}
            onClick={() => handleMoodSelection(mood)}
            variant={selectedMoods.includes(mood) ? 'default' : 'outline'}
            className="h-24 text-lg rounded-xl transition-all duration-300 hover:scale-105"
          >
            {mood}
          </Button>
        ))}
      </div>
      <Button
        className="mt-8 px-8 py-4 text-lg rounded-full bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 transition-all duration-300"
        onClick={() => setStep('artists')}
        disabled={selectedMoods.length === 0}
      >
        次へ
      </Button>
    </motion.div>
  )

  const renderArtistSelection = () => (
    <motion.div
      key="artists"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50 }}
      className="p-8"
    >
      <h2 className="text-3xl font-bold mb-6 text-white">好きなアーティストを選んでください</h2>
      <ScrollArea className="h-[400px]">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {mockArtists.map(artist => (
            <Button
              key={artist.id}
              onClick={() => handleArtistSelection(artist.id)}
              variant={selectedArtists.includes(artist.id) ? 'default' : 'outline'}
              className="h-24 text-lg flex flex-col items-center justify-center rounded-xl transition-all duration-300 hover:scale-105"
            >
              <Image
                src={artist.image}
                alt={artist.name}
                width={40}
                height={40}
                className="rounded-full mb-2"
              />
              {artist.name}
            </Button>
          ))}
        </div>
      </ScrollArea>
      <Button
        className="mt-8 px-8 py-4 text-lg rounded-full bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 transition-all duration-300"
        onClick={() => setStep('matching')}
        disabled={selectedArtists.length === 0}
      >
        マッチングを開始
      </Button>
    </motion.div>
  )

  const renderMatching = () => (
    <motion.div
      key="matching"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50 }}
      className="flex flex-col items-center p-8"
    >
      <h2 className="text-3xl font-bold mb-8 text-white">この曲はどうですか？</h2>
      <div className="w-full max-w-sm aspect-square relative">
        <AnimatePresence>
          {currentTrack && (
            <TrackCard
              key={currentTrack.title}
              track={currentTrack}
              swipeDirection={swipeDirection}
              onSwipeComplete={(liked) => {
                if (liked) {
                  setRecommendations(prev => [...prev, currentTrack!])
                }
                if (progress + 20 >= 100) {
                  setProgress(100)
                  setStep('recommendations')
                } else {
                  setProgress(prev => prev + 20)
                  const nextTrack = getNextTrack()
                  setCurrentTrack(nextTrack)
                }
                setSwipeDirection(null)
              }}
            />
          )}
        </AnimatePresence>
      </div>
      <div className="flex justify-center mt-8 space-x-8">
        <Button
          onClick={() => {
            if (!swipeDirection) {
              setSwipeDirection('left')
            }
          }}
          size="lg"
          className="w-16 h-16 rounded-full bg-transparent hover:bg-red-600/20 border-2 border-red-500 transition-all duration-300 flex items-center justify-center"
        >
          <ThumbsDown className="w-8 h-8 text-red-500" />
        </Button>
        <Button
          onClick={() => {
            if (!swipeDirection) {
              setSwipeDirection('right')
            }
          }}
          size="lg"
          className="w-16 h-16 rounded-full bg-transparent hover:bg-green-600/20 border-2 border-green-500 transition-all duration-300 flex items-center justify-center"
        >
          <ThumbsUp className="w-8 h-8 text-green-500" />
        </Button>
      </div>
      <Progress value={progress} className="w-full mt-8" />
    </motion.div>
  )

  const renderRecommendations = () => (
    <motion.div
      key="recommendations"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50 }}
      className="p-8"
    >
      <h2 className="text-3xl font-bold mb-6 text-white">あなたへのおすすめ</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {recommendations.map((track, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
          >
            <Card className="cursor-pointer overflow-hidden" onClick={() => onSelectTrack(track)}>
              <div className="relative aspect-square">
                <Image
                  src={track.thumbnail}
                  alt={track.title}
                  layout="fill"
                  objectFit="cover"
                />
              </div>
              <div className="p-4">
                <p className="font-bold truncate">{track.title}</p>
                <p className="text-sm text-muted-foreground truncate">{track.artist}</p>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-gray-900 to-black">
      <div className="flex items-center justify-center p-6 bg-black/50 backdrop-blur-lg">
        <Brain className="w-12 h-12 text-primary mr-4" />
        <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-500 to-pink-500">AIリコメンド（仮）</h1>
      </div>
      <ScrollArea className="flex-grow">
        <AnimatePresence mode="wait">
          {step === 'intro' && renderIntro()}
          {step === 'genre' && renderGenreSelection()}
          {step === 'mood' && renderMoodSelection()}
          {step === 'artists' && renderArtistSelection()}
          {step === 'matching' && renderMatching()}
          {step === 'recommendations' && renderRecommendations()}
        </AnimatePresence>
      </ScrollArea>
      {step !== 'intro' && step !== 'recommendations' && (
        <div className="p-4 bg-black/50 backdrop-blur-lg">
          <div className="flex justify-between items-center">
            <Button
              onClick={() => {
                if (step === 'genre') setStep('intro')
                if (step === 'mood') setStep('genre')
                if (step === 'artists') setStep('mood')
                if (step === 'matching') setStep('artists')
              }}
              variant="outline"
              className="px-6 py-2 rounded-full text-white border-white hover:bg-white/20"
            >
              戻る
            </Button>
            <div className="flex space-x-2">
              {['genre', 'mood', 'artists', 'matching'].map((s, index) => (
                <div
                  key={s}
                  className={`w-3 h-3 rounded-full ${
                    ['genre', 'mood', 'artists', 'matching'].indexOf(step) >= index
                      ? 'bg-primary'
                      : 'bg-gray-600'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// TrackCardコンポーネントの定義
interface TrackCardProps {
  track: PlayableItem
  onSwipeComplete: (liked: boolean) => void
  swipeDirection: 'left' | 'right' | null
}

const TrackCard: React.FC<TrackCardProps> = ({ track, onSwipeComplete, swipeDirection }) => {
  const x = useMotionValue(0)
  const controls = useAnimation()

  useEffect(() => {
    if (swipeDirection) {
      const toX = swipeDirection === 'right' ? 500 : -500
      const rotate = swipeDirection === 'right' ? 20 : -20
      controls.start({
        x: toX,
        opacity: 0,
        rotate,
        transition: { duration: 0.5 },
      }).then(() => {
        onSwipeComplete(swipeDirection === 'right')
      })
    }
  }, [swipeDirection, controls, onSwipeComplete])

  const handleDragEnd = (
    event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    if (info.offset.x > 100) {
      controls.start({
        x: 500,
        opacity: 0,
        rotate: 20,
        transition: { duration: 0.5 },
      }).then(() => {
        onSwipeComplete(true)
      })
    } else if (info.offset.x < -100) {
      controls.start({
        x: -500,
        opacity: 0,
        rotate: -20,
        transition: { duration: 0.5 },
      }).then(() => {
        onSwipeComplete(false)
      })
    } else {
      controls.start({ x: 0 })
    }
  }

  return (
    <motion.div
      key={track.title}
      drag="x"
      style={{ x }}
      animate={controls}
      onDragEnd={handleDragEnd}
      initial={{ x: 0, opacity: 1, rotate: 0 }}
      exit={{ x: x.get() > 0 ? 500 : -500, opacity: 0, rotate: x.get() > 0 ? 20 : -20 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute w-full h-full rounded-2xl overflow-hidden shadow-xl"
    >
      <Image
        src={track.thumbnail}
        alt={track.title}
        layout="fill"
        objectFit="cover"
      />
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black to-transparent text-white">
        <p className="font-bold text-xl truncate">{track.title}</p>
        <p className="text-lg truncate">{track.artist}</p>
      </div>
      {Math.abs(x.get()) > 100 && (
        <div className={`absolute top-8 ${x.get() > 0 ? 'right-8' : 'left-8'} transform ${x.get() > 0 ? 'rotate-12' : '-rotate-12'}`}>
          <span className={`text-4xl font-bold ${x.get() > 0 ? 'text-green-500' : 'text-red-500'}`}>
            {x.get() > 0 ? 'LIKE' : 'NOPE'}
          </span>
        </div>
      )}
    </motion.div>
  )
}
