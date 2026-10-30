import { useEffect } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { TooltipProvider } from '@gs/ui';
import { usePrefs } from './store/prefs';
import { router } from './router';

export function App() {
  useThemeSync();
  return (
    <TooltipProvider delayDuration={400}>
      <RouterProvider router={router} />
    </TooltipProvider>
  );
}

function useThemeSync() {
  const theme = usePrefs((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#1b1c1f' : '#f5f6f8');
  }, [theme]);
}
