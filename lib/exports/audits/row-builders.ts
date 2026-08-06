import type {
    AuditSession,
    InstrumentQuestion,
    PlayspaceInstrument,
    PreAuditQuestion,
    QuestionResponsePayload,
} from "lib/audit/types";
import { getVisibleSections } from "lib/audit/selectors";
import { buildSociabilityExportCells, formatMultipleSociabilityAnswer } from "lib/audit/sociability";

import {
    formatChecklistAnswer,
    formatConstructLabel,
    formatExecutionModeLabel,
    formatLocality,
    formatQuestionAnswer,
    formatQuestionDomainLabel,
    formatQuestionKeyForDisplay,
    formatQuestionModeLabel,
    formatTimestampForDisplay,
    joinDisplayValues,
    questionDomainFallback,
    readPreAuditQuestionValues,
    resolveExecutionMode,
    resolvePreAuditDisplayValues,
    slugifySegment,
    stripPromptMarkup,
} from "lib/exports/reports/format-utils";
import type { ExportAuditorProfile, SpreadsheetRow, WorkbookPayload, WorkbookTable } from "lib/exports/reports/types";

import {
    COMMENT_ROW_SENTINEL,
    IN_PROGRESS_OVERVIEW_COLUMN_WIDTHS,
    IN_PROGRESS_PRE_AUDIT_COLUMN_WIDTHS,
    IN_PROGRESS_RESPONSE_COLUMN_WIDTHS,
    IN_PROGRESS_RESPONSE_HEADERS,
    IN_PROGRESS_SPACE_AUDIT_COLUMN_WIDTHS,
    PENDING_PLACEHOLDER,
    SECTION_NOTE_RESPONSE_SENTINEL,
    SECTION_NOTE_SENTINEL,
    UNANSWERED_PLACEHOLDER,
    type InProgressExportableAudit,
} from "./types";

/** Replace empty answer strings with the visible "Not answered" placeholder. */
function orUnanswered(value: string): string {
    return value.trim().length === 0 ? UNANSWERED_PLACEHOLDER : value;
}

/** Convert one in-progress audit into workbook-style sheets. */
export function buildInProgressAuditWorkbook(
    exportableAudit: InProgressExportableAudit,
    instrument: PlayspaceInstrument,
): WorkbookPayload {
    const auditCodeSegment = slugifySegment(exportableAudit.auditSession.audit_code);
    const projectSegment = slugifySegment(exportableAudit.auditSession.project_name);
    // Space Audit precedes the Overview so the space setup is seen before the scores.
    const tables: WorkbookTable[] = [];

    const spaceAuditTable = buildSpaceAuditTable(exportableAudit, instrument);
    if (spaceAuditTable !== null) {
        tables.push(spaceAuditTable);
    }

    tables.push(
        buildOverviewTable(exportableAudit, instrument),
        buildPreAuditTable(exportableAudit, instrument),
        buildResponsesTable(exportableAudit, instrument),
    );

    return {
        fileBaseName: `pvua-in-progress-${projectSegment}-${auditCodeSegment}`,
        title: `${instrument.instrument_name} In-Progress Export - ${exportableAudit.auditSession.audit_code}`,
        tables,
    };
}

/** Builds the row set for the Overview worksheet. */
export function buildInProgressOverviewRows(
    exportableAudit: InProgressExportableAudit,
    instrument: PlayspaceInstrument,
): readonly SpreadsheetRow[] {
    const { auditSession, context, auditorProfile } = exportableAudit;
    const progress = auditSession.progress;
    const answeredLabel = `${progress.answered_visible_questions} of ${progress.total_visible_questions}`;
    const sectionsLabel = `${progress.completed_section_count} of ${progress.visible_section_count}`;
    const executionModeLabel = formatExecutionModeLabel(auditSession, instrument);
    const finalComments = auditSession.meta.final_comments?.trim() ?? "";

    return [
        ["Field", "Value"],
        ["Instrument", `${instrument.instrument_name} v${instrument.instrument_version}`],
        ["Audit Code", auditSession.audit_code],
        ["Place Name", auditSession.place_name],
        ["Project Name", auditSession.project_name],
        ["Locality", formatLocality(context)],
        ["Status", formatInProgressStatusLabel(auditSession)],
        ["Execution Mode", executionModeLabel.length > 0 ? executionModeLabel : PENDING_PLACEHOLDER],
        ["Started At", formatTimestampForDisplay(auditSession.started_at) || PENDING_PLACEHOLDER],
        ["Questions Answered", answeredLabel],
        ["Sections Completed", sectionsLabel],
        ...(finalComments.length > 0 ? ([["Final Comments", finalComments]] as SpreadsheetRow[]) : []),
        ["Auditor Code", auditorProfile?.auditorCode ?? ""],
        ["Auditor Country", auditorProfile?.country ?? ""],
        ["Auditor Gender", auditorProfile?.gender ?? ""],
        ["Auditor Age", auditorProfile?.ageRange ?? ""],
        ["Auditor Role", auditorProfile?.role ?? ""],
    ];
}

