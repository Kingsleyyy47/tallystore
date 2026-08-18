import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { useSupportSettings } from '@/hooks/useSupportSettings'
import { MessageCircle, X, Send, Sparkles, ExternalLink } from 'lucide-react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content:
    "Hi! I'm the TallyStore assistant. Ask me how buying, depositing, or referrals work, or tell me what kind of account you're looking for and I'll help you find it.",
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE])
  const support = useSupportSettings()
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isOpen])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isSending) return

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setInput('')
    setIsSending(true)

    try {
      const { data, error } = await supabase.functions.invoke('chatbot', {
        body: { messages: nextMessages },
      })

      if (error) throw error

      const reply =
        data?.reply ||
        "Sorry, I couldn't generate a reply just now. Try again in a moment, or reach support directly."
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch (err) {
      console.error('Chat widget error:', err)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            "Sorry, something went wrong on my end. You can reach a human via WhatsApp or Telegram below.",
        },
      ])
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="fixed bottom-24 left-4 z-50 md:bottom-5 md:left-5">
      {isOpen && (
        <div className="mb-3 w-[90vw] max-w-sm rounded-2xl border border-border/60 bg-background shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <span className="font-semibold text-sm">TallyStore Assistant</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded-full p-1 hover:bg-white/20 transition-colors"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="h-80 px-3 py-3 overflow-y-auto">
            <div className="flex flex-col gap-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'self-end bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                      : 'self-start bg-muted text-foreground'
                  }`}
                >
                  {m.content}
                </div>
              ))}
              {isSending && (
                <div className="self-start bg-muted text-foreground rounded-xl px-3 py-2 text-sm">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce [animation-delay:-0.3s]">•</span>
                    <span className="animate-bounce [animation-delay:-0.15s]">•</span>
                    <span className="animate-bounce">•</span>
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Quick support links */}
          {(support.whatsappUrl || support.telegramUrl) && (
            <div className="px-3 pb-2 flex gap-2 text-xs flex-wrap">
              {support.telegramUrl && (
                <a
                  href={support.telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                >
                  <ExternalLink className="h-3 w-3" /> Telegram support
                </a>
              )}
              {support.whatsappUrl && (
                <a
                  href={support.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                >
                  <ExternalLink className="h-3 w-3" /> WhatsApp support
                </a>
              )}
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 px-3 pb-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about purchases, deposits, referrals..."
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              disabled={isSending}
            />
            <Button size="icon" onClick={handleSend} disabled={isSending || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Floating circle toggle */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-14 h-14 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
      >
        {isOpen ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </div>
  )
}
