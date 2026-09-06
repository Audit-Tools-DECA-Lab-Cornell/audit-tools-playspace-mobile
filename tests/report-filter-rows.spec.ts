import { describe, expect, it } from "vitest";

import { createDefaultReportFilter, setDomainOverride, setOverallSelection } from "lib/audit/report-filter";
import { buildDomainReportRows, buildReportScoreProjection, sumDomainScoreTotals } from "lib/audit/report-helpers";
import { auditSessionSchema, playspaceInstrumentSchema } from "lib/audit/types";
import { buildSingleAuditPdfHtml } from "lib/exports/reports/pdf";
import {
    buildBulkAuditWorkbook,
    buildOverviewRows,
    buildSingleAuditResponseHeaders,
    buildSingleAuditResponseRows,
    buildSingleAuditWorkbook,
} from "lib/exports/reports/row-builders";
import { COMMENT_ROW_SENTINEL } from "lib/exports/reports/types";

const PLAY_VALUE_ONLY = { playValue: true, usability: false };
const USABILITY_ONLY = { playValue: false, usability: true };

function provisionScale() {
    return {
        key: "provision",
        title: "Provision",
        prompt: "Provision",
        options: [
            {
                key: "a_lot",
                label: "A lot",
                addition_value: 2,
                boost_value: 1,
                allows_follow_up_scales: true,
                is_not_applicable: false,
            },
            {
                key: "no",
                label: "No",
                addition_value: 0,
                boost_value: 0,
                allows_follow_up_scales: false,
                is_not_applicable: false,
            },
        ],
    };
}

function scaledQuestion(questionKey: string, constructs: string[], domains: string[]) {
    return {
        question_key: questionKey,
        mode: "audit",
        constructs,
        domains,
        section_key: "section_mixed",
        prompt: `Scaled question ${questionKey}`,
        question_type: "scaled",
        required: true,
        display_if: null,
        notes_prompt: null,
        options: [],
        scales: [provisionScale()],
    };
}

/** Construct-less checklist follow-up; inherits domain and constructs from its parent. */
function checklistFollowUp(questionKey: string, parentQuestionKey: string) {
    return {
        question_key: questionKey,
        mode: "audit",
        constructs: [],
        domains: [],
        section_key: "section_mixed",
        prompt: `Checklist ${questionKey}`,
        question_type: "checklist",
        required: false,
        display_if: {
            question_key: parentQuestionKey,
            response_key: "provision",
            any_of_option_keys: ["a_lot"],
        },
        notes_prompt: null,
        options: [
            { key: "opt_a", label: "Option A" },
            { key: "opt_b", label: "Option B" },
        ],
        scales: [],
    };
}

function buildInstrument() {
    return playspaceInstrumentSchema.parse({
        instrument_key: "pvua-v-test",
        instrument_name: "PVUA",
        instrument_version: "5.2",
        current_sheet: "sheet-1",
        source_files: ["instrument.json"],
        preamble: [],
        execution_modes: [{ key: "audit", label: "Place Audit", description: null }],
        pre_audit_questions: [],
        scale_guidance: [],
        sections: [
            {
                section_key: "section_mixed",
                title: "Mixed",
                description: "Mixed section",
                instruction: "Answer the questions",
                notes_prompt: null,
                questions: [
                    scaledQuestion("q_pv", ["play_value"], ["movement"]),
                    scaledQuestion("q_u", ["usability"], ["movement"]),
                    checklistFollowUp("q_pv_1", "q_pv"),
                    scaledQuestion("q_dual", ["play_value", "usability"], ["seating"]),
                ],
            },
        ],
    });
}

function buildScoreTotals() {
    return {
        provision_total: 4,
        provision_total_max: 4,
        variety_total: 0,
        variety_total_max: 0,
        challenge_total: 0,
        challenge_total_max: 0,
        sociability_total: 0,
        sociability_total_max: 0,
        sociability_breakdown: null,
        play_value_total: 2,
        play_value_total_max: 2,
        usability_total: 2,
        usability_total_max: 2,
    };
}

