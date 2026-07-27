/**
 * Seed the two operator accounts.
 *
 * Idempotent: run it as often as you like. It upserts by email, so it will not
 * duplicate accounts, and it will not silently reset a password that has already
 * been changed away from the seed value.
 *
 *   npm run seed
 *
 * The Python service owns the schema, so this expects `users` to already exist —
 * start the Python service (or run its migration) at least once first.
 */
import bcrypt from 'bcryptjs';
import { assertDbReady, closeDb, query, queryOne } from '../config/db';
import { env } from '../config/env';

interface SeedAccount {
  email: string;
  password: string;
  name: string;
  role: 'ADMIN' | 'DESK2';
}

const ACCOUNTS: SeedAccount[] = [
  {
    email: env.ADMIN_EMAIL.toLowerCase(),
    password: env.ADMIN_PASSWORD,
    name: 'Administrator',
    role: 'ADMIN',
  },
  {
    email: env.DESK2_EMAIL.toLowerCase(),
    password: env.DESK2_PASSWORD,
    name: 'Desk 2',
    role: 'DESK2',
  },
];

async function seed() {
  await assertDbReady();

  const schemaOk = await queryOne(
    `SELECT 1 AS ok FROM information_schema.tables WHERE table_name = 'users'`,
  );
  if (!schemaOk) {
    throw new Error(
      'The `users` table does not exist. Start the Python service once to create the schema, then re-run the seed.',
    );
  }

  for (const account of ACCOUNTS) {
    const existing = await queryOne<{ id: string; role: string }>(
      'SELECT id, role FROM users WHERE email = $1',
      [account.email],
    );

    if (existing) {
      // Keep the role in sync (it is the thing most likely to be wrong after a
      // schema change) but never touch an existing password hash.
      if (existing.role !== account.role) {
        await query('UPDATE users SET role = $1, updated_at = now() WHERE id = $2', [
          account.role,
          existing.id,
        ]);
        console.log(`updated role for ${account.email} -> ${account.role}`);
      } else {
        console.log(`exists, unchanged: ${account.email} (${account.role})`);
      }
      continue;
    }

    const passwordHash = await bcrypt.hash(account.password, 12);
    await query(
      `INSERT INTO users (id, email, name, password_hash, role, is_active, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, true, now(), now())`,
      [account.email, account.name, passwordHash, account.role],
    );
    console.log(`created ${account.role}: ${account.email}`);
  }

  const usingDefaults = ACCOUNTS.some((a) => a.password.startsWith('ChangeMe!'));
  if (usingDefaults) {
    console.warn(
      '\nWARNING: at least one account is using the default seed password. ' +
        'Set ADMIN_PASSWORD and DESK2_PASSWORD in the environment before deploying.',
    );
  }
}

seed()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('Seed failed:', err.message);
    await closeDb().catch(() => {});
    process.exit(1);
  });
