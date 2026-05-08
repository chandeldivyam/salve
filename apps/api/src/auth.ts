// better-auth setup for salve.
//
// - Drizzle adapter pointed at @salve/db's schema.
// - Email/password enabled. Google OAuth + magic link kept as placeholders
//   (gated on env so dev runs without third-party config).
// - Organization plugin enabled so workspace = better-auth `organization`.

import { randomUUID } from 'node:crypto';
import { apiKey } from '@better-auth/api-key';
import { authSchema, getDb } from '@salve/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import { organization } from 'better-auth/plugins/organization';
import { sendRawBuffer } from './email/mailer.js';

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3001';
const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

export const auth = betterAuth({
  baseURL,
  secret: process.env.AUTH_SECRET,
  trustedOrigins,
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    // Our schema uses singular table names ("user", "session", ...).
    usePlural: false,
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    callbackURL: '/auth/verify-email?status=verified',
    sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
      const from = process.env.SALVE_TRANSACTIONAL_FROM ?? 'noreply@usesalve.com';
      const to = user.email;

      if (process.env.NODE_ENV !== 'production') {
        console.log(`[salve-api] verify → ${to} → ${url}`);
      }

      const htmlBody = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#111;max-width:560px;margin:0 auto;padding:32px 16px">
<h2 style="margin-bottom:8px">Verify your email for Salve</h2>
<p style="margin-bottom:24px;color:#555">Click the button below to verify your email address and get started.</p>
<a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600">Verify email</a>
<p style="margin-top:24px;color:#888;font-size:13px">Or copy this link into your browser:<br><a href="${url}" style="color:#4f46e5;word-break:break-all">${url}</a></p>
<p style="margin-top:32px;color:#aaa;font-size:12px">If you didn't create a Salve account, ignore this email.</p>
</body></html>`;
      const textBody = `Verify your email for Salve\n\nClick the link below to verify your email address:\n\n${url}\n\nIf you didn't create a Salve account, ignore this email.`;

      const CRLF = '\r\n';
      const boundary = `=_salve_verif_${randomUUID().replace(/-/g, '')}`;
      const msgID = `<${randomUUID()}@mail.usesalve.com>`;

      const textB64 = Buffer.from(textBody, 'utf-8').toString('base64');
      const htmlB64 = Buffer.from(htmlBody, 'utf-8').toString('base64');

      const chunk = (s: string, n: number) => {
        const out: string[] = [];
        for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
        return out.join(CRLF);
      };

      const raw = [
        `MIME-Version: 1.0`,
        `Date: ${new Date().toUTCString()}`,
        `From: Salve <${from}>`,
        `To: ${to}`,
        `Subject: Verify your email for Salve`,
        `Message-ID: ${msgID}`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset="utf-8"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        chunk(textB64, 76),
        `--${boundary}`,
        `Content-Type: text/html; charset="utf-8"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        chunk(htmlB64, 76),
        `--${boundary}--`,
        ``,
      ].join(CRLF);

      await sendRawBuffer({
        from,
        to,
        raw: Buffer.from(raw, 'utf-8'),
        fallbackMessageID: msgID,
      });
    },
  },
  // Google OAuth — kept off when secrets missing so dev boots without them.
  socialProviders:
    googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        }
      : {},
  plugins: [
    organization({
      // Cap is generous for now. Phase 2 may tighten via plan tier.
      membershipLimit: 1000,
      // Members default to 'member'; admins/owners promoted explicitly.
      creatorRole: 'owner',
      sendInvitationEmail: async (data) => {
        const frontendOrigin =
          (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? 'http://localhost:5173')
            .split(',')[0]
            ?.trim() ?? 'http://localhost:5173';
        const inviteUrl = `${frontendOrigin}/auth/accept-invitation?invitationId=${data.id}`;
        const workspaceName = data.organization.name;
        const from = process.env.SALVE_TRANSACTIONAL_FROM ?? 'noreply@usesalve.com';
        const to = data.email;

        if (process.env.NODE_ENV !== 'production') {
          console.log(`[salve-api] invite → ${to} → ${inviteUrl}`);
        }

        const subject = `You've been invited to join ${workspaceName} on Salve`;
        const htmlBody = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#111;max-width:560px;margin:0 auto;padding:32px 16px">
<h2 style="margin-bottom:8px">Join ${workspaceName} on Salve</h2>
<p style="margin-bottom:24px;color:#555">${data.inviter.user.name ?? data.inviter.user.email} invited you to join <strong>${workspaceName}</strong> as a ${data.role}.</p>
<a href="${inviteUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600">Accept invitation</a>
<p style="margin-top:24px;color:#888;font-size:13px">Or copy this link:<br><a href="${inviteUrl}" style="color:#4f46e5;word-break:break-all">${inviteUrl}</a></p>
<p style="margin-top:32px;color:#aaa;font-size:12px">If you didn't expect this invitation, you can ignore this email.</p>
</body></html>`;
        const textBody = `Join ${workspaceName} on Salve\n\n${data.inviter.user.name ?? data.inviter.user.email} invited you as a ${data.role}.\n\nAccept here:\n${inviteUrl}\n\nIf you didn't expect this, ignore this email.`;

        const CRLF = '\r\n';
        const boundary = `=_salve_invite_${randomUUID().replace(/-/g, '')}`;
        const msgID = `<${randomUUID()}@mail.usesalve.com>`;
        const chunk = (s: string, n: number) => {
          const out: string[] = [];
          for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
          return out.join(CRLF);
        };
        const textB64 = Buffer.from(textBody, 'utf-8').toString('base64');
        const htmlB64 = Buffer.from(htmlBody, 'utf-8').toString('base64');
        const raw = [
          'MIME-Version: 1.0',
          `Date: ${new Date().toUTCString()}`,
          `From: Salve <${from}>`,
          `To: ${to}`,
          `Subject: ${subject}`,
          `Message-ID: ${msgID}`,
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          '',
          `--${boundary}`,
          'Content-Type: text/plain; charset="utf-8"',
          'Content-Transfer-Encoding: base64',
          '',
          chunk(textB64, 76),
          `--${boundary}`,
          'Content-Type: text/html; charset="utf-8"',
          'Content-Transfer-Encoding: base64',
          '',
          chunk(htmlB64, 76),
          `--${boundary}--`,
          '',
        ].join(CRLF);

        await sendRawBuffer({
          from,
          to,
          raw: Buffer.from(raw, 'utf-8'),
          fallbackMessageID: msgID,
        });
      },
    }),
    apiKey({
      references: 'organization',
      defaultPrefix: 'slv_pat_',
      requireName: true,
      maximumNameLength: 80,
      maximumPrefixLength: 16,
      enableMetadata: true,
      startingCharactersConfig: {
        shouldStore: true,
        charactersLength: 12,
      },
      rateLimit: {
        enabled: true,
        timeWindow: 60_000,
        maxRequests: 60,
      },
      keyExpiration: {
        defaultExpiresIn: null,
        minExpiresIn: 1,
        maxExpiresIn: 365,
      },
    }),
    magicLink({
      // Placeholder transport — Phase 1 doesn't wire mail yet.
      // In dev we log the link to API stdout so it can be copied; in
      // production we silently drop it until a real mail transport is
      // wired. Logging links to stdout in prod would leak a sign-in
      // credential into the platform's log pipeline.
      sendMagicLink: async ({ email, url }) => {
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[salve-api] magic-link → ${email} → ${url}`);
        }
      },
    }),
  ],
});

export type Auth = typeof auth;
export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
