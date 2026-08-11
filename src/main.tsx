import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// Register service worker for PWA functionality.
// 'prompt' mode: the SW downloads in the background and waits; onNeedRefresh fires
// when it's ready. We dispatch a custom event so the React app can show a
// non-blocking "Update available" banner instead of a blocking confirm() dialog.
let _updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;

const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent('pwa-update-available', {
      detail: { update: () => _updateSW?.(true) },
    }));
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
