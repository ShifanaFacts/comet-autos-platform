/**
 * Imported first by unit tests whose modules reach the Prisma client through
 * their imports (lib/errors → lib/auth). The client is created but never
 * used — unit tests run no queries — so a placeholder address is enough, and
 * no unit test can ever touch a real database.
 */
process.env.DATABASE_URL ??= 'postgresql://unit-tests@127.0.0.1:1/never-connected';
