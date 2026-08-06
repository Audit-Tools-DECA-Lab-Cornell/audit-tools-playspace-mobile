import type { AuditSession } from "lib/audit/types";
import { SOCIABILITY_EXPORT_HEADERS } from "lib/audit/sociability";

import type { AuditExportContext, ExportAuditorProfile } from "lib/exports/reports/types";

/** File formats supported for in-progress audit exports. */
export type InProgressAuditExportFormat = "pdf" | "csv" | "xlsx";

/** One in-progress (or any) audit bundled with the extra context needed to export. */
export interface InProgressExportableAudit {
    readonly auditSession: AuditSession;
    readonly context: AuditExportContext | null;
    readonly auditorProfile: ExportAuditorProfile | null;
}

/** Lightweight workbook-style preview shown before exporting. */
export interface InProgressAuditExportPreview {
    readonly auditCode: string;
    readonly headers: readonly string[];
    readonly rows: readonly (readonly string[])[];
}

/**
 * Response matrix headers used by the in-progress export.
 *
 * Score columns are intentionally omitted: an audit that has not been submitted
 * does not have computed totals yet, so the matrix focuses on the recorded
 * answers themselves.
 */
export const IN_PROGRESS_RESPONSE_HEADERS = [
    "Question Key",
    "Mode",
    "Constructs",
    "Domain",
    "Prompt",
    "Provision",
    "Variety",
    "Sociability",
    ...SOCIABILITY_EXPORT_HEADERS,
    "Challenge",
] as const;

export const IN_PROGRESS_RESPONSE_COLUMN_WIDTHS = [14, 14, 16, 28, 64, 26, 26, 26, 26, 26, 26, 26] as const;

export const IN_PROGRESS_OVERVIEW_COLUMN_WIDTHS = [28, 56] as const;
export const IN_PROGRESS_PRE_AUDIT_COLUMN_WIDTHS = [42, 58] as const;
export const IN_PROGRESS_SPACE_AUDIT_COLUMN_WIDTHS = [42, 58] as const;

export const IN_PROGRESS_PREVIEW_COLUMN_INDEXES = [0, 1, 3, 4] as const;

/** Sentinel placed in col 1 so the styler can identify per-question auditor comment rows. */
export const COMMENT_ROW_SENTINEL = "__comment__" as const;

/** Sentinel placed in col 1 for the bold Notes Prompt banner row. */
export const SECTION_NOTE_SENTINEL = "__section_note__" as const;

/** Sentinel placed in col 1 for the normal-weight Auditor Note response row. */
export const SECTION_NOTE_RESPONSE_SENTINEL = "__section_note_response__" as const;

/**
 * Display value used in scale, checklist, and pre-audit cells when the auditor
 * has not recorded an answer yet. Surfacing a visible placeholder (instead of
 * leaving the cell blank) makes it obvious in CSV exports that the slot is
 * intentionally empty, and lets the XLSX/PDF renderers attach a "needs
 * attention" highlight to the same cells.
 */
export const UNANSWERED_PLACEHOLDER = "Not answered" as const;

/** Display value used when a value is not yet known (e.g. progress totals on a fresh audit). */
export const PENDING_PLACEHOLDER = "-" as const;

/**
 * Soft warning palette applied to unanswered cells in the in-progress XLSX
 * and PDF exports. The fill is a pale red and the text is a muted red - clear
 * enough to spot from across a printed page without screaming "error".
 */
export const UNANSWERED_CELL_PALETTE = {
    fillHex: "FEF2F2",
    textHex: "B91C1C",
} as const;
