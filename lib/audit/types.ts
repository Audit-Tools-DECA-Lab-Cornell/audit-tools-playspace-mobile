import { z } from "zod";

export type DirtySections = Record<string, Record<string, number>>;
export type DirtyPreAudit = Record<string, number>;
export type DirtyMeta = Record<string, number>;
// One-shot flag per audit: set when the execute-time started_at stamp lands
// locally on a pristine draft and must be pushed to the backend on next sync.
export type DirtyStartedAt = Record<string, boolean>;

export const executionModeSchema = z.enum(["audit", "survey", "both"]);
export const auditStatusSchema = z.enum(["IN_PROGRESS", "PAUSED", "SUBMITTED"]);
export const questionModeSchema = z.enum(["audit", "survey", "both"]);
export const constructKeySchema = z.enum(["usability", "play_value"]);
export const scaleKeySchema = z.enum(["provision", "variety", "sociability", "challenge"]);
export const scaleSelectionModeSchema = z.enum(["single", "multiple"]);
export const preAuditInputTypeSchema = z.enum(["single_select", "multi_select", "auto_timestamp"]);
export const preAuditPageKeySchema = z.enum(["audit_info", "space_setup"]);
export const questionTypeSchema = z.enum(["scaled", "checklist"]);
export const playspaceTypeSchema = z.enum([
    "Public Playspace",
    "Pre-School Playspace",
    "Destination Playspace",
    "Nature Playspace",
    "Neighborhood Playspace",
    "Waterfront Playspace",
    "School Playspace",
]);

export const choiceOptionSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    description: z.string().nullable().optional(),
});

export const scaleOptionSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    addition_value: z.number(),
    boost_value: z.number(),
    allows_follow_up_scales: z.boolean(),
    is_not_applicable: z.boolean().optional().default(false),
    is_unsure: z.boolean().optional().default(false),
});

export const scaleDefinitionSchema = z.object({
    key: scaleKeySchema,
    title: z.string().min(1),
    prompt: z.string().min(1),
    description: z.string().min(1),
    selection_mode: scaleSelectionModeSchema.default("single"),
    options: z.array(scaleOptionSchema),
});

export const preAuditQuestionSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    description: z.string().nullable().optional(),
    input_type: preAuditInputTypeSchema,
    required: z.boolean(),
    options: z.array(choiceOptionSchema),
    page_key: preAuditPageKeySchema.default("space_setup"),
    visible_modes: z.array(executionModeSchema).default(["audit", "survey", "both"]),
    group_key: z.string().nullable().optional(),
});

export const questionScaleSchema = z.object({
    key: scaleKeySchema,
    title: z.string().min(1),
    prompt: z.string().min(1),
    selection_mode: scaleSelectionModeSchema.default("single"),
    options: z.array(scaleOptionSchema),
});

export const questionDisplayConditionSchema = z.object({
    question_key: z.string().min(1),
    response_key: z.string().min(1).default("provision"),
    any_of_option_keys: z.array(z.string()).default([]),
});

export const instrumentQuestionSchema = z.object({
    question_key: z.string().min(1),
    mode: questionModeSchema,
    constructs: z.array(constructKeySchema),
    domains: z.array(z.string()),
    section_key: z.string().min(1),
    prompt: z.string().min(1),
    question_type: questionTypeSchema.default("scaled"),
    scales: z.array(questionScaleSchema).default([]),
    options: z.array(choiceOptionSchema).default([]),
    required: z.boolean().default(true),
    display_if: questionDisplayConditionSchema.nullable().optional(),
    notes_prompt: z.string().nullable().optional(),
});

export const instrumentSectionSchema = z.object({
    section_key: z.string().min(1),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    instruction: z.string().min(1),
    notes_prompt: z.string().nullable().optional(),
    questions: z.array(instrumentQuestionSchema),
});

export const legalSectionSchema = z.object({
    key: z.string().min(1),
    title: z.string().min(1),
    body: z.array(z.string()),
    bullets: z.array(z.string()).default([]),
});

export const legalDocumentSchema = z.object({
    key: z.string().min(1),
    short_title: z.string().min(1),
    title: z.string().min(1),
    eyebrow: z.string().min(1),
    last_updated: z.string().min(1),
    summary: z.string().min(1),
    sections: z.array(legalSectionSchema),
});

export type LegalSection = z.infer<typeof legalSectionSchema>;
export type LegalDocument = z.infer<typeof legalDocumentSchema>;

