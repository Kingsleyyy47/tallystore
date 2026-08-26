import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// Register service worker for PWA functionality. Updates are activated
// automatically so returning users do not stay on stale cached bundles.
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let reloadingForUpdate = false;

const activateLatestVersion = async () => {
  if (reloadingForUpdate) return;
  reloadingForUpdate = true;

  try {
    if (updateSW) {
      await updateSW(true);
      return;
    }
  } catch (error) {
    console.warn('TallyStore: service worker update activation failed, reloading page', error);
  }

  window.location.reload();
};

updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.dispatchEvent(
      new CustomEvent('pwa-update-available', {
        detail: { update: activateLatestVersion },
      }),
    );
    void activateLatestVersion();
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;

    const checkForUpdate = () => {
      if (!navigator.onLine) return;
      registration.update().catch(() => undefined);
    };

    checkForUpdate();
    window.setInterval(checkForUpdate, 60 * 1000);
    window.addEventListener('focus', checkForUpdate);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkForUpdate();
    });

    navigator.serviceWorker?.addEventListener('controllerchange', () => {
      void activateLatestVersion();
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
