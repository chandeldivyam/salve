import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Logo } from '@salve/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import * as z from 'zod';
import { authClient } from '@/lib/auth-client';

const RESEND_COOLDOWN = 60;

const searchSchema = z.object({
  status: z.enum(['pending', 'verified', 'error']).catch('pending'),
  email: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/auth/verify-email')({
  validateSearch: (s) => searchSchema.parse(s),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { status, email } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      {status === 'pending' && <PendingCard email={email} />}
      {status === 'verified' && <VerifiedCard navigate={navigate} />}
      {status === 'error' && <ErrorCard email={email} />}
    </div>
  );
}

function PendingCard({ email }: { email?: string }) {
  const [cooldown, setCooldown] = useState(0);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN);
    intervalRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function handleResend() {
    if (!email || cooldown > 0) return;
    setResendError(null);
    setResendSuccess(false);
    const res = await authClient.sendVerificationEmail({
      email,
      callbackURL: `${window.location.origin}/auth/verify-email?status=verified`,
    });
    if (res.error) {
      setResendError(res.error.message ?? 'Resend failed.');
      return;
    }
    setResendSuccess(true);
    startCooldown();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <Logo />
        <CardTitle as="h1">Check your email</CardTitle>
        <CardDescription>
          {email
            ? `We sent a verification link to ${email}.`
            : 'We sent a verification link to your email address.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Click the link in the email to verify your account. The link expires in 24 hours.
        </p>
        {resendSuccess && (
          <p className="text-sm text-green-600" role="status">
            Verification email sent.
          </p>
        )}
        {resendError && (
          <p className="text-sm text-danger-soft-foreground" role="alert">
            {resendError}
          </p>
        )}
        {email && (
          <Button type="button" variant="outline" disabled={cooldown > 0} onClick={handleResend}>
            {cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend email'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function VerifiedCard({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  useEffect(() => {
    const t = setTimeout(() => {
      void navigate({ to: '/app' });
    }, 1500);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <Logo />
        <CardTitle as="h1">Email verified</CardTitle>
        <CardDescription>Your email address has been verified.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">Taking you to the app…</p>
        <Button type="button" onClick={() => void navigate({ to: '/app' })}>
          Continue
        </Button>
      </CardContent>
    </Card>
  );
}

function ErrorCard({ email }: { email?: string }) {
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState(false);

  async function handleResend() {
    if (!email) return;
    setResendError(null);
    setResendSuccess(false);
    const res = await authClient.sendVerificationEmail({
      email,
      callbackURL: `${window.location.origin}/auth/verify-email?status=verified`,
    });
    if (res.error) {
      setResendError(res.error.message ?? 'Resend failed.');
      return;
    }
    setResendSuccess(true);
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <Logo />
        <CardTitle as="h1">Verification failed</CardTitle>
        <CardDescription>We couldn't verify your email address.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          The link may have expired or already been used. Request a new one below.
        </p>
        {resendSuccess && (
          <p className="text-sm text-green-600" role="status">
            Verification email sent.
          </p>
        )}
        {resendError && (
          <p className="text-sm text-danger-soft-foreground" role="alert">
            {resendError}
          </p>
        )}
        {email && (
          <Button type="button" variant="outline" onClick={handleResend}>
            Try resending
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
