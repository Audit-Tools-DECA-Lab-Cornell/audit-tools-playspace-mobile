import {
    buildQuestionLookup,
    getQuestionConstructKeys,
    isDefaultReportFilter,
    maskScoreTotalsByConstructSelection,
    questionMatchesReportFilter,
    resolveQuestionConstructSelection,
    type ConstructSelection,
    type ReportResultFilter,
} from "lib/audit/report-filter";
import { buildReportScoreProjection, getQuestionDomainKeys } from "lib/audit/report-helpers";
import {
    addScoreTotals,
    calculateQuestionScores,
    createEmptyScoreTotals,
    formatPercentage,
    formatScoreValue,
} from "lib/audit/score-helpers";
import {
    SOCIABILITY_EXPORT_NOT_CAPTURED,
    buildSociabilityExportCells,
    formatMultipleSociabilityAnswer,
} from "lib/audit/sociability";
import type {
    AuditScoreTotals,
    AuditSession,
    ConstructKey,
    InstrumentQuestion,
    PlayspaceInstrument,
    PreAuditQuestion,
    QuestionResponsePayload,
} from "lib/audit/types";

import {
    BULK_PRE_AUDIT_COLUMN_WIDTHS,
    BULK_RESPONSE_COLUMN_WIDTHS,
    BULK_SPACE_AUDIT_COLUMN_WIDTHS,
    COMMENT_ROW_SENTINEL,
    GUIDANCE_COLUMN_WIDTHS,
    OVERVIEW_COLUMN_WIDTHS,
    SCORE_ROW_SENTINEL,
    SECTION_NOTE_RESPONSE_SENTINEL,
    SECTION_NOTE_SENTINEL,
    SINGLE_PRE_AUDIT_COLUMN_WIDTHS,
    SINGLE_RESPONSE_COLUMN_WIDTHS,
    SINGLE_RESPONSE_HEADERS,
    SINGLE_SPACE_AUDIT_COLUMN_WIDTHS,
    type ExportAuditorProfile,
    type ExportableAudit,
    type ScoreRowKind,
    type SpreadsheetRow,
    type WorkbookPayload,
    type WorkbookTable,
} from "./types";
import {
    deriveSummaryScore,
    formatAuditStatusLabel,
    formatChecklistAnswer,
    formatConstructLabel,
    formatExecutionModeLabel,
    formatLocality,
    formatOptionScoreLabel,
    formatQuestionAnswer,
    formatQuestionDomainLabel,
    formatQuestionKeyForDisplay,
    formatQuestionModeLabel,
    formatTimestampForDisplay,
    joinDisplayValues,
    questionDomainFallback,
    readPreAuditQuestionValues,
    roundToTwoDecimals,
    resolveExecutionMode,
    resolvePreAuditDisplayValues,
    slugifySegment,
    stripPromptMarkup,
} from "./format-utils";

/**
 * Plain-language description of what a filtered export contains.
 *
 * This is stamped into the exported document itself, not only its metadata: a
 * Play-Value-only export that is not visibly labelled could otherwise be read as
 * a complete audit, which matters for a research instrument.
 *
 * @param resultFilter Filter applied to the export, if any.
 * @returns A sentence naming the constructs and whether domains were customized.
 */
export function describeResultFilter(resultFilter: ReportResultFilter | undefined): string {
    if (resultFilter === undefined || isDefaultReportFilter(resultFilter)) {
        return "Play Value and Usability (complete audit)";
    }
    const customized = Object.keys(resultFilter.domainOverrides).length > 0;
    const customizedNote = customized ? "; some domains customized" : "";
    if (!resultFilter.overall.usability) {
        return `Play Value only${customizedNote}`;
    }
    if (!resultFilter.overall.playValue) {
        return `Usability only${customizedNote}`;
    }
    return `Play Value and Usability${customizedNote}`;
}

/**
 * Filename fragment naming the construct a filtered export covers.
 *
 * Without it a Play-Value-only export and a full export share a filename, and
 * the second silently replaces the first on the device.
 *
 * @param resultFilter Filter applied to the export, if any.
 * @returns An empty string for an unfiltered export, otherwise a leading-dash suffix.
 */
export function buildFilterFileNameSuffix(resultFilter: ReportResultFilter | undefined): string {
    if (resultFilter === undefined || isDefaultReportFilter(resultFilter)) {
        return "";
    }
    if (!resultFilter.overall.usability) {
        return "-play-value";
    }
    if (!resultFilter.overall.playValue) {
        return "-usability";
    }
    return "-filtered";
}

