import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Logo,
} from '@salve/ui';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { fetchSession } from '@/lib/session-loader';

export const Route = createFileRoute('/auth/sign-up')({
  // Mirror of /app's beforeLoad: bounce already-signed-in visitors back to
  // the app. clearSessionCache() runs on sign-out so refetch returns null
  // and signed-out users land here as expected.
  beforeLoad: async () => {
    const session = await fetchSession();
    if (session) throw redirect({ to: '/app' });
  },
  component: SignUpPage,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
}

function SignUpPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!name.trim()) errs.name = 'Name is required.';
    else if (name.trim().length < 2) errs.name = 'At least 2 characters.';
    if (!email) errs.email = 'Email is required.';
    else if (!EMAIL_RE.test(email)) errs.email = 'Enter a valid email address.';
    if (!password) errs.password = 'Password is required.';
    else if (password.length < 8) errs.password = 'At least 8 characters.';
    return errs;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    const res = await authClient.signUp.email({
      email,
      password,
      name,
      callbackURL: `${window.location.origin}/auth/verify-email?status=verified`,
    });
    setLoading(false);
    if (res.error) {
      setServerError(res.error.message ?? 'Sign-up failed.');
      return;
    }
    await navigate({
      to: '/auth/verify-email',
      search: { status: 'pending', email },
    });
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Logo />
          <CardTitle as="h1">Create your Salve account</CardTitle>
          <CardDescription>Set up your agent account in 30 seconds.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={fieldErrors.name ? true : undefined}
                aria-describedby={fieldErrors.name ? 'name-error' : undefined}
              />
              {fieldErrors.name ? (
                <p id="name-error" className="mt-1 text-sm text-danger-soft-foreground">
                  {fieldErrors.name}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="jane@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={fieldErrors.email ? true : undefined}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
              />
              {fieldErrors.email ? (
                <p id="email-error" className="mt-1 text-sm text-danger-soft-foreground">
                  {fieldErrors.email}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={fieldErrors.password ? true : undefined}
                aria-describedby={fieldErrors.password ? 'password-error' : 'password-hint'}
              />
              {fieldErrors.password ? (
                <p id="password-error" className="mt-1 text-sm text-danger-soft-foreground">
                  {fieldErrors.password}
                </p>
              ) : (
                <p id="password-hint" className="text-xs text-muted-foreground">
                  At least 8 characters.
                </p>
              )}
            </div>
            {serverError ? (
              <p role="alert" className="text-sm text-danger-soft-foreground">
                {serverError}
              </p>
            ) : null}
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link className="font-medium text-brand-soft-foreground underline" to="/auth/sign-in">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
