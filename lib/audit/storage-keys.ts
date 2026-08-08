/**
 * Key derivation for the editing store's persisted audit snapshot.
 *
 * Kept free of React Native imports and separate from `stores/audit-store.ts`
 * so anything that has to reason about the on-device keyspace - the account
 * deletion purge in particular - derives keys from the same source the writer
 * uses, instead of re-spelling the format and drifting from it.
 */

/** Prefix for the per-account audit editing snapshot. */
export const AUDIT_STATE_KEY_PREFIX = "audit.state.v4";

/**
 * Storage key holding one account's audit editing snapshot.
 *
 * @param userId Account the snapshot belongs to.
 * @returns Exact storage key.
 */
export function auditStateStorageKey(userId: string): string {
    return `${AUDIT_STATE_KEY_PREFIX}.${encodeURIComponent(userId)}`;
}

/**
 * Whether a storage key belongs to one account's audit snapshot - the snapshot
 * itself or any quarantine copy written beside it by the persistence guards.
 *
 * Matching is exact-or-dot-delimited rather than a bare prefix test: account
 * ids are not delimiter-free, so `audit.state.v4.<a>` would otherwise also
 * match `audit.state.v4.<ab>` and reach into a different account's data.
 *
 * @param key Candidate storage key.
 * @param userId Account being matched.
 * @returns True when the key is owned by that account.
 */
export function isAuditStateKeyForUser(key: string, userId: string): boolean {
    const ownKey = auditStateStorageKey(userId);
    return key === ownKey || key.startsWith(`${ownKey}.`);
}