/** Convert one audit into workbook-style sheets. */
export function buildSingleAuditWorkbook(
    exportableAudit: ExportableAudit,
    instrument: PlayspaceInstrument,
): WorkbookPayload {
    const auditCodeSegment = slugifySegment(exportableAudit.auditSession.audit_code);
    const projectSegment = slugifySegment(exportableAudit.auditSession.project_name);
    return {
        fileBaseName: `pvua-${projectSegment}-${auditCodeSegment}${buildFilterFileNameSuffix(exportableAudit.resultFilter)}`,
        title: `${instrument.instrument_name} Export - ${exportableAudit.auditSession.audit_code}`,
        tables: [
            // Space Audit precedes the Overview so the space setup is seen before the scores.
            buildSingleAuditSpaceAuditTable(exportableAudit, instrument),
            buildSingleAuditOverviewTable(exportableAudit, instrument),
            buildSingleAuditPreAuditTable(exportableAudit, instrument),
            buildAuditGuidanceTable(instrument),
            buildResponsesTable(exportableAudit, instrument),
        ],
    };
}

/** Convert multiple audits into workbook-style sheets. */
export function buildBulkAuditWorkbook(
    exportableAudits: readonly ExportableAudit[],
    instrument: PlayspaceInstrument,
    auditorProfile: ExportAuditorProfile | null,
): WorkbookPayload {
    return {
        fileBaseName: `pvua-bulk-${new Date().toISOString().replaceAll("-", "").replaceAll(":", "").slice(0, 15)}${buildFilterFileNameSuffix(exportableAudits[0]?.resultFilter)}`,
        title: `${instrument.instrument_name} Bulk Export`,
        tables: [
            // Space Audit precedes the Overview so the space setup is seen before the scores.
            buildBulkAuditSpaceAuditTable(exportableAudits, auditorProfile, instrument),
            buildBulkAuditOverviewTable(exportableAudits, auditorProfile, instrument),
            buildBulkAuditPreAuditTable(exportableAudits, auditorProfile, instrument),
            buildAuditGuidanceTable(instrument),
            buildBulkResponsesTable(exportableAudits, instrument),
        ],
    };
}

/** Builds the full row set for the Overview worksheet. */
export function buildOverviewRows(
    exportableAudit: ExportableAudit,
    instrument: PlayspaceInstrument,
): readonly SpreadsheetRow[] {
    const { auditSession, context, auditorProfile } = exportableAudit;
    const projection = buildReportScoreProjection(auditSession, instrument, exportableAudit.resultFilter);
    const overallScores = projection.isFiltered ? projection.overall : auditSession.scores.overall;
    const finalComments = auditSession.meta.final_comments?.trim() ?? "";
    const resultScopeRows: SpreadsheetRow[] = projection.isFiltered
        ? [["Results Included", describeResultFilter(projection.filter)]]
        : [];
    const headlineRows: SpreadsheetRow[] = [
        ...(projection.visibleConstructs.playValue
            ? ([["Play Value Total", overallScores?.play_value_total ?? "Pending"]] as SpreadsheetRow[])
            : []),
        ...(projection.visibleConstructs.usability
            ? ([["Usability Total", overallScores?.usability_total ?? "Pending"]] as SpreadsheetRow[])
            : []),
    ];

    return [
        ["Field", "Value"],
        ...resultScopeRows,
        ["Instrument", `${instrument.instrument_name} v${instrument.instrument_version}`],
        ["Audit Code", auditSession.audit_code],
        ["Place Name", auditSession.place_name],
        ["Project Name", auditSession.project_name],
        ["Locality", formatLocality(context)],
        ["Status", formatAuditStatusLabel(auditSession.status)],
        ["Execution Mode", formatExecutionModeLabel(auditSession, instrument)],
        ["Started At", formatTimestampForDisplay(auditSession.started_at)],
        ["Submitted At", formatTimestampForDisplay(auditSession.submitted_at)],
        ["Total Minutes", auditSession.total_minutes ?? "Pending"],
        ...(finalComments.length > 0 ? ([["Final Comments", finalComments]] as SpreadsheetRow[]) : []),
        [
            "Summary Score",
            projection.isFiltered
                ? overallScores === null
                    ? "Pending"
                    : roundToTwoDecimals(
                          (projection.visibleConstructs.playValue ? overallScores.play_value_total : 0) +
                              (projection.visibleConstructs.usability ? overallScores.usability_total : 0),
                      )
                : deriveSummaryScore(auditSession),
        ],
        ...headlineRows,
        ["Provision Total", overallScores?.provision_total ?? "Pending"],
        ["Variety Total", overallScores?.variety_total ?? "Pending"],
        ["Sociability Total", overallScores?.sociability_total ?? "Pending"],
        ["Challenge Total", overallScores?.challenge_total ?? "Pending"],
        ...buildUnsureOverviewRows(exportableAudit, instrument),
        ["Auditor Code", auditorProfile?.auditorCode ?? ""],
        ["Auditor Country", auditorProfile?.country ?? ""],
        ["Auditor Gender", auditorProfile?.gender ?? ""],
        ["Auditor Age", auditorProfile?.ageRange ?? ""],
        ["Auditor Role", auditorProfile?.role ?? ""],
    ];
}