function buildAuditSession() {
    const totals = buildScoreTotals();
    return auditSessionSchema.parse({
        audit_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        audit_code: "AUDIT-FILTER-001",
        project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        project_name: "Project Alpha",
        place_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        place_name: "Place One",
        place_type: "Public Playspace",
        allowed_execution_modes: ["audit"],
        selected_execution_mode: "audit",
        status: "SUBMITTED",
        instrument_key: "pvua-v-test",
        instrument_version: "5.2",
        started_at: "2026-05-01T12:00:00.000Z",
        submitted_at: "2026-05-01T12:30:00.000Z",
        total_minutes: 30,
        meta: { execution_mode: "audit", final_comments: null },
        pre_audit: {
            place_size: null,
            current_users_0_5: null,
            current_users_6_12: null,
            current_users_13_17: null,
            current_users_18_plus: null,
            playspace_busyness: null,
            season: null,
            weather_conditions: [],
            wind_conditions: null,
        },
        sections: {
            section_mixed: {
                section_key: "section_mixed",
                note: null,
                responses: {
                    q_pv: { provision: "a_lot" },
                    q_u: { provision: "a_lot" },
                    q_pv_1: { selected_option_keys: ["opt_a"] },
                    q_dual: { provision: "a_lot" },
                },
            },
        },
        scores: {
            draft_progress_percent: 100,
            execution_mode: "audit",
            audit: totals,
            survey: null,
            overall: totals,
            by_section: { section_mixed: totals },
            by_domain: { movement: totals, seating: totals },
        },
        progress: {
            required_pre_audit_complete: true,
            visible_section_count: 1,
            completed_section_count: 1,
            total_visible_questions: 4,
            answered_visible_questions: 4,
            ready_to_submit: true,
            sections: [
                {
                    section_key: "section_mixed",
                    title: "Mixed",
                    visible_question_count: 4,
                    answered_question_count: 4,
                    is_complete: true,
                },
            ],
        },
    });
}

function questionKeysFor(domainKey: string, rows: ReturnType<typeof buildDomainReportRows>): string[] {
    return (rows.find((row) => row.domainKey === domainKey)?.questions ?? []).map((row) => row.questionKey).sort();
}

