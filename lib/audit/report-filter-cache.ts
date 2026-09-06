import { createDefaultReportFilter } from "lib/audit/report-filter";
import type { ConstructSelection, ReportResultFilter } from "lib/audit/report-filter";
import {
    buildBulkReportIdentity,
    buildReportIdentity,
    reportFilterKeyPrefix,
    reportFilterUserKey,
} from "lib/audit/report-filter-keys";
import { createModuleLogger } from "lib/logger";
import { mmkvStorage } from "lib/storage/mmkv";

const log = createModuleLogger("report-filter-cache");

/**
 * Master switch for remembering a reader's filter choices between visits.
 *
 * Sticky filters are on trial. Setting this to `false` makes every report open
 * with both constructs enabled and turns all reads and writes below into no-ops,
 * without touching any call site. Flip it here rather than reverting the feature.
 */
export const REPORT_FILTERS_PERSIST = true;

/** Maximum report entries kept per user, evicting least-recently-changed first. */
const MAX_ENTRIES = 100;

interface CacheEntry {
    readonly overall: ConstructSelection;
    readonly domainOverrides: Record<string, ConstructSelection>;
    /** Epoch milliseconds of the last change, used for eviction ordering. */
    readonly updatedAt: number;
}

type CachePayload = Record<string, CacheEntry>;

export { buildBulkReportIdentity, buildReportIdentity, reportFilterKeyPrefix, reportFilterUserKey };

function isConstructSelection(value: unknown): value is ConstructSelection {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.playValue !== "boolean" || typeof candidate.usability !== "boolean") {
        return false;
    }
    return candidate.playValue || candidate.usability;
}

function parseEntry(value: unknown): CacheEntry | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const candidate = value as Record<string, unknown>;
    if (!isConstructSelection(candidate.overall)) {
        return null;
    }
    const overrides: Record<string, ConstructSelection> = {};
    const rawOverrides = candidate.domainOverrides;
    if (typeof rawOverrides === "object" && rawOverrides !== null) {
        Object.entries(rawOverrides as Record<string, unknown>).forEach(([domainKey, selection]) => {
            if (isConstructSelection(selection)) {
                overrides[domainKey] = { playValue: selection.playValue, usability: selection.usability };
            }
        });
    }
    return {
        overall: { playValue: candidate.overall.playValue, usability: candidate.overall.usability },
        domainOverrides: overrides,
        updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : 0,
    };
}

function readPayload(userId: string): CachePayload {
    try {
        const raw = mmkvStorage.getString(reportFilterUserKey(userId));
        if (raw === undefined) {
            return {};
        }
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) {
            return {};
        }
        const payload: CachePayload = {};
        Object.entries(parsed as Record<string, unknown>).forEach(([reportIdentity, entry]) => {
            const parsedEntry = parseEntry(entry);
            if (parsedEntry !== null) {
                payload[reportIdentity] = parsedEntry;
            }
        });
        return payload;
    } catch {
        log.warn("discarding unreadable report-filter cache");
        return {};
    }
}

function writePayload(userId: string, payload: CachePayload): void {
    try {
        mmkvStorage.set(reportFilterUserKey(userId), JSON.stringify(payload));
    } catch {
        log.warn("failed to store report filters");
    }
}

function evictOldest(payload: CachePayload): CachePayload {
    const entries = Object.entries(payload);
    if (entries.length <= MAX_ENTRIES) {
        return payload;
    }
    entries.sort((left, right) => right[1].updatedAt - left[1].updatedAt);
    return Object.fromEntries(entries.slice(0, MAX_ENTRIES));
}

/**
 * Read one report's stored filter.
 *
 * @param userId Signed-in user's id, or null when no user can be identified.
 * @param reportIdentity Report key from `buildReportIdentity`.
 * @returns The stored filter, or a default filter when there is none to restore.
 */
export function loadReportFilter(userId: string | null, reportIdentity: string): ReportResultFilter {
    if (!REPORT_FILTERS_PERSIST || userId === null || userId.length === 0) {
        return createDefaultReportFilter();
    }
    const entry = readPayload(userId)[reportIdentity];
    if (entry === undefined) {
        return createDefaultReportFilter();
    }
    return { overall: entry.overall, domainOverrides: entry.domainOverrides };
}

/**
 * Store one report's filter, evicting the least-recently-changed entries beyond
 * the cap.
 *
 * @param userId Signed-in user's id.
 * @param reportIdentity Report key from `buildReportIdentity`.
 * @param filter Filter to remember.
 * @param changedAt Epoch milliseconds used for eviction ordering.
 */
export function saveReportFilter(
    userId: string | null,
    reportIdentity: string,
    filter: ReportResultFilter,
    changedAt: number,
): void {
    if (!REPORT_FILTERS_PERSIST || userId === null || userId.length === 0) {
        return;
    }
    const payload = readPayload(userId);
    payload[reportIdentity] = {
        overall: filter.overall,
        domainOverrides: { ...filter.domainOverrides },
        updatedAt: changedAt,
    };
    writePayload(userId, evictOldest(payload));
}

/**
 * Remove every stored selection for one user.
 *
 * @param userId Signed-in user's id.
 */
export function clearReportFilters(userId: string | null): void {
    if (userId === null || userId.length === 0) {
        return;
    }
    try {
        mmkvStorage.remove(reportFilterUserKey(userId));
    } catch {
        log.warn("failed to clear report filters");
    }
}
