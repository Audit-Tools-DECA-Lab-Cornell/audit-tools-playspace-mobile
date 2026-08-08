/**
 * Key derivation for the durable submit outbox.
 *
 * Free of React Native imports so both the MMKV-backed storage adapter and the
 * account deletion purge derive the same keys from one definition.
 */

/** Prefix shared by every submit outbox entry. */
export const SUBMIT_OUTBOX_KEY_PREFIX = "audit.outbox.v1";

/**
 * Prefix covering every outbox entry owned by one account, including
 * quarantined rows.
 *
 * The trailing dot is load-bearing: it keeps `<prefix>.<a>.` from also matching
 * `<prefix>.<ab>.`, so a per-account sweep can never reach another account.
 *
 * @param userId Account that owns the entries.
 * @returns Prefix ending in a dot.
 */
export function submitOutboxUserKeyPrefix(userId: string): string {
    return `${SUBMIT_OUTBOX_KEY_PREFIX}.${encodeURIComponent(userId)}.`;
}

/**
 * Prefix covering one account's pending submit ops.
 *
 * @param userId Account that owns the ops.
 * @returns Prefix ending in a dot.
 */
export function submitOutboxOpKeyPrefix(userId: string): string {
    return `${submitOutboxUserKeyPrefix(userId)}submit.`;
}

/**
 * Key for one account's pending submit op.
 *
 * @param userId Account that owns the op.
 * @param auditId Audit awaiting delivery.
 * @returns Exact storage key.
 */
export function submitOutboxOpKey(userId: string, auditId: string): string {
    return `${submitOutboxOpKeyPrefix(userId)}${encodeURIComponent(auditId)}`;
}

/**
 * Quarantine key for an unreadable op, derived from its primary key so the raw
 * value stays recoverable under the same account's prefix.
 *
 * @param opKey Primary key of the unreadable op.
 * @returns Quarantine key.
 */
export function submitOutboxQuarantineKey(opKey: string): string {
    return opKey.replace(".submit.", ".corrupt.");
}
