'use client'

import Script from 'next/script'
import { useEffect } from 'react'

// Extend the Window interface to include difyChatbotConfig
declare global {
  interface Window {
    difyChatbotConfig?: {
      token: string
    }
  }
}

const DifyChatButton = () => {
  useEffect(() => {
    // Configure Dify chatbot
    window.difyChatbotConfig = {
      token: 'YC5rzqjJiUzm0IOQ'
    }
  }, [])

  return (
    <>
      <Script
        src="https://udify.app/embed.min.js"
        id="YC5rzqjJiUzm0IOQ"
        strategy="afterInteractive"
      />
    </>
  )
}

export default DifyChatButton