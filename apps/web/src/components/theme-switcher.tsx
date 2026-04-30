import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@opendesk/ui';
import { Check, Laptop, Moon, Sun } from 'lucide-react';
import { setThemeMode, type ThemeMode, useTheme } from '@/lib/theme';

const OPTIONS: Array<{ id: ThemeMode; label: string; icon: typeof Sun }> = [
  { id: 'system', label: 'System', icon: Laptop },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
];

export function ThemeSwitcher() {
  const { mode, resolved } = useTheme();
  const TriggerIcon = mode === 'system' ? Laptop : resolved === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Theme"
          title="Theme"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <TriggerIcon className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {OPTIONS.map(({ id, label, icon: Icon }) => {
          const isActive = id === mode;
          return (
            <DropdownMenuItem key={id} onSelect={() => setThemeMode(id)}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="flex-1">{label}</span>
              {isActive ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