function formatPvUVariantSummary(
    exportableAudit: ExportableAudit,
    instrument: PlayspaceInstrument,
    variant: "unsure_as_zero" | "unsure_as_max",
): string {
    const projection = buildReportScoreProjection(
        exportableAudit.auditSession,
        instrument,
        exportableAudit.resultFilter,
        variant,
    );
    const totals = projection.overall;
    if (totals === null) {
        return "Pending";
    }
    return [
        projection.visibleConstructs.playValue
            ? `PV ${formatScoreValue(totals.play_value_total)} / ${formatScoreValue(totals.play_value_total_max)}`
            : null,
        projection.visibleConstructs.usability
            ? `U ${formatScoreValue(totals.usability_total)} / ${formatScoreValue(totals.usability_total_max)}`
            : null,
    ]
        .filter((value): value is string => value !== null)
        .join(" | ");
}

function buildUnsureOverviewRows(
    exportableAudit: ExportableAudit,
    instrument: PlayspaceInstrument,
): readonly SpreadsheetRow[] {
    const projection = buildReportScoreProjection(
        exportableAudit.auditSession,
        instrument,
        exportableAudit.resultFilter,
    );
    if (projection.unsureAnswerCount <= 0) {
        return [];
    }

    return [
        ["Unsure Answers", projection.unsureAnswerCount],
        ["Unsure Interpretation", "Report score excludes Unsure answers from score and maximum."],
        ["Unsure as Zero", formatPvUVariantSummary(exportableAudit, instrument, "unsure_as_zero")],
        ["Unsure as Maximum", formatPvUVariantSummary(exportableAudit, instrument, "unsure_as_max")],
    ];
}

function buildSingleAuditOverviewTable(
    exportableAudit: ExportableAudit,
    instrument: PlayspaceInstrument,
): WorkbookTable {
    return {
        name: "Overview",
        title: "Audit Overview",
        columnWidths: OVERVIEW_COLUMN_WIDTHS,
        rows: buildOverviewRows(exportableAudit, instrument),
    };
}

function buildBulkAuditOverviewTable(
    exportableAudits: readonly ExportableAudit[],
    auditorProfile: ExportAuditorProfile | null,
    instrument: PlayspaceInstrument,
): WorkbookTable {
    const includeResultScope = exportableAudits.some(
        (exportableAudit) =>
            exportableAudit.resultFilter !== undefined && !isDefaultReportFilter(exportableAudit.resultFilter),
    );
    const includePlayValue = exportableAudits.some(
        (exportableAudit) =>
            buildReportScoreProjection(exportableAudit.auditSession, instrument, exportableAudit.resultFilter)
                .visibleConstructs.playValue,
    );
    const includeUsability = exportableAudits.some(
        (exportableAudit) =>
            buildReportScoreProjection(exportableAudit.auditSession, instrument, exportableAudit.resultFilter)
                .visibleConstructs.usability,
    );
    return {
        name: "Overview",
        title: "Audit Overview",
        ...(includePlayValue && includeUsability
            ? {
                  columnWidths: [16, 24, 24, 24, 14, 28, 20, 20, 14, 14, 14, 14, 14, 14, 14, 14, 16, 16, 16, 16, 18],
              }
            : {}),
        rows: [
            [
                "Audit Code",
                "Place Name",
                "Project Name",
                "Locality",
                "Status",
                "Execution Mode",
                ...(includeResultScope ? ["Results Included"] : []),
                "Started At",
                "Submitted At",
                "Total Minutes",
                "Summary Score",
                ...(includePlayValue ? ["Play Value Total"] : []),
                ...(includeUsability ? ["Usability Total"] : []),
                "Provision Total",
                "Variety Total",
                "Sociability Total",
                "Challenge Total",
                "Auditor Code",
                "Auditor Country",
                "Auditor Gender",
                "Auditor Age",
                "Auditor Role",
            ],
            ...exportableAudits.map((exportableAudit) =>
                buildBulkAuditOverviewRow(
                    exportableAudit,
                    auditorProfile,
                    instrument,
                    includeResultScope,
                    includePlayValue,
                    includeUsability,
                ),
            ),
        ],
    };
}

function buildSingleAuditPreAuditTable(
    exportableAudit: ExportableAudit,
    instrument: PlayspaceInstrument,
): WorkbookTable {
    const auditInfoQuestions = instrument.pre_audit_questions.filter((question) => question.page_key === "audit_info");
    const { auditSession, auditorProfile } = exportableAudit;
    return {
        name: "PreAudit",
        title: "Pre-Audit",
        columnWidths: SINGLE_PRE_AUDIT_COLUMN_WIDTHS,
        rows: [
            ["Question", "Recorded Answer"],
            ...auditInfoQuestions.map((question) =>
                buildSingleAuditPreAuditRow(auditSession, auditorProfile, question),
            ),
        ],
    };
}

