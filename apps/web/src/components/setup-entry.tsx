import { Button } from '@salve/ui';
import { Link } from '@tanstack/react-router';
import { ListChecks } from 'lucide-react';
import { useSetupProgress } from '@/lib/setup-progress';

interface SetupEntryProps {
  activeWorkspaceID: string | null;
  pathname: string;
}

export function SetupEntry({ activeWorkspaceID, pathname }: SetupEntryProps) {
  const progress = useSetupProgress(activeWorkspaceID);
  if (!activeWorkspaceID) return null;
  if (pathname.startsWith('/app/settings/setup')) return null;
  if (!progress.shouldPromote) return null;

  return (
    <Button asChild size="sm" variant="outline">
      <Link
        to="/app/settings/setup"
        className="border-brand-border bg-brand-soft text-brand-soft-foreground hover:bg-brand-soft/80"
        title={`Setup ${progress.completedCount} of ${progress.total} complete`}
      >
        <ListChecks className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">
          Continue setup · {progress.completedCount}/{progress.total}
        </span>
        <span className="sm:hidden">
          Setup {progress.completedCount}/{progress.total}
        </span>
      </Link>
    </Button>
  );
}
