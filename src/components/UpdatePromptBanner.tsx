import { useState, useEffect } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function UpdatePromptBanner() {
  const [show, setShow] = useState(false);
  const [doUpdate, setDoUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const { update } = (e as CustomEvent).detail ?? {};
      if (typeof update === 'function') {
        setDoUpdate(() => update);
        setShow(true);
      }
    };
    window.addEventListener('pwa-update-available', handler);
    return () => window.removeEventListener('pwa-update-available', handler);
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-24 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-xl border bg-background/95 px-4 py-3 text-sm font-medium shadow-lg backdrop-blur md:bottom-4">
      <RefreshCw className="h-4 w-4 text-primary shrink-0" />
      <span className="flex-1">A new version of TallyStore is ready.</span>
      <Button
        size="sm"
        className="h-7 px-3 text-xs"
        onClick={() => {
          setShow(false);
          // Activate the new service worker, then hard-reload to guarantee
          // the browser fetches fresh assets rather than serving from cache.
          doUpdate?.();
          setTimeout(() => window.location.reload(), 300);
        }}
      >
        Update
      </Button>
      <button
        aria-label="Dismiss"
        onClick={() => setShow(false)}
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
