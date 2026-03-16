import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const BLOCK = 512;

export interface TarEntry {
  name: string;
  data: Buffer;
  typeflag?: "0" | "2"; // "0" = regular file (default), "2" = symlink
  linkname?: string;
}

export interface ParsedTarEntry {
  name: string;
  data: Buffer;
  typeflag: string;
  linkname: string;
}

function buildHeader(entry: TarEntry): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  const typeflag = entry.typeflag ?? "0";

  const writeStr = (s: string, off: number, max: number) => {
    const b = Buffer.from(s, "utf8");
    b.copy(h, off, 0, Math.min(b.length, max));
  };

  writeStr(entry.name, 0, 100);
  writeStr("0000644\0", 100, 8);
  writeStr("0000000\0", 108, 8);
  writeStr("0000000\0", 116, 8);
  writeStr(entry.data.length.toString(8).padStart(11, "0") + "\0", 124, 12);
  writeStr("00000000000\0", 136, 12); // mtime = 0
  h.fill(0x20, 148, 156);            // checksum placeholder = 8 spaces
  h[156] = typeflag.charCodeAt(0);
  if (entry.linkname) writeStr(entry.linkname, 157, 100);
  writeStr("ustar\0", 257, 6);
  writeStr("00", 263, 2);

  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  writeStr(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);

  return h;
}

export async function buildTarGz(entries: TarEntry[]): Promise<Buffer> {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    blocks.push(buildHeader(entry));
    if (entry.data.length > 0 && entry.typeflag !== "2") {
      const padded = Math.ceil(entry.data.length / BLOCK) * BLOCK;
      const buf = Buffer.alloc(padded, 0);
      entry.data.copy(buf);
      blocks.push(buf);
    }
  }

  blocks.push(Buffer.alloc(BLOCK * 2, 0)); // end-of-archive

  const tar = Buffer.concat(blocks);
  return gzipAsync(tar, { level: 6 }) as Promise<Buffer>;
}

export async function parseTarGz(compressed: Buffer): Promise<ParsedTarEntry[]> {
  const tar = (await gunzipAsync(compressed)) as Buffer;
  const entries: ParsedTarEntry[] = [];
  let offset = 0;

  while (offset + BLOCK <= tar.length) {
    const h = tar.subarray(offset, offset + BLOCK);
    if (h.every((b) => b === 0)) break;

    const name = h.subarray(0, 100).toString("utf8").replace(/\0+$/, "");
    if (!name) break;

    const tc = h[156];
    const typeflag = tc === 0x00 || tc === 0x30 ? "0" : String.fromCharCode(tc);
    const linkname = h.subarray(157, 257).toString("utf8").replace(/\0+$/, "");
    const sizeStr = h.subarray(124, 136).toString("utf8").replace(/\0+$/, "").trim();
    const size = parseInt(sizeStr, 8) || 0;

    offset += BLOCK;
    entries.push({ name, data: Buffer.from(tar.subarray(offset, offset + size)), typeflag, linkname });
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }

  return entries;
}
