import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// The PWA plugin reloads once when a new service worker activates.
registerSW({
  immediate: true,

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
