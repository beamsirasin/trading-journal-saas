'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * The only place a client component reaches Better Auth. Thin on purpose —
 * every security decision still happens server-side (`src/server/auth/dal.ts`);
 * this just triggers the handful of actions a form needs (sign in, sign up,
 * sign out, request a password reset, resend verification) and exposes
 * `useSession()` for the rare client-side read that cannot wait for a server
 * round trip.
 */
export const authClient = createAuthClient();

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
} = authClient;