export const playspaceInstrumentSchema = z.object({
    instrument_key: z.string().min(1),
    instrument_name: z.string().min(1),
    instrument_version: z.string().min(1),
    current_sheet: z.string().min(1),
    source_files: z.array(z.string()),
    preamble: z.array(z.string()),
    execution_modes: z.array(choiceOptionSchema),
    pre_audit_questions: z.array(preAuditQuestionSchema),
    scale_guidance: z.array(scaleDefinitionSchema),
    sections: z.array(instrumentSectionSchema),
    legal_documents: z.array(legalDocumentSchema).default([]),
});

export const auditSectionProgressSchema = z.object({
    section_key: z.string().min(1),
    title: z.string().min(1),
    visible_question_count: z.number().int().nonnegative(),
    answered_question_count: z.number().int().nonnegative(),
    is_complete: z.boolean(),
});

export const auditProgressSchema = z.object({
    required_pre_audit_complete: z.boolean(),
    visible_section_count: z.number().int().nonnegative(),
    completed_section_count: z.number().int().nonnegative(),
    total_visible_questions: z.number().int().nonnegative(),
    answered_visible_questions: z.number().int().nonnegative(),
    ready_to_submit: z.boolean(),
    sections: z.array(auditSectionProgressSchema),
});

export const auditMetaSchema = z.object({
    execution_mode: executionModeSchema.nullable(),
    final_comments: z.string().nullable().optional().default(null),
});

export const preAuditValuesSchema = z.object({
    place_size: z.string().nullable(),
    current_users_0_5: z.string().nullable(),
    current_users_6_12: z.string().nullable(),
    current_users_13_17: z.string().nullable(),
    current_users_18_plus: z.string().nullable(),
    playspace_busyness: z.string().nullable(),
    season: z.string().nullable(),
    weather_conditions: z.array(z.string()),
    wind_conditions: z.string().nullable(),
});

export const questionResponseValueSchema = z.union([
    z.string(),
    z.array(z.string()),
    z.record(z.string(), z.string()),
    z.null(),
]);

export const questionResponsePayloadSchema = z.record(
    z.string(),
    z.union([questionResponseValueSchema, z.string().nullable()]),
);

export const auditSectionStateSchema = z.object({
    section_key: z.string().min(1),
    responses: z.record(z.string(), questionResponsePayloadSchema),
    note: z.string().nullable(),
});

export const auditScoreTotalsSchema = z.object({
    provision_total: z.number(),
    provision_total_max: z.number(),
    variety_total: z.number(),
    variety_total_max: z.number(),
    challenge_total: z.number(),
    challenge_total_max: z.number(),
    sociability_total: z.number(),
    sociability_total_max: z.number(),
    sociability_breakdown: z
        .object({
            model: z.literal("multi_select_v1"),
            play_alone: z.object({ total: z.number(), max: z.number() }),
            small_group: z.object({ total: z.number(), max: z.number() }),
            large_group: z.object({ total: z.number(), max: z.number() }),
            captured_question_count: z.number().int().nonnegative(),
            eligible_question_count: z.number().int().nonnegative(),
        })
        .nullable()
        .optional()
        .default(null),
    play_value_total: z.number(),
    play_value_total_max: z.number(),
    usability_total: z.number(),
    usability_total_max: z.number(),
});

export const auditScoreVariantBucketsSchema = z.object({
    execution_mode: executionModeSchema.nullable().optional().default(null),
    audit: auditScoreTotalsSchema.nullable().optional().default(null),
    survey: auditScoreTotalsSchema.nullable().optional().default(null),
    overall: auditScoreTotalsSchema.nullable(),
    by_section: z.record(z.string(), auditScoreTotalsSchema).default({}),
    by_domain: z.record(z.string(), auditScoreTotalsSchema).default({}),
});

export const auditUnsureVariantsSchema = z.object({
    unsure_as_zero: auditScoreVariantBucketsSchema.nullable().optional().default(null),
    unsure_as_max: auditScoreVariantBucketsSchema.nullable().optional().default(null),
});

