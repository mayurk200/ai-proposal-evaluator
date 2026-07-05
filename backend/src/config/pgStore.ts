import { getPool } from './pg';

/**
 * PostgreSQL-backed document store exposing the same Firestore-style
 * collection API as `localStore.ts`, so the service layer never changes.
 *
 * Each collection is a table in a dedicated "backend" schema:
 *   backend.<name> (id TEXT PRIMARY KEY, data JSONB NOT NULL)
 * The "public" schema stays owned by the Python service (its SQLAlchemy
 * models define `proposals`/`evaluations` there), so names never clash.
 * Tables are created lazily on first use — no migration step required.
 */

const SCHEMA = 'backend';

// Collection/field names come from our own code, never user input, but they
// are interpolated into SQL — enforce a strict shape anyway.
function assertSafeIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid identifier for pg store: ${name}`);
  }
  return name;
}

// Shared across collections so concurrent first queries don't race the
// CREATE SCHEMA statement. Reset on failure so a later call can retry.
let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getPool()
      .query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`)
      .then(() => undefined)
      .catch((err) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

interface Filter {
  field: string;
  op: string;
  value: any;
}

interface SortConfig {
  field: string;
  direction: string;
}

interface DocRef {
  id: string;
  _table: string;
}

function makeSnapshot(rows: Array<{ id: string; data: any }>, table: string) {
  return {
    empty: rows.length === 0,
    docs: rows.map((row) => ({
      id: row.id,
      data: () => row.data,
      ref: { id: row.id, _table: table } as DocRef,
    })),
    size: rows.length,
  };
}

class PgCollection {
  /** Fully qualified, safely quoted table name (e.g. backend."users"). */
  readonly table: string;
  private tableReady: Promise<void> | null = null;

  constructor(name: string) {
    assertSafeIdentifier(name);
    this.table = `${SCHEMA}."${name}"`;
  }

  private ensureTable(): Promise<void> {
    if (!this.tableReady) {
      this.tableReady = ensureSchema()
        .then(() =>
          getPool().query(
            `CREATE TABLE IF NOT EXISTS ${this.table} (id TEXT PRIMARY KEY, data JSONB NOT NULL)`
          )
        )
        .then(() => undefined)
        .catch((err) => {
          this.tableReady = null;
          throw err;
        });
    }
    return this.tableReady;
  }

  /** Internal: run a query after making sure the table exists. */
  async _query(text: string, params?: any[]) {
    await this.ensureTable();
    return getPool().query(text, params);
  }

  doc(id: string) {
    const self = this;
    return {
      async get() {
        const res = await self._query(`SELECT data FROM ${self.table} WHERE id = $1`, [id]);
        const data = res.rows[0]?.data ?? null;
        return {
          exists: !!data,
          data: () => data,
          id,
          ref: { id, _table: self.table } as DocRef,
        };
      },
      async set(value: any) {
        await self._query(
          `INSERT INTO ${self.table} (id, data) VALUES ($1, $2::jsonb)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
          [id, JSON.stringify({ ...value, _id: id })]
        );
      },
      async update(value: any) {
        // Shallow merge onto the existing document; no-op when it doesn't
        // exist (same semantics as the local JSON store).
        await self._query(`UPDATE ${self.table} SET data = data || $2::jsonb WHERE id = $1`, [
          id,
          JSON.stringify(value),
        ]);
      },
      async delete() {
        await self._query(`DELETE FROM ${self.table} WHERE id = $1`, [id]);
      },
    };
  }

  where(field: string, op: string, value: any) {
    return new PgQuery(this, [{ field, op, value }]);
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
    return new PgQuery(this, [], { field, direction });
  }

  count() {
    return new PgQuery(this).count();
  }

  async get() {
    return new PgQuery(this).get();
  }

  get firestore() {
    return { batch: () => new PgBatch() };
  }
}

class PgQuery {
  private collection: PgCollection;
  private filters: Filter[];
  private sortConfig?: SortConfig;
  private limitCount?: number;
  private offsetCount?: number;

  constructor(collection: PgCollection, filters: Filter[] = [], sortConfig?: SortConfig) {
    this.collection = collection;
    this.filters = filters;
    this.sortConfig = sortConfig;
  }

  where(field: string, op: string, value: any) {
    this.filters.push({ field, op, value });
    return this;
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
    this.sortConfig = { field, direction };
    return this;
  }

  limit(n: number) {
    this.limitCount = n;
    return this;
  }

  offset(n: number) {
    this.offsetCount = n;
    return this;
  }

  /**
   * Translate the accumulated filters into a WHERE clause. Values are compared
   * as jsonb (`to_jsonb`-style), which keeps number/string/bool typing intact.
   */
  private buildWhere(params: any[]): string {
    const conditions: string[] = [];
    for (const f of this.filters) {
      assertSafeIdentifier(f.field);
      const fieldExpr = `data->'${f.field}'`;
      switch (f.op) {
        case '==':
          params.push(JSON.stringify(f.value));
          conditions.push(`${fieldExpr} = $${params.length}::jsonb`);
          break;
        case '!=':
          // IS DISTINCT FROM keeps documents where the field is missing,
          // matching the local store's `!==` behaviour.
          params.push(JSON.stringify(f.value));
          conditions.push(`${fieldExpr} IS DISTINCT FROM $${params.length}::jsonb`);
          break;
        case '>':
        case '<':
        case '>=':
        case '<=':
          params.push(JSON.stringify(f.value));
          conditions.push(`${fieldExpr} ${f.op} $${params.length}::jsonb`);
          break;
        case 'in':
          params.push(JSON.stringify(Array.isArray(f.value) ? f.value : []));
          conditions.push(`${fieldExpr} IN (SELECT jsonb_array_elements($${params.length}::jsonb))`);
          break;
        case 'array-contains':
          params.push(JSON.stringify([f.value]));
          conditions.push(`${fieldExpr} @> $${params.length}::jsonb`);
          break;
        default:
          throw new Error(`Unsupported where operator: ${f.op}`);
      }
    }
    return conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  }

  count() {
    return {
      get: async () => {
        const params: any[] = [];
        const sql =
          `SELECT COUNT(*)::int AS count FROM ${this.collection.table}` + this.buildWhere(params);
        const res = await this.collection._query(sql, params);
        return { data: () => ({ count: res.rows[0]?.count ?? 0 }) };
      },
    };
  }

  async get() {
    const params: any[] = [];
    let sql = `SELECT id, data FROM ${this.collection.table}` + this.buildWhere(params);

    if (this.sortConfig) {
      assertSafeIdentifier(this.sortConfig.field);
      const dir = this.sortConfig.direction?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      sql += ` ORDER BY data->'${this.sortConfig.field}' ${dir}`;
    }
    if (this.limitCount != null) {
      params.push(this.limitCount);
      sql += ` LIMIT $${params.length}`;
    }
    if (this.offsetCount != null) {
      params.push(this.offsetCount);
      sql += ` OFFSET $${params.length}`;
    }

    const res = await this.collection._query(sql, params);
    return makeSnapshot(res.rows, this.collection.table);
  }
}

class PgBatch {
  private deletes: Array<{ table: string; id: string }> = [];

  delete(ref: DocRef) {
    // Only refs produced by this store carry _table; validate its shape since
    // it ends up interpolated into SQL.
    if (!ref?.id || !ref?._table) return;
    if (!new RegExp(`^${SCHEMA}\\."[A-Za-z_][A-Za-z0-9_]*"$`).test(ref._table)) {
      throw new Error(`Invalid table reference in batch delete: ${ref._table}`);
    }
    this.deletes.push({ table: ref._table, id: ref.id });
  }

  async commit() {
    if (this.deletes.length === 0) return;

    const byTable = new Map<string, string[]>();
    for (const d of this.deletes) {
      const ids = byTable.get(d.table) ?? [];
      ids.push(d.id);
      byTable.set(d.table, ids);
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      for (const [table, ids] of byTable) {
        await client.query(`DELETE FROM ${table} WHERE id = ANY($1)`, [ids]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

export function createPgCollection(name: string) {
  return new PgCollection(name);
}
