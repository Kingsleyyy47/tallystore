import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Smartphone, Apple, Chrome, Download, Share2, Plus, CheckCircle } from 'lucide-react';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { useToast } from '@/hooks/use-toast';

interface InstallAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function InstallAppDialog({ open, onOpenChange }: InstallAppDialogProps) {
  const { isIOS, isAndroid, platform, canInstall, installApp } = usePWAInstall();
  const { toast } = useToast();
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [installing, setInstalling] = useState(false);

  const handleAndroidInstall = async () => {
    setInstalling(true);
    
    try {
      const success = await installApp();
      
      if (success) {
        toast({
          title: "App Installing! 📱",
          description: "TallyStore is being added to your home screen.",
        });
        onOpenChange(false);
      } else {
        toast({
          variant: "destructive",
          title: "Installation Cancelled",
          description: "You can install the app anytime from the menu.",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Installation Failed",
        description: "Please try again or use your browser's install option.",
      });
    } finally {
      setInstalling(false);
    }
  };

  const handleIOSClick = () => {
    setShowIOSInstructions(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {!showIOSInstructions ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Download className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <DialogTitle className="text-xl">Download TallyStore</DialogTitle>
                  <DialogDescription>
                    Install our app for a better experience
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-3 mt-4">
              {/* Android/Chrome Install Button */}
              {(isAndroid || platform === 'desktop') && canInstall && (
                <Button
                  onClick={handleAndroidInstall}
                  disabled={installing}
                  className="w-full h-14 text-base font-medium bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600"
                >
                  <div className="flex items-center gap-3">
                    <Chrome className="h-5 w-5" />
                    <div className="text-left">
                      <div className="font-semibold">
                        {installing ? 'Installing...' : 'Download for Android'}
                      </div>
                      <div className="text-xs opacity-90">Install now (one tap)</div>
                    </div>
                  </div>
                </Button>
              )}

              {/* iOS Install Button */}
              {isIOS && (
                <Button
                  onClick={handleIOSClick}
                  variant="outline"
                  className="w-full h-14 text-base font-medium border-2 hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  <div className="flex items-center gap-3">
                    <Apple className="h-5 w-5" />
                    <div className="text-left">
                      <div className="font-semibold">Download for iOS</div>
                      <div className="text-xs text-muted-foreground">View instructions</div>
                    </div>
                  </div>
                </Button>
              )}

              {/* Desktop Chrome Fallback */}
              {!canInstall && !isIOS && platform === 'desktop' && (
                <Alert>
                  <Smartphone className="h-4 w-4" />
                  <AlertDescription>
                    Install option is available in your browser's menu (⋮) → "Install TallyStore"
                  </AlertDescription>
                </Alert>
              )}

              {/* Unsupported Browser */}
              {!canInstall && !isIOS && platform === 'unknown' && (
                <Alert>
                  <AlertDescription>
                    App installation is available on Chrome, Edge, or Safari browsers.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Benefits Section */}
            <div className="mt-6 pt-6 border-t">
              <h4 className="font-semibold text-sm mb-3">Benefits of the App:</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <span>Faster loading and smoother performance</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <span>Works offline - view orders anytime</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <span>Quick access from your home screen</span>
                </li>
              </ul>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-12 w-12 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <Apple className="h-6 w-6" />
                </div>
                <div>
                  <DialogTitle className="text-xl">Install on iPhone</DialogTitle>
                  <DialogDescription>
                    Follow these simple steps
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              {/* Step 1 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                  1
                </div>
                <div className="flex-1">
                  <p className="font-medium mb-1">Tap the Share button</p>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Share2 className="h-4 w-4" />
                    <span>Look for the <strong>Share icon</strong> (square with arrow) at the bottom or top</span>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                  2
                </div>
                <div className="flex-1">
                  <p className="font-medium mb-1">Scroll down and tap "Add to Home Screen"</p>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Plus className="h-4 w-4" />
                    <span>In the Share menu, scroll down to find this option</span>
                  </div>
                </div>
              </div>

              {/* Step 3 - NEW: iOS 26+ Toggle */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                  3
                </div>
                <div className="flex-1">
                  <p className="font-medium mb-1">Ensure "Open as a web app" is enabled</p>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle className="h-4 w-4" />
                    <span>This toggle should be <strong>ON</strong> by default (iOS 26+)</span>
                  </div>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                  4
                </div>
                <div className="flex-1">
                  <p className="font-medium mb-1">Tap "Add" in the top right corner</p>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle className="h-4 w-4" />
                    <span>TallyStore icon will appear on your home screen!</span>
                  </div>
                </div>
              </div>

              {/* Visual Aid */}
              <Alert className="bg-primary/5 border-primary/20">
                <AlertDescription className="text-center">
                  <div className="text-4xl mb-2">📱</div>
                  <p className="text-sm font-medium mb-1">
                    Look for the <Share2 className="h-3 w-3 inline mx-1" /> Share button
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Square icon with an upward arrow at the bottom or top of Safari
                  </p>
                </AlertDescription>
              </Alert>

              {/* Back Button */}
              <Button
                onClick={() => setShowIOSInstructions(false)}
                variant="outline"
                className="w-full"
              >
                Back to Download Options
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
