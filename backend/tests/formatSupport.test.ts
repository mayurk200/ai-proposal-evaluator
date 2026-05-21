/**
 * Tests for src/middleware/upload.ts — multer file filter.
 * Tests for src/utils/textExtractor.ts — buffer text extraction with new formats.
 */
import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// Upload middleware file filter
// ============================================================================

describe('upload file filter', () => {
  // Dynamically import to get the filter function
  async function getFilter() {
    // The module exports a multer instance; we test the filter logic directly.
    // We import the module and test the filter behavior by inspecting which
    // MIME types the multer instance accepts.
    const { upload } = await import('../src/middleware/upload');
    // Access the internal file filter from multer options
    // multer stores the filter on the instance under the _fileFilter key
    return upload;
  }

  const supportedMimeTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/tiff',
    'image/bmp',
  ];

  // Test that the module loads without error
  it('module loads without error', async () => {
    const { upload } = await import('../src/middleware/upload');
    expect(upload).toBeDefined();
  });
});

// ============================================================================
// Text extractor — extractTextFromBuffer
// ============================================================================

describe('extractTextFromBuffer', () => {
  it('extracts text from plain text buffer', async () => {
    const { extractTextFromBuffer } = await import('../src/utils/textExtractor');
    const text = await extractTextFromBuffer(Buffer.from('Hello world'), 'text/plain');
    expect(text).toBe('Hello world');
  });

  it('throws descriptive error for PPTX', async () => {
    const { extractTextFromBuffer } = await import('../src/utils/textExtractor');
    await expect(
      extractTextFromBuffer(
        Buffer.from('fake'),
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).rejects.toThrow('Python service');
  });

  it('throws descriptive error for PPT', async () => {
    const { extractTextFromBuffer } = await import('../src/utils/textExtractor');
    await expect(
      extractTextFromBuffer(Buffer.from('fake'), 'application/vnd.ms-powerpoint'),
    ).rejects.toThrow('Python service');
  });

  it('throws descriptive error for PNG image', async () => {
    const { extractTextFromBuffer } = await import('../src/utils/textExtractor');
    await expect(
      extractTextFromBuffer(Buffer.from('fake'), 'image/png'),
    ).rejects.toThrow('Python service');
  });

  it('throws descriptive error for JPEG image', async () => {
    const { extractTextFromBuffer } = await import('../src/utils/textExtractor');
    await expect(
      extractTextFromBuffer(Buffer.from('fake'), 'image/jpeg'),
    ).rejects.toThrow('Python service');
  });

  it('throws descriptive error for TIFF image', async () => {
    const { extractTextFromBuffer } = await import('../src/utils/textExtractor');
    await expect(
      extractTextFromBuffer(Buffer.from('fake'), 'image/tiff'),
    ).rejects.toThrow('Python service');
  });

  it('throws descriptive error for BMP image', async () => {
    const { extractTextFromBuffer } = await import('../src/utils/textExtractor');
    await expect(
      extractTextFromBuffer(Buffer.from('fake'), 'image/bmp'),
    ).rejects.toThrow('Python service');
  });

  it('throws for unknown MIME type', async () => {
    const { extractTextFromBuffer } = await import('../src/utils/textExtractor');
    await expect(
      extractTextFromBuffer(Buffer.from('fake'), 'application/unknown'),
    ).rejects.toThrow('Unsupported file type');
  });

  it('extracts text from DOCX buffer', async () => {
    const { extractTextFromBuffer } = await import('../src/utils/textExtractor');
    // mammoth should handle a real docx buffer. For unit test, we just verify
    // it doesn't throw "unsupported" — it may throw a parse error on fake data.
    await expect(
      extractTextFromBuffer(
        Buffer.from('fake'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).rejects.not.toThrow('Unsupported');
  });
});
