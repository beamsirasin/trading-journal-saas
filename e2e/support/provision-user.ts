import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { generateId } from '../../src/lib/identifiers';
import { accounts, users } from '../../src/server/db/schema';

/**
 * Directly provisions an already-verified user with a real Better-Auth
 * password hash, bypassing the browser and the (deliberately fail-closed,
 * no-provider-configured) email adapter entirely.
 *
 * This does NOT import `src/lib/auth/server.ts` or `src/server/db/client.ts`
 * — both pull in the `server-only` marker package, which throws outside a
 * Next.js RSC context (the same constraint the integration test suite hit;
 * see `vitest.integration.config.ts`). Playwright's `globalSetup` runs as a
 * plain Node script, not through Next's bundler, so it connects directly
 * with `postgres`/`drizzle` and only the plain schema/crypto/id modules
 * that carry no such import.
 *
 * The resulting user can complete a REAL `signIn.email` through the browser
 * against the actual running app — no session cookie is fabricated here, only
 * the account a genuine login can succeed against.
 */
export async function provisionVerifiedUser(
  connectionUrl: string,
  { email, password, name }: { email: string; password: string; name: string },
): Promise<{ id: string; email: string; password: string; name: string }> {
  const client = postgres(connectionUrl, { max: 1 });
  const db = drizzle(client, { schema: { users, accounts } });

  try {
    // Idempotent for repeated local/CI runs against a reused database: clear
    // any prior run's row for this fixed email before recreating it, rather
    // than accumulating duplicate test users or failing on the unique index.
    await db.delete(users).where(eq(users.email, email));

    const userId = generateId();
    await db.insert(users).values({
      id: userId,
      name,
      email,
      emailVerified: true,
    });

    const hash = await hashPassword(password);
    await db.insert(accounts).values({
      id: generateId(),
      userId,
      accountId: userId,
      providerId: 'credential',
      password: hash,
    });

    return { id: userId, email, password, name };
  } finally {
    await client.end();
  }
}