function buildSingleAuditSpaceAuditTable(
    exportableAudit: ExportableAudit,
    instrument: PlayspaceInstrument,
): WorkbookTable {
    const spaceSetupQuestions = instrument.pre_audit_questions.filter(
        (question) => question.page_key === "space_setup",
    );
    const { auditSession, auditorProfile } = exportableAudit;
    return {
        name: "SpaceAudit",
        title: "Space Audit Setup",
        columnWidths: SINGLE_SPACE_AUDIT_COLUMN_WIDTHS,
        rows: [
            ["Question", "Recorded Answer"],
            ...spaceSetupQuestions.map((question) =>
                buildSingleAuditPreAuditRow(auditSession, auditorProfile, question),
            ),
        ],
    };
}

function buildBulkAuditPreAuditTable(
    exportableAudits: readonly ExportableAudit[],
    auditorProfile: ExportAuditorProfile | null,
    instrument: PlayspaceInstrument,
): WorkbookTable {
    const auditInfoQuestions = instrument.pre_audit_questions.filter((question) => question.page_key === "audit_info");
    const rows: SpreadsheetRow[] = [["Audit Code", "Place Name", "Question", "Recorded Answer"]];

    for (const exportableAudit of exportableAudits) {
        for (const question of auditInfoQuestions) {
            rows.push(buildBulkAuditPreAuditRow(exportableAudit.auditSession, auditorProfile, question));
        }
    }

    return {
        name: "PreAudit",
        title: "Pre-Audit",
        columnWidths: BULK_PRE_AUDIT_COLUMN_WIDTHS,
        rows,
    };
}

function buildBulkAuditSpaceAuditTable(
    exportableAudits: readonly ExportableAudit[],
    auditorProfile: ExportAuditorProfile | null,
    instrument: PlayspaceInstrument,
): WorkbookTable {
    const spaceSetupQuestions = instrument.pre_audit_questions.filter(
        (question) => question.page_key === "space_setup",
    );
    const rows: SpreadsheetRow[] = [["Audit Code", "Place Name", "Question", "Recorded Answer"]];

    for (const exportableAudit of exportableAudits) {
        for (const question of spaceSetupQuestions) {
            rows.push(buildBulkAuditPreAuditRow(exportableAudit.auditSession, auditorProfile, question));
        }
    }

    return {
        name: "SpaceAudit",
        title: "Space Audit Setup",
        columnWidths: BULK_SPACE_AUDIT_COLUMN_WIDTHS,
        rows,
    };
}

function buildAuditGuidanceTable(instrument: PlayspaceInstrument): WorkbookTable {
    const executionModeOptions = instrument.execution_modes
        .map((option) => {
            const description =
                typeof option.description === "string" && option.description.trim().length > 0
                    ? ` - ${stripPromptMarkup(option.description)}`
                    : "";
            return `${stripPromptMarkup(option.label)}${description}`;
        })
        .join("\n");

    const rows: SpreadsheetRow[] = [
        ["Topic", "Guidance", "Available options"],
        ["Instrument Overview", instrument.preamble.map(stripPromptMarkup).join("\n\n"), ""],
        ["Execution Modes", "Choose the option that matches how the audit was completed.", executionModeOptions],
    ];

    for (const scale of instrument.scale_guidance) {
        rows.push([
            stripPromptMarkup(scale.title),
            [stripPromptMarkup(scale.description), stripPromptMarkup(scale.prompt)]
                .filter((value) => value.length > 0)
                .join("\n\n"),
            scale.options.map((option) => formatOptionScoreLabel(option)).join("\n"),
        ]);
    }

    return {
        name: "Guidance",
        title: "PVUA Guidance",
        columnWidths: GUIDANCE_COLUMN_WIDTHS,
        rows,
    };
}

