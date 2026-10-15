import pg from 'pg';
import { schema } from './schema.js';

export interface Sql {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export class Postgres implements Database {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 5,
      statement_timeout: 15000,
      connectionTimeoutMillis: 5000,
    });
  }
  async query<T>(sql: string, params: unknown[] = []) {
    return this.pool.query(sql, params) as unknown as Promise<{ rows: T[] }>;
  }
  async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({
        query: async <T>(sql: string, params: unknown[] = []) =>
          client.query(sql, params) as unknown as Promise<{ rows: T[] }>,
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
export async function migrate(db: Database) {
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(612458902)');
    await tx.query(schema);
  });
}
