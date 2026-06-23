export { STORE_VERSION, computeDnaVersion, serializeForVersion } from "./version-identity.js";
export type { CausalStamps } from "./version-identity.js";
export type { StoredSnapshot, SnapshotStore, CommitResult } from "./store.js";
export { commitSnapshot, inMemorySnapshotStore } from "./store.js";