describe("buildDomainReportRows construct filtering", () => {
    it("produces identical rows with no options and with the default filter", () => {
        const instrument = buildInstrument();
        const auditSession = buildAuditSession();

        const withoutOptions = buildDomainReportRows(auditSession, instrument, auditSession.scores);
        const withDefaultFilter = buildDomainReportRows(auditSession, instrument, auditSession.scores, {
            filter: createDefaultReportFilter(),
        });

        expect(withDefaultFilter).toEqual(withoutOptions);
    });

    it("passes backend domain totals through when nothing is filtered", () => {
        const instrument = buildInstrument();
        const auditSession = buildAuditSession();

        const rows = buildDomainReportRows(auditSession, instrument, auditSession.scores, {
            filter: createDefaultReportFilter(),
        });

        expect(rows.find((row) => row.domainKey === "movement")?.scoreTotals).toEqual(
            auditSession.scores.by_domain.movement,
        );
    });

    it("drops usability questions from a play-value-only report and keeps dual ones", () => {
        const instrument = buildInstrument();
        const auditSession = buildAuditSession();
        const filter = setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY);

        const rows = buildDomainReportRows(auditSession, instrument, auditSession.scores, { filter });

        expect(questionKeysFor("movement", rows)).toEqual(["q_pv", "q_pv_1"]);
        expect(questionKeysFor("seating", rows)).toEqual(["q_dual"]);
    });

    it("drops a play-value question and its checklist follow-up from a usability-only report", () => {
        const instrument = buildInstrument();
        const auditSession = buildAuditSession();
        const filter = setOverallSelection(createDefaultReportFilter(), USABILITY_ONLY);

        const rows = buildDomainReportRows(auditSession, instrument, auditSession.scores, { filter });

        expect(questionKeysFor("movement", rows)).toEqual(["q_u"]);
    });

    it("recomputes filtered domain totals instead of reusing backend ones", () => {
        const instrument = buildInstrument();
        const auditSession = buildAuditSession();
        const filter = setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY);

        const movement = buildDomainReportRows(auditSession, instrument, auditSession.scores, { filter }).find(
            (row) => row.domainKey === "movement",
        );

        expect(movement?.scoreTotals?.provision_total).toBe(2);
        expect(movement?.scoreTotals?.play_value_total).toBe(2);
        expect(movement?.scoreTotals?.usability_total).toBe(0);
    });

    it("narrows only the overridden domain", () => {
        const instrument = buildInstrument();
        const auditSession = buildAuditSession();
        const filter = setDomainOverride(createDefaultReportFilter(), "movement", USABILITY_ONLY);

        const rows = buildDomainReportRows(auditSession, instrument, auditSession.scores, { filter });

        expect(questionKeysFor("movement", rows)).toEqual(["q_u"]);
        expect(rows.find((row) => row.domainKey === "seating")?.scoreTotals).toEqual(
            auditSession.scores.by_domain.seating,
        );
    });

    it("keeps construct-less content without manufacturing a zero score", () => {
        const baseInstrument = buildInstrument();
        const orphanChecklist = {
            ...checklistFollowUp("q_orphan", "q_missing"),
            domains: ["movement"],
            display_if: null,
        };
        const instrument = playspaceInstrumentSchema.parse({
            ...baseInstrument,
            sections: [
                {
                    ...baseInstrument.sections[0],
                    questions: [scaledQuestion("q_u", ["usability"], ["movement"]), orphanChecklist],
                },
            ],
        });
        const auditSession = buildAuditSession();
        const movement = buildDomainReportRows(auditSession, instrument, auditSession.scores, {
            filter: setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY),
        }).find((row) => row.domainKey === "movement");

        expect(movement?.itemCount).toBe(1);
        expect(movement?.scoreTotals).toBeNull();
        expect(movement?.questions.map((question) => question.questionKey)).toEqual(["q_orphan"]);
    });

    it("sums the domain buckets that remain into the overall total", () => {
        const instrument = buildInstrument();
        const auditSession = buildAuditSession();
        const filter = setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY);

        const rows = buildDomainReportRows(auditSession, instrument, auditSession.scores, { filter });
        const overall = sumDomainScoreTotals(rows);
        const expected = rows.reduce((sum, row) => sum + (row.scoreTotals?.play_value_total ?? 0), 0);

        expect(overall?.play_value_total).toBe(expected);
    });

    it("returns null when no domain carries a score", () => {
        expect(sumDomainScoreTotals([])).toBeNull();
    });

    it("recomputes audit and survey partitions after mode and display conditions are applied", () => {
        const hidden = {
            ...scaledQuestion("q_hidden", ["play_value"], ["movement"]),
            display_if: {
                question_key: "q_pv",
                response_key: "provision",
                any_of_option_keys: ["no"],
            },
        };
        const instrument = playspaceInstrumentSchema.parse({
            ...buildInstrument(),
            execution_modes: [{ key: "both", label: "Full assessment", description: null }],
            sections: [
                {
                    ...buildInstrument().sections[0],
                    questions: [
                        scaledQuestion("q_pv", ["play_value"], ["movement"]),
                        { ...scaledQuestion("q_u", ["usability"], ["movement"]), mode: "survey" },
                        { ...scaledQuestion("q_dual", ["play_value", "usability"], ["seating"]), mode: "both" },
                        hidden,
                    ],
                },
            ],
        });
        const auditSession = buildAuditSession();
        auditSession.selected_execution_mode = "both";
        auditSession.meta.execution_mode = "both";
        auditSession.aggregate.meta.execution_mode = "both";
        auditSession.scores.execution_mode = "both";
        auditSession.scores.survey = buildScoreTotals();
        const sectionResponses = auditSession.sections.section_mixed?.responses;
        if (sectionResponses === undefined) throw new Error("Missing test responses");
        sectionResponses.q_hidden = { provision: "a_lot" };

        const projection = buildReportScoreProjection(
            auditSession,
            instrument,
            setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY),
        );

        expect(projection.scoreBuckets.audit?.provision_total).toBe(4);
        expect(projection.scoreBuckets.survey?.provision_total).toBe(2);
        expect(projection.overall?.provision_total).toBe(4);
        expect(
            projection.domainRows.flatMap((row) => row.questions.map((question) => question.questionKey)),
        ).not.toContain("q_hidden");
    });

    it("keeps an unavailable mode partition null after filtering", () => {
        const baseInstrument = buildInstrument();
        const instrument = playspaceInstrumentSchema.parse({
            ...baseInstrument,
            sections: baseInstrument.sections.map((section) => ({
                ...section,
                questions: section.questions.map((question) =>
                    question.question_key === "q_dual" ? { ...question, mode: "both" } : question,
                ),
            })),
        });
        const projection = buildReportScoreProjection(
            buildAuditSession(),
            instrument,
            setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY),
        );

        expect(projection.scoreBuckets.audit?.provision_total).toBe(4);
        expect(projection.scoreBuckets.survey).toBeNull();
    });
});