function buildBulkAuditOverviewRow(
    exportableAudit: ExportableAudit,
    auditorProfile: ExportAuditorProfile | null,
    instrument: PlayspaceInstrument,
    includeResultScope: boolean,
    includePlayValue: boolean,
    includeUsability: boolean,
): SpreadsheetRow {
    const { auditSession, context } = exportableAudit;
    const projection = buildReportScoreProjection(auditSession, instrument, exportableAudit.resultFilter);
    const overallScores = projection.isFiltered ? projection.overall : auditSession.scores.overall;

    return [
        auditSession.audit_code,
        auditSession.place_name,
        context?.projectName ?? auditSession.project_name,
        formatLocality(context),
        formatAuditStatusLabel(auditSession.status),
        formatExecutionModeLabel(auditSession, instrument),
        ...(includeResultScope ? [describeResultFilter(exportableAudit.resultFilter)] : []),
        formatTimestampForDisplay(auditSession.started_at),
        formatTimestampForDisplay(auditSession.submitted_at),
        auditSession.total_minutes ?? "Pending",
        projection.isFiltered
            ? overallScores === null
                ? "Pending"
                : roundToTwoDecimals(
                      (projection.visibleConstructs.playValue ? overallScores.play_value_total : 0) +
                          (projection.visibleConstructs.usability ? overallScores.usability_total : 0),
                  )
            : deriveSummaryScore(auditSession),
        ...(includePlayValue
            ? [projection.visibleConstructs.playValue ? (overallScores?.play_value_total ?? "Pending") : ""]
            : []),
        ...(includeUsability
            ? [projection.visibleConstructs.usability ? (overallScores?.usability_total ?? "Pending") : ""]
            : []),
        overallScores?.provision_total ?? "Pending",
        overallScores?.variety_total ?? "Pending",
        overallScores?.sociability_total ?? "Pending",
        overallScores?.challenge_total ?? "Pending",
        auditorProfile?.auditorCode,
        auditorProfile?.country,
        auditorProfile?.gender,
        auditorProfile?.ageRange,
        auditorProfile?.role,
    ].map((value) => value ?? "N/A");
}

function buildSingleAuditPreAuditRow(
    auditSession: AuditSession,
    auditorProfile: ExportAuditorProfile | null,
    question: PreAuditQuestion,
): SpreadsheetRow {
    return [
        question.label,
        joinDisplayValues(
            resolvePreAuditDisplayValues(question, readPreAuditQuestionValues(auditSession, auditorProfile, question)),
        ),
    ];
}

function buildBulkAuditPreAuditRow(
    auditSession: AuditSession,
    auditorProfile: ExportAuditorProfile | null,
    question: PreAuditQuestion,
): SpreadsheetRow {
    return [
        auditSession.audit_code,
        auditSession.place_name,
        question.label,
        joinDisplayValues(
            resolvePreAuditDisplayValues(question, readPreAuditQuestionValues(auditSession, auditorProfile, question)),
        ),
    ];
}

/** Builds the full row set for the PVUA Response Matrix. Header row is not included. */
export function buildSingleAuditResponseRows(
    exportableAudit: ExportableAudit,
    instrument: PlayspaceInstrument,
): readonly SpreadsheetRow[] {
    const { auditSession } = exportableAudit;
    const executionMode = resolveExecutionMode(auditSession);
    const rows: SpreadsheetRow[] = [];
    let overallTotals = createEmptyScoreTotals();

    const questionLookup = buildQuestionLookup(instrument);
    const projection = buildReportScoreProjection(auditSession, instrument, exportableAudit.resultFilter);
    const resultFilter = projection.filter;
    const isFiltering = projection.isFiltered;

    for (const [sectionIndex, section] of instrument.sections.entries()) {
        const sectionResponses = auditSession.sections[section.section_key]?.responses ?? {};
        const allVisibleQuestions = section.questions.filter((question) =>
            isQuestionVisible(question, executionMode, sectionResponses),
        );
        if (allVisibleQuestions.length === 0) {
            continue;
        }

        const sectionState = auditSession.sections[section.section_key];
        let sectionTotals = createEmptyScoreTotals();
        let sectionConstructs: ConstructSelection = { playValue: false, usability: false };
        let includedScoredQuestionCount = 0;
        rows.push(buildSectionHeaderRow(sectionIndex, section.title, section.description, section.instruction));

        for (const [questionIndex, question] of allVisibleQuestions.entries()) {
            const questionAnswers = sectionState?.responses[question.question_key] ?? {};
            const included =
                !isFiltering ||
                questionMatchesReportFilter(question, questionLookup, getQuestionDomainKeys, resultFilter);
            const selection = isFiltering
                ? resolveQuestionConstructSelection(question, questionLookup, getQuestionDomainKeys, resultFilter)
                : { playValue: true, usability: true };
            const constructKeys = getQuestionConstructKeys(question, questionLookup);

            if (included) {
                const rawQuestionScores = calculateQuestionScores(question, questionAnswers);
                const questionScores = isFiltering
                    ? maskScoreTotalsByConstructSelection(rawQuestionScores, selection)
                    : rawQuestionScores;

                rows.push(
                    buildQuestionResponseRow(
                        sectionIndex,
                        questionIndex,
                        question,
                        questionAnswers,
                        questionScores,
                        isFiltering ? { selection, constructKeys } : undefined,
                    ),
                );
                sectionTotals = addScoreTotals(sectionTotals, questionScores);
                if (question.question_type === "scaled") {
                    includedScoredQuestionCount += 1;
                }
                sectionConstructs = {
                    playValue:
                        sectionConstructs.playValue || (selection.playValue && constructKeys.includes("play_value")),
                    usability:
                        sectionConstructs.usability || (selection.usability && constructKeys.includes("usability")),
                };
            }

            const questionComment =
                typeof questionAnswers.question_note === "string" ? questionAnswers.question_note.trim() : "";
            if (questionComment.length > 0) {
                rows.push(
                    buildQuestionCommentRow(
                        sectionIndex,
                        questionIndex,
                        questionComment,
                        formatQuestionKeyForDisplay(question.question_key, `${sectionIndex + 1}.${questionIndex + 1}`),
                    ),
                );
            }
        }

        const sectionNote = sectionState?.note ?? "";
        const notesPrompt = typeof section.notes_prompt === "string" ? stripPromptMarkup(section.notes_prompt) : "";

        if (notesPrompt.length > 0 || sectionNote.trim().length > 0) {
            rows.push(
                ...buildSectionNoteRow(
                    sectionIndex,
                    allVisibleQuestions.length + 1,
                    questionDomainFallback(section.title),
                    notesPrompt,
                    sectionNote,
                ),
            );
        }

        if (!isFiltering || includedScoredQuestionCount > 0) {
            rows.push(...buildSectionSummaryRows(sectionTotals, isFiltering ? sectionConstructs : undefined));
        }
        if (!isFiltering) {
            overallTotals = addScoreTotals(overallTotals, sectionTotals);
        }
    }

    if (rows.length > 0 && (!isFiltering || projection.overall !== null)) {
        if (isFiltering) {
            overallTotals = projection.overall ?? createEmptyScoreTotals();
        }
        rows.push(buildEmptyResponseRow());
        rows.push(...buildOverallSummaryRows(overallTotals, isFiltering ? projection.visibleConstructs : undefined));
    }

    return isFiltering ? rows.map((row) => projectResponseRow(row, projection.visibleConstructs)) : rows;
}

