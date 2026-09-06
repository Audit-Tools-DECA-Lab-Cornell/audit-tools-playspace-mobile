import { describe, expect, it } from "vitest";

import {
    buildDomainReportRows,
    buildSociabilityCategoryRankings,
    getSociabilityBreakdownCoverage,
    type DomainReportRow,
} from "lib/audit/report-helpers";
import { calculateQuestionScores } from "lib/audit/score-helpers";
import { buildInProgressAuditResponseRows, buildInProgressAuditWorkbook } from "lib/exports/audits/row-builders";
import { IN_PROGRESS_RESPONSE_HEADERS } from "lib/exports/audits/types";
import { buildWorkbookCsvText, buildXlsxWorkbookBase64 } from "lib/exports/reports/excel";
import { buildSingleAuditResponseRows, buildSingleAuditWorkbook } from "lib/exports/reports/row-builders";
import {
    PREVIEW_RESPONSE_COLUMN_INDEXES,
    SINGLE_RESPONSE_HEADERS,
    type ExportableAudit,
} from "lib/exports/reports/types";

import { buildSociabilityInstrument, buildSociabilitySession } from "./support/sociability-fixtures";

function exportable(selectionMode: "single" | "multiple"): ExportableAudit {
    const answers =
        selectionMode === "multiple"
            ? { provision: "some", sociability: ["play_alone", "large_group"] }
            : { provision: "some", sociability: "more_than_two" };
    const session = buildSociabilitySession(answers, selectionMode);
    const targetQuestion = session.instrument?.sections[0]?.questions[0];
    if (targetQuestion === undefined) {
        throw new Error("Expected fixture question.");
    }
    const totals = calculateQuestionScores(targetQuestion, answers);

    return {
        auditSession: {
            ...session,
            scores: {
                ...session.scores,
                audit: totals,
                overall: totals,
                by_section: { section_a: totals },
                by_domain: { Movement: totals },
            },
        },
        context: null,
        auditorProfile: null,
    };
}

function findQuestionRow(rows: readonly (readonly (string | number)[])[]): readonly (string | number)[] {
    const row = rows.find((candidate) => candidate[1] === "Audit");
    if (row === undefined) {
        throw new Error("Expected response question row.");
    }
    return row;
}

describe("Sociability report data", () => {
    it("exposes captured category selections without inventing category values for scalar sessions", () => {
        const multiple = exportable("multiple");
        const legacy = exportable("single");
        const multipleQuestion = buildDomainReportRows(multiple.auditSession, buildSociabilityInstrument("multiple"))[0]
            ?.questions[0];
        const legacyQuestion = buildDomainReportRows(legacy.auditSession, buildSociabilityInstrument("single"))[0]
            ?.questions[0];

        expect(multipleQuestion?.sociabilityCapturedAsMultiselect).toBe(true);
        expect(multipleQuestion?.sociabilitySelections).toEqual({
            play_alone: true,
            small_group: false,
            large_group: true,
        });
        expect(legacyQuestion?.sociabilityCapturedAsMultiselect).toBe(false);
        expect(legacyQuestion?.sociabilitySelections).toEqual({
            play_alone: null,
            small_group: null,
            large_group: null,
        });
    });

    it("ranks each captured category independently and excludes legacy-only domains", () => {
        const multipleTotals = exportable("multiple").auditSession.scores.overall;
        const legacyTotals = exportable("single").auditSession.scores.overall;
        const rows: DomainReportRow[] = [
            {
                domainKey: "movement",
                domainTitle: "Movement",
                scoreTotals: multipleTotals,
                itemCount: 1,
                sectionNotes: [],
                commentOnlyNotes: [],
                filteredOutQuestionCount: 0,
                questions: [],
            },
            {
                domainKey: "nature",
                domainTitle: "Nature",
                scoreTotals: legacyTotals,
                itemCount: 1,
                sectionNotes: [],
                commentOnlyNotes: [],
                filteredOutQuestionCount: 0,
                questions: [],
            },
        ];

        const rankings = buildSociabilityCategoryRankings(rows);
        expect(rankings.map((ranking) => ranking.categoryKey)).toEqual(["play_alone", "small_group", "large_group"]);
        expect(rankings[0]?.bestDomain?.domainTitle).toBe("Movement");
        expect(rankings[1]?.bestDomain?.score).toBe(0);
        expect(rankings.every((ranking) => ranking.bestDomain?.domainTitle !== "Nature")).toBe(true);
        expect(getSociabilityBreakdownCoverage(multipleTotals)).toEqual({
            capturedQuestionCount: 1,
            eligibleQuestionCount: 1,
            isComplete: true,
        });
        expect(getSociabilityBreakdownCoverage(legacyTotals)).toBeNull();
    });
});

