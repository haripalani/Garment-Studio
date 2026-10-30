import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import './i18n';
import { App } from './App';

// Test hooks exist only on the dev server (dead-code-eliminated from production builds).
if (import.meta.env.DEV) void import('./devHooks').then((m) => m.installDevHooks());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