function projectResponseRow(row: SpreadsheetRow, visibleConstructs: ConstructSelection): SpreadsheetRow {
    return row.filter(
        (_cell, index) =>
            (index !== 14 || visibleConstructs.playValue) && (index !== 15 || visibleConstructs.usability),
    );
}

export function buildSingleAuditResponseHeaders(
    exportableAudit: ExportableAudit,
    instrument: PlayspaceInstrument,
): readonly string[] {
    const projection = buildReportScoreProjection(
        exportableAudit.auditSession,
        instrument,
        exportableAudit.resultFilter,
    );
    return projection.isFiltered
        ? projectResponseRow([...SINGLE_RESPONSE_HEADERS], projection.visibleConstructs).map(String)
        : SINGLE_RESPONSE_HEADERS;
}

/** Build detailed PVUA-style response rows across multiple audits. */
export function buildBulkAuditResponseRows(
    exportableAudits: readonly ExportableAudit[],
    instrument: PlayspaceInstrument,
): readonly SpreadsheetRow[] {
    const rows: SpreadsheetRow[] = [];

    for (const exportableAudit of exportableAudits) {
        for (const row of buildSingleAuditResponseRows(exportableAudit, instrument)) {
            rows.push(row);
        }
    }

    return rows;
}

/** Produces the full-width section header row. */
export function buildSectionHeaderRow(
    sectionIndex: number,
    title: string,
    description: string | null | undefined,
    instruction: string,
): SpreadsheetRow {
    return [
        (sectionIndex + 1).toString(),
        "",
        "",
        questionDomainFallback(title),
        typeof description === "string" ? stripPromptMarkup(description) : "",
        stripPromptMarkup(instruction),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
    ];
}

