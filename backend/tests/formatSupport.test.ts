/**
 * Tests for src/middleware/upload.ts — multer file filter.
 */
import { describe, it, expect } from 'vitest';

describe('upload file filter', () => {
  it('module loads without error', async () => {
    const { upload } = await import('../src/middleware/upload');
    expect(upload).toBeDefined();
  });
});
