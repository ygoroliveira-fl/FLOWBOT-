import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resetDatabase, TEST_DATABASE_URL } from './db.js';

describe.skipIf(!TEST_DATABASE_URL)('migrações', () => {
  it('aplicam do zero e não há divergência entre schema.prisma e as migrações', async () => {
    const db = await resetDatabase();
    await db.$disconnect();
    // Sai com código 0 e sem SQL quando o banco migrado corresponde ao schema.prisma.
    const diff = execFileSync(
      'pnpm',
      [
        'exec',
        'prisma',
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--script',
      ],
      { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, encoding: 'utf8' },
    );
    expect(diff).toMatch(/This is an empty migration|^\s*$/);
  });

  it('migrate deploy é idempotente', () => {
    const out = execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      encoding: 'utf8',
    });
    expect(out).toContain('No pending migrations');
  });
});