/** Produces the data row for a single question and its recorded answers. */
export function buildQuestionResponseRow(
    sectionIndex: number,
    questionIndex: number,
    question: InstrumentQuestion,
    answers: QuestionResponsePayload,
    questionScores: AuditScoreTotals,
    options?: Readonly<{
        selection: ConstructSelection;
        constructKeys: readonly ConstructKey[];
    }>,
): SpreadsheetRow {
    const questionKey = formatQuestionKeyForDisplay(question.question_key, `${sectionIndex + 1}.${questionIndex + 1}`);
    const selection = options?.selection ?? { playValue: true, usability: true };
    const constructKeys = options?.constructKeys ?? question.constructs;
    const visibleConstructKeys = options
        ? constructKeys.filter(
              (constructKey) =>
                  (constructKey !== "play_value" || selection.playValue) &&
                  (constructKey !== "usability" || selection.usability),
          )
        : question.constructs;

    if (question.question_type === "checklist") {
        return [
            questionKey,
            formatQuestionModeLabel(question.mode),
            formatConstructLabel(visibleConstructKeys),
            formatQuestionDomainLabel(question),
            "",
            "",
            stripPromptMarkup(question.prompt),
            formatChecklistAnswer(question, answers),
            "",
            "",
            "",
            "",
            "",
            "",
            selection.playValue ? "N/A" : "",
            selection.usability ? "N/A" : "",
        ];
    }

    const sociabilityCells = buildSociabilityExportCells(question, answers);
    const sociabilityAggregate =
        typeof answers.sociability === "string"
            ? formatQuestionAnswer(question, "sociability", answers.sociability)
            : formatMultipleSociabilityAnswer(question, answers);

    return [
        questionKey,
        formatQuestionModeLabel(question.mode),
        formatConstructLabel(visibleConstructKeys),
        formatQuestionDomainLabel(question),
        "",
        "",
        stripPromptMarkup(question.prompt),
        formatQuestionAnswer(
            question,
            "provision",
            typeof answers.provision === "string" ? answers.provision : undefined,
        ),
        formatQuestionAnswer(question, "variety", typeof answers.variety === "string" ? answers.variety : undefined),
        sociabilityAggregate,
        ...sociabilityCells,
        formatQuestionAnswer(
            question,
            "challenge",
            typeof answers.challenge === "string" ? answers.challenge : undefined,
        ),
        selection.playValue ? (constructKeys.includes("play_value") ? questionScores.play_value_total : "N/A") : "",
        selection.usability ? (constructKeys.includes("usability") ? questionScores.usability_total : "N/A") : "",
    ];
}

/** Produces a per-question auditor comment row. */
export function buildQuestionCommentRow(
    _sectionIndex: number,
    _questionIndex: number,
    comment: string,
    questionKey: string,
): SpreadsheetRow {
    return [questionKey, COMMENT_ROW_SENTINEL, "", "", "", "", comment, "", "", "", "", "", "", "", "", ""];
}

/** Produces one or two full-width banner rows for the section note block. */
export function buildSectionNoteRow(
    _sectionIndex: number,
    _noteIndex: number,
    _domainLabel: string,
    notesPrompt: string,
    submittedComment: string,
): readonly SpreadsheetRow[] {
    const blank = ["", "", "", "", "", "", "", "", "", "", "", "", "", ""] as const;
    const rows: SpreadsheetRow[] = [];

    if (notesPrompt.length > 0) {
        rows.push([`Notes Prompt: ${notesPrompt}`, SECTION_NOTE_SENTINEL, ...blank]);
    }

    if (submittedComment.trim().length > 0) {
        rows.push([`Auditor Note: ${submittedComment.trim()}`, SECTION_NOTE_RESPONSE_SENTINEL, ...blank]);
    }

    return rows;
}

/** Produces the three per-section summary rows. */
export function buildSectionSummaryRows(
    totals: AuditScoreTotals,
    visibleConstructs?: ConstructSelection,
): readonly SpreadsheetRow[] {
    return [
        buildScoreSummaryRow("Total", "Raw Scores", totals, "raw", visibleConstructs),
        buildScoreSummaryRow("Max", "Max Possible", totals, "maximum", visibleConstructs),
        buildScoreSummaryRow("%", "Final Percentage", totals, "percentage", visibleConstructs),
    ];
}

/** Produces the three overall summary rows appended at the end of the matrix. */
export function buildOverallSummaryRows(
    totals: AuditScoreTotals,
    visibleConstructs?: ConstructSelection,
): readonly SpreadsheetRow[] {
    return [
        buildScoreSummaryRow("Overall Total", "Raw Scores", totals, "raw", visibleConstructs),
        buildScoreSummaryRow("Overall Max", "Max Possible", totals, "maximum", visibleConstructs),
        buildScoreSummaryRow("Overall %", "Final Percentage", totals, "percentage", visibleConstructs),
    ];
}

