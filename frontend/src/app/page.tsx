'use client'

import { MainApp } from '@/components/MainApp'
import { MainPlayerProvider } from '@/contexts/MainPlayerContext'

export default function Home() {
  return (
    <MainPlayerProvider>
      <MainApp />
    </MainPlayerProvider>
  )
}