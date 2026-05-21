/**
 * Tests for src/config/localStore.ts — in-memory JSON store.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createLocalCollection } from '../src/config/localStore';

const TEST_COLLECTION = `_test_collection_${Date.now()}`;

describe('LocalCollection', () => {
  let collection: ReturnType<typeof createLocalCollection>;

  beforeEach(() => {
    collection = createLocalCollection(TEST_COLLECTION);
  });

  afterEach(() => {
    // Cleanup test file
    const filePath = path.resolve(__dirname, `../data/${TEST_COLLECTION}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  describe('doc operations', () => {
    it('set and get a document', async () => {
      await collection.doc('doc1').set({ name: 'Test', score: 85 });
      const snap = await collection.doc('doc1').get();

      expect(snap.exists).toBe(true);
      expect(snap.data()!.name).toBe('Test');
      expect(snap.data()!.score).toBe(85);
      expect(snap.id).toBe('doc1');
    });

    it('returns non-existent doc as null', async () => {
      const snap = await collection.doc('nonexistent').get();
      expect(snap.exists).toBe(false);
      expect(snap.data()).toBeNull();
    });

    it('update merges fields', async () => {
      await collection.doc('doc1').set({ name: 'Original', count: 1 });
      await collection.doc('doc1').update({ count: 2, extra: 'new' });

      const snap = await collection.doc('doc1').get();
      expect(snap.data()!.name).toBe('Original');
      expect(snap.data()!.count).toBe(2);
      expect(snap.data()!.extra).toBe('new');
    });

    it('update on nonexistent doc is a no-op', async () => {
      await collection.doc('missing').update({ foo: 'bar' });
      const snap = await collection.doc('missing').get();
      expect(snap.exists).toBe(false);
    });

    it('delete removes a document', async () => {
      await collection.doc('doc1').set({ name: 'Delete me' });
      await collection.doc('doc1').delete();

      const snap = await collection.doc('doc1').get();
      expect(snap.exists).toBe(false);
    });
  });

  describe('collection get', () => {
    it('returns all documents', async () => {
      await collection.doc('a').set({ value: 1 });
      await collection.doc('b').set({ value: 2 });

      const result = await collection.get();
      expect(result.size).toBe(2);
      expect(result.empty).toBe(false);
    });

    it('returns empty on no docs', async () => {
      const result = await collection.get();
      expect(result.empty).toBe(true);
      expect(result.size).toBe(0);
    });
  });

  describe('count', () => {
    it('returns document count', async () => {
      await collection.doc('a').set({ v: 1 });
      await collection.doc('b').set({ v: 2 });

      const result = await collection.count().get();
      expect(result.data().count).toBe(2);
    });
  });

  describe('where queries', () => {
    beforeEach(async () => {
      await collection.doc('p1').set({ status: 'active', score: 90 });
      await collection.doc('p2').set({ status: 'pending', score: 60 });
      await collection.doc('p3').set({ status: 'active', score: 75 });
    });

    it('filters with ==', async () => {
      const result = await collection.where('status', '==', 'active').get();
      expect(result.size).toBe(2);
    });

    it('filters with !=', async () => {
      const result = await collection.where('status', '!=', 'active').get();
      expect(result.size).toBe(1);
    });

    it('filters with >', async () => {
      const result = await collection.where('score', '>', 70).get();
      expect(result.size).toBe(2);
    });

    it('filters with <', async () => {
      const result = await collection.where('score', '<', 80).get();
      expect(result.size).toBe(2);
    });

    it('chained where', async () => {
      const result = await collection
        .where('status', '==', 'active')
        .where('score', '>', 80)
        .get();
      expect(result.size).toBe(1);
      expect(result.docs[0].data().score).toBe(90);
    });

    it('count after where', async () => {
      const result = await collection.where('status', '==', 'active').count().get();
      expect(result.data().count).toBe(2);
    });
  });

  describe('orderBy, limit, offset', () => {
    beforeEach(async () => {
      await collection.doc('a').set({ name: 'Alpha', rank: 3 });
      await collection.doc('b').set({ name: 'Beta', rank: 1 });
      await collection.doc('c').set({ name: 'Gamma', rank: 2 });
    });

    it('orders ascending', async () => {
      const result = await collection.orderBy('rank', 'asc').get();
      expect(result.docs[0].data().rank).toBe(1);
      expect(result.docs[2].data().rank).toBe(3);
    });

    it('orders descending', async () => {
      const result = await collection.orderBy('rank', 'desc').get();
      expect(result.docs[0].data().rank).toBe(3);
    });

    it('limits results', async () => {
      const result = await collection.orderBy('rank').limit(2).get();
      expect(result.size).toBe(2);
    });

    it('offsets results', async () => {
      const result = await collection.orderBy('rank').offset(1).get();
      expect(result.size).toBe(2);
      expect(result.docs[0].data().rank).toBe(2);
    });

    it('limit + offset combined', async () => {
      const result = await collection.orderBy('rank').offset(1).limit(1).get();
      expect(result.size).toBe(1);
      expect(result.docs[0].data().rank).toBe(2);
    });
  });

  describe('batch', () => {
    it('commit runs without error', async () => {
      const batch = collection.firestore.batch();
      batch.delete({ id: 'nonexistent' });
      await expect(batch.commit()).resolves.not.toThrow();
    });
  });
});