describe("Sociability production export rows", () => {
    it("keeps the on-screen response preview on its existing nine-column semantics", () => {
        expect(PREVIEW_RESPONSE_COLUMN_INDEXES).toEqual([0, 1, 2, 3, 6, 7, 8, 9, 13]);
        expect(PREVIEW_RESPONSE_COLUMN_INDEXES.map((columnIndex) => SINGLE_RESPONSE_HEADERS[columnIndex])).toEqual([
            "Question Key",
            "Mode",
            "Constructs",
            "Domain",
            "Prompt",
            "Provision",
            "Variety",
            "Sociability",
            "Challenge",
        ]);
    });

    it("retains aggregate Sociability and adds three structural columns in submitted CSV/XLSX data", () => {
        const submitted = exportable("multiple");
        const instrument = buildSociabilityInstrument("multiple");
        const workbook = buildSingleAuditWorkbook(submitted, instrument);
        const rows = buildSingleAuditResponseRows(submitted, instrument);
        const questionRow = findQuestionRow(rows);

        expect(SINGLE_RESPONSE_HEADERS).toHaveLength(16);
        expect(SINGLE_RESPONSE_HEADERS.slice(9, 13)).toEqual([
            "Sociability",
            "Sociability - Play alone",
            "Sociability - Small group",
            "Sociability - Large group",
        ]);
        expect(questionRow).toHaveLength(16);
        expect(questionRow[9]).toContain("Play on their own");
        expect(questionRow.slice(10, 13)).toEqual(["Selected", "Not selected", "Selected"]);

        const rawSummary = rows.find((row) => row[0] === "Overall Total");
        expect(rawSummary?.slice(9, 13)).toEqual([2, 1, 0, 1]);
        expect(buildWorkbookCsvText(workbook)).toContain('"Sociability - Play alone"');
        expect(buildXlsxWorkbookBase64(workbook).length).toBeGreaterThan(100);
    });

    it("keeps the legacy scalar value and marks only the structural columns as not captured", () => {
        const submitted = exportable("single");
        const instrument = buildSociabilityInstrument("single");
        const questionRow = findQuestionRow(buildSingleAuditResponseRows(submitted, instrument));

        expect(questionRow[9]).toContain("more than two children");
        expect(questionRow.slice(10, 13)).toEqual(["Not captured", "Not captured", "Not captured"]);
        const workbook = buildSingleAuditWorkbook(submitted, instrument);
        const responses = workbook.tables.find((table) => table.name === "Responses");
        expect(responses?.columnWidths).toHaveLength(16);
    });

    it("uses the same aggregate-plus-three-column contract for in-progress raw rows", () => {
        const submitted = exportable("multiple");
        const instrument = buildSociabilityInstrument("multiple");
        const inProgress = {
            auditSession: submitted.auditSession,
            context: submitted.context,
            auditorProfile: submitted.auditorProfile,
        };
        const rows = buildInProgressAuditResponseRows(inProgress, instrument);
        const questionRow = findQuestionRow(rows);

        expect(IN_PROGRESS_RESPONSE_HEADERS).toHaveLength(12);
        expect(IN_PROGRESS_RESPONSE_HEADERS.slice(7, 11)).toEqual([
            "Sociability",
            "Sociability - Play alone",
            "Sociability - Small group",
            "Sociability - Large group",
        ]);
        expect(questionRow).toHaveLength(12);
        expect(questionRow.slice(8, 11)).toEqual(["Selected", "Not selected", "Selected"]);
        const responses = buildInProgressAuditWorkbook(inProgress, instrument).tables.find(
            (table) => table.name === "Responses",
        );
        expect(responses?.columnWidths).toHaveLength(12);
    });
});
