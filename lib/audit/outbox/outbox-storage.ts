import { createModuleLogger } from "lib/logger";
import { mmkvStorage } from "lib/storage/mmkv";
import { submitOutboxOpKey, submitOutboxOpKeyPrefix, submitOutboxQuarantineKey } from "lib/audit/outbox/outbox-keys";
import { submitOutboxOpSchema, type OutboxKeyValueStorage, type SubmitOutboxOp } from "lib/audit/outbox/types";

const log = createModuleLogger("submit-outbox");

/**
 * Append-only, per-op submit outbox backed by individual key-value entries.
 *
 * Each op lives under its own key (`audit.outbox.v1.<user>.submit.<auditId>`),
 * so a single unreadable op is quarantined without discarding the rest of the
 * queue - the row-level durability the editing store's one-big-blob snapshot
 * cannot offer. The keyspace is independent of `audit.state.v4.<user>`, so
 * sign-out and editing-store resets never delete pending submissions. The
 * storage handle is injected so the pure logic is testable and a SQLite backend
 * can replace MMKV later without touching callers.
 */
export class SubmitOutbox {
    private readonly storage: OutboxKeyValueStorage;

    constructor(storage: OutboxKeyValueStorage = mmkvStorage) {
        this.storage = storage;
    }

    private opKey(userId: string, auditId: string): string {
        return submitOutboxOpKey(userId, auditId);
    }

    private opKeyPrefix(userId: string): string {
        return submitOutboxOpKeyPrefix(userId);
    }

    /** List all pending submit ops for one user, quarantining unreadable rows. */
    list(userId: string): SubmitOutboxOp[] {
        const prefix = this.opKeyPrefix(userId);
        const ops: SubmitOutboxOp[] = [];
        for (const key of this.storage.getAllKeys()) {
            if (!key.startsWith(prefix)) {
                continue;
            }
            const raw = this.storage.getString(key);
            if (raw === undefined) {
                continue;
            }
            const op = this.parseOrQuarantine(key, raw);
            if (op !== null) {
                ops.push(op);
            }
        }
        return ops;
    }

    /** Read one op, or null when absent or unreadable. */
    get(userId: string, auditId: string): SubmitOutboxOp | null {
        const key = this.opKey(userId, auditId);
        const raw = this.storage.getString(key);
        if (raw === undefined) {
            return null;
        }
        return this.parseOrQuarantine(key, raw);
    }

    /** Insert or replace one op. */
    put(userId: string, op: SubmitOutboxOp): void {
        try {
            this.storage.set(this.opKey(userId, op.audit_id), JSON.stringify(op));
        } catch (error) {
            log.withError(error).error("failed to persist submit outbox op");
        }
    }

    /** Remove one op after a successful (or terminally failed) delivery. */
    remove(userId: string, auditId: string): void {
        this.storage.remove(this.opKey(userId, auditId));
    }

    /**
     * Parse a stored op; on failure copy the raw value to a quarantine key and
     * delete the primary so one corrupt row never blocks the queue, and the raw
     * payload is preserved for recovery.
     */
    private parseOrQuarantine(key: string, raw: string): SubmitOutboxOp | null {
        try {
            const parsed = submitOutboxOpSchema.safeParse(JSON.parse(raw));
            if (parsed.success) {
                return parsed.data;
            }
        } catch (error) {
            log.withError(error).error("failed to parse submit outbox op");
        }
        const quarantineKey = submitOutboxQuarantineKey(key);
        try {
            this.storage.set(quarantineKey, raw);
        } catch (error) {
            log.withError(error).error("failed to quarantine unreadable submit outbox op; keeping original");
            return null;
        }
        this.storage.remove(key);
        return null;
    }
}

/** Shared MMKV-backed submit outbox used by the audit store. */
export const submitOutbox = new SubmitOutbox();
