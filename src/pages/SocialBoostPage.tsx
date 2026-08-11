import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/SimpleAuth';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import ReactCountryFlag from 'react-country-flag';
import {
  Search,
  Loader2,
  TrendingUp,
  Wallet,
  CheckCircle2,
  AlertCircle,
  Info,
  ExternalLink,
  RefreshCw,
  Clock,
  Zap,
  Users,
  Heart,
  Eye,
  MessageCircle,
  Share2,
  Star,
  ShoppingCart,
  History,
  ArrowLeft,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// Platform configurations with example URLs
const PLATFORMS = [
  { id: 'all', name: 'All', shortName: 'All', icon: Zap, color: 'text-primary', placeholder: 'https://...', example: 'Enter the link to your post or profile' },
  { id: 'instagram', name: 'Instagram', shortName: 'IG', icon: Heart, color: 'text-pink-500', placeholder: 'https://instagram.com/p/ABC123...', example: 'Post, Reel, or Profile URL' },
  { id: 'tiktok', name: 'TikTok', shortName: 'TT', icon: Share2, color: 'text-black dark:text-white', placeholder: 'https://tiktok.com/@user/video/123...', example: 'Video or Profile URL' },
  { id: 'youtube', name: 'YouTube', shortName: 'YT', icon: Eye, color: 'text-red-500', placeholder: 'https://youtube.com/watch?v=ABC123', example: 'Video, Short, or Channel URL' },
  { id: 'facebook', name: 'Facebook', shortName: 'FB', icon: Users, color: 'text-blue-600', placeholder: 'https://facebook.com/post/123...', example: 'Post or Page URL' },
  { id: 'twitter', name: 'Twitter/X', shortName: 'X', icon: MessageCircle, color: 'text-sky-500', placeholder: 'https://x.com/user/status/123...', example: 'Tweet or Profile URL' },
  { id: 'telegram', name: 'Telegram', shortName: 'TG', icon: Share2, color: 'text-blue-400', placeholder: 'https://t.me/channel/123', example: 'Channel or Post URL' },
  { id: 'spotify', name: 'Spotify', shortName: 'SP', icon: Star, color: 'text-green-500', placeholder: 'https://open.spotify.com/track/...', example: 'Track, Album, or Artist URL' },
];

// Country codes that appear in service names
const COUNTRY_CODES = [
  'AR', 'BR', 'US', 'UK', 'GB', 'DE', 'FR', 'ES', 'IT', 'PT',
  'MX', 'CA', 'AU', 'IN', 'JP', 'KR', 'CN', 'RU', 'TR', 'SA',
  'AE', 'EG', 'NG', 'ZA', 'KE', 'PH', 'ID', 'MY', 'SG', 'TH',
  'VN', 'PK', 'BD', 'PL', 'NL', 'BE', 'SE', 'NO', 'DK', 'FI',
  'CL', 'CO', 'PE', 'VE', 'EC', 'IL', 'GR', 'CZ', 'HU', 'RO',
  'UA', 'AT', 'CH', 'IE', 'NZ',
];

// Convert Unicode flag emoji to country code
// Flag emojis are made of Regional Indicator Symbols: 🇦 (U+1F1E6) to 🇿 (U+1F1FF)
// Example: 🇳🇬 = Regional N (U+1F1F3) + Regional G (U+1F1EC) = "NG"
const flagEmojiToCountryCode = (flag: string): string | null => {
  const codePoints = [...flag].map(char => char.codePointAt(0) || 0);
  
  // Check if we have exactly 2 regional indicator symbols (each 4 bytes, but JS sees as 2 chars)
  if (codePoints.length !== 2) return null;
  
  // Regional Indicator range: U+1F1E6 (127462) to U+1F1FF (127487)
  const isRegionalIndicator = (cp: number) => cp >= 127462 && cp <= 127487;
  
  if (!isRegionalIndicator(codePoints[0]) || !isRegionalIndicator(codePoints[1])) {
    return null;
  }
  
  // Convert back to letters: subtract offset (127462 - 65 = 127397)
  const letter1 = String.fromCharCode(codePoints[0] - 127397);
  const letter2 = String.fromCharCode(codePoints[1] - 127397);
  
  return letter1 + letter2;
};

// Check if string starts with a flag emoji and extract the country code
const extractFlagFromStart = (name: string): { countryCode: string | null; cleanName: string } => {
  // Flag emojis are 4 bytes (2 UTF-16 surrogate pairs), appears as first 2 "characters" when spread
  const chars = [...name];
  
  if (chars.length >= 2) {
    // Try first 2 code points as potential flag
    const potentialFlag = chars[0] + chars[1];
    const countryCode = flagEmojiToCountryCode(potentialFlag);
    
    if (countryCode) {
      // Remove the flag emoji from the start
      const cleanName = chars.slice(2).join('').trimStart();
      return { countryCode: countryCode === 'UK' ? 'GB' : countryCode, cleanName };
    }
  }
  
  // Also check for text country codes at start (e.g., "ARTikTok")
  for (const code of COUNTRY_CODES) {
    if (name.startsWith(code) && name.length > code.length) {
      const nextChar = name[code.length];
      if (nextChar === ' ' || (nextChar >= 'A' && nextChar <= 'Z')) {
        return { 
          countryCode: code === 'UK' ? 'GB' : code, 
          cleanName: name.slice(code.length).trimStart() 
        };
      }
    }
  }
  
  return { countryCode: null, cleanName: name };
};

// Legacy function for compatibility
const extractCountryCode = (name: string): string | null => {
  return extractFlagFromStart(name).countryCode;
};

// Remove flag emoji or country code from service name
const formatServiceName = (name: string): string => {
  return extractFlagFromStart(name).cleanName;
};

// Country Flag component with SVG fallback for Windows
const CountryFlag: React.FC<{ code: string; className?: string }> = ({ code, className }) => {
  const normalizedCode = code === 'UK' ? 'GB' : code.toUpperCase();
  return (
    <ReactCountryFlag
      countryCode={normalizedCode}
      svg
      style={{
        width: '1.2em',
        height: '1.2em',
      }}
      className={className}
      title={normalizedCode}
    />
  );
};

// Service name with flag (uses SVG for Windows compatibility)
const ServiceNameWithFlag: React.FC<{ name: string; className?: string }> = ({ name, className }) => {
  const countryCode = extractCountryCode(name);
  const cleanName = formatServiceName(name);
  
  return (
    <span className={`inline-flex items-center gap-1 ${className || ''}`}>
      {countryCode && <CountryFlag code={countryCode} />}
      <span>{cleanName}</span>
    </span>
  );
};

// Get placeholder based on service platform
const getPlaceholderForPlatform = (platform: string | undefined): { placeholder: string; example: string } => {
  const found = PLATFORMS.find(p => p.id === platform?.toLowerCase());
  return found ? { placeholder: found.placeholder, example: found.example } : { placeholder: 'https://...', example: 'Enter the link to your post or profile' };
};

// Service type field requirements
const SERVICE_TYPE_FIELDS: Record<string, string[]> = {
  'Default': ['link', 'quantity'],
  'Package': ['link'],
  'Custom Comments': ['link', 'comments'],
  'Custom Comments Package': ['link', 'comments'],
  'Mentions': ['link', 'quantity', 'usernames'],
  'Mentions with Hashtags': ['link', 'quantity', 'usernames', 'hashtags'],
  'Mentions Custom List': ['link', 'usernames'],
  'Mentions Hashtag': ['link', 'quantity', 'hashtag'],
  'Mentions User Followers': ['link', 'quantity', 'username'],
  'Mentions Media Likers': ['link', 'quantity', 'username'],
  'Comment Likes': ['link', 'quantity', 'username'],
  'Comment Replies': ['link', 'username', 'comments'],
  'Poll': ['link', 'answer_number'],
  'Invites from Groups': ['link', 'quantity', 'groups'],
  'Subscriptions': ['username', 'quantity'],
  'SEO': ['link', 'keywords'],
  'Web Traffic': ['link', 'quantity'],
};

const getFieldsForType = (serviceType: string): string[] => {
  return SERVICE_TYPE_FIELDS[serviceType] || ['link', 'quantity'];
};

const getServiceIcon = (name: string) => {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('follower') || lowerName.includes('subscriber')) return Users;
  if (lowerName.includes('like') || lowerName.includes('heart')) return Heart;
  if (lowerName.includes('view') || lowerName.includes('watch')) return Eye;
  if (lowerName.includes('comment')) return MessageCircle;
  if (lowerName.includes('share') || lowerName.includes('retweet')) return Share2;
  return Zap;
};

