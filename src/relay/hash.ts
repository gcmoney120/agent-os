import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256")
    .update(typeof data === "string" ? Buffer.from(data, "utf8") : data)
    .digest("hex");
}

export function sha256HexOfFile(filePath: string): string {
  return sha256Hex(readFileSync(filePath));
}
