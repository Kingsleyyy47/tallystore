import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Announcement {
  id: string;
  message: string;
  link?: string;
  linkText?: string;
  emoji?: string;
}

// Hardcoded announcements - can be moved to Supabase later
const ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'crypto-sell-launch',
    message: 'Sell your crypto instantly for Naira',
    emoji: '💰',
    link: '/crypto-exchange',
    linkText: 'Try Now',
  },
  {
    id: 'bills-launch',
    message: 'Buy Airtime & Data directly from your balance',
    emoji: '📱',
    link: '/bills',
    linkText: 'Buy Now',
  },
  {
    id: 'fast-withdrawal',
    message: 'Instant bank withdrawals now available',
    emoji: '⚡',
    link: '/crypto-exchange',
    linkText: 'Get Started',
  },
  {
    id: 'premium-accounts',
    message: 'Premium social media accounts at best prices',
    emoji: '✨',
    link: '/products',
    linkText: 'Shop Now',
  },
];

const STORAGE_KEY = 'announcement-banner-dismissed';

export default function AnnouncementBanner() {
  const [isDismissed, setIsDismissed] = useState(false);

  // Load dismissed state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') {
      setIsDismissed(true);
    }
  }, []);

  // Dismiss banner
  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem(STORAGE_KEY, 'true');
  };

  if (isDismissed) {
    return null;
  }

  // Create repeated announcements for seamless scroll
  const repeatedAnnouncements = [...ANNOUNCEMENTS, ...ANNOUNCEMENTS, ...ANNOUNCEMENTS];

  return (
    <div className="fixed left-0 right-0 top-0 z-[60] h-8 max-w-[100vw] overflow-hidden bg-gradient-to-r from-primary via-purple-600 to-primary text-white">
      {/* Scrolling Marquee Container */}
      <div className="flex h-full max-w-full items-center overflow-hidden pr-10">
        {/* Animated scrolling content */}
        <div className="flex min-w-max animate-marquee whitespace-nowrap">
          {repeatedAnnouncements.map((announcement, index) => (
            <div key={`${announcement.id}-${index}`} className="mx-4 flex items-center sm:mx-8">
              <span className="mr-2">{announcement.emoji}</span>
              <span className="font-medium text-sm">{announcement.message}</span>
              {announcement.link && announcement.linkText && (
                <Link
                  to={announcement.link}
                  className="ml-2 font-bold text-sm underline underline-offset-2 hover:no-underline"
                >
                  {announcement.linkText} →
                </Link>
              )}
              <span className="mx-8 text-white/50">•</span>
            </div>
          ))}
        </div>
      </div>

      {/* Dismiss Button */}
      <button
        onClick={handleDismiss}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-white/20 rounded-full transition-colors z-10"
        aria-label="Dismiss announcements"
      >
        <X className="w-3 h-3" />
      </button>

      {/* Gradient fade on edges */}
      <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-primary to-transparent pointer-events-none" />
      <div className="absolute right-8 top-0 bottom-0 w-8 bg-gradient-to-l from-primary to-transparent pointer-events-none" />
    </div>
  );
}
