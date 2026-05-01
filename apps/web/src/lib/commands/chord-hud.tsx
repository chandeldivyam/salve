import { useCommandRegistry } from './registry';

export function ChordHud() {
  const pendingChord = useCommandRegistry((state) => state.pendingChord);
  if (!pendingChord) return null;

  return (
    <div className="fixed bottom-3 left-3 z-z-command-menu rounded-md border border-line-default bg-bg-popover px-2 py-1 text-[11px] font-medium text-fg-secondary shadow-[var(--shadow-medium)]">
      {pendingChord}…
    </div>
  );
}
