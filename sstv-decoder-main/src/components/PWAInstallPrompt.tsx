'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already installed (standalone mode)
    const isInStandalone = window.matchMedia('(display-mode: standalone)').matches 
      || (window.navigator as any).standalone 
      || document.referrer.includes('android-app://');
    
    setIsStandalone(isInStandalone);

    // Check if iOS
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    // Check if user has dismissed the prompt before
    const hasSeenPrompt = localStorage.getItem('pwa-install-prompt-dismissed');
    
    if (isInStandalone || hasSeenPrompt) {
      return;
    }

    // For Chromium-based browsers (Chrome, Edge, Samsung Internet, etc.)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      
      // Show prompt after a short delay (better UX)
      setTimeout(() => {
        setShowPrompt(true);
      }, 3000);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // For iOS, show custom prompt after delay if not in standalone
    if (ios && !isInStandalone) {
      setTimeout(() => {
        setShowPrompt(true);
      }, 3000);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt && !isIOS) {
      return;
    }

    if (deferredPrompt) {
      // Chromium-based browsers
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
      }
      
      setDeferredPrompt(null);
      setShowPrompt(false);
      localStorage.setItem('pwa-install-prompt-dismissed', 'true');
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa-install-prompt-dismissed', 'true');
  };

  const handleMaybeLater = () => {
    setShowPrompt(false);
    // Don't set localStorage, so it can show again in future visits
  };

  if (!showPrompt || isStandalone) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-gradient-to-t from-black/95 to-black/90 backdrop-blur-sm border-t border-green-500/20 shadow-lg animate-slide-up">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="flex-shrink-0 w-12 h-12 bg-green-600 rounded-lg flex items-center justify-center">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-semibold text-base mb-1">
              Install SSTV Decoder
            </h3>
            <p className="text-gray-300 text-sm mb-3">
              {isIOS 
                ? 'Add to your Home Screen for the best experience and offline access.'
                : 'Install this app on your device for quick access and offline use.'
              }
            </p>

            {/* iOS Instructions */}
            {isIOS && (
              <div className="bg-gray-800/50 rounded-lg p-3 mb-3 text-xs text-gray-300 space-y-1">
                <p className="font-medium text-white mb-2">To install:</p>
                <div className="flex items-start gap-2">
                  <span className="text-green-400">1.</span>
                  <p>Tap the Share button <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-500 rounded text-white text-xs">⬆️</span></p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-400">2.</span>
                  <p>Scroll and tap &quot;Add to Home Screen&quot;</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-400">3.</span>
                  <p>Tap &quot;Add&quot; in the top right corner</p>
                </div>
              </div>
            )}

            {/* Buttons */}
            <div className="flex flex-wrap gap-2">
              {!isIOS && deferredPrompt && (
                <button
                  onClick={handleInstallClick}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm transition-colors"
                >
                  Install Now
                </button>
              )}
              
              {isIOS && (
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm transition-colors"
                >
                  Got it
                </button>
              )}

              <button
                onClick={handleMaybeLater}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium text-sm transition-colors"
              >
                Maybe Later
              </button>
              
              <button
                onClick={handleDismiss}
                className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
              >
                Don&apos;t Show Again
              </button>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 text-gray-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
