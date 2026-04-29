import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@opendesk/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { authClient, switchWorkspace } from '@/lib/auth-client';

export const Route = createFileRoute('/app/workspaces/new')({
  component: NewWorkspacePage,
});

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function NewWorkspacePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const finalSlug = slug || slugify(name);
    const res = await authClient.organization.create({ name, slug: finalSlug });
    if (res.error) {
      setLoading(false);
      setError(res.error.message ?? 'Could not create workspace.');
      return;
    }
    const orgID = (res.data as { id?: string } | null | undefined)?.id;
    if (orgID) {
      try {
        await switchWorkspace(orgID);
      } catch (err) {
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Could not switch workspace.');
        return;
      }
    }
    setLoading(false);
    await navigate({ to: '/app' });
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create a workspace</CardTitle>
          <CardDescription>
            A workspace is your team's slice of Salve. You'll be its owner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Workspace name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slug) setSlug(slugify(e.target.value));
                }}
                placeholder="Acme Support"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="slug">URL slug</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(slugify(e.target.value))}
                placeholder="acme-support"
                required
              />
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create workspace'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
