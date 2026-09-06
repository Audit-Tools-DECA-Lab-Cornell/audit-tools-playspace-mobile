/**
 * Storage key names for per-report construct filters.
 *
 * Kept free of storage, React Native and network imports so that pure decision
 * logic — account deletion in particular — can name these keys while staying
 * unit testable in the node environment.
 */

/** Storage schema version. Bump to abandon incompatible stored entries. */
export const REPORT_FILTER_CACHE_VERSION = "v1";

/**
 * Prefix shared by every user's report-filter key.
 *
 * @returns The prefix used to recognize report-filter keys.
 */
export function reportFilterKeyPrefix(): string {
    return `playspace.report-filters.${REPORT_FILTER_CACHE_VERSION}.`;
}

/**
 * Storage key holding one user's stored report filters.
 *
 * @param userId Signed-in user's id.
 * @returns The storage key for that user's report filters.
 */
export function reportFilterUserKey(userId: string): string {
    return `${reportFilterKeyPrefix()}${userId}`;
}

/**
 * Stable identity for one report's stored selections.
 *
 * A combined place report merges exactly one audit session and one survey
 * session, so both ids are needed to name it.
 *
 * @param auditId Audit session id.
 * @param surveyId Survey session id for a combined report; omit for a single report.
 * @returns The report identity used as a cache entry key.
 */
export function buildReportIdentity(auditId: string, surveyId?: string | null): string {
    return surveyId === undefined || surveyId === null ? `audit:${auditId}` : `combined:${auditId}:${surveyId}`;
}

/**
 * Identity for the bulk export screen's shared selection.
 *
 * Bulk export is one choice applied to many reports, so it is stored once per
 * user rather than per report.
 *
 * @returns The bulk selection's cache entry key.
 */
export function buildBulkReportIdentity(): string {
    return "bulk";
}
