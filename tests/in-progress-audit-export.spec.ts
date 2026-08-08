import { describe, expect, it } from "vitest";

import { auditSessionSchema, playspaceInstrumentSchema } from "lib/audit/types";
import { buildInProgressAuditXlsxBase64 } from "lib/exports/audits/excel";
import {
    buildInProgressAuditResponseRows,
    buildInProgressAuditWorkbook,
    buildInProgressOverviewRows,
} from "lib/exports/audits/row-builders";
import { UNANSWERED_PLACEHOLDER } from "lib/exports/audits/types";

const instrument = playspaceInstrumentSchema.parse({
    instrument_key: "pvua_v5_2",
    instrument_name: "PVUA",
    instrument_version: "5.2",
    current_sheet: "Sheet1",
    source_files: [],
    preamble: [],
    execution_modes: [
        {
            key: "audit",
            label: "Audit",
            description: null,
        },
    ],
    pre_audit_questions: [
        {
            key: "place_size",
            label: "Approximate size of the playspace",
            input_type: "single_select",
            required: true,
            page_key: "space_setup",
            options: [{ key: "large", label: "Large" }],
        },
        {
            key: "current_users_6_12",
            label: "Current users aged 6-12",
            input_type: "single_select",
            required: false,
            page_key: "space_setup",
            options: [{ key: "a_few", label: "A few" }],
        },
        {
            key: "weather_conditions",
            label: "Weather during the audit",
            input_type: "multi_select",
            required: false,
            page_key: "space_setup",
            options: [{ key: "cloudy_overcast", label: "Cloudy / overcast" }],
        },
    ],
    scale_guidance: [],
    sections: [
        {
            section_key: "section_13_natural_play_features",
            title: "Natural Play Features",
            description: null,
            instruction: "Read each statement.",
            notes_prompt: null,
            questions: [
                {
                    question_key: "q_13_1",
                    mode: "audit",
                    constructs: ["play_value"],
                    domains: ["Natural Play Features"],
                    section_key: "section_13_natural_play_features",
                    prompt: "This playspace has climbable vegetation.",
                    question_type: "scaled",
                    required: true,
                    display_if: null,
                    notes_prompt: null,
                    options: [],
                    scales: [
                        {
                            key: "provision",
                            title: "Provision",
                            prompt: "How much is provided?",
                            options: [
                                {
                                    key: "a_lot",
                                    label: "A lot",
                                    addition_value: 2,
                                    boost_value: 2,
                                    allows_follow_up_scales: true,
                                    is_not_applicable: false,
                                },
                            ],
                        },
                    ],
                },
                {
                    question_key: "q_13_2",
                    mode: "audit",
                    constructs: ["play_value"],
                    domains: ["Natural Play Features"],
                    section_key: "section_13_natural_play_features",
                    prompt: "Unanswered question for the partial case.",
                    question_type: "scaled",
                    required: true,
                    display_if: null,
                    notes_prompt: null,
                    options: [],
                    scales: [
                        {
                            key: "provision",
                            title: "Provision",
                            prompt: "How much is provided?",
                            options: [
                                {
                                    key: "a_little",
                                    label: "A little",
                                    addition_value: 1,
                                    boost_value: 1,
                                    allows_follow_up_scales: true,
                                    is_not_applicable: false,
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
    legal_documents: [],
});

const inProgressAuditSession = auditSessionSchema.parse({
    audit_id: "11111111-1111-4111-8111-111111111111",
    audit_code: "AUD-001",
    project_id: "22222222-2222-4222-8222-222222222222",
    project_name: "Project Alpha",
    place_id: "33333333-3333-4333-8333-333333333333",
    place_name: "Place Alpha",
    place_type: "Public Playspace",
    allowed_execution_modes: ["audit"],
    selected_execution_mode: "audit",
    status: "IN_PROGRESS",
    instrument_key: "pvua_v5_2",
    instrument_version: "5.2",
    instrument,
    schema_version: 1,
    revision: 3,
    started_at: "2026-05-01T12:00:00.000Z",
    submitted_at: null,
    total_minutes: null,
    meta: {
        execution_mode: "audit",
    },
    pre_audit: {
        place_size: "large",
        current_users_0_5: null,
        current_users_6_12: "a_few",
        current_users_13_17: null,
        current_users_18_plus: null,
        playspace_busyness: null,
        season: null,
        weather_conditions: ["cloudy_overcast"],
        wind_conditions: null,
    },
    sections: {
        section_13_natural_play_features: {
            section_key: "section_13_natural_play_features",
            note: null,
            responses: {
                q_13_1: {
                    provision: "a_lot",
                },
            },
        },
    },
    scores: {
        draft_progress_percent: 50,
        execution_mode: "audit",
        audit: null,
        survey: null,
        overall: null,
        by_section: {},
        by_domain: {},
    },
    progress: {
        required_pre_audit_complete: false,
        visible_section_count: 1,
        completed_section_count: 0,
        total_visible_questions: 2,
        answered_visible_questions: 1,
        ready_to_submit: false,
        sections: [
            {
                section_key: "section_13_natural_play_features",
                title: "Natural Play Features",
                visible_question_count: 2,
                answered_question_count: 1,
                is_complete: false,
            },
        ],
    },
});

describe("in-progress audit export", () => {
    it("includes final comments in the overview when present", () => {
        const auditSession = auditSessionSchema.parse({
            ...inProgressAuditSession,
            meta: {
                ...inProgressAuditSession.meta,
                final_comments: "Watch drainage near the north entry after heavy rain.",
            },
            aggregate: {
                ...inProgressAuditSession.aggregate,
                meta: {
                    ...inProgressAuditSession.aggregate.meta,
                    final_comments: "Watch drainage near the north entry after heavy rain.",
                },
            },
        });

        const rows = buildInProgressOverviewRows(
            {
                auditSession,
                context: null,
                auditorProfile: null,
            },
            instrument,
        );

        expect(rows).toContainEqual(["Final Comments", "Watch drainage near the north entry after heavy rain."]);
    });

    it("includes a progress row in the overview using the live progress totals", () => {
        const rows = buildInProgressOverviewRows(
            {
                auditSession: inProgressAuditSession,
                context: null,
                auditorProfile: null,
            },
            instrument,
        );

        expect(rows).toEqual(expect.arrayContaining([["Questions Answered", "1 of 2"]]));
        expect(rows).toEqual(expect.arrayContaining([["Status", "In progress"]]));
    });

    it("emits answered scale cells verbatim and flags unanswered scale cells with the placeholder", () => {
        const rows = buildInProgressAuditResponseRows(
            {
                auditSession: inProgressAuditSession,
                context: null,
                auditorProfile: null,
            },
            instrument,
        );

        const answeredRow = rows.find((row) => row[0] === "13.1");
        expect(answeredRow?.[5]).toContain("A lot");

        const unansweredRow = rows.find((row) => row[0] === "13.2");
        expect(unansweredRow?.[5]).toBe(UNANSWERED_PLACEHOLDER);
        expect(unansweredRow?.[6]).toBe(UNANSWERED_PLACEHOLDER);
    });

    it("includes the unanswered placeholder in the XLSX payload so downstream styling can target it", () => {
        const workbook = buildInProgressAuditWorkbook(
            {
                auditSession: inProgressAuditSession,
                context: null,
                auditorProfile: null,
            },
            instrument,
        );
        const base64 = buildInProgressAuditXlsxBase64(workbook);
        const decoded = Buffer.from(base64, "base64").toString("binary");
        expect(decoded).toContain(UNANSWERED_PLACEHOLDER);
    });

    it("uses an in-progress prefix in the workbook file base name", () => {
        const workbook = buildInProgressAuditWorkbook(
            {
                auditSession: inProgressAuditSession,
                context: null,
                auditorProfile: null,
            },
            instrument,
        );

        expect(workbook.fileBaseName.startsWith("pvua-in-progress-")).toBe(true);
        expect(workbook.tables.map((table) => table.name)).toEqual(["SpaceAudit", "Overview", "PreAudit", "Responses"]);
        expect(workbook.tables.find((table) => table.name === "SpaceAudit")?.rows).toEqual([
            ["Question", "Recorded Answer"],
            ["Approximate size of the playspace", "Large"],
            ["Current users aged 6-12", "A few"],
            ["Weather during the audit", "Cloudy / overcast"],
        ]);
    });

    it("includes mode-specific questions when the audit was executed in 'both' mode", () => {
        const bothModeSession = auditSessionSchema.parse({
            ...inProgressAuditSession,
            allowed_execution_modes: ["both"],
            selected_execution_mode: "both",
            meta: { execution_mode: "both" },
            sections: {
                section_13_natural_play_features: {
                    section_key: "section_13_natural_play_features",
                    note: null,
                    responses: {
                        q_13_1: { provision: "a_lot" },
                    },
                },
            },
        });

        const rows = buildInProgressAuditResponseRows(
            {
                auditSession: bothModeSession,
                context: null,
                auditorProfile: null,
            },
            instrument,
        );

        const answeredRow = rows.find((row) => row[0] === "13.1");
        expect(answeredRow).toBeDefined();
        expect(answeredRow?.[5]).toContain("A lot");
    });
});