// Robust URL patterns - accepting valid variations for each platform
const URL_PATTERNS: Record<string, RegExp> = {
  // Instagram: www/m + paths like /p/, /reel/, /stories/, /tv/, @username, usernames
  instagram: /^https?:\/\/(www\.|m\.)?instagram\.com\/(p|reel|reels|stories|tv|s|explore|accounts|direct)\/[\w.-]+\/?.*$|^https?:\/\/(www\.|m\.)?instagram\.com\/[\w.-]+\/?$/i,
  
  // TikTok: www/m/vm/vt subdomains, @user/video paths OR short links
  tiktok: /^https?:\/\/(www\.|m\.|vm\.|vt\.)?tiktok\.com\/((@[\w.-]+\/(video|photo|live)\/\d+)|(@[\w.-]+)|[\w-]+)\/?.*$/i,
  
  // YouTube: youtube.com, youtu.be, m.youtube - watch, shorts, channel, @user, playlists
  youtube: /^https?:\/\/(www\.|m\.|music\.)?youtube\.com\/(watch\?v=[\w-]+|shorts\/[\w-]+|channel\/[\w-]+|c\/[\w-]+|user\/[\w-]+|playlist\?list=[\w-]+|@[\w.-]+|embed\/[\w-]+|live\/[\w-]+).*$|^https?:\/\/youtu\.be\/[\w-]+.*$/i,
  
  // Facebook: fb.com, facebook.com, fb.watch, fb.me - posts, videos, profiles, pages, groups, stories
  facebook: /^https?:\/\/(www\.|m\.|web\.|l\.)?(facebook\.com|fb\.com)\/([\w.-]+\/(posts|videos|photos|reels)\/[\w.-]+|[\w.-]+\/?\??.*|story\.php\?.*|watch\/?\?v=\d+|groups\/[\w.-]+|events\/\d+|share\/.+).*$|^https?:\/\/(fb\.watch|fb\.me)\/[\w.-]+.*$/i,
  
  // Twitter/X: twitter.com, x.com - tweets, profiles, status
  twitter: /^https?:\/\/(www\.|mobile\.)?(twitter\.com|x\.com)\/([\w]+\/status\/\d+|[\w]+|i\/web\/status\/\d+|hashtag\/[\w]+).*$|^https?:\/\/t\.co\/[\w]+$/i,
  
  // Telegram: t.me, telegram.me - channels, groups, usernames, messages
  telegram: /^https?:\/\/(www\.)?(t\.me|telegram\.me|telegram\.org)\/([\w]+|s\/[\w]+|c\/[\d-]+\/\d+|joinchat\/[\w-]+|addstickers\/[\w]+|\+[\w]+).*$/i,
  
  // Spotify: open.spotify.com - tracks, albums, artists, playlists, podcasts, episodes
  spotify: /^https?:\/\/(open\.)?spotify\.com\/(track|album|artist|playlist|user|show|episode|intl-[\w]+)\/[\w]+.*$/i,
  
  // Threads: threads.net - posts and profiles
  threads: /^https?:\/\/(www\.)?threads\.net\/(@[\w.-]+|t\/[\w]+|[\w.-]+\/post\/[\w]+).*$/i,
  
  // LinkedIn: linkedin.com - posts, profiles, company pages
  linkedin: /^https?:\/\/(www\.)?linkedin\.com\/(in|company|posts|pulse|feed|groups)\/[\w.-]+.*$/i,
  
  // Pinterest: pinterest.com, pin.it - pins, boards, profiles
  pinterest: /^https?:\/\/(www\.|[\w]+\.)?pinterest\.com\/(pin\/[\d]+|[\w.-]+).*$|^https?:\/\/pin\.it\/[\w]+$/i,
  
  // Snapchat: snapchat.com - profiles, stories, spotlight
  snapchat: /^https?:\/\/(www\.|story\.|t\.)?snapchat\.com\/(add|spotlight|discover|stories)\/[\w.-]+.*$|^https?:\/\/(www\.)?snapchat\.com\/[\w.-]+$/i,
  
  // Twitch: twitch.tv - channels, videos, clips
  twitch: /^https?:\/\/(www\.|m\.)?twitch\.tv\/(videos\/\d+|[\w]+\/clip\/[\w-]+|[\w]+).*$/i,
  
  // Discord: discord.gg, discord.com - invites, channels
  discord: /^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\/[\w-]+.*$|^https?:\/\/(www\.)?discord\.com\/channels\/\d+\/\d+.*$/i,
  
  // SoundCloud: soundcloud.com - tracks, playlists, profiles
  soundcloud: /^https?:\/\/(www\.|m\.|on\.)?soundcloud\.com\/[\w.-]+(\/[\w.-]+)?.*$/i,
  
  // Reddit: reddit.com - posts, subreddits, profiles
  reddit: /^https?:\/\/(www\.|old\.|new\.)?reddit\.com\/(r\/[\w]+|u\/[\w]+|user\/[\w]+|comments\/[\w]+).*$/i,
};

