import fs from 'fs';
import path from 'path';

/**
 * Simple local JSON file store — used as a fallback when Firebase
 * service account is not configured. Data is persisted to disk.
 * Automatically replaced by Firestore when firebase-service-account.json is present.
 */

const DATA_DIR = path.resolve(__dirname, '../../data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface StoreData {
  [key: string]: any;
}

class LocalCollection {
  private filePath: string;
  private collectionName: string;

  constructor(name: string) {
    this.collectionName = name;
    this.filePath = path.join(DATA_DIR, `${name}.json`);
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '{}', 'utf-8');
    }
  }

  private readAll(): StoreData {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private writeAll(data: StoreData): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  doc(id: string) {
    const self = this;
    return {
      async get() {
        const all = self.readAll();
        const data = all[id] || null;
        return {
          exists: !!data,
          data: () => data,
          id,
          ref: { id },
        };
      },
      async set(value: any) {
        const all = self.readAll();
        all[id] = { ...value, _id: id };
        self.writeAll(all);
      },
      async update(value: any) {
        const all = self.readAll();
        if (all[id]) {
          all[id] = { ...all[id], ...value };
          self.writeAll(all);
        }
      },
      async delete() {
        const all = self.readAll();
        delete all[id];
        self.writeAll(all);
      },
    };
  }

  where(field: string, op: string, value: any) {
    return new LocalQuery(this, [{ field, op, value }]);
  }

  async count() {
    const all = this.readAll();
    return {
      get: async () => ({
        data: () => ({ count: Object.keys(all).length }),
      }),
    };
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
    return new LocalQuery(this, [], { field, direction });
  }

  // Expose readAll for queries
  _readAll(): StoreData {
    return this.readAll();
  }

  get firestore() {
    return {
      batch: () => new LocalBatch(),
    };
  }
}

class LocalQuery {
  private collection: LocalCollection;
  private filters: Array<{ field: string; op: string; value: any }>;
  private sortConfig?: { field: string; direction: string };
  private limitCount?: number;
  private offsetCount?: number;

  constructor(
    collection: LocalCollection,
    filters: Array<{ field: string; op: string; value: any }> = [],
    sortConfig?: { field: string; direction: string }
  ) {
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

  async count() {
    const docs = this.filterDocs();
    return {
      get: async () => ({
        data: () => ({ count: docs.length }),
      }),
    };
  }

  async get() {
    let docs = this.filterDocs();

    // Sort
    if (this.sortConfig) {
      const { field, direction } = this.sortConfig;
      docs.sort((a, b) => {
        const av = a[field], bv = b[field];
        if (av < bv) return direction === 'asc' ? -1 : 1;
        if (av > bv) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    // Offset
    if (this.offsetCount) {
      docs = docs.slice(this.offsetCount);
    }

    // Limit
    if (this.limitCount) {
      docs = docs.slice(0, this.limitCount);
    }

    return {
      empty: docs.length === 0,
      docs: docs.map((d) => ({
        id: d._id || d.id,
        data: () => d,
        ref: { id: d._id || d.id },
      })),
      size: docs.length,
    };
  }

  private filterDocs(): any[] {
    const all = this.collection._readAll();
    let docs = Object.values(all);

    for (const f of this.filters) {
      docs = docs.filter((doc) => {
        const docVal = doc[f.field];
        switch (f.op) {
          case '==': return docVal === f.value;
          case '!=': return docVal !== f.value;
          case '>': return docVal > f.value;
          case '<': return docVal < f.value;
          case '>=': return docVal >= f.value;
          case '<=': return docVal <= f.value;
          case 'in': return Array.isArray(f.value) && f.value.includes(docVal);
          case 'array-contains': return Array.isArray(docVal) && docVal.includes(f.value);
          default: return true;
        }
      });
    }

    return docs;
  }
}

class LocalBatch {
  private ops: Array<() => void> = [];

  delete(ref: { id: string }) {
    // batch delete is handled individually
    this.ops.push(() => {});
  }

  async commit() {
    this.ops.forEach((op) => op());
  }
}

export function createLocalCollection(name: string) {
  return new LocalCollection(name);
}
