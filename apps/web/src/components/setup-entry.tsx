import { Button } from '@opendesk/ui';
import { Link } from '@tanstack/react-router';
import { ListChecks } from 'lucide-react';

interface SetupEntryProps {
  activeWorkspaceID: string | null;
  pathname: string;
}

export function SetupEntry({ activeWorkspaceID, pathname }: SetupEntryProps) {
  if (!activeWorkspaceID || pathname.startsWith('/app/settings/channels/email')) return null;

  return (
    <Button asChild size="sm" variant="outline">
      <Link
        to="/app/settings/channels/email"
        className="border-brand-border bg-brand-soft text-brand-soft-foreground hover:bg-brand-soft/80"
        title="Continue setup"
      >
        <ListChecks className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Continue setup</span>
        <span className="sm:hidden">Setup</span>
      </Link>
    </Button>
  );
}
