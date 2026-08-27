import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// Register service worker for PWA functionality.
// When a genuine new version is detected, the page reloads automatically —
// but ONLY once per new version, and ONLY after a 5-minute cooldown between
// update checks. This stops the "reload on every tab switch" behaviour while
// keeping seamless auto-updates for real deploys.
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let reloadingForUpdate = false;

const applyUpdate = async () => {
  if (reloadingForUpdate) return;
  reloadingForUpdate = true;
  try {
    if (updateSW) await updateSW(true);
    else window.location.reload();
  } catch {
    window.location.reload();
  }
};

updateSW = registerSW({
  immediate: true,

  onNeedRefresh() {
    // A real new version was found — auto-reload once.
    // Also dispatch the banner event in case the reload is delayed.
    window.dispatchEvent(
      new CustomEvent('pwa-update-available', { detail: { update: applyUpdate } }),
    );
    void applyUpdate();
  },

  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;

    const checkForUpdate = () => {
      if (!navigator.onLine) return;
      registration.update().catch(() => undefined);
    };

    // Check once on load, then every 5 minutes.
    checkForUpdate();
    window.setInterval(checkForUpdate, 5 * 60 * 1000);

    // Check on tab return — but throttled to once per 5 minutes so
    // rapid tab-switching never triggers a spurious reload.
    let lastCheck = 0;
    const COOLDOWN_MS = 5 * 60 * 1000;
    const throttledCheck = () => {
      const now = Date.now();
      if (now - lastCheck > COOLDOWN_MS) {
        lastCheck = now;
        checkForUpdate();
      }
    };

    window.addEventListener('focus', throttledCheck);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) throttledCheck();
    });

    // When the new SW takes control, apply the update.
    navigator.serviceWorker?.addEventListener('controllerchange', () => {
      void applyUpdate();
    });
  },

  onOfflineReady() {
    console.log('TallyStore: ready to work offline');
  },
});

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
