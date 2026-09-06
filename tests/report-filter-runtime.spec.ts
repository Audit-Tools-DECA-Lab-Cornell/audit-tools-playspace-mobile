import { describe, expect, it, vi } from "vitest";

import { createDefaultReportFilter, setOverallSelection } from "lib/audit/report-filter";
import {
    reportFilterRuntimeIdentity,
    resolveReportFilterRuntimeState,
    type ReportFilterRuntimeState,
} from "lib/audit/use-report-filter";

vi.mock("lib/audit/report-filter-cache", () => ({
    loadReportFilter: vi.fn(),
    saveReportFilter: vi.fn(),
}));

describe("report filter runtime identity", () => {
    it("loads the next account and report synchronously instead of reusing stale state", () => {
        const storedForNextIdentity = setOverallSelection(createDefaultReportFilter(), {
            playValue: false,
            usability: true,
        });
        const load = vi.fn(() => storedForNextIdentity);
        const current: ReportFilterRuntimeState = {
            identityKey: reportFilterRuntimeIdentity("user-a", "audit:first"),
            persistedFilter: setOverallSelection(createDefaultReportFilter(), {
                playValue: true,
                usability: false,
            }),
            temporaryFilter: createDefaultReportFilter(),
        };

        const next = resolveReportFilterRuntimeState(current, "user-b", "audit:second", load);

        expect(load).toHaveBeenCalledWith("user-b", "audit:second");
        expect(next.identityKey).toBe(reportFilterRuntimeIdentity("user-b", "audit:second"));
        expect(next.persistedFilter).toEqual(storedForNextIdentity);
        expect(next.temporaryFilter).toBeNull();
    });

    it("keeps a temporary full-report view only while the identity remains mounted", () => {
        const current: ReportFilterRuntimeState = {
            identityKey: reportFilterRuntimeIdentity("user-a", "audit:first"),
            persistedFilter: setOverallSelection(createDefaultReportFilter(), {
                playValue: true,
                usability: false,
            }),
            temporaryFilter: createDefaultReportFilter(),
        };
        const load = vi.fn(() => createDefaultReportFilter());

        expect(resolveReportFilterRuntimeState(current, "user-a", "audit:first", load)).toBe(current);
        expect(load).not.toHaveBeenCalled();
    });
});
