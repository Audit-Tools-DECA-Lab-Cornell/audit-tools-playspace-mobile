import { Directory, File, Paths } from "expo-file-system";
import { mmkvStorage } from "lib/storage/mmkv";

import type { BugReportContext, BugReportSeverity } from "lib/bug-report/types";

/**
 * A queued bug report not yet sent to the backend. Reports are stored here
 * first so they survive offline. `flush.ts` sends them only when the app is
 * foregrounded, online, and the auditor confirms; there is no background sync.
 *
 * Only privacy-filtered user input and safe diagnostics are stored. The
 * screenshot remains local (`screenshotLocalUri`) until flush time.
 */
export interface PendingBugReport {
    id: string;
    createdAt: string;
    title: string;
    description: string;
    severity: BugReportSeverity;
    context: BugReportContext;
    projectId?: string;
    placeId?: string;
    submissionId?: string;
    /** Durable on-device URI of the captured screenshot, if one was attached. */
    screenshotLocalUri?: string;
    /**
     * Account that filed the report. This queue survives sign-out and is shared
     * by every auditor who has used the device, so the owner decides who may
     * submit it and whose account deletion may remove it. Absent only on entries
     * written before account tagging; those have no established owner, so they
     * are neither submitted under someone else's session nor deleted.
     */
    accountId?: string;
}

const QUEUE_STORAGE_KEY = "playspace.bugReport.queue.v1";
const SCREENSHOT_DIR = "bug-report-screenshots";

/**
 * A collision-resistant local id for a queued report. Bug reports are low
 * volume and device-local, so a timestamp plus randomness is sufficient; this
 * id never leaves the device (the backend assigns the real id on submit).
 */
export function createPendingBugReportId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readQueue(): PendingBugReport[] {
    try {
        const raw = mmkvStorage.getString(QUEUE_STORAGE_KEY);
        if (raw === undefined) {
            return [];
        }
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? (parsed as PendingBugReport[]) : [];
    } catch {
        return [];
    }
}

function writeQueue(queue: PendingBugReport[]): void {
    try {
        mmkvStorage.set(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    } catch {
        /* non-critical: a failed persist only loses the most recent enqueue */
    }
}

/** All reports waiting to be submitted, oldest first. */
export function readPendingBugReports(): PendingBugReport[] {
    return readQueue();
}

/** How many reports are waiting to be submitted. */
export function countPendingBugReports(): number {
    return readQueue().length;
}

/** Append a finished report to the local queue. */
export function enqueueBugReport(report: PendingBugReport): void {
    const queue = readQueue();
    queue.push(report);
    writeQueue(queue);
}

/**
 * Remove a report from the queue once it has been submitted (or abandoned) and
 * delete its locally-stored screenshot file.
 */
export function removePendingBugReport(id: string): void {
    const queue = readQueue();
    const target = queue.find((report) => report.id === id);
    if (target?.screenshotLocalUri) {
        deleteLocalScreenshot(target.screenshotLocalUri);
    }
    writeQueue(queue.filter((report) => report.id !== id));
}

/**
 * Copy a freshly-captured temporary screenshot into durable per-app storage so
 * it survives until the report is submitted, even across app restarts. Returns
 * the durable URI, or ``undefined`` if the copy fails (the report is still
 * queued without a screenshot - attachment is always optional).
 */
export function persistScreenshotForQueue(tmpUri: string, reportId: string): string | undefined {
    try {
        const source = new File(tmpUri);
        if (!source.exists) {
            return undefined;
        }
        const directory = new Directory(Paths.document, SCREENSHOT_DIR);
        if (!directory.exists) {
            directory.create({ intermediates: true, idempotent: true });
        }
        const destination = new File(directory, `${reportId}.png`);
        if (destination.exists) {
            destination.delete();
        }
        source.copy(destination);
        return destination.uri;
    } catch {
        return undefined;
    }
}

/** Delete a locally-stored screenshot file; safe to call if it is already gone. */
export function deleteLocalScreenshot(uri: string): void {
    try {
        const file = new File(uri);
        if (file.exists) {
            file.delete();
        }
    } catch {
        /* non-critical: an orphaned file is harmless and cleaned up by the OS */
    }
}
