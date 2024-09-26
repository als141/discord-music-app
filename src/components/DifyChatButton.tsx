'use client'

import { useEffect } from 'react'
import Script from 'next/script'

const DifyChatButton = () => {
  useEffect(() => {
    // This effect will run on the client-side only
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
      <style jsx global>{`
        #dify-chatbot-bubble-button {
          background-color: #1C64F2 !important;
        }
      `}</style>
    </>
  )
}

export default DifyChatButton