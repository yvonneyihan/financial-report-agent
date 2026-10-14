import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Local-disk document storage. Swappable for S3/GCS later behind this same interface. */
export interface DocumentStorage {
  save(ownerId: string, contentSha256: string, bytes: Buffer): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
}

export class LocalDocumentStorage implements DocumentStorage {
  constructor(private readonly rootDir: string) {}

  async save(ownerId: string, contentSha256: string, bytes: Buffer): Promise<string> {
    const dir = path.join(this.rootDir, ownerId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${contentSha256}.pdf`);
    await writeFile(filePath, bytes);
    return filePath;
  }

  async read(storagePath: string): Promise<Buffer> {
    return readFile(storagePath);
  }
}
