/**
 * Agent OS — Memory Engine K1
 * Public barrel export for the memory module.
 *
 * Source: .claude/docs/architecture/Memory_Engine_Architecture_Spec_v1.1.md
 * Slice: K1 — Memory Engine Foundation
 *
 * Consumers of the K1 memory module import from this entry point only.
 * Internal module boundaries (store, write, retrieval, schemas, enums)
 * are implementation detail — this index defines the public surface.
 */

export * from "./enums.js";
export * from "./schemas.js";
export * from "./store.js";
export * from "./write.js";
export * from "./retrieval.js";
