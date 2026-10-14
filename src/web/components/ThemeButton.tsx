import { useTheme } from '../theme';
import { Moon, Sun } from './Icons';

export function ThemeButton() {
  const [theme, toggle] = useTheme();
  return (
    <button className="icon-btn" onClick={toggle} title="Toggle light / dark" aria-label="Toggle theme">
      {theme === 'dark' ? <Sun /> : <Moon />}
    </button>
  );
}
