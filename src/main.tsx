import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// Register service worker for PWA functionality. Updates are activated
// automatically so returning users do not stay on stale cached bundles.
let _updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    _updateSW?.(true);
  },
  onRegisteredSW(_swUrl, registration) {
    registration?.update();
    window.setInterval(() => registration?.update(), 60 * 1000);
  },
  onOfflineReady() {
    console.log('TallyStore: ready to work offline');
  },
});

_updateSW = updateSW;

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