interface SmmService {
  id: number;
  external_id: number;
  name: string;
  category: string;
  platform: string;
  service_type: string;
  rate_usd: number;
  price_ngn: number;
  min_quantity: number;
  max_quantity: number;
  has_refill: boolean;
  has_cancel: boolean;
  is_active: boolean;
}

interface SmmOrder {
  id: string;
  service_id: string;
  link: string;
  quantity: number;
  amount_ngn: number;
  status: string;
  external_order_id: number | null;
  start_count: number | null;
  remains: number | null;
  created_at: string;
  updated_at: string;
  // Joined from smm_services
  smm_services?: {
    name: string;
    platform: string;
  };
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export default function SocialBoostPage() {
  const navigate = useNavigate();
  const { user, walletBalance, refreshWalletBalance } = useAuth();
  const { toast } = useToast();

  const [services, setServices] = useState<SmmService[]>([]);
  const [orders, setOrders] = useState<SmmOrder[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingWallet, setLoadingWallet] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [activeTab, setActiveTab] = useState<'order' | 'history'>('order');
  const debouncedSearch = useDebounce(searchQuery, 300);

  const [selectedService, setSelectedService] = useState<SmmService | null>(null);
  const [link, setLink] = useState('');
  const [quantity, setQuantity] = useState('');
  const [linkError, setLinkError] = useState('');
  const [comments, setComments] = useState('');
  const [usernames, setUsernames] = useState('');
  const [username, setUsername] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [hashtag, setHashtag] = useState('');
  const [keywords, setKeywords] = useState('');
  const [answerNumber, setAnswerNumber] = useState('');
  const [groups, setGroups] = useState('');

  const searchServices = useCallback(async (query: string, platform: string) => {
    if (!query.trim() && platform === 'all') {
      setServices([]);
      return;
    }
    setLoadingServices(true);
    try {
      let dbQuery = supabase
        .from('smm_services')
        .select('*')
        .eq('is_active', true)
        .order('name')
        .limit(50);

      if (platform !== 'all') dbQuery = dbQuery.eq('platform', platform);
      
      // Intelligent search: split query into words and search each
      if (query.trim()) {
        const words = query.toLowerCase().trim().split(/\s+/).filter(w => w.length > 1);
        if (words.length > 0) {
          // Build OR conditions for each word across name, category, and platform
          const conditions = words.map(word => 
            `name.ilike.%${word}%,category.ilike.%${word}%,platform.ilike.%${word}%`
          ).join(',');
          dbQuery = dbQuery.or(conditions);
        }
      }

      const { data, error } = await dbQuery;
      if (error) throw error;
      
      // Client-side scoring: prioritize results matching more words
      if (query.trim() && data) {
        const words = query.toLowerCase().trim().split(/\s+/).filter(w => w.length > 1);
        const scored = data.map(service => {
          const searchText = `${service.name} ${service.category} ${service.platform}`.toLowerCase();
          const score = words.filter(word => searchText.includes(word)).length;
          return { ...service, _score: score };
        });
        scored.sort((a, b) => b._score - a._score);
        setServices(scored);
      } else {
        setServices(data || []);
      }
    } catch (err) {
      console.error('Error searching services:', err);
      toast({ variant: 'destructive', title: 'Search Error', description: 'Failed to search services.' });
    } finally {
      setLoadingServices(false);
    }
  }, [toast]);

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    setLoadingOrders(true);
    try {
      const { data, error } = await supabase
        .from('smm_orders')
        .select(`
          id, service_id, link, quantity, amount_ngn, status,
          external_order_id, start_count, remains,
          created_at, updated_at,
          smm_services ( name, platform )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setOrders(data || []);
    } catch (err) {
      console.error('Error fetching orders:', err);
    } finally {
      setLoadingOrders(false);
    }
  }, [user]);

  useEffect(() => {
    searchServices(debouncedSearch, selectedPlatform);
  }, [debouncedSearch, selectedPlatform, searchServices]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Fetch wallet balance on mount
  useEffect(() => {
    const loadWallet = async () => {
      setLoadingWallet(true);
      await refreshWalletBalance();
      setLoadingWallet(false);
    };
    if (user) {
      loadWallet();
    }
  }, [user, refreshWalletBalance]);

  const requiredFields = useMemo(() => {
    if (!selectedService) return ['link', 'quantity'];
    return getFieldsForType(selectedService.service_type);
  }, [selectedService]);

  const validateLink = (url: string, service: SmmService | null): string => {
    if (!url.trim() || !service) return '';
    try { new URL(url); } catch { return 'Please enter a valid URL'; }
    const platform = service.platform?.toLowerCase();
    if (platform && URL_PATTERNS[platform] && !URL_PATTERNS[platform].test(url)) {
      return `Please enter a valid ${platform.charAt(0).toUpperCase() + platform.slice(1)} URL`;
    }
    return '';
  };

  const handleLinkChange = (value: string) => {
    setLink(value);
    setLinkError(validateLink(value, selectedService));
  };

  const handleSelectService = (service: SmmService) => {
    setSelectedService(service);
    setQuantity(service.min_quantity.toString());
    setLink(''); setLinkError(''); setComments(''); setUsernames('');
    setUsername(''); setHashtags(''); setHashtag(''); setKeywords('');
    setAnswerNumber(''); setGroups('');
  };

  // Service types that use quantity for pricing
  const typesWithQuantity = [
    'Default', 'Mentions', 'Mentions with Hashtags', 'Mentions Hashtag',
    'Mentions User Followers', 'Mentions Media Likers', 'Comment Likes',
    'Invites from Groups', 'Subscriptions', 'Web Traffic'
  ];

  const calculateTotal = (): number => {
    if (!selectedService) return 0;
    
    // Types with fixed pricing (no quantity multiplier)
    // Package, Custom Comments, Custom Comments Package, Comment Replies, Poll, SEO, Mentions Custom List
    if (!typesWithQuantity.includes(selectedService.service_type)) {
      return selectedService.price_ngn;
    }
    
    // Types with quantity-based pricing
    const qty = parseInt(quantity) || 0;
    return Math.ceil((selectedService.price_ngn / 1000) * qty);
  };

  const isFormValid = (): boolean => {
    if (!selectedService) return false;
    const fields = requiredFields;
    
    // Validate link for types that need it (not Subscriptions)
    if (fields.includes('link') && selectedService.service_type !== 'Subscriptions') {
      if (!link || linkError) return false;
    }
    
    // Validate quantity for types that need it
    if (typesWithQuantity.includes(selectedService.service_type)) {
      const qty = parseInt(quantity) || 0;
      if (qty < selectedService.min_quantity || qty > selectedService.max_quantity) return false;
    }
    
    // Validate other fields
    if (fields.includes('comments') && !comments.trim()) return false;
    if (fields.includes('usernames') && !usernames.trim()) return false;
    if (fields.includes('username') && !username.trim()) return false;
    if (fields.includes('hashtags') && !hashtags.trim()) return false;
    if (fields.includes('hashtag') && !hashtag.trim()) return false;
    if (fields.includes('keywords') && !keywords.trim()) return false;
    if (fields.includes('answer_number') && !answerNumber) return false;
    if (fields.includes('groups') && !groups.trim()) return false;
    if (calculateTotal() > walletBalance) return false;
    return true;
  };

  const handleSubmitOrder = async () => {
    if (!selectedService || !isFormValid()) return;
    
    // Build payload - use service_id (internal DB ID) not external_id
    const payload: Record<string, string | number> = { 
      service_id: selectedService.id // Internal DB ID
    };
    
    // Service types that require quantity parameter
    const typesWithQuantity = [
      'Default', 'Mentions', 'Mentions with Hashtags', 'Mentions Hashtag',
      'Mentions User Followers', 'Mentions Media Likers', 'Comment Likes',
      'Invites from Groups', 'Subscriptions', 'Web Traffic'
    ];
    
    // Add link for types that need it (all except Subscriptions)
    if (requiredFields.includes('link') && selectedService.service_type !== 'Subscriptions') {
      payload.link = link;
    }
    
    // Add quantity only for types that need it
    if (typesWithQuantity.includes(selectedService.service_type)) {
      payload.quantity = parseInt(quantity) || selectedService.min_quantity;
    }
    
    // Add type-specific fields
    if (requiredFields.includes('comments')) payload.comments = comments;
    if (requiredFields.includes('usernames')) payload.usernames = usernames;
    if (requiredFields.includes('username')) payload.username = username;
    if (requiredFields.includes('hashtags')) payload.hashtags = hashtags;
    if (requiredFields.includes('hashtag')) payload.hashtag = hashtag;
    if (requiredFields.includes('keywords')) payload.keywords = keywords;
    if (requiredFields.includes('answer_number')) payload.answer_number = parseInt(answerNumber);
    if (requiredFields.includes('groups')) payload.groups = groups;

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('smm-create-order', { body: payload });
      
      // Handle edge function errors - extract the actual error message
      if (error) {
        // Try to get detailed error from FunctionsHttpError
        let errorMessage = error.message;
        if (error.context?.body) {
          try {
            const errorBody = typeof error.context.body === 'string' 
              ? JSON.parse(error.context.body) 
              : error.context.body;
            if (errorBody?.error) errorMessage = errorBody.error;
          } catch { /* ignore parse errors */ }
        }
        throw new Error(errorMessage);
      }
      
      if (data?.success) {
        toast({ title: 'Order Placed! 🎉', description: `Order #${data.data?.reference || data.orderId} submitted.` });
        setSelectedService(null); setLink(''); setQuantity(''); setSearchQuery('');
        setComments(''); setUsernames(''); setUsername(''); setHashtags('');
        setHashtag(''); setKeywords(''); setAnswerNumber(''); setGroups('');
        await Promise.all([fetchOrders(), refreshWalletBalance()]);
        setActiveTab('history');
      } else {
        throw new Error(data?.error || 'Failed to place order');
      }
    } catch (err: unknown) {
      console.error('Order error:', err);
      // Check if error has JSON body with more details
      let errorMessage = 'Failed to place order.';
      if (err instanceof Error) {
        errorMessage = err.message;
      }
      toast({ variant: 'destructive', title: 'Order Failed', description: errorMessage });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckStatus = async (orderId: string, panelOrderId: number | null) => {
    if (!panelOrderId) {
      toast({ variant: 'destructive', title: 'Cannot Check', description: 'No panel order ID yet.' });
      return;
    }
    setCheckingStatus(orderId);
    try {
      const { data, error } = await supabase.functions.invoke('smm-check-status', { body: { order_id: orderId } });
      if (error) throw error;
      if (data.success) {
        const status = data.data?.status || data.status || 'Unknown';
        toast({ title: 'Status Updated', description: `Status: ${status}` });
        await fetchOrders();
      } else throw new Error(data.error);
    } catch (err) {
      console.error('Status check error:', err);
      toast({ variant: 'destructive', title: 'Check Failed', description: err instanceof Error ? err.message : 'Failed.' });
    } finally {
      setCheckingStatus(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'completed') return <Badge className="bg-green-500">Completed</Badge>;
    if (s === 'in progress' || s === 'inprogress' || s === 'processing') return <Badge className="bg-blue-500">In Progress</Badge>;
    if (s === 'pending') return <Badge className="bg-yellow-500">Pending</Badge>;
    if (s === 'partial') return <Badge className="bg-orange-500">Partial</Badge>;
    if (s === 'canceled' || s === 'cancelled') return <Badge className="bg-red-500">Cancelled</Badge>;
    if (s === 'refunded') return <Badge className="bg-purple-500">Refunded</Badge>;
    return <Badge variant="secondary">{status}</Badge>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      {/* Sticky Nav */}
      <nav className="border-b bg-gradient-to-r from-pink-600 to-purple-600 shadow-lg sticky top-0 z-10">
        <div className="container mx-auto px-3 sm:px-6 py-3 sm:py-4 flex justify-between items-center">
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')} className="gap-1 text-white hover:bg-white/20 hover:text-white font-medium text-xs sm:text-sm px-2 sm:px-3">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden xs:inline">Back</span>
          </Button>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            <h1 className="text-base sm:text-lg md:text-xl font-bold text-white">Social Boost</h1>
          </div>
          <div className="w-12 sm:w-20" />
        </div>
      </nav>

      <div className="container mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 max-w-6xl">
        {/* Hero - Compact on mobile */}
        <div className="text-center mb-4 sm:mb-6">
          <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-foreground mb-1">Boost Your Social Media</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">Followers, likes, views & more</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            {/* Wallet Card - Compact on mobile */}
            <Card className="border-2">
              <CardContent className="p-3 sm:p-4 md:pt-6">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="p-1.5 sm:p-2 rounded-full bg-green-500 shrink-0"><Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-white" /></div>
                    <div className="min-w-0">
                      <p className="font-semibold text-xs sm:text-sm">Balance</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">TallyStore Wallet</p>
                    </div>
                  </div>
                  {loadingWallet ? (
                    <div className="h-7 sm:h-8 w-24 sm:w-32 bg-muted animate-pulse rounded" />
                  ) : (
                    <p className="text-lg sm:text-xl md:text-2xl font-bold text-green-700 dark:text-green-400 shrink-0">₦{walletBalance.toLocaleString('en-NG', { minimumFractionDigits: 0 })}</p>
                  )}
                </div>
                {!loadingWallet && walletBalance < 1000 && <Button size="sm" variant="outline" onClick={() => navigate('/wallet')} className="mt-2 sm:mt-3 w-full text-xs sm:text-sm h-8 sm:h-9">Top Up Wallet</Button>}
              </CardContent>
            </Card>

            <Card className="shadow-xl">
              <CardHeader className="bg-gradient-to-r from-muted/50 to-muted/30 border-b p-3 sm:p-4 md:p-6">
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl md:text-2xl"><TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />Services</CardTitle>
                <CardDescription className="text-xs sm:text-sm">Search & order social media services</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 md:p-6">
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'order' | 'history')}>
                  <TabsList className="grid w-full grid-cols-2 h-9 sm:h-10 md:h-12 mb-4 sm:mb-6">
                    <TabsTrigger value="order" className="text-xs sm:text-sm md:text-base gap-1 sm:gap-2"><ShoppingCart className="w-3.5 h-3.5 sm:w-4 sm:h-4" /><span className="hidden xs:inline">New</span> Order</TabsTrigger>
                    <TabsTrigger value="history" className="text-xs sm:text-sm md:text-base gap-1 sm:gap-2"><History className="w-3.5 h-3.5 sm:w-4 sm:h-4" />History</TabsTrigger>
                  </TabsList>

                  <TabsContent value="order" className="space-y-3 sm:space-y-4 md:space-y-6 mt-0">
                    {/* Platform filters - horizontal scroll on mobile */}
                    <div className="-mx-3 sm:mx-0 px-3 sm:px-0 overflow-x-auto scrollbar-hide">
                      <div className="flex gap-1.5 sm:gap-2 min-w-max sm:min-w-0 sm:flex-wrap pb-2 sm:pb-0">
                        {PLATFORMS.map((platform) => {
                          const Icon = platform.icon;
                          const isActive = selectedPlatform === platform.id;
                          return (
                            <Button 
                              key={platform.id} 
                              variant={isActive ? 'default' : 'outline'} 
                              size="sm"
                              onClick={() => { setSelectedPlatform(platform.id); setSelectedService(null); }} 
                              className={`gap-1 sm:gap-1.5 h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm shrink-0 ${isActive ? '' : 'border-muted-foreground/30'}`}
                            >
                              <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${!isActive ? platform.color : ''}`} />
                              <span>{platform.shortName}</span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Search input with mobile result count */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
                      <Input 
                        placeholder={selectedPlatform !== 'all' 
                          ? `Search ${PLATFORMS.find(p => p.id === selectedPlatform)?.name} services...` 
                          : "Search services (e.g., 'tiktok followers')"}
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setSelectedService(null); }} 
                        className="pl-9 sm:pl-10 pr-20 sm:pr-3 h-10 sm:h-11 md:h-12 text-sm sm:text-base" 
                      />
                      {loadingServices ? (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 animate-spin text-muted-foreground" />
                      ) : (searchQuery.trim() || selectedPlatform !== 'all') && services.length > 0 ? (
                        <Badge variant="secondary" className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-1.5 h-5 lg:hidden">{services.length} found</Badge>
                      ) : null}
                    </div>

                    {!searchQuery.trim() && selectedPlatform === 'all' ? (
                      <div className="p-4 sm:p-6 md:p-8 bg-muted/50 rounded-lg border-2 border-dashed text-center">
                        <Search className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 mx-auto mb-2 sm:mb-3 text-muted-foreground" />
                        <p className="text-muted-foreground font-medium text-sm sm:text-base">Search for a service</p>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-1">Try "tiktok followers" or select a platform above</p>
                      </div>
                    ) : loadingServices ? (
                      <div className="flex items-center justify-center py-8 sm:py-12"><Loader2 className="w-6 h-6 sm:w-8 sm:h-8 animate-spin text-muted-foreground" /></div>
                    ) : services.length === 0 ? (
                      <div className="p-4 sm:p-6 md:p-8 bg-muted/50 rounded-lg border-2 border-dashed text-center">
                        <AlertCircle className="w-8 h-8 sm:w-10 sm:h-10 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-muted-foreground text-sm">No services found</p>
                        <p className="text-xs text-muted-foreground mt-1">Try different keywords</p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[280px] sm:max-h-[320px] md:max-h-[350px] overflow-y-auto -mx-1 px-1">
                        {services.map((service) => {
                          const ServiceIcon = getServiceIcon(service.name);
                          const isSelected = selectedService?.id === service.id;
                          return (
                            <Card 
                              key={service.id} 
                              className={`cursor-pointer transition-all active:scale-[0.99] ${isSelected ? 'ring-2 ring-primary bg-primary/5' : 'hover:border-primary hover:shadow-sm'}`}
                              onClick={() => handleSelectService(service)}
                            >
                              <CardContent className="p-2.5 sm:p-3 md:p-4">
                                <div className="flex items-center justify-between gap-2 sm:gap-3">
                                  <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                                    <div className={`p-1.5 sm:p-2 rounded-lg shrink-0 ${isSelected ? 'bg-primary text-white' : 'bg-muted'}`}>
                                      <ServiceIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium text-xs sm:text-sm line-clamp-2 leading-tight"><ServiceNameWithFlag name={service.name} /></p>
                                      <div className="flex items-center gap-1.5 mt-0.5 sm:mt-1">
                                        <Badge variant="outline" className="text-[10px] sm:text-xs px-1 sm:px-1.5 py-0 h-4 sm:h-5">{service.platform || 'Other'}</Badge>
                                        <span className="text-[10px] sm:text-xs text-muted-foreground">
                                          {service.service_type === 'Package' ? 'Package' : `${service.min_quantity.toLocaleString()}+`}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-sm sm:text-base md:text-lg font-bold text-green-600">₦{service.price_ngn.toLocaleString()}</p>
                                    <p className="text-[10px] sm:text-xs text-muted-foreground">{service.service_type === 'Package' ? 'fixed' : '/1K'}</p>
                                  </div>
                                  {isSelected && <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-primary shrink-0" />}
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    )}

                    {selectedService && (
                      <Card className="border-2 border-primary/50 bg-primary/5">
                        <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-4 md:p-6">
                          <CardTitle className="text-base sm:text-lg flex items-center gap-2"><ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5" />Order Details</CardTitle>
                          <div className="text-xs sm:text-sm text-muted-foreground flex items-center gap-2">
                            <span>Type:</span>
                            <Badge variant="secondary" className="text-xs">{selectedService.service_type}</Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3 sm:space-y-4 p-3 sm:p-4 md:p-6 pt-0 sm:pt-0">
                          <div className="p-2 sm:p-3 bg-background rounded-lg">
                            <p className="font-medium text-xs sm:text-sm line-clamp-2"><ServiceNameWithFlag name={selectedService.name} /></p>
                            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">{selectedService.category}</p>
                          </div>

                          {requiredFields.includes('link') && selectedService.service_type !== 'Subscriptions' && (() => {
                            const { placeholder, example } = getPlaceholderForPlatform(selectedService.platform);
                            return (
                              <div className="space-y-1.5 sm:space-y-2">
                                <Label className="text-sm sm:text-base font-medium">Link / URL *</Label>
                                <div className="relative">
                                  <ExternalLink className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                  <Input 
                                    placeholder={placeholder} 
                                    value={link} 
                                    onChange={(e) => handleLinkChange(e.target.value)} 
                                    className={`pl-10 h-10 sm:h-11 md:h-12 text-sm sm:text-base ${linkError ? 'border-red-500' : ''}`} 
                                  />
                                </div>
                                {linkError ? (
                                  <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{linkError}</p>
                                ) : (
                                  <p className="text-[10px] sm:text-xs text-muted-foreground">{example}</p>
                                )}
                              </div>
                            );
                          })()}

                          {typesWithQuantity.includes(selectedService.service_type) && (() => {
                            const qty = parseInt(quantity) || 0;
                            const isBelowMin = qty > 0 && qty < selectedService.min_quantity;
                            const isAboveMax = qty > selectedService.max_quantity;
                            const hasError = isBelowMin || isAboveMax;
                            
                            return (
                              <div className="space-y-1.5 sm:space-y-2">
                                <Label className="text-sm sm:text-base font-medium">Quantity *</Label>
                                <Input 
                                  type="number" 
                                  placeholder={`Min: ${selectedService.min_quantity}`} 
                                  value={quantity} 
                                  onChange={(e) => setQuantity(e.target.value)}
                                  className={`h-10 sm:h-11 md:h-12 text-sm sm:text-base md:text-lg ${hasError ? 'border-red-500 focus-visible:ring-red-500' : ''}`} 
                                  min={selectedService.min_quantity} 
                                  max={selectedService.max_quantity} 
                                />
                                {isBelowMin ? (
                                  <p className="text-xs text-red-500 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />
                                    Minimum quantity is {selectedService.min_quantity.toLocaleString()}
                                  </p>
                                ) : isAboveMax ? (
                                  <p className="text-xs text-red-500 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />
                                    Maximum quantity is {selectedService.max_quantity.toLocaleString()}
                                  </p>
                                ) : (
                                  <p className="text-[10px] sm:text-xs text-muted-foreground">
                                    Min: {selectedService.min_quantity.toLocaleString()} • Max: {selectedService.max_quantity.toLocaleString()}
                                  </p>
                                )}
                                <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                                  {[selectedService.min_quantity, 100, 500, 1000, 5000]
                                    .filter((q, i, arr) => q >= selectedService.min_quantity && q <= selectedService.max_quantity && arr.indexOf(q) === i)
                                    .slice(0, 4)
                                    .map((qty) => (
                                      <Button key={qty} type="button" variant="outline" size="sm" onClick={() => setQuantity(qty.toString())} className="h-8 text-xs sm:text-sm">
                                        {qty >= 1000 ? `${qty / 1000}K` : qty}
                                      </Button>
                                    ))}
                                </div>
                              </div>
                            );
                          })()}

                          {requiredFields.includes('username') && (
                            <div className="space-y-1.5 sm:space-y-2">
                              <Label className="text-sm sm:text-base font-medium">Username *</Label>
                              <Input placeholder="@username (without @)" value={username} onChange={(e) => setUsername(e.target.value.replace('@', ''))} className="h-10 sm:h-11 md:h-12 text-sm sm:text-base" />
                            </div>
                          )}

                          {requiredFields.includes('usernames') && (
                            <div className="space-y-1.5 sm:space-y-2">
                              <Label className="text-sm sm:text-base font-medium">Usernames * (one per line)</Label>
                              <Textarea placeholder={"username1\nusername2\nusername3"} value={usernames} onChange={(e) => setUsernames(e.target.value)} rows={3} className="text-sm" />
                            </div>
                          )}

                          {requiredFields.includes('comments') && (
                            <div className="space-y-1.5 sm:space-y-2">
                              <Label className="text-sm sm:text-base font-medium">Comments * (one per line)</Label>
                              <Textarea placeholder={"Great post!\nLove this 🔥\nAmazing"} value={comments} onChange={(e) => setComments(e.target.value)} rows={3} className="text-sm" />
                            </div>
                          )}

                          {requiredFields.includes('hashtags') && (
                            <div className="space-y-1.5 sm:space-y-2">
                              <Label className="text-sm sm:text-base font-medium">Hashtags * (one per line)</Label>
                              <Textarea placeholder={"#trending\n#viral"} value={hashtags} onChange={(e) => setHashtags(e.target.value)} rows={2} className="text-sm" />
                            </div>
                          )}

                          {requiredFields.includes('hashtag') && (
                            <div className="space-y-1.5 sm:space-y-2">
                              <Label className="text-sm sm:text-base font-medium">Hashtag *</Label>
                              <Input placeholder="#trending" value={hashtag} onChange={(e) => setHashtag(e.target.value)} className="h-10 sm:h-11 md:h-12 text-sm sm:text-base" />
                            </div>
                          )}

                          {requiredFields.includes('keywords') && (
                            <div className="space-y-1.5 sm:space-y-2">
                              <Label className="text-sm sm:text-base font-medium">Keywords * (one per line)</Label>
                              <Textarea placeholder={"keyword 1\nkeyword 2"} value={keywords} onChange={(e) => setKeywords(e.target.value)} rows={2} className="text-sm" />
                            </div>
                          )}

                          {requiredFields.includes('answer_number') && (
                            <div className="space-y-1.5 sm:space-y-2">
                              <Label className="text-sm sm:text-base font-medium">Poll Answer Number *</Label>
                              <Input type="number" placeholder="1, 2, 3..." value={answerNumber} onChange={(e) => setAnswerNumber(e.target.value)} className="h-10 sm:h-11 md:h-12 text-sm sm:text-base" min={1} />
                            </div>
                          )}

                          {requiredFields.includes('groups') && (
                            <div className="space-y-1.5 sm:space-y-2">
                              <Label className="text-sm sm:text-base font-medium">Group Links * (one per line)</Label>
                              <Textarea placeholder={"https://t.me/group1\nhttps://t.me/group2"} value={groups} onChange={(e) => setGroups(e.target.value)} rows={2} className="text-sm" />
                            </div>
                          )}

                          <div className="p-3 sm:p-4 bg-background rounded-lg border">
                            <div className="flex justify-between items-center text-xs sm:text-sm">
                              <span className="text-muted-foreground">
                                {typesWithQuantity.includes(selectedService.service_type) ? 'Price per 1000:' : 'Fixed Price:'}
                              </span>
                              <span className="font-medium">₦{selectedService.price_ngn.toLocaleString()}</span>
                            </div>
                            {typesWithQuantity.includes(selectedService.service_type) && (
                              <div className="flex justify-between items-center mt-1.5 sm:mt-2 text-xs sm:text-sm">
                                <span className="text-muted-foreground">Quantity:</span>
                                <span className="font-medium">{parseInt(quantity || '0').toLocaleString()}</span>
                              </div>
                            )}
                            <div className="border-t mt-2 sm:mt-3 pt-2 sm:pt-3 flex justify-between items-center">
                              <span className="font-semibold text-sm sm:text-base">Total:</span>
                              <span className="text-xl sm:text-2xl font-bold text-green-600">₦{calculateTotal().toLocaleString()}</span>
                            </div>
                          </div>

                          {(() => {
                            const qty = parseInt(quantity) || 0;
                            const isQuantityInvalid = typesWithQuantity.includes(selectedService.service_type) && 
                              (qty < selectedService.min_quantity || qty > selectedService.max_quantity);
                            const isBalanceInsufficient = calculateTotal() > walletBalance;
                            const isLinkInvalid = requiredFields.includes('link') && selectedService.service_type !== 'Subscriptions' && (!link || linkError);
                            
                            return (
                              <Button 
                                onClick={handleSubmitOrder} 
                                className={`w-full h-11 sm:h-12 md:h-14 text-sm sm:text-base md:text-lg ${isQuantityInvalid ? 'bg-orange-500 hover:bg-orange-600' : ''}`} 
                                size="lg" 
                                disabled={submitting || !isFormValid()}
                              >
                                {submitting ? (
                                  <><Loader2 className="w-4 h-4 sm:w-5 sm:h-5 mr-2 animate-spin" />Processing...</>
                                ) : isQuantityInvalid ? (
                                  <><AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 mr-1.5" />Enter Valid Quantity (Min: {selectedService.min_quantity})</>
                                ) : isLinkInvalid ? (
                                  <><AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 mr-1.5" />Enter Valid Link</>
                                ) : isBalanceInsufficient ? (
                                  <><AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 mr-1.5" />Insufficient Balance</>
                                ) : (
                                  <><ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5 mr-1.5" />Place Order • ₦{calculateTotal().toLocaleString()}</>
                                )}
                              </Button>
                            );
                          })()}
                        </CardContent>
                      </Card>
                    )}

                    <div className="pt-3 sm:pt-4 border-t space-y-1.5 sm:space-y-2">
                      <p className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1.5"><Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5" />Most orders start within minutes</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />Quality services from trusted providers</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1.5"><Info className="w-3 h-3 sm:w-3.5 sm:h-3.5" />Make sure your profile/post is public</p>
                    </div>
                  </TabsContent>

                  <TabsContent value="history" className="mt-0">
                    {loadingOrders ? (
                      <div className="flex items-center justify-center py-8 sm:py-12"><Loader2 className="w-6 h-6 sm:w-8 sm:h-8 animate-spin text-muted-foreground" /></div>
                    ) : orders.length === 0 ? (
                      <div className="text-center py-8 sm:py-12">
                        <History className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-2 sm:mb-3 text-muted-foreground" />
                        <p className="text-muted-foreground text-sm">No orders yet</p>
                        <Button variant="outline" size="sm" className="mt-3 sm:mt-4" onClick={() => setActiveTab('order')}>Place Your First Order</Button>
                      </div>
                    ) : (
                      <div className="space-y-2 sm:space-y-3">
                        {orders.map((order) => (
                          <Card key={order.id} className="border">
                            <CardContent className="p-2.5 sm:p-3 md:p-4">
                              <div className="flex items-start justify-between gap-2 mb-2 sm:mb-3">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-xs sm:text-sm line-clamp-1"><ServiceNameWithFlag name={order.smm_services?.name || 'Service'} /></p>
                                  {order.link && <a href={order.link} target="_blank" rel="noopener noreferrer" className="text-[10px] sm:text-xs text-primary hover:underline flex items-center gap-1 mt-0.5">
                                    <ExternalLink className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" /><span className="truncate">{order.link}</span>
                                  </a>}
                                </div>
                                {getStatusBadge(order.status)}
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] sm:text-xs text-muted-foreground">
                                <div><span className="block">Quantity</span><span className="font-medium text-foreground">{(order.quantity ?? 0).toLocaleString()}</span></div>
                                <div><span className="block">Amount</span><span className="font-medium text-foreground">₦{(order.amount_ngn ?? 0).toLocaleString()}</span></div>
                                {order.start_count != null && <div className="hidden sm:block"><span className="block">Start</span><span className="font-medium text-foreground">{order.start_count.toLocaleString()}</span></div>}
                                {order.remains != null && <div className="hidden sm:block"><span className="block">Remains</span><span className="font-medium text-foreground">{order.remains.toLocaleString()}</span></div>}
                              </div>
                              <div className="flex items-center justify-between mt-2 sm:mt-3 pt-2 sm:pt-3 border-t">
                                <span className="text-[10px] sm:text-xs text-muted-foreground">{formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}</span>
                                <Button variant="outline" size="sm" onClick={() => handleCheckStatus(order.id, order.external_order_id)} disabled={checkingStatus === order.id || !order.external_order_id} className="gap-1 h-7 sm:h-8 text-[10px] sm:text-xs px-2 sm:px-3">
                                  {checkingStatus === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}<span className="hidden xs:inline">Check</span> Status
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - hidden on mobile, shows count + info */}
          <div className="hidden lg:block lg:col-span-1 space-y-4 sm:space-y-6">
            {(searchQuery.trim() || selectedPlatform !== 'all') && (
              <Card className="shadow-lg">
                <CardContent className="p-4 sm:pt-6">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Services Found</span>
                    <span className="text-2xl font-bold">{services.length}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="shadow-lg">
              <CardHeader className="bg-gradient-to-r from-muted/50 to-muted/30 border-b p-4"><CardTitle className="text-base">How It Works</CardTitle></CardHeader>
              <CardContent className="p-4">
                <div className="space-y-3">
                  <div className="flex gap-2.5"><div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><span className="text-xs font-bold text-primary">1</span></div><div><p className="font-medium text-sm">Search Service</p><p className="text-xs text-muted-foreground">Type to find what you need</p></div></div>
                  <div className="flex gap-2.5"><div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><span className="text-xs font-bold text-primary">2</span></div><div><p className="font-medium text-sm">Select & Configure</p><p className="text-xs text-muted-foreground">Choose and enter details</p></div></div>
                  <div className="flex gap-2.5"><div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><span className="text-xs font-bold text-primary">3</span></div><div><p className="font-medium text-sm">Place Order</p><p className="text-xs text-muted-foreground">Pay from your wallet</p></div></div>
                  <div className="flex gap-2.5"><div className="w-7 h-7 rounded-full bg-green-500/10 flex items-center justify-center shrink-0"><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /></div><div><p className="font-medium text-sm">Get Results</p><p className="text-xs text-muted-foreground">Watch your numbers grow!</p></div></div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30">
              <CardHeader className="pb-2 p-4"><CardTitle className="text-sm flex items-center gap-2 text-orange-700 dark:text-orange-400"><Info className="w-4 h-4" />Pro Tips</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0">
                <ul className="text-xs text-orange-700 dark:text-orange-400 space-y-1.5">
                  <li>• Keep your profile public</li>
                  <li>• Don't change username during delivery</li>
                  <li>• Start with smaller quantities</li>
                  <li>• Check status regularly</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
