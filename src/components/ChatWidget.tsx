import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { useSupportSettings } from '@/hooks/useSupportSettings'
import { MessageCircle, X, Send, Sparkles, ExternalLink, ArrowRight } from 'lucide-react'
import { trackRevenueEvent, createCroIntervention, markInterventionClicked } from '@/lib/revenue-os'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'

type ChatProductCard = {
  id: string
  name: string
  price: number
  categoryId: string | null
  categoryName: string | null
  availability: string
  href: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  productCards?: ChatProductCard[]
}

const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content:
    "Hey! Welcome to TallyStore. Are you looking for something specific today, or would you like me to help you explore what we have?",
}

export default function ChatWidget() {
  const { user } = useAuth()
  const { currency, formatPrice } = useCurrency()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE])
  const support = useSupportSettings()
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Track chat session lifetime
  const chatSessionIdRef = useRef<string | null>(null)
  const sessionDbIdRef   = useRef<string | null>(null)
  const sessionOpenedAt  = useRef<string | null>(null)
  // Map chatTurnId → intervention IDs for product cards shown in that turn
  const interventionMapRef = useRef<Record<string, string[]>>({})

  // Open a chat_sessions row when the widget opens for the first time
  async function openChatSession() {
    if (chatSessionIdRef.current) return // already open
    const sessionId = `chat:${Date.now()}:${crypto.randomUUID()}`
    chatSessionIdRef.current = sessionId
    sessionOpenedAt.current  = new Date().toISOString()
    try {
      const { data } = await supabase
        .from('chat_sessions' as any)
        .insert({
          session_id:   sessionId,
          visitor_id:   sessionId,
          customer_id:  user?.id || null,
          opened_at:    sessionOpenedAt.current,
        })
        .select('id')
        .single()
      sessionDbIdRef.current = (data as any)?.id || null
    } catch (_) { /* non-critical */ }
  }

  // Close / update the chat_sessions row when widget closes or component unmounts
  async function closeChatSession(extra?: { purchased?: boolean; revenueNgn?: number }) {
    if (!sessionDbIdRef.current) return
    const msgs = messages.filter((m) => m.role === 'user').length
    try {
      await supabase
        .from('chat_sessions' as any)
        .update({
          closed_at:    new Date().toISOString(),
          messages_sent: msgs,
          purchased:    extra?.purchased || false,
          revenue_ngn:  extra?.revenueNgn || null,
        })
        .eq('id', sessionDbIdRef.current)
    } catch (_) { /* non-critical */ }
  }

  // Close session on unmount
  useEffect(() => {
    return () => { closeChatSession() }
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isOpen])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isSending) return

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }]
    const chatTurnId = `chat:${Date.now()}:${crypto.randomUUID()}`
    setMessages(nextMessages)
    setInput('')
    setIsSending(true)
    trackRevenueEvent({
      eventType: 'CHAT_MESSAGE',
      userId: user?.id || null,
      surface: 'chat_widget',
      eventId: `CHAT_MESSAGE:${chatTurnId}`,
      metadata: { chatTurnId, length: text.length },
    })

    try {
      const userName =
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        user?.email?.split('@')[0] ||
        null

      const { data, error } = await supabase.functions.invoke('chatbot', {
        body: {
          messages: nextMessages,
          pagePath: `${window.location.pathname}${window.location.search}`,
          displayCurrency: currency,
          userName,
        },
      })

      if (error) throw error

      const reply =
        data?.reply ||
        "Sorry, I couldn't generate a reply just now. Try again in a moment, or reach support directly."
      const productCards: ChatProductCard[] = Array.isArray(data?.productCards)
        ? data.productCards
            .filter((card: ChatProductCard) => card?.id && card?.name && card?.href)
            .slice(0, 4)
        : []
      setMessages((prev) => [...prev, { role: 'assistant', content: reply, productCards }])
      if (data?.intent) {
        trackRevenueEvent({
          eventType: 'CHAT_INTENT',
          userId: user?.id || null,
          surface: 'chat_widget',
          eventId: `CHAT_INTENT:${chatTurnId}`,
          metadata: {
            chatTurnId,
            intent: data.intent,
            templateId: data?.templateId || null,
            supportHandoff: !!data?.supportHandoff,
            productCount: Array.isArray(data?.productIds) ? data.productIds.length : 0,
            entities: data?.entities || null,
            conversationContext: data?.conversationContext || null,
            conversationStage: data?.conversationStage || null,
            responsePlan: data?.responsePlan || null,
            personality: data?.personality || null,
          },
        })
      }
      if (data?.supportHandoff) {
        trackRevenueEvent({
          eventType: 'SUPPORT_HANDOFF',
          userId: user?.id || null,
          surface: 'chat_widget',
          eventId: `SUPPORT_HANDOFF:${chatTurnId}`,
          metadata: {
            chatTurnId,
            intent: data.intent || 'SUPPORT',
            conversationContext: data?.conversationContext || null,
            conversationStage: data?.conversationStage || null,
            responsePlan: data?.responsePlan || 'SUPPORT_HANDOFF',
          },
        })
      }
      if (Array.isArray(data?.productIds) && data.productIds.length > 0) {
        const shownIds: string[] = data.productIds.slice(0, 4)
        const turnInterventions: string[] = []

        shownIds.forEach((productId: string, index: number) => {
          trackRevenueEvent({
            eventType: 'CHAT_PRODUCT_SHOWN',
            userId: user?.id || null,
            surface: 'chat_widget',
            productGroupId: productId,
            eventId: `CHAT_PRODUCT_SHOWN:${chatTurnId}:${productId}:${index + 1}`,
            metadata: {
              chatTurnId,
              intent: data.intent,
              position: index + 1,
              productIds: shownIds,
              conversationScope: data?.conversationContext?.scope || null,
              contextConfidence: data?.conversationContext?.confidence || null,
              conversationStage: data?.conversationStage || null,
              responsePlan: data?.responsePlan || null,
            },
          })
          // Create a CRO intervention for each product card shown (fire-and-forget)
          createCroIntervention({
            actionType:      'SHOW_ALTERNATIVE',
            surface:         'chat_widget',
            targetProductId: productId,
            strategyKey:     `chat:${data.intent || 'UNKNOWN'}`,
            userId:          user?.id || null,
          }).then((id) => {
            if (id) {
              turnInterventions.push(id)
              interventionMapRef.current[chatTurnId] = turnInterventions
              // Write chat_interventions row
              supabase.from('chat_interventions' as any).insert({
                intervention_id: id,
                session_id:      chatSessionIdRef.current,
                visitor_id:      chatSessionIdRef.current,
                customer_id:     user?.id || null,
                chat_session_id: sessionDbIdRef.current,
                intent:          data.intent || null,
                action:          'SHOW_PRODUCT',
                strategy:        data?.responsePlan || null,
                product_id:      productId,
                template_family: data?.templateId || null,
                confidence:      data?.conversationContext?.confidence || null,
              }).then(() => {}).catch(() => {})
            }
          })
        })
      }
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

  const handleProductCardClick = (card: ChatProductCard, position: number) => {
    trackRevenueEvent({
      eventType: 'RECOMMENDATION_CLICKED',
      userId: user?.id || null,
      productGroupId: card.id,
      categoryId: card.categoryId,
      surface: 'chat_widget_product_card',
      metadata: {
        position,
        destination: card.href,
        categoryName: card.categoryName,
      },
    })
    // Mark any intervention for this product as clicked
    const allInterventions = Object.values(interventionMapRef.current).flat()
    // We fire on all open interventions for this session — the loop will de-dup later
    allInterventions.forEach((id) => markInterventionClicked(id))

    // Update chat_session buy_click flag
    if (sessionDbIdRef.current) {
      supabase
        .from('chat_sessions' as any)
        .update({ buy_click: true })
        .eq('id', sessionDbIdRef.current)
        .then(() => {}).catch(() => {})
    }
    setIsOpen(false)
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
                <div key={i} className={`flex max-w-[88%] flex-col gap-2 ${m.role === 'user' ? 'self-end' : 'self-start'}`}>
                  <div
                    className={`whitespace-pre-line rounded-xl px-3 py-2 text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                        : 'bg-muted text-foreground'
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.role === 'assistant' && m.productCards && m.productCards.length > 0 && (
                    <div className="grid gap-2">
                      {m.productCards.map((card, index) => (
                        <Link
                          key={`${card.id}-${index}`}
                          to={card.href}
                          onClick={() => handleProductCardClick(card, index + 1)}
                          className="group rounded-xl border border-border/70 bg-background p-3 text-left shadow-sm transition hover:border-primary/40 hover:bg-primary/5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="line-clamp-2 text-sm font-black leading-tight text-foreground">{card.name}</p>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {card.categoryName || 'Product'} · {card.availability}
                              </p>
                            </div>
                            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                          </div>
                          <p className="mt-2 text-sm font-black text-primary">
                            {formatPrice(Number(card.price || 0))}
                          </p>
                        </Link>
                      ))}
                    </div>
                  )}
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
        onClick={() => {
          setIsOpen((prev) => {
            const next = !prev
            if (next) {
              trackRevenueEvent({ eventType: 'CHAT_OPENED', userId: user?.id || null, surface: 'chat_widget' })
              openChatSession()
            } else {
              closeChatSession()
            }
            return next
          })
        }}
        className="w-14 h-14 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
      >
        {isOpen ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </div>
  )
}
