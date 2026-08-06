import { auditSessionSchema, playspaceInstrumentSchema } from "lib/audit/types";
import type { AuditSession, PlayspaceInstrument, QuestionResponsePayload } from "lib/audit/types";

export function buildSociabilityInstrument(selectionMode: "single" | "multiple" = "multiple"): PlayspaceInstrument {
    const sociabilityOptions =
        selectionMode === "multiple"
            ? [
                  { key: "play_alone", label: "Play on their own" },
                  { key: "small_group", label: "Play together in a small group" },
                  { key: "large_group", label: "Play together in a larger group" },
              ]
            : [
                  { key: "no", label: "No", addition_value: 0 },
                  { key: "a_pair", label: "Yes - a pair", addition_value: 2 },
                  { key: "more_than_two", label: "Yes - more than two children", addition_value: 3 },
              ];

    return playspaceInstrumentSchema.parse({
        instrument_key: "pvua_sociability_test",
        instrument_name: "Sociability test instrument",
        instrument_version: selectionMode === "multiple" ? "5.32" : "5.31",
        current_sheet: "Test",
        source_files: [],
        preamble: [],
        execution_modes: [{ key: "audit", label: "Audit", description: null }],
        pre_audit_questions: [],
        scale_guidance: [],
        sections: [
            {
                section_key: "section_a",
                title: "Section A",
                description: null,
                instruction: "Rate the feature.",
                notes_prompt: null,
                questions: [
                    {
                        question_key: "q1",
                        mode: "audit",
                        constructs: ["play_value"],
                        domains: ["Movement"],
                        section_key: "section_a",
                        prompt: "A play feature",
                        question_type: "scaled",
                        scales: [
                            {
                                key: "provision",
                                title: "Provision",
                                prompt: "Is it available?",
                                options: [
                                    {
                                        key: "no",
                                        label: "No",
                                        addition_value: 0,
                                        boost_value: 0,
                                        allows_follow_up_scales: false,
                                    },
                                    {
                                        key: "some",
                                        label: "Some",
                                        addition_value: 1,
                                        boost_value: 1,
                                        allows_follow_up_scales: true,
                                    },
                                    {
                                        key: "not_applicable",
                                        label: "Not applicable",
                                        addition_value: 0,
                                        boost_value: 1,
                                        allows_follow_up_scales: false,
                                        is_not_applicable: true,
                                    },
                                    {
                                        key: "unsure",
                                        label: "Unsure",
                                        addition_value: 0,
                                        boost_value: 1,
                                        allows_follow_up_scales: false,
                                        is_unsure: true,
                                    },
                                ],
                            },
                            {
                                key: "sociability",
                                title: "Sociability",
                                prompt: "Does this feature provide opportunities?",
                                selection_mode: selectionMode,
                                options: sociabilityOptions.map((option) => ({
                                    addition_value: 1,
                                    boost_value: 1,
                                    allows_follow_up_scales: false,
                                    ...option,
                                })),
                            },
                        ],
                        options: [],
                        required: true,
                        display_if: null,
                        notes_prompt: null,
                    },
                ],
            },
        ],
        legal_documents: [],
    });
}

export function buildSociabilitySession(
    answers: QuestionResponsePayload = {},
    selectionMode: "single" | "multiple" = "multiple",
    revision = 1,
): AuditSession {
    const instrument = buildSociabilityInstrument(selectionMode);
    const responses = Object.keys(answers).length === 0 ? {} : { q1: answers };
    const preAudit = {
        place_size: null,
        current_users_0_5: null,
        current_users_6_12: null,
        current_users_13_17: null,
        current_users_18_plus: null,
        playspace_busyness: null,
        season: null,
        weather_conditions: [],
        wind_conditions: null,
    };
    const section = { section_key: "section_a", note: null, responses };

    return auditSessionSchema.parse({
        audit_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        audit_code: "SOC-001",
        project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        project_name: "Project",
        place_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        place_name: "Place",
        place_type: "Public Playspace",
        allowed_execution_modes: ["audit"],
        selected_execution_mode: "audit",
        status: "IN_PROGRESS",
        instrument_key: instrument.instrument_key,
        instrument_version: instrument.instrument_version,
        instrument,
        schema_version: 1,
        revision,
        aggregate: {
            schema_version: 1,
            revision,
            meta: { execution_mode: "audit", final_comments: null },
            pre_audit: preAudit,
            sections: { section_a: section },
        },
        started_at: "2026-08-06T12:00:00.000Z",
        submitted_at: null,
        total_minutes: null,
        meta: { execution_mode: "audit", final_comments: null },
        pre_audit: preAudit,
        sections: { section_a: section },
        scores: {
            draft_progress_percent: 0,
            execution_mode: "audit",
            audit: null,
            survey: null,
            overall: null,
            by_section: {},
            by_domain: {},
        },
        progress: {
            required_pre_audit_complete: true,
            visible_section_count: 1,
            completed_section_count: 0,
            total_visible_questions: 1,
            answered_visible_questions: 0,
            ready_to_submit: false,
            sections: [
                {
                    section_key: "section_a",
                    title: "Section A",
                    visible_question_count: 1,
                    answered_question_count: 0,
                    is_complete: false,
                },
            ],
        },
    });
}
