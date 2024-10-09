import React, { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card } from '@/components/ui/card'
import { Loader2, Send, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

const API_URL = process.env.NEXT_PUBLIC_API_URL

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export const ChatScreen: React.FC = () => {
  const { data: session } = useSession()
  const { toast } = useToast()
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window !== 'undefined') {
      const storedMessages = localStorage.getItem('chatMessages')
      return storedMessages ? JSON.parse(storedMessages) : []
    }
    return []
  })
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(messages))
  }, [messages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!inputValue.trim()) return
    const newMessage: Message = { role: 'user', content: inputValue }
    setMessages((prev) => [...prev, newMessage])
    setInputValue('')
    setIsStreaming(true)

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        body: JSON.stringify({ messages: [...messages, newMessage] }),
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        throw new Error('エラーが発生しました。')
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder('utf-8')

      // 初期のassistantMessageを追加
      let assistantMessage: Message = { role: 'assistant', content: '' }
      setMessages((prev) => [...prev, assistantMessage])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        // assistantMessageを新しいオブジェクトとして作成
        assistantMessage = { ...assistantMessage, content: assistantMessage.content + chunk }
        // メッセージ一覧を更新
        setMessages((prev) => {
          const updatedMessages = [...prev]
          updatedMessages[updatedMessages.length - 1] = assistantMessage
          return updatedMessages
        })
      }
    } catch (error) {
      console.error(error)
      toast({
        title: 'エラー',
        description: 'メッセージの送信に失敗しました。',
        variant: 'destructive',
      })
    } finally {
      setIsStreaming(false)
    }
  }


  const handleClear = () => {
    setMessages([])
    localStorage.removeItem('chatMessages')
  }

  const CodeBlock: React.FC<{ language: string; value: string }> = ({ language, value }) => {
    return (
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={language}
        PreTag="div"
      >
        {value}
      </SyntaxHighlighter>
    )
  }

  return (
    <Card className="flex flex-col h-full shadow-lg bg-gray-900 text-gray-100">
      <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">チャット</h2>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-red-400 border-red-400 hover:bg-red-900 hover:text-red-300">
              <Trash2 className="w-4 h-4 mr-2" />
              履歴をクリア
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-gray-800 text-gray-100">
            <AlertDialogHeader>
              <AlertDialogTitle>本当に履歴をクリアしますか？</AlertDialogTitle>
              <AlertDialogDescription className="text-gray-300">
                この操作は取り消せません。すべてのチャット履歴が削除されます。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-gray-700 text-gray-100 hover:bg-gray-600">キャンセル</AlertDialogCancel>
              <AlertDialogAction onClick={handleClear} className="bg-red-600 hover:bg-red-700 text-gray-100">クリア</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <ScrollArea className="flex-grow p-4 space-y-4">
        <AnimatePresence>
          {messages.map((message, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}
            >
              {message.role === 'assistant' && (
                <Avatar className="mr-2">
                  <AvatarImage src="/assistant_avatar.png" alt="Assistant" />
                  <AvatarFallback>A</AvatarFallback>
                </Avatar>
              )}
              <div className={`rounded-lg p-3 max-w-[80%] ${
                message.role === 'user'
                  ? 'bg-blue-600 text-gray-100'
                  : 'bg-gray-700 text-gray-100'
              }`}>
                {message.role === 'user' ? (
                  <p>{message.content}</p>
                ) : (
                  <ReactMarkdown
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '')
                        const language = match ? match[1] : 'text'
                        const codeString = String(children).replace(/\n$/, '')
                        
                        return codeString.includes('\n') ? (
                          <CodeBlock
                            language={language}
                            value={codeString}
                            {...props}
                          />
                        ) : (
                          <code className={`${className} bg-gray-800 text-gray-300 px-1 rounded`} {...props}>
                            {codeString}
                          </code>
                        )
                      }
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                )}
              </div>
              {message.role === 'user' && (
                <Avatar className="ml-2">
                  <AvatarImage src={session?.user.image || '/default_avatar.png'} alt={session?.user.name || 'User'} />
                  <AvatarFallback>{session?.user.name?.charAt(0) || 'U'}</AvatarFallback>
                </Avatar>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {isStreaming && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <Avatar className="mr-2">
              <AvatarImage src="/assistant_avatar.png" alt="Assistant" />
              <AvatarFallback>A</AvatarFallback>
            </Avatar>
            <div className="bg-gray-700 rounded-lg p-3 shadow-md">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </ScrollArea>
      <div className="p-4 border-t border-gray-700 bg-gray-800">
        <div className="flex items-center space-x-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="メッセージを入力..."
            className="flex-grow bg-gray-700 text-gray-100 border-0 focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || isStreaming}
            className="bg-blue-600 hover:bg-blue-700 text-gray-100"
          >
            <Send className="w-4 h-4 mr-2" />
            送信
          </Button>
        </div>
      </div>
    </Card>
  )
}