/** Produces a single score summary row. */
export function buildScoreSummaryRow(
    idLabel: string,
    modeLabel: string,
    totals: AuditScoreTotals,
    rowKind: ScoreRowKind,
    visibleConstructs?: ConstructSelection,
): SpreadsheetRow {
    const base = [idLabel, modeLabel, SCORE_ROW_SENTINEL, "", "", "", ""] as const;
    const breakdown = totals.sociability_breakdown;

    if (rowKind === "raw") {
        return [
            ...base,
            totals.provision_total,
            totals.variety_total,
            totals.sociability_total,
            breakdown?.play_alone.total ?? SOCIABILITY_EXPORT_NOT_CAPTURED,
            breakdown?.small_group.total ?? SOCIABILITY_EXPORT_NOT_CAPTURED,
            breakdown?.large_group.total ?? SOCIABILITY_EXPORT_NOT_CAPTURED,
            totals.challenge_total,
            visibleConstructs?.playValue === false ? "" : totals.play_value_total,
            visibleConstructs?.usability === false ? "" : totals.usability_total,
        ];
    }

    if (rowKind === "maximum") {
        return [
            ...base,
            totals.provision_total_max,
            totals.variety_total_max,
            totals.sociability_total_max,
            breakdown?.play_alone.max ?? SOCIABILITY_EXPORT_NOT_CAPTURED,
            breakdown?.small_group.max ?? SOCIABILITY_EXPORT_NOT_CAPTURED,
            breakdown?.large_group.max ?? SOCIABILITY_EXPORT_NOT_CAPTURED,
            totals.challenge_total_max,
            visibleConstructs?.playValue === false ? "" : totals.play_value_total_max,
            visibleConstructs?.usability === false ? "" : totals.usability_total_max,
        ];
    }

    return [
        ...base,
        formatPercentage(totals.provision_total, totals.provision_total_max),
        formatPercentage(totals.variety_total, totals.variety_total_max),
        formatPercentage(totals.sociability_total, totals.sociability_total_max),
        breakdown === null || breakdown === undefined
            ? SOCIABILITY_EXPORT_NOT_CAPTURED
            : formatPercentage(breakdown.play_alone.total, breakdown.play_alone.max),
        breakdown === null || breakdown === undefined
            ? SOCIABILITY_EXPORT_NOT_CAPTURED
            : formatPercentage(breakdown.small_group.total, breakdown.small_group.max),
        breakdown === null || breakdown === undefined
            ? SOCIABILITY_EXPORT_NOT_CAPTURED
            : formatPercentage(breakdown.large_group.total, breakdown.large_group.max),
        formatPercentage(totals.challenge_total, totals.challenge_total_max),
        visibleConstructs?.playValue === false
            ? ""
            : formatPercentage(totals.play_value_total, totals.play_value_total_max),
        visibleConstructs?.usability === false
            ? ""
            : formatPercentage(totals.usability_total, totals.usability_total_max),
    ];
}

/** Produces a blank separator row. */
export function buildEmptyResponseRow(): SpreadsheetRow {
    return ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
}

/** Build a workbook-style response table for a single audit. */
export function buildResponsesTable(exportableAudit: ExportableAudit, instrument: PlayspaceInstrument): WorkbookTable {
    const headers = buildSingleAuditResponseHeaders(exportableAudit, instrument);
    return {
        name: "Responses",
        title: "PVUA Response Matrix",
        columnWidths: headers.map((header) => {
            const sourceIndex = SINGLE_RESPONSE_HEADERS.indexOf(header as (typeof SINGLE_RESPONSE_HEADERS)[number]);
            return SINGLE_RESPONSE_COLUMN_WIDTHS[sourceIndex] ?? 16;
        }),
        rows: [headers, ...buildSingleAuditResponseRows(exportableAudit, instrument)],
    };
}

/** Build a workbook-style response table across multiple audits. */
export function buildBulkResponsesTable(
    exportableAudits: readonly ExportableAudit[],
    instrument: PlayspaceInstrument,
): WorkbookTable {
    const firstAudit = exportableAudits[0];
    const headers =
        firstAudit === undefined ? SINGLE_RESPONSE_HEADERS : buildSingleAuditResponseHeaders(firstAudit, instrument);
    return {
        name: "Responses",
        title: "PVUA Response Matrix",
        columnWidths: headers.map((header) => {
            const sourceIndex = SINGLE_RESPONSE_HEADERS.indexOf(header as (typeof SINGLE_RESPONSE_HEADERS)[number]);
            return BULK_RESPONSE_COLUMN_WIDTHS[sourceIndex] ?? 16;
        }),
        rows: [headers, ...buildBulkAuditResponseRows(exportableAudits, instrument)],
    };
}

/** Decide whether a question should appear in the export for the chosen mode. */
export function isQuestionVisible(
    question: InstrumentQuestion,
    executionMode: ReturnType<typeof resolveExecutionMode>,
    sectionResponses: Record<string, QuestionResponsePayload>,
): boolean {
    if (executionMode !== null && question.mode !== "both" && question.mode !== executionMode) {
        return false;
    }

    if (question.display_if === null || question.display_if === undefined) {
        return true;
    }

    const parentAnswers = sectionResponses[question.display_if.question_key];
    if (parentAnswers === undefined) {
        return false;
    }

    const selectedValue = parentAnswers[question.display_if.response_key];
    if (typeof selectedValue === "string") {
        return question.display_if.any_of_option_keys.includes(selectedValue);
    }

    if (Array.isArray(selectedValue)) {
        return selectedValue.some(
            (entry) => typeof entry === "string" && question.display_if?.any_of_option_keys.includes(entry),
        );
    }

    return false;
}
