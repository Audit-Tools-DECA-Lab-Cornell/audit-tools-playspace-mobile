import { describe, expect, it } from "vitest";

import { getSociabilityDataColumnWidth, resolveReportScoreTableLayout } from "lib/report-table-layout-math";

/** Content-track widths for the devices the audit app actually ships on. */
const PHONE_TRACKS = [320, 358, 390, 430] as const;
const TABLET_TRACKS = [704, 834, 1024, 1180] as const;

const SCALE_COLUMN_COUNT = 3;
const SOCIABILITY_COLUMN_COUNT = 3;
const CONSTRUCT_COLUMN_COUNT = 2;

describe("report score table widths", () => {
    it.each(PHONE_TRACKS)("fits all three phone groups inside a %ipt track", (track) => {
        const layout = resolveReportScoreTableLayout(track, false);

        const scaleWidth = layout.labelColWidth + layout.leftDataColWidth * SCALE_COLUMN_COUNT;
        const constructWidth = layout.labelColWidth + layout.rightDataColWidth * CONSTRUCT_COLUMN_COUNT;

        // The scale group is solved to the track exactly; the construct group divides the same
        // leftover width two ways, so rounding may leave it at most one point short - never over.
        expect(scaleWidth).toBe(track);
        expect(constructWidth).toBeLessThanOrEqual(track);
        expect(track - constructWidth).toBeLessThanOrEqual(1);
        expect(layout.sociabilityTableWidth).toBe(track);
    });

    it.each(TABLET_TRACKS)("keeps every tablet group inside a %ipt track", (track) => {
        const layout = resolveReportScoreTableLayout(track, true);

        expect(layout.leftTableWidth).toBe(layout.labelColWidth + layout.leftDataColWidth * SCALE_COLUMN_COUNT);
        expect(layout.sociabilityTableWidth).toBe(
            layout.labelColWidth + layout.leftDataColWidth * SOCIABILITY_COLUMN_COUNT,
        );
        expect(layout.rightTableWidth).toBe(layout.labelColWidth + layout.rightDataColWidth * CONSTRUCT_COLUMN_COUNT);

        // Groups sit side by side in one scroller, so no single group may exceed the track.
        expect(layout.leftTableWidth).toBeLessThanOrEqual(track);
        expect(layout.sociabilityTableWidth).toBeLessThanOrEqual(track);
        expect(layout.rightTableWidth).toBeLessThanOrEqual(track);
    });

    it("never returns a column narrower than the enforced minimum", () => {
        for (const track of [0, 40, 120]) {
            const phone = resolveReportScoreTableLayout(track, false);
            const tablet = resolveReportScoreTableLayout(track, true);

            for (const layout of [phone, tablet]) {
                expect(layout.leftDataColWidth).toBeGreaterThanOrEqual(28);
                expect(layout.rightDataColWidth).toBeGreaterThanOrEqual(28);
            }
        }
    });

    it("gives the Sociability group one footprint whether it shows three opportunities or one", () => {
        for (const [track, isTablet] of [
            [390, false],
            [1024, true],
        ] as const) {
            const layout = resolveReportScoreTableLayout(track, isTablet);

            const threeColumnWidth =
                layout.labelColWidth + getSociabilityDataColumnWidth(layout, SOCIABILITY_COLUMN_COUNT) * 3;
            const legacyWidth = layout.labelColWidth + getSociabilityDataColumnWidth(layout, 1) * 1;

            // A legacy 5.31 report widens the single aggregate column instead of shrinking the
            // group, so it never renders as a stranded narrow table beside the other two groups.
            expect(Math.abs(threeColumnWidth - legacyWidth)).toBeLessThanOrEqual(2);
            expect(Math.abs(legacyWidth - layout.sociabilityTableWidth)).toBeLessThanOrEqual(2);
        }
    });
});
