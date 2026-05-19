import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export async function extractTextFromFile(filePath: string, fileType: string): Promise<string> {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  switch (fileType) {
    case 'application/pdf':
      return extractFromPdf(absolutePath);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractFromDocx(absolutePath);
    case 'text/plain':
      return fs.readFileSync(absolutePath, 'utf-8');
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

/**
 * Extract text directly from a Buffer (no file on disk needed).
 */
export async function extractTextFromBuffer(buffer: Buffer, fileType: string): Promise<string> {
  switch (fileType) {
    case 'application/pdf': {
      const data = await pdfParse(buffer);
      return data.text;
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case 'application/msword': {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case 'text/plain':
      return buffer.toString('utf-8');
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

async function extractFromPdf(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

async function extractFromDocx(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}
