import { useState, useEffect } from 'react';
import { X, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import InstallAppDialog from '@/components/InstallAppDialog';
import { usePWAInstall } from '@/hooks/usePWAInstall';

const STORAGE_KEY = 'pwa-install-prompt-dismissed';
const SHOW_DELAY = 3000; // Show after 3 seconds

export default function InstallPromptBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const { canInstall, isInstalled, isIOS, isAndroid, installApp } = usePWAInstall();

  useEffect(() => {
    // Don't show if already installed
    if (isInstalled) {
      return;
    }

    // Don't show if user previously dismissed
    const wasDismissed = localStorage.getItem(STORAGE_KEY);
    if (wasDismissed === 'true') {
      return;
    }

    // Show banner after delay
    const timer = setTimeout(() => {
      setShowBanner(true);
    }, SHOW_DELAY);

    return () => clearTimeout(timer);
  }, [isInstalled]);

  const handleInstallClick = async () => {
    if (isAndroid || canInstall) {
      // Android: Auto-install
      const success = await installApp();
      if (success) {
        setShowBanner(false);
        localStorage.setItem(STORAGE_KEY, 'true');
      }
    } else if (isIOS) {
      // iOS: Show instructions
      setShowDialog(true);
      setShowBanner(false);
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem(STORAGE_KEY, 'true');
  };

  if (!showBanner) {
    return null;
  }

  return (
    <>
      {/* Banner */}
      <div 
        className="fixed bottom-0 left-0 right-0 z-50"
        style={{
          animation: 'slideUp 0.4s ease-out'
        }}
      >
        <div className="bg-gradient-to-r from-primary via-primary/95 to-primary text-white shadow-2xl border-t-4 border-primary/20">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              {/* Icon & Message */}
              <div className="flex items-center gap-3 flex-1">
                <div className="hidden sm:flex h-12 w-12 rounded-xl bg-white/20 backdrop-blur-sm items-center justify-center flex-shrink-0">
                  <Download className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-base sm:text-lg mb-0.5">
                    📱 Get the TallyStore App!
                  </h3>
                  <p className="text-sm text-white/90 hidden sm:block">
                    Install our app for faster access and better experience
                  </p>
                  <p className="text-xs text-white/90 sm:hidden">
                    Install for faster access & offline mode
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  onClick={handleInstallClick}
                  size="sm"
                  className="bg-white text-primary hover:bg-white/90 font-semibold shadow-lg h-9 sm:h-10"
                >
                  <Download className="h-4 w-4 mr-1.5" />
                  <span className="hidden sm:inline">Install Now</span>
                  <span className="sm:hidden">Install</span>
                </Button>
                
                <Button
                  onClick={handleDismiss}
                  size="sm"
                  variant="ghost"
                  className="text-white hover:bg-white/10 h-9 sm:h-10 hidden sm:flex"
                >
                  Maybe Later
                </Button>

                {/* Mobile close button */}
                <button
                  onClick={handleDismiss}
                  className="sm:hidden p-2 hover:bg-white/10 rounded-lg transition-colors"
                  aria-label="Close"
                >
                  <X className="h-5 w-5 text-white" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Install Dialog */}
      <InstallAppDialog 
        open={showDialog} 
        onOpenChange={setShowDialog}
      />

      <style>{`
        @keyframes slideUp {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </>
  );
}
