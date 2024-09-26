'use client'

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

    // Create and insert the script element
    const script = document.createElement('script')
    script.src = 'https://udify.app/embed.min.js'
    script.id = 'YC5rzqjJiUzm0IOQ'
    script.defer = true
    document.body.appendChild(script)

    // Create and insert the style element
    const style = document.createElement('style')
    style.textContent = `
      #dify-chatbot-bubble-button {
        background-color: #1C64F2 !important;
      }
    `
    document.head.appendChild(style)

    // Cleanup function
    return () => {
      document.body.removeChild(script)
      document.head.removeChild(style)
    }
  }, [])

  // This component doesn't render anything visible
  return null
}

export default DifyChatButton