// better-auth setup for opendesk.
//
// - Drizzle adapter pointed at @opendesk/db's schema.
// - Email/password enabled. Google OAuth + magic link kept as placeholders
//   (gated on env so dev runs without third-party config).
// - Organization plugin enabled so workspace = better-auth `organization`.

import { authSchema, getDb } from '@opendesk/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import { organization } from 'better-auth/plugins/organization';

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
    requireEmailVerification: false,
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
    }),
    magicLink({
      // Placeholder transport — Phase 1 doesn't wire mail yet.
      // Logs the link so a developer can copy it from API stdout if needed.
      sendMagicLink: async ({ email, url }) => {
        console.log(`[opendesk-api] magic-link → ${email} → ${url}`);
      },
    }),
  ],
});

export type Auth = typeof auth;
export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