describe("filtered report exports", () => {
    it("keeps the default workbook and PDF output identical when the default filter is explicit", () => {
        const instrument = buildInstrument();
        const auditSession = buildAuditSession();
        const unfiltered = { auditSession, context: null, auditorProfile: null };
        const withDefault = { ...unfiltered, resultFilter: createDefaultReportFilter() };

        expect(buildSingleAuditWorkbook(withDefault, instrument)).toEqual(
            buildSingleAuditWorkbook(unfiltered, instrument),
        );
        expect(buildSingleAuditPdfHtml(withDefault, instrument)).toBe(buildSingleAuditPdfHtml(unfiltered, instrument));
    });

    it("drops a globally disabled construct column and masks the dual-construct score", () => {
        const instrument = buildInstrument();
        const resultFilter = setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY);
        const exportableAudit = {
            auditSession: buildAuditSession(),
            context: null,
            auditorProfile: null,
            resultFilter,
        };

        expect(buildSingleAuditResponseHeaders(exportableAudit, instrument)).toEqual([
            "Question Key",
            "Mode",
            "Constructs",
            "Domain",
            "Domain Description",
            "Instructions",
            "Prompt",
            "Provision",
            "Variety",
            "Sociability",
            "Sociability - Play alone",
            "Sociability - Small group",
            "Sociability - Large group",
            "Challenge",
            "PV Score",
        ]);
        const dualRow = buildSingleAuditResponseRows(exportableAudit, instrument).find((row) => row[0] === "dual");
        expect(dualRow?.at(-1)).toBe(2);
        expect(buildSingleAuditPdfHtml(exportableAudit, instrument)).toContain("Results Included");
        expect(buildSingleAuditPdfHtml(exportableAudit, instrument)).not.toContain("U Score");
    });

    it("keeps both columns for mixed domain settings and leaves a disabled question cell empty", () => {
        const instrument = buildInstrument();
        const resultFilter = setDomainOverride(createDefaultReportFilter(), "movement", USABILITY_ONLY);
        const exportableAudit = {
            auditSession: buildAuditSession(),
            context: null,
            auditorProfile: null,
            resultFilter,
        };
        const headers = buildSingleAuditResponseHeaders(exportableAudit, instrument);
        const usabilityRow = buildSingleAuditResponseRows(exportableAudit, instrument).find((row) => row[0] === "u");

        expect(headers.slice(-2)).toEqual(["PV Score", "U Score"]);
        expect(usabilityRow?.[14]).toBe("");
        expect(usabilityRow?.[15]).toBe(2);
    });

    it("retains comments and section notes when their scored question is filtered out", () => {
        const instrument = playspaceInstrumentSchema.parse({
            ...buildInstrument(),
            sections: [
                {
                    section_key: "section_mixed",
                    title: "Mixed",
                    description: "Mixed section",
                    instruction: "Answer the questions",
                    notes_prompt: "Record context",
                    questions: [scaledQuestion("q_u", ["usability"], ["movement"])],
                },
            ],
        });
        const auditSession = buildAuditSession();
        const sectionState = auditSession.sections.section_mixed;
        if (sectionState === undefined) throw new Error("Missing test section");
        sectionState.note = "Keep this section note";
        sectionState.responses.q_u = { provision: "a_lot", question_note: "Keep this question comment" };
        const exportableAudit = {
            auditSession,
            context: null,
            auditorProfile: null,
            resultFilter: setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY),
        };
        const rows = buildSingleAuditResponseRows(exportableAudit, instrument);
        const overviewRows = buildOverviewRows(exportableAudit, instrument);
        const bulkOverview = buildBulkAuditWorkbook([exportableAudit], instrument, null).tables.find(
            (table) => table.name === "Overview",
        );
        const bulkSummaryIndex = bulkOverview?.rows[0]?.indexOf("Summary Score") ?? -1;

        expect(rows.some((row) => row[1] === COMMENT_ROW_SENTINEL && row[6] === "Keep this question comment")).toBe(
            true,
        );
        expect(rows.some((row) => row[0] === "Auditor Note: Keep this section note")).toBe(true);
        expect(rows.some((row) => row[2] === "Summary")).toBe(false);
        expect(overviewRows.find((row) => row[0] === "Summary Score")?.[1]).toBe("Pending");
        expect(bulkOverview?.rows[1]?.[bulkSummaryIndex]).toBe("Pending");
    });
});
