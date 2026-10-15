import { PGlite } from '@electric-sql/pglite';
import type { Database, Sql } from '../src/db.js';
import { schema } from '../src/schema.js';
export async function testDatabase(): Promise<Database> {
  const pg = new PGlite();
  await pg.exec(schema);
  return {
    query: async <T>(sql: string, params: unknown[] = []) => pg.query<T>(sql, params),
    transaction: <T>(fn: (tx: Sql) => Promise<T>) =>
      pg.transaction((tx) =>
        fn({ query: async <R>(sql: string, params: unknown[] = []) => tx.query<R>(sql, params) }),
      ),
    close: () => pg.close(),
  };
}
