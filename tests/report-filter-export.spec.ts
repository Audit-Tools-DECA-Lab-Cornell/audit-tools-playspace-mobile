import { describe, expect, it } from "vitest";

import { createDefaultReportFilter, setDomainOverride, setOverallSelection } from "lib/audit/report-filter";
import { buildFilterFileNameSuffix, describeResultFilter } from "lib/exports/reports/row-builders";

const PLAY_VALUE_ONLY = { playValue: true, usability: false };
const USABILITY_ONLY = { playValue: false, usability: true };

describe("export filename suffixes", () => {
    it("leaves an unfiltered export's filename alone", () => {
        expect(buildFilterFileNameSuffix(undefined)).toBe("");
        expect(buildFilterFileNameSuffix(createDefaultReportFilter())).toBe("");
    });

    it("names the construct for a single-construct export", () => {
        expect(buildFilterFileNameSuffix(setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY))).toBe(
            "-play-value",
        );
        expect(buildFilterFileNameSuffix(setOverallSelection(createDefaultReportFilter(), USABILITY_ONLY))).toBe(
            "-usability",
        );
    });

    it("marks a domain-customized export as filtered", () => {
        expect(
            buildFilterFileNameSuffix(setDomainOverride(createDefaultReportFilter(), "seating", USABILITY_ONLY)),
        ).toBe("-filtered");
    });
});

describe("export provenance line", () => {
    it("declares an unfiltered export complete", () => {
        expect(describeResultFilter(undefined)).toBe("Play Value and Usability (complete audit)");
        expect(describeResultFilter(createDefaultReportFilter())).toBe("Play Value and Usability (complete audit)");
    });

    it("names the construct a single-construct export covers", () => {
        expect(describeResultFilter(setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY))).toBe(
            "Play Value only",
        );
        expect(describeResultFilter(setOverallSelection(createDefaultReportFilter(), USABILITY_ONLY))).toBe(
            "Usability only",
        );
    });

    it("reports domain customization alongside the construct", () => {
        const filter = setDomainOverride(
            setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY),
            "seating",
            USABILITY_ONLY,
        );
        expect(describeResultFilter(filter)).toBe("Play Value only; some domains customized");
    });
});
