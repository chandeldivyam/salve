import { zodResolver } from '@hookform/resolvers/zod';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  LoadingButton,
  useFieldContext,
} from '@salve/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { authClient, switchWorkspace } from '@/lib/auth-client';
import { showSuccess, toUserErrorMessage } from '@/lib/feedback';
import { clearSessionCache } from '@/lib/session-loader';

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

const workspaceSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters.'),
  slug: z
    .string()
    .trim()
    .min(2, 'At least 2 characters.')
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, and hyphens only.'),
});

type WorkspaceFormValues = z.infer<typeof workspaceSchema>;

function NewWorkspacePage() {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    control,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<WorkspaceFormValues>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: { name: '', slug: '' },
    mode: 'onSubmit',
  });

  const name = watch('name');
  // Auto-derive the slug from the name until the user edits it directly.
  useEffect(() => {
    if (dirtyFields.slug) return;
    setValue('slug', slugify(name ?? ''), { shouldValidate: false });
  }, [name, dirtyFields.slug, setValue]);

  async function onSubmit(values: WorkspaceFormValues) {
    setServerError(null);
    const finalSlug = values.slug || slugify(values.name);
    const res = await authClient.organization.create({ name: values.name, slug: finalSlug });
    if (res.error) {
      setServerError(res.error.message ?? 'Could not create workspace.');
      return;
    }
    const orgID = (res.data as { id?: string } | null | undefined)?.id;
    if (orgID) {
      try {
        await switchWorkspace(orgID);
      } catch (err) {
        setServerError(toUserErrorMessage(err, 'Could not switch workspace.'));
        return;
      }
    }
    clearSessionCache();
    showSuccess('Workspace created', `${values.name} is ready.`);
    await navigate({ to: '/app/settings/setup' });
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle as="h1">Create a workspace</CardTitle>
          <CardDescription>
            A workspace is your team's slice of Salve. You'll be its owner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
            <FieldGroup>
              <Field hasError={Boolean(errors.name)}>
                <FieldLabel>Workspace name</FieldLabel>
                <NameInput
                  registration={register('name')}
                  hasError={Boolean(errors.name)}
                  placeholder="Acme Support"
                />
                <FieldError>{errors.name?.message}</FieldError>
              </Field>
              <Field hasError={Boolean(errors.slug)}>
                <FieldLabel>URL slug</FieldLabel>
                <Controller
                  name="slug"
                  control={control}
                  render={({ field }) => (
                    <SlugInput
                      value={field.value}
                      onBlur={field.onBlur}
                      onChange={(value) => field.onChange(slugify(value))}
                      hasError={Boolean(errors.slug)}
                    />
                  )}
                />
                <FieldError>{errors.slug?.message}</FieldError>
              </Field>
            </FieldGroup>
            {serverError ? (
              <p role="alert" className="text-sm text-danger-soft-foreground">
                {serverError}
              </p>
            ) : null}
            <LoadingButton type="submit" className="w-full" loading={isSubmitting}>
              {isSubmitting ? 'Creating workspace…' : 'Create workspace'}
            </LoadingButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function NameInput({
  registration,
  hasError,
  placeholder,
}: {
  registration: ReturnType<ReturnType<typeof useForm<WorkspaceFormValues>>['register']>;
  hasError: boolean;
  placeholder?: string;
}) {
  const ctx = useFieldContext();
  return (
    <Input
      id={ctx?.inputId}
      placeholder={placeholder}
      autoComplete="organization"
      aria-invalid={hasError || undefined}
      aria-describedby={hasError ? ctx?.errorId : undefined}
      {...registration}
    />
  );
}

function SlugInput({
  value,
  onChange,
  onBlur,
  hasError,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  hasError: boolean;
}) {
  const ctx = useFieldContext();
  return (
    <Input
      id={ctx?.inputId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder="acme-support"
      autoComplete="off"
      aria-invalid={hasError || undefined}
      aria-describedby={hasError ? ctx?.errorId : undefined}
    />
  );
}
