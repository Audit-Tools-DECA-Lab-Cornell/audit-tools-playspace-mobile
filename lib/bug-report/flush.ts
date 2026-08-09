import type { AuthSession } from "lib/auth/types";
import { createSingleFlightRunner } from "lib/audit/store-sync-core";

import { createBugReport } from "lib/bug-report/api";
import { readPendingBugReports, removePendingBugReport } from "lib/bug-report/queue";
import { uploadCapturedScreenshot, type UploadedScreenshot } from "lib/bug-report/screenshot";

export interface FlushResult {
    /** Reports that reached the backend and were removed from the queue. */
    submitted: number;
    /** Reports that failed to send and remain queued for a later attempt. */
    failed: number;
}

/**
 * Send queued bug reports to the backend. Screenshots upload first, but upload
 * failures do not block submission. Reports that fail to send stay queued for
 * retry. Call only when online.
 *
 * Wrapped with `createSingleFlightRunner` so concurrent callers (the immediate
 * background flush after submit and the prompt-driven flush from
 * `use-flush-prompt.ts`) share one in-flight execution and never POST the same
 * report twice. The backend `BugReportCreateRequest` carries no idempotency key,
 * so single-flight is the only duplicate-submission guard.
 *
 * A report tagged to a different account is never sent. The queue outlives
 * sign-out on a shared field device, so submitting every entry would file
 * another auditor's report - and their typed words - under whoever happens to be
 * signed in.
 *
 * Untagged entries (written before account tagging) *are* sent. Deletion and
 * delivery fail in opposite directions here: refusing to delete an unowned entry
 * costs nothing, but refusing to send one strands a report the auditor believes
 * they filed. On upgrade those entries belong to the person still signed in.
 */
export const flushPendingBugReports: (session: AuthSession) => Promise<FlushResult> = createSingleFlightRunner(
    async (session: AuthSession): Promise<FlushResult> => {
        const pending = readPendingBugReports().filter(
            (report) => report.accountId === undefined || report.accountId === session.user.id,
        );
        let submitted = 0;
        let failed = 0;

        for (const report of pending) {
            try {
                let screenshot: UploadedScreenshot | null = null;
                if (report.screenshotLocalUri) {
                    try {
                        screenshot = await uploadCapturedScreenshot(session, report.screenshotLocalUri);
                    } catch {
                        // Attachment is optional: send the report without the image.
                        screenshot = null;
                    }
                }

                await createBugReport(session, {
                    surface: "mobile",
                    title: report.title,
                    description: report.description,
                    severity: report.severity,
                    ...(report.projectId ? { project_id: report.projectId } : {}),
                    ...(report.placeId ? { place_id: report.placeId } : {}),
                    ...(report.submissionId ? { playspace_submission_id: report.submissionId } : {}),
                    ...(screenshot
                        ? { screenshot_url: screenshot.url, screenshot_public_id: screenshot.publicId }
                        : {}),
                    context: report.context,
                });

                removePendingBugReport(report.id);
                submitted += 1;
            } catch {
                failed += 1;
            }
        }

        return { submitted, failed };
    },
);