export const auditScoresSchema = z.object({
    draft_progress_percent: z.number().nullable(),
    execution_mode: executionModeSchema.nullable(),
    audit: auditScoreTotalsSchema.nullable().optional().default(null),
    survey: auditScoreTotalsSchema.nullable().optional().default(null),
    overall: auditScoreTotalsSchema.nullable(),
    by_section: z.record(z.string(), auditScoreTotalsSchema),
    by_domain: z.record(z.string(), auditScoreTotalsSchema),
    unsure_answer_count: z.number().int().nonnegative().optional().default(0),
    unsure_variants: auditUnsureVariantsSchema.nullable().optional().default(null),
});

export const auditAggregateSchema = z.object({
    schema_version: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    meta: auditMetaSchema,
    pre_audit: preAuditValuesSchema,
    sections: z.record(z.string(), auditSectionStateSchema),
});

const auditSessionPayloadSchema = z.object({
    audit_id: z.uuid(),
    audit_code: z.string().min(1),
    project_id: z.uuid(),
    project_name: z.string().min(1),
    place_id: z.uuid(),
    place_name: z.string().min(1),
    place_type: playspaceTypeSchema.nullable(),
    allowed_execution_modes: z.array(executionModeSchema),
    selected_execution_mode: executionModeSchema.nullable(),
    status: auditStatusSchema,
    instrument_key: z.string().min(1),
    instrument_version: z.string().min(1),
    instrument: playspaceInstrumentSchema.optional(),
    schema_version: z.number().int().positive().optional().default(1),
    revision: z.number().int().nonnegative().optional().default(0),
    aggregate: auditAggregateSchema.optional(),
    started_at: z.iso.datetime(),
    submitted_at: z.iso.datetime().nullable(),
    total_minutes: z.number().int().nullable(),
    meta: auditMetaSchema,
    pre_audit: preAuditValuesSchema,
    sections: z.record(z.string(), auditSectionStateSchema),
    scores: auditScoresSchema,
    progress: auditProgressSchema,
});

export const auditSessionSchema = auditSessionPayloadSchema.transform((value) => {
    const aggregate = value.aggregate ?? {
        schema_version: value.schema_version,
        revision: value.revision,
        meta: value.meta,
        pre_audit: value.pre_audit,
        sections: value.sections,
    };

    return {
        ...value,
        schema_version: aggregate.schema_version,
        revision: aggregate.revision,
        aggregate,
    };
});

export const preAuditDraftSchema = z.object({
    place_size: z.string().nullable().optional(),
    current_users_0_5: z.string().nullable().optional(),
    current_users_6_12: z.string().nullable().optional(),
    current_users_13_17: z.string().nullable().optional(),
    current_users_18_plus: z.string().nullable().optional(),
    playspace_busyness: z.string().nullable().optional(),
    season: z.string().nullable().optional(),
    weather_conditions: z.array(z.string()).default([]),
    wind_conditions: z.string().nullable().optional(),
});

export const sectionDraftPatchSchema = z.object({
    responses: z.record(z.string(), questionResponsePayloadSchema).default({}),
    note: z.string().nullable().optional(),
});

