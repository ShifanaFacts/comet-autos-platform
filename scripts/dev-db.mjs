// Local-development-only PostgreSQL, for machines where a system-wide
// PostgreSQL install isn't available. Runs a real native Postgres binary
// (via the `embedded-postgres` package) with data persisted under
// .local-postgres-data/ (gitignored). Not used in production.
//
// Usage:
//   node scripts/dev-db.mjs start   # initialise (if needed), start, ensure DB exists, keep running
//   node scripts/dev-db.mjs stop    # stop a running instance
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.join(__dirname, '..', '.local-postgres-data');
const DEV_DATABASE_NAME = 'comet_autos_dev';

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password: 'postgres',
  port: 5432,
  persistent: true,
});

const command = process.argv[2];

if (command === 'start') {
  const alreadyInitialised = existsSync(path.join(databaseDir, 'PG_VERSION'));
  if (!alreadyInitialised) {
    console.log('Initialising local PostgreSQL data directory...');
    await pg.initialise();
  }

  await pg.start();
  console.log('Local PostgreSQL is running on port 5432.');

  await pg.createDatabase(DEV_DATABASE_NAME).catch((error) => {
    if (!String(error?.message ?? error).includes('already exists')) {
      throw error;
    }
  });
  console.log(`Database "${DEV_DATABASE_NAME}" is ready.`);
  console.log('Press Ctrl+C to stop.');

  // Keep the process alive; embedded-postgres registers an exit hook that
  // stops the server cleanly when this process is terminated.
  await new Promise(() => {});
} else if (command === 'stop') {
  await pg.stop();
  console.log('Local PostgreSQL stopped.');
} else {
  console.error('Usage: node scripts/dev-db.mjs <start|stop>');
  process.exit(1);
}
