export type HotkeyPlatform = 'mac' | 'windows';

const isMacPlatform =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export function currentHotkeyPlatform(): HotkeyPlatform {
  return isMacPlatform ? 'mac' : 'windows';
}

export function formatHotkey(
  pattern: string,
  platform: HotkeyPlatform = currentHotkeyPlatform(),
): string {
  return pattern
    .split(' ')
    .map((part) =>
      part
        .split('+')
        .map((token) => formatToken(token, platform))
        .join(platform === 'mac' ? '' : '+'),
    )
    .join(' ');
}

function formatToken(token: string, platform: HotkeyPlatform): string {
  const normalized = token.trim();
  if (!normalized) return '';
  switch (normalized.toLowerCase()) {
    case '$mod':
    case 'mod':
      return platform === 'mac' ? '⌘' : 'Ctrl';
    case 'meta':
      return platform === 'mac' ? '⌘' : 'Meta';
    case 'ctrl':
    case 'control':
      return 'Ctrl';
    case 'shift':
      return platform === 'mac' ? '⇧' : 'Shift';
    case 'alt':
    case 'option':
      return platform === 'mac' ? '⌥' : 'Alt';
    case 'enter':
      return 'Enter';
    case 'escape':
    case 'esc':
      return 'Esc';
    case 'arrowdown':
      return '↓';
    case 'arrowup':
      return '↑';
    case 'arrowleft':
      return '←';
    case 'arrowright':
      return '→';
    case 'backspace':
      return '⌫';
    case ' ':
    case 'space':
      return 'Space';
    default:
      return normalized.length === 1 ? normalized.toUpperCase() : normalized;
  }
}