/**
 * Build the full set of response rows (header row excluded) for an in-progress audit.
 *
 * The visible section/question set is computed by `getVisibleSections`, the
 * same selector the audit-execution screens use, so the export mirrors what
 * the auditor sees in the app - including the `"both"` execution-mode case
 * where mode filtering is bypassed.
 */
export function buildInProgressAuditResponseRows(
    exportableAudit: InProgressExportableAudit,
    instrument: PlayspaceInstrument,
): readonly SpreadsheetRow[] {
    const { auditSession } = exportableAudit;
    const executionMode = resolveExecutionMode(auditSession);
    const rows: SpreadsheetRow[] = [];

    const sectionResponsesBySection = Object.fromEntries(
        Object.entries(auditSession.sections).map(([sectionKey, sectionState]) => [sectionKey, sectionState.responses]),
    );
    const visibleSections =
        executionMode === null ? [] : getVisibleSections(instrument, executionMode, sectionResponsesBySection);

    for (const [sectionIndex, section] of visibleSections.entries()) {
        if (section.questions.length === 0) {
            continue;
        }

        const sectionState = auditSession.sections[section.section_key];
        const sectionResponses = sectionState?.responses ?? {};

        rows.push(buildSectionHeaderRow(sectionIndex, section.title, section.description, section.instruction));

        for (const [questionIndex, question] of section.questions.entries()) {
            const questionAnswers = sectionResponses[question.question_key] ?? {};
            rows.push(buildQuestionResponseRow(sectionIndex, questionIndex, question, questionAnswers));

            const questionComment =
                typeof questionAnswers.question_note === "string" ? questionAnswers.question_note.trim() : "";
            if (questionComment.length > 0) {
                rows.push(
                    buildQuestionCommentRow(
                        questionComment,
                        formatQuestionKeyForDisplay(question.question_key, `${sectionIndex + 1}.${questionIndex + 1}`),
                    ),
                );
            }
        }

        const sectionNote = sectionState?.note ?? "";
        const notesPrompt = typeof section.notes_prompt === "string" ? stripPromptMarkup(section.notes_prompt) : "";

        if (notesPrompt.length > 0 || sectionNote.trim().length > 0) {
            rows.push(...buildSectionNoteRows(notesPrompt, sectionNote));
        }
    }

    return rows;
}

function buildOverviewTable(
    exportableAudit: InProgressExportableAudit,
    instrument: PlayspaceInstrument,
): WorkbookTable {
    return {
        name: "Overview",
        title: "Audit Overview",
        columnWidths: IN_PROGRESS_OVERVIEW_COLUMN_WIDTHS,
        rows: buildInProgressOverviewRows(exportableAudit, instrument),
    };
}

function buildPreAuditTable(
    exportableAudit: InProgressExportableAudit,
    instrument: PlayspaceInstrument,
): WorkbookTable {
    const auditInfoQuestions = instrument.pre_audit_questions.filter((question) => question.page_key === "audit_info");
    const { auditSession, auditorProfile } = exportableAudit;
    return {
        name: "PreAudit",
        title: "Pre-Audit",
        columnWidths: IN_PROGRESS_PRE_AUDIT_COLUMN_WIDTHS,
        rows: [
            ["Question", "Recorded Answer"],
            ...auditInfoQuestions.map((question) => buildPreAuditRow(auditSession, auditorProfile, question)),
        ],
    };
}

