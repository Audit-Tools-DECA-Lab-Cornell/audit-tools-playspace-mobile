import { describe, expect, it } from "vitest";

import { buildSociabilityCategoryRankings, type DomainReportRow } from "lib/audit/report-helpers";
import type { AuditScoreTotals } from "lib/audit/types";

function totals(breakdown: AuditScoreTotals["sociability_breakdown"]): AuditScoreTotals {
    return {
        provision_total: 0,
        provision_total_max: 0,
        variety_total: 0,
        variety_total_max: 0,
        challenge_total: 0,
        challenge_total_max: 0,
        sociability_total: 0,
        sociability_total_max: 0,
        sociability_breakdown: breakdown,
        play_value_total: 0,
        play_value_total_max: 0,
        usability_total: 0,
        usability_total_max: 0,
    };
}

function breakdown(
    playAlone: [number, number],
    smallGroup: [number, number],
    largeGroup: [number, number],
): NonNullable<AuditScoreTotals["sociability_breakdown"]> {
    return {
        model: "multi_select_v1",
        play_alone: { total: playAlone[0], max: playAlone[1] },
        small_group: { total: smallGroup[0], max: smallGroup[1] },
        large_group: { total: largeGroup[0], max: largeGroup[1] },
        captured_question_count: 1,
        eligible_question_count: 1,
    };
}

function domain(domainTitle: string, scoreTotals: AuditScoreTotals): DomainReportRow {
    return { domainTitle, scoreTotals } as DomainReportRow;
}

describe("Sociability domain rankings", () => {
    it("ranks each opportunity independently by share of its own maximum", () => {
        const rankings = buildSociabilityCategoryRankings([
            domain("Pathways", totals(breakdown([4, 4], [1, 4], [2, 4]))),
            domain("Seating", totals(breakdown([1, 2], [2, 2], [0, 2]))),
        ]);

        const playAlone = rankings.find((entry) => entry.categoryKey === "play_alone");
        const smallGroup = rankings.find((entry) => entry.categoryKey === "small_group");

        expect(playAlone?.bestDomains[0]?.domainTitle).toBe("Pathways");
        expect(playAlone?.bestDomains[0]?.percent).toBe(100);
        expect(playAlone?.worstDomains[0]?.domainTitle).toBe("Seating");
        expect(smallGroup?.bestDomains[0]?.domainTitle).toBe("Seating");
        expect(smallGroup?.worstDomains[0]?.domainTitle).toBe("Pathways");
    });

    it("lists every tied domain instead of only the first match", () => {
        const playAlone = buildSociabilityCategoryRankings([
            domain("Pathways", totals(breakdown([1, 2], [0, 2], [0, 2]))),
            domain("Seating", totals(breakdown([2, 4], [2, 2], [0, 2]))),
            domain("Planting", totals(breakdown([0, 2], [1, 2], [0, 2]))),
        ]).find((entry) => entry.categoryKey === "play_alone");

        expect(playAlone?.bestDomains.map((entry) => entry.domainTitle)).toEqual(["Pathways", "Seating"]);
        expect(playAlone?.worstDomains.map((entry) => entry.domainTitle)).toEqual(["Planting"]);
        expect(playAlone?.hasSufficientData).toBe(true);
        expect(playAlone?.allTied).toBe(false);
    });

    it("reports insufficient data rather than naming one domain both highest and lowest", () => {
        const playAlone = buildSociabilityCategoryRankings([
            domain("Pathways", totals(breakdown([1, 2], [0, 0], [0, 0]))),
            domain("Seating", totals(breakdown([0, 0], [1, 2], [0, 0]))),
        ]).find((entry) => entry.categoryKey === "play_alone");

        expect(playAlone?.comparableDomainCount).toBe(1);
        expect(playAlone?.hasSufficientData).toBe(false);
        expect(playAlone?.bestDomains[0]?.domainTitle).toBe("Pathways");
    });

    it("excludes zero-maximum domains instead of reporting them as 0%", () => {
        for (const ranking of buildSociabilityCategoryRankings([
            domain("Pathways", totals(breakdown([0, 0], [0, 0], [0, 0]))),
            domain("Seating", totals(breakdown([0, 0], [0, 0], [0, 0]))),
        ])) {
            expect(ranking.comparableDomainCount).toBe(0);
            expect(ranking.hasSufficientData).toBe(false);
            expect(ranking.bestDomain).toBeNull();
        }
    });

    it("flags an all-tied opportunity so no arbitrary winner is shown", () => {
        const playAlone = buildSociabilityCategoryRankings([
            domain("Pathways", totals(breakdown([1, 2], [0, 2], [0, 2]))),
            domain("Seating", totals(breakdown([2, 4], [0, 2], [0, 2]))),
        ]).find((entry) => entry.categoryKey === "play_alone");

        expect(playAlone?.allTied).toBe(true);
        expect(playAlone?.bestDomains).toHaveLength(2);
        expect(playAlone?.worstDomains).toHaveLength(2);
    });

    it("contributes nothing for legacy rows that never captured a breakdown", () => {
        for (const ranking of buildSociabilityCategoryRankings([
            domain("Pathways", totals(null)),
            domain("Seating", totals(null)),
        ])) {
            expect(ranking.comparableDomainCount).toBe(0);
            expect(ranking.hasSufficientData).toBe(false);
        }
    });
});
