import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const systemTheme = (): Theme => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) || systemTheme());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () =>
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('mm-theme', next);
      } catch {
        /* private mode: the toggle still works for this session */
      }
      return next;
    });
  return [theme, toggle];
}