export const auditAggregateWriteSchema = z.object({
    schema_version: z.number().int().positive().optional(),
    meta: z
        .object({
            execution_mode: executionModeSchema.nullable().optional(),
            final_comments: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    pre_audit: preAuditDraftSchema.nullable().optional(),
    sections: z.record(z.string(), sectionDraftPatchSchema).default({}),
});

export const auditDraftPatchSchema = z.object({
    expected_revision: z.number().int().nonnegative().optional(),
    aggregate: auditAggregateWriteSchema.nullable().optional(),
    meta: z
        .object({
            execution_mode: executionModeSchema.nullable().optional(),
            final_comments: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    pre_audit: preAuditDraftSchema.nullable().optional(),
    sections: z.record(z.string(), sectionDraftPatchSchema).default({}),
    // Execute-time started_at correction (FEAT-01). Sent on the first sync after
    // the auditor opens the execute screen on a pristine audit.
    started_at: z.iso.datetime().optional(),
});

export const auditDraftSaveSchema = z.object({
    audit_id: z.uuid(),
    status: auditStatusSchema,
    schema_version: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    draft_progress_percent: z.number().nullable(),
    saved_at: z.iso.datetime(),
});

const dirtySectionVersionMapSchema = z.record(z.string(), z.number().int().nonnegative());

const dirtySectionsSchema = z
    .union([z.record(z.string(), z.array(z.string())), z.record(z.string(), dirtySectionVersionMapSchema)])
    .transform<DirtySections>((value) => normalizeDirtySections(value));

const dirtyPreAuditSchema = z
    .union([z.array(z.string()), z.record(z.string(), z.number().int().nonnegative())])
    .transform<DirtyPreAudit>((value) => normalizeDirtyPreAudit(value));

const dirtyMetaSchema = z.record(z.string(), z.number().int().nonnegative());

const dirtyStartedAtSchema = z.record(z.string(), z.boolean());

export const auditSyncPhaseSchema = z.enum([
    "idle",
    "dirty",
    "saving",
    "conflict",
    "submitting",
    "resolving_submit",
    "submitted",
    "blocked_network",
    "blocked_auth",
    "blocked_validation",
    "blocked_server",
    "queued_submit",
]);

export const auditSyncStateSchema = z.object({
    phase: auditSyncPhaseSchema,
    detail: z.string().nullable().default(null),
    updated_at: z.iso.datetime(),
});

export const auditSyncStateByAuditIdSchema = z.record(z.string(), auditSyncStateSchema);

export const persistedAuditStateSchema = z.object({
    storage_user_id: z.string().min(1).nullable().default(null),
    instrument: playspaceInstrumentSchema.nullable(),
    sessions_by_audit_id: z.record(z.string(), auditSessionSchema),
    sessions_by_pair_key: z.record(z.string(), auditSessionSchema),
    dirty_sections: dirtySectionsSchema.default({}),
    dirty_pre_audit: dirtyPreAuditSchema.default({}),
    dirty_meta: dirtyMetaSchema.default({}),
    dirty_started_at: dirtyStartedAtSchema.default({}),
    sync_state_by_audit_id: auditSyncStateByAuditIdSchema.default({}),
    local_change_counter: z.number().int().nonnegative().default(0),
    last_successful_sync_at: z.string().nullable().default(null),
});

/**
 * Generic TypeScript shape for paginated API responses.
 */
export interface PaginatedResponse<TItem> {
    items: TItem[];
    total_count: number;
    page: number;
    page_size: number;
    total_pages: number;
}

/**
 * Create a runtime schema for paginated API responses that wrap data in `items`.
 *
 * @param itemSchema Runtime schema for one item in the collection.
 * @returns Runtime schema for the paginated response envelope.
 */
export const createPaginatedResponseSchema = <TItemSchema extends z.ZodType>(itemSchema: TItemSchema) =>
    z.object({
        items: z.array(itemSchema),
        total_count: z.number().int().nonnegative(),
        page: z.number().int().positive(),
        page_size: z.number().int().positive(),
        total_pages: z.number().int().positive(),
    });

export type ExecutionMode = z.infer<typeof executionModeSchema>;
export type AuditStatus = z.infer<typeof auditStatusSchema>;
export type QuestionMode = z.infer<typeof questionModeSchema>;
export type ConstructKey = z.infer<typeof constructKeySchema>;
export type ScaleKey = z.infer<typeof scaleKeySchema>;
export type ScaleSelectionMode = z.infer<typeof scaleSelectionModeSchema>;
export type PreAuditInputType = z.infer<typeof preAuditInputTypeSchema>;
export type PreAuditPageKey = z.infer<typeof preAuditPageKeySchema>;
export type QuestionType = z.infer<typeof questionTypeSchema>;
export type PlayspaceType = z.infer<typeof playspaceTypeSchema>;
export type ChoiceOption = z.infer<typeof choiceOptionSchema>;
export type ScaleOption = z.infer<typeof scaleOptionSchema>;
export type ScaleDefinition = z.infer<typeof scaleDefinitionSchema>;
export type PreAuditQuestion = z.infer<typeof preAuditQuestionSchema>;
export type QuestionScale = z.infer<typeof questionScaleSchema>;
export type QuestionDisplayCondition = z.infer<typeof questionDisplayConditionSchema>;
export type InstrumentQuestion = z.infer<typeof instrumentQuestionSchema>;
export type InstrumentSection = z.infer<typeof instrumentSectionSchema>;
export type PlayspaceInstrument = z.infer<typeof playspaceInstrumentSchema>;
export type AuditSectionProgress = z.infer<typeof auditSectionProgressSchema>;
export type AuditProgress = z.infer<typeof auditProgressSchema>;
export type AuditMeta = z.infer<typeof auditMetaSchema>;
export type AuditPreAuditValues = z.infer<typeof preAuditValuesSchema>;
export type QuestionResponseValue = z.infer<typeof questionResponseValueSchema>;
export type QuestionResponsePayload = z.infer<typeof questionResponsePayloadSchema>;
export type AuditSectionState = z.infer<typeof auditSectionStateSchema>;
export type AuditScoreTotals = z.infer<typeof auditScoreTotalsSchema>;
export type SociabilityBreakdown = NonNullable<AuditScoreTotals["sociability_breakdown"]>;
export type SociabilityCategoryKey = "play_alone" | "small_group" | "large_group";
export type AuditScoreVariantBuckets = z.infer<typeof auditScoreVariantBucketsSchema>;
export type AuditUnsureVariants = z.infer<typeof auditUnsureVariantsSchema>;
export type AuditScores = z.infer<typeof auditScoresSchema>;
export type AuditAggregate = z.infer<typeof auditAggregateSchema>;
export type AuditSession = z.infer<typeof auditSessionSchema>;
export type PreAuditDraft = z.infer<typeof preAuditDraftSchema>;
export type SectionDraftPatch = z.infer<typeof sectionDraftPatchSchema>;
export type AuditAggregateWrite = z.infer<typeof auditAggregateWriteSchema>;
export type AuditDraftPatch = z.infer<typeof auditDraftPatchSchema>;
export type AuditDraftSave = z.infer<typeof auditDraftSaveSchema>;
export type AuditSyncPhase = z.infer<typeof auditSyncPhaseSchema>;
export type AuditSyncState = z.infer<typeof auditSyncStateSchema>;
export type AuditSyncStateByAuditId = z.infer<typeof auditSyncStateByAuditIdSchema>;
export type PersistedAuditState = z.infer<typeof persistedAuditStateSchema>;

/**
 * Read a string-only answer map from an unknown JSON payload.
 *
 * @param value Unknown JSON-like value.
 * @returns A string record when available, otherwise an empty object.
 */
export function readStringRecord(value: unknown): Record<string, string> {
    if (typeof value !== "object" || value === null) {
        return {};
    }

    const nextRecord: Record<string, string> = {};
    for (const [recordKey, recordValue] of Object.entries(value)) {
        if (typeof recordValue === "string") {
            nextRecord[recordKey] = recordValue;
        }
    }
    return nextRecord;
}

/**
 * Read a nested question-to-scale answer map from unknown JSON.
 *
 * @param value Unknown JSON-like value.
 * @returns A normalized nested record of section answers.
 */
export function readNestedStringRecord(value: unknown): Record<string, Record<string, string>> {
    if (typeof value !== "object" || value === null) {
        return {};
    }

    const nextRecord: Record<string, Record<string, string>> = {};
    for (const [recordKey, recordValue] of Object.entries(value)) {
        nextRecord[recordKey] = readStringRecord(recordValue);
    }
    return nextRecord;
}

/**
 * Normalize either the legacy array-based dirty section structure or the new
 * versioned structure into a stable version map.
 *
 * @param value Parsed persisted dirty section payload.
 * @returns Audit-to-section version map.
 */
function normalizeDirtySections(
    value: Record<string, string[]> | Record<string, Record<string, number>>,
): DirtySections {
    const nextDirtySections: DirtySections = {};
    for (const [auditId, auditValue] of Object.entries(value)) {
        if (Array.isArray(auditValue)) {
            nextDirtySections[auditId] = Object.fromEntries(auditValue.map((sectionKey) => [sectionKey, 0]));
            continue;
        }

        const nextAuditSections: Record<string, number> = {};
        for (const [sectionKey, version] of Object.entries(auditValue)) {
            if (typeof version === "number") {
                nextAuditSections[sectionKey] = version;
            }
        }
        nextDirtySections[auditId] = nextAuditSections;
    }
    return nextDirtySections;
}

/**
 * Normalize either the legacy array-based pre-audit dirty structure or the new
 * versioned structure into a stable version map.
 *
 * @param value Parsed persisted dirty pre-audit payload.
 * @returns Audit-to-version map for pre-audit edits.
 */
function normalizeDirtyPreAudit(value: string[] | DirtyPreAudit): DirtyPreAudit {
    if (Array.isArray(value)) {
        return Object.fromEntries(value.map((auditId) => [auditId, 0]));
    }

    const nextDirtyPreAudit: DirtyPreAudit = {};
    for (const [auditId, version] of Object.entries(value)) {
        nextDirtyPreAudit[auditId] = version;
    }
    return nextDirtyPreAudit;
}