function buildSpaceAuditTable(
    exportableAudit: InProgressExportableAudit,
    instrument: PlayspaceInstrument,
): WorkbookTable | null {
    const spaceSetupQuestions = instrument.pre_audit_questions.filter(
        (question) => question.page_key === "space_setup",
    );
    if (spaceSetupQuestions.length === 0) {
        return null;
    }
    const { auditSession, auditorProfile } = exportableAudit;
    return {
        name: "SpaceAudit",
        title: "Space Audit Setup",
        columnWidths: IN_PROGRESS_SPACE_AUDIT_COLUMN_WIDTHS,
        rows: [
            ["Question", "Recorded Answer"],
            ...spaceSetupQuestions.map((question) => buildPreAuditRow(auditSession, auditorProfile, question)),
        ],
    };
}

function buildResponsesTable(
    exportableAudit: InProgressExportableAudit,
    instrument: PlayspaceInstrument,
): WorkbookTable {
    return {
        name: "Responses",
        title: "Recorded Responses",
        columnWidths: IN_PROGRESS_RESPONSE_COLUMN_WIDTHS,
        rows: [IN_PROGRESS_RESPONSE_HEADERS, ...buildInProgressAuditResponseRows(exportableAudit, instrument)],
    };
}

function buildPreAuditRow(
    auditSession: AuditSession,
    auditorProfile: ExportAuditorProfile | null,
    question: PreAuditQuestion,
): SpreadsheetRow {
    const displayValues = resolvePreAuditDisplayValues(
        question,
        readPreAuditQuestionValues(auditSession, auditorProfile, question),
    );
    return [question.label, orUnanswered(joinDisplayValues(displayValues))];
}

function buildSectionHeaderRow(
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
        [typeof description === "string" ? stripPromptMarkup(description) : "", stripPromptMarkup(instruction)]
            .filter((value) => value.length > 0)
            .join("\n\n"),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
    ];
}

function buildQuestionResponseRow(
    sectionIndex: number,
    questionIndex: number,
    question: InstrumentQuestion,
    answers: QuestionResponsePayload,
): SpreadsheetRow {
    const questionKey = formatQuestionKeyForDisplay(question.question_key, `${sectionIndex + 1}.${questionIndex + 1}`);
    const constructs = formatConstructLabel(question.constructs);
    const mode = formatQuestionModeLabel(question.mode);
    const domain = formatQuestionDomainLabel(question);
    const prompt = stripPromptMarkup(question.prompt);

    if (question.question_type === "checklist") {
        return [
            questionKey,
            mode,
            constructs,
            domain,
            prompt,
            orUnanswered(formatChecklistAnswer(question, answers)),
            "",
            "",
            "",
            "",
            "",
            "",
        ];
    }

    const readScale = (scaleKey: "provision" | "variety" | "challenge"): string => {
        const rawValue = answers[scaleKey];
        return orUnanswered(
            formatQuestionAnswer(question, scaleKey, typeof rawValue === "string" ? rawValue : undefined),
        );
    };
    const sociabilityCells = buildSociabilityExportCells(question, answers);
    const sociabilityAggregate =
        typeof answers.sociability === "string"
            ? formatQuestionAnswer(question, "sociability", answers.sociability)
            : formatMultipleSociabilityAnswer(question, answers);

    return [
        questionKey,
        mode,
        constructs,
        domain,
        prompt,
        readScale("provision"),
        readScale("variety"),
        orUnanswered(sociabilityAggregate),
        ...sociabilityCells,
        readScale("challenge"),
    ];
}

function buildQuestionCommentRow(comment: string, questionKey: string): SpreadsheetRow {
    return [questionKey, COMMENT_ROW_SENTINEL, "", "", comment, "", "", "", "", "", "", ""];
}

function buildSectionNoteRows(notesPrompt: string, submittedComment: string): readonly SpreadsheetRow[] {
    const blank = ["", "", "", "", "", "", "", "", "", ""] as const;
    const rows: SpreadsheetRow[] = [];

    if (notesPrompt.length > 0) {
        rows.push([`Notes Prompt: ${notesPrompt}`, SECTION_NOTE_SENTINEL, ...blank]);
    }

    if (submittedComment.trim().length > 0) {
        rows.push([`Auditor Note: ${submittedComment.trim()}`, SECTION_NOTE_RESPONSE_SENTINEL, ...blank]);
    }

    return rows;
}

function formatInProgressStatusLabel(auditSession: AuditSession): string {
    switch (auditSession.status) {
        case "IN_PROGRESS":
            return "In progress";
        case "PAUSED":
            return "Paused";
        case "SUBMITTED":
            return "Submitted";
        default:
            return auditSession.status;
    }
}
