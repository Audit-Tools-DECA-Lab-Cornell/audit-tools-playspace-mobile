import {
    formatScoreValue,
    addScoreTotals,
    calculateQuestionScores,
    createEmptyScoreTotals,
    formatPercentage,
    getEffectiveAuditScoreTotals,
} from "lib/audit/score-helpers";
import {
    buildSociabilityExportCells,
    formatMultipleSociabilityAnswer,
    getSociabilityScale,
    SOCIABILITY_CATEGORY_KEYS,
    SOCIABILITY_EXPORT_HEADERS,
} from "lib/audit/sociability";
import type {
    AuditScoreTotals,
    InstrumentQuestion,
    PlayspaceInstrument,
    QuestionResponsePayload,
} from "lib/audit/types";

import {
    COMMENT_ROW_SENTINEL,
    PDF_RESPONSE_HEADERS,
    SCORE_ROW_SENTINEL,
    SECTION_NOTE_RESPONSE_SENTINEL,
    SECTION_NOTE_SENTINEL,
    WEB_AUDIT_EXPORT_PALETTE,
    // type ExportScaleKey,
    type ExportableAudit,
    type SpreadsheetCell,
    type SpreadsheetRow,
    type WorkbookPayload,
} from "./types";
import {
    deriveSummaryScore,
    escapeHtml,
    formatAuditStatusLabel,
    formatChecklistAnswer,
    formatConstructLabel,
    formatExecutionModeLabel,
    formatQuestionAnswer,
    formatQuestionKeyForDisplay,
    formatQuestionModeLabel,
    formatTimestampForDisplay,
    resolveExecutionMode,
    stripPromptMarkup,
} from "./format-utils";
import { isQuestionVisible } from "./row-builders";

const palette = WEB_AUDIT_EXPORT_PALETTE;

/** True when a question's Sociability scale accepts any combination of its answers. */
function isMultipleSociabilityQuestion(question: InstrumentQuestion): boolean {
    return getSociabilityScale(question)?.selection_mode === "multiple";
}

/**
 * Render the play opportunities an auditor selected, one per line.
 *
 * The wording comes from the instrument's own option labels via the shared formatter, so the
 * printed answer matches the on-screen report and the spreadsheet cells.
 */
function formatSociabilityAnswerForExport(question: InstrumentQuestion, answers: QuestionResponsePayload): string {
    const formatted = formatMultipleSociabilityAnswer(question, answers);
    if (formatted.length > 0) {
        return formatted.split(" | ").join("\n");
    }
    // Every structural column carries the same non-selection state for this question.
    return buildSociabilityExportCells(question, answers)[0];
}

/** One score row per play opportunity, or a single line stating the breakdown was never captured. */
function buildSociabilityBreakdownScoreRows(totals: AuditScoreTotals | null): readonly ScoreSummaryDisplayRow[] {
    const breakdown = totals?.sociability_breakdown;
    if (breakdown === null || breakdown === undefined) {
        return [
            {
                label: "Sociability Breakdown",
                value: "Not captured by this instrument",
                className: "score-row scale-sociability",
            },
        ];
    }

    return SOCIABILITY_CATEGORY_KEYS.map((categoryKey, index) => {
        const category = breakdown[categoryKey];
        return {
            label: SOCIABILITY_EXPORT_HEADERS[index] ?? categoryKey,
            value: `${formatScoreValue(category.total)} / ${formatScoreValue(category.max)} (${formatPercentage(
                category.total,
                category.max,
            )})`,
            className: "score-row scale-sociability",
        };
    });
}

/** Build the web-styled single-audit PDF HTML used by Expo Print. */
export function buildSingleAuditPdfHtml(exportableAudit: ExportableAudit, instrument: PlayspaceInstrument): string {
    const { auditSession, auditorProfile } = exportableAudit;
    const overallScores = auditSession.scores.overall;
    const detailsRows = buildAuditDetailsRows(exportableAudit, instrument);

    const profileRows: readonly (readonly [string, SpreadsheetCell])[] = auditorProfile
        ? [
              ["Auditor Code", auditorProfile.auditorCode],
              ["Age Range", auditorProfile.ageRange ?? "-"],
              ["Gender", auditorProfile.gender ?? "-"],
              ["Country", auditorProfile.country ?? "-"],
              ["Role", auditorProfile.role ?? "-"],
          ]
        : [["Auditor", "Not available"]];

    const scoreRows: readonly ScoreSummaryDisplayRow[] = [
        {
            label: "Summary Score",
            value: String(deriveSummaryScore(auditSession)),
            className: "score-row score-row-primary",
        },
        {
            label: "Play Value Total",
            value: formatScoreValue(overallScores?.play_value_total ?? 0),
            className: "score-row score-row-neutral strong",
        },
        {
            label: "Usability Total",
            value: formatScoreValue(overallScores?.usability_total ?? 0),
            className: "score-row score-row-neutral strong",
        },
        {
            label: "Provision Total",
            value: formatScoreValue(overallScores?.provision_total ?? 0),
            className: "score-row scale-provision",
        },
        {
            label: "Variety Total",
            value: formatScoreValue(overallScores?.variety_total ?? 0),
            className: "score-row scale-variety",
        },
        {
            label: "Sociability Total",
            value: formatScoreValue(overallScores?.sociability_total ?? 0),
            className: "score-row scale-sociability",
        },
        {
            label: "Challenge Total",
            value: formatScoreValue(overallScores?.challenge_total ?? 0),
            className: "score-row scale-challenge",
        },
        // The three play opportunities follow the Sociability aggregate as their own block. All
        // three share the Sociability fill so the printed page reads them as equal measures.
        ...buildSociabilityBreakdownScoreRows(overallScores),
        ...buildUnsureScoreRows(auditSession),
    ];

    return [
        "<!doctype html>",
        "<html>",
        "<head>",
        '<meta charset="utf-8" />',
        `<title>${escapeHtml(`${auditSession.audit_code} PVUA Audit Export`)}</title>`,
        "<style>",
        buildPdfCss(),
        "</style>",
        "</head>",
        "<body>",
        '<section class="summary-page">',
        '<header class="audit-header">',
        "<div>",
        "<h1>PVUA Audit Export</h1>",
        `<p>${escapeHtml(auditSession.audit_code)}</p>`,
        "</div>",
        "</header>",
        '<div class="summary-grid">',
        renderKeyValuePanel("Audit Details", detailsRows),
        renderKeyValuePanel("Auditor Profile", profileRows),
        "</div>",
        renderScoreSummary(scoreRows),
        "</section>",
        '<section class="response-page">',
        `<h2>${escapeHtml(`${auditSession.audit_code} - ${auditSession.place_name} - PVUA Response Matrix`)}</h2>`,
        renderPdfResponseMatrix(exportableAudit, instrument),
        "</section>",
        "</body>",
        "</html>",
    ].join("");
}

/** Build a generic web-styled PDF HTML for bulk exports. */
export function buildWorkbookPdfHtml(workbook: WorkbookPayload): string {
    const renderedTables = workbook.tables
        .map((table, index) => {
            const sectionClass = table.name === "Responses" ? "response-page" : "summary-page generic-page";
            const breakClass = index === 0 ? "" : " page-break";
            return [
                `<section class="${sectionClass}${breakClass}">`,
                `<h2>${escapeHtml(table.title)}</h2>`,
                renderGenericTable(table.rows, table.name),
                "</section>",
            ].join("");
        })
        .join("");

    return [
        "<!doctype html>",
        "<html>",
        "<head>",
        '<meta charset="utf-8" />',
        `<title>${escapeHtml(workbook.title)}</title>`,
        "<style>",
        buildPdfCss(),
        "</style>",
        "</head>",
        "<body>",
        '<header class="audit-header floating-header">',
        "<div>",
        `<h1>${escapeHtml(workbook.title)}</h1>`,
        "<p>PVUA export generated from submitted audit data.</p>",
        "</div>",
        "</header>",
        renderedTables,
        "</body>",
        "</html>",
    ].join("");
}

function formatPvUVariantSummaryForPdf(
    auditSession: ExportableAudit["auditSession"],
    variant: "unsure_as_zero" | "unsure_as_max",
): string {
    const totals = getEffectiveAuditScoreTotals(auditSession.scores, variant);
    if (totals === null) {
        return "Pending";
    }
    return `PV ${formatScoreValue(totals.play_value_total)} / ${formatScoreValue(totals.play_value_total_max)} | U ${formatScoreValue(totals.usability_total)} / ${formatScoreValue(totals.usability_total_max)}`;
}

function buildUnsureScoreRows(auditSession: ExportableAudit["auditSession"]): readonly ScoreSummaryDisplayRow[] {
    if (auditSession.scores.unsure_answer_count <= 0) {
        return [];
    }

    return [
        {
            label: "Unsure Answers",
            value: auditSession.scores.unsure_answer_count.toString(),
            className: "score-row score-row-neutral",
        },
        {
            label: "Unsure as Zero",
            value: formatPvUVariantSummaryForPdf(auditSession, "unsure_as_zero"),
            className: "score-row score-row-neutral",
        },
        {
            label: "Unsure as Maximum",
            value: formatPvUVariantSummaryForPdf(auditSession, "unsure_as_max"),
            className: "score-row score-row-neutral",
        },
    ];
}

interface ScoreSummaryDisplayRow {
    readonly label: string;
    readonly value: string;
    readonly className: string;
}

function renderKeyValuePanel(title: string, rows: readonly (readonly [string, SpreadsheetCell])[]): string {
    return [
        '<table class="info-table">',
        `<thead><tr><th colspan="2">${escapeHtml(title)}</th></tr></thead>`,
        "<tbody>",
        rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join(""),
        "</tbody>",
        "</table>",
    ].join("");
}

function renderScoreSummary(rows: readonly ScoreSummaryDisplayRow[]): string {
    return [
        '<table class="score-summary">',
        "<thead><tr><th>Score Metric</th><th>Value</th></tr></thead>",
        "<tbody>",
        rows
            .map(
                (row) =>
                    `<tr class="${row.className}"><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`,
            )
            .join(""),
        "</tbody>",
        "</table>",
    ].join("");
}

function renderPdfResponseMatrix(exportableAudit: ExportableAudit, instrument: PlayspaceInstrument): string {
    const head = PDF_RESPONSE_HEADERS.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
    const rows = buildPdfResponseRows(exportableAudit, instrument).join("");
    return [
        '<table class="response-matrix pdf-response-matrix">',
        `<thead><tr>${head}</tr></thead>`,
        `<tbody>${rows}</tbody>`,
        "</table>",
    ].join("");
}

function buildAuditDetailsRows(exportableAudit: ExportableAudit, instrument: PlayspaceInstrument): [string, string][] {
    const { auditSession, context } = exportableAudit;
    const finalComments = auditSession.meta.final_comments?.trim() ?? "";
    const rows: [string, string][] = [
        ["Place", auditSession.place_name],
        ["Project", auditSession.project_name],
        ["Status", formatAuditStatusLabel(auditSession.status)],
        ["Mode", formatExecutionModeLabel(auditSession, instrument)],
        ["Started", formatTimestampForDisplay(auditSession.started_at)],
        ["Submitted", formatTimestampForDisplay(auditSession.submitted_at)],
    ];

    if (context?.city || context?.province || context?.country) {
        const locationParts = [context?.city, context?.province, context?.country].filter(Boolean);
        rows.push(["Location", locationParts.join(", ")]);
    }
    if (finalComments.length > 0) {
        rows.push(["Final Comments", finalComments]);
    }

    return rows;
}

function buildPdfResponseRows(exportableAudit: ExportableAudit, instrument: PlayspaceInstrument): string[] {
    const { auditSession } = exportableAudit;
    const executionMode = resolveExecutionMode(auditSession);
    const rows: string[] = [];
    let questionRowIndex = 0;
    let overallTotals = createEmptyScoreTotals();

    for (const [sectionIndex, section] of instrument.sections.entries()) {
        const sectionResponses = auditSession.sections[section.section_key]?.responses ?? {};
        const visibleQuestions = section.questions.filter((question) =>
            isQuestionVisible(question, executionMode, sectionResponses),
        );
        if (visibleQuestions.length === 0) continue;

        const sectionState = auditSession.sections[section.section_key];
        let sectionTotals = createEmptyScoreTotals();

        rows.push(
            renderBannerRow(`Section ${sectionIndex + 1} · ${stripPromptMarkup(section.title)}`, "section-title"),
        );

        const description = typeof section.description === "string" ? stripPromptMarkup(section.description) : "";
        if (description.length > 0) {
            rows.push(renderBannerRow(description, "section-description"));
        }

        const instruction = stripPromptMarkup(section.instruction);
        if (instruction.length > 0) {
            rows.push(renderBannerRow(`Instruction: ${instruction}`, "section-instruction"));
        }

        const notesPrompt = typeof section.notes_prompt === "string" ? stripPromptMarkup(section.notes_prompt) : "";
        if (notesPrompt.length > 0) {
            rows.push(renderBannerRow(`Notes Prompt: ${notesPrompt}`, "section-notes"));
        }

        for (const question of visibleQuestions) {
            const answers = sectionState?.responses[question.question_key] ?? {};
            const scores = calculateQuestionScores(question, answers);
            sectionTotals = addScoreTotals(sectionTotals, scores);
            rows.push(renderPdfQuestionRow(sectionIndex, questionRowIndex, question, answers, scores));

            const questionComment = typeof answers.question_note === "string" ? answers.question_note.trim() : "";
            if (questionComment.length > 0) {
                rows.push(renderBannerRow(`Auditor Comment: ${questionComment}`, "question-comment"));
            }

            questionRowIndex += 1;
        }

        const sectionNote = sectionState?.note ?? "";
        rows.push(
            renderBannerRow(
                sectionNote.trim().length > 0 ? `Auditor Note: ${sectionNote.trim()}` : "",
                "section-notes",
            ),
        );
        rows.push(renderPdfScoreRow(`Section ${sectionIndex + 1} Total`, sectionTotals, "raw"));
        rows.push(renderPdfScoreRow(`Section ${sectionIndex + 1} Max`, sectionTotals, "maximum"));
        rows.push(renderPdfScoreRow(`Section ${sectionIndex + 1} Percent`, sectionTotals, "percentage"));
        overallTotals = addScoreTotals(overallTotals, sectionTotals);
    }

    if (rows.length > 0) {
        rows.push(renderBannerRow("", "section-separator"));
        rows.push(renderPdfScoreRow("Overall Total", overallTotals, "raw"));
        rows.push(renderPdfScoreRow("Overall Max", overallTotals, "maximum"));
        rows.push(renderPdfScoreRow("Overall Percent", overallTotals, "percentage"));
    }

    return rows;
}

function renderPdfQuestionRow(
    sectionIndex: number,
    questionRowIndex: number,
    question: InstrumentQuestion,
    answers: QuestionResponsePayload,
    scores: AuditScoreTotals,
): string {
    const fallbackQuestionKey = `${sectionIndex + 1}.${questionRowIndex + 1}`;
    const questionKey = formatQuestionKeyForDisplay(question.question_key, fallbackQuestionKey);
    const isChecklist = question.question_type === "checklist";
    const provisionAnswer = isChecklist
        ? formatChecklistAnswer(question, answers)
        : formatQuestionAnswer(
              question,
              "provision",
              typeof answers.provision === "string" ? answers.provision : undefined,
          );
    const varietyAnswer = isChecklist
        ? ""
        : formatQuestionAnswer(question, "variety", typeof answers.variety === "string" ? answers.variety : undefined);
    // A multi-answer Sociability scale stores an array, so the shared formatter decides what the
    // cell says; the scalar path stays untouched for historical instruments.
    const sociabilityAnswer = isChecklist
        ? ""
        : isMultipleSociabilityQuestion(question)
          ? formatSociabilityAnswerForExport(question, answers)
          : formatQuestionAnswer(
                question,
                "sociability",
                typeof answers.sociability === "string" ? answers.sociability : undefined,
            );
    const challengeAnswer = isChecklist
        ? ""
        : formatQuestionAnswer(
              question,
              "challenge",
              typeof answers.challenge === "string" ? answers.challenge : undefined,
          );

    const cells: readonly { readonly value: SpreadsheetCell; readonly className?: string }[] = [
        { value: questionKey, className: "key-cell" },
        { value: formatQuestionModeLabel(question.mode), className: "muted-cell" },
        { value: formatConstructLabel(question.constructs), className: "muted-cell" },
        { value: stripPromptMarkup(question.prompt) },
        { value: provisionAnswer, className: "scale-provision" },
        { value: varietyAnswer, className: "scale-variety" },
        { value: sociabilityAnswer, className: "scale-sociability" },
        { value: challengeAnswer, className: "scale-challenge" },
        {
            value: question.constructs.includes("play_value") ? scores.play_value_total : "N/A",
            className: "score-cell",
        },
        { value: question.constructs.includes("usability") ? scores.usability_total : "N/A", className: "score-cell" },
    ];

    return `<tr>${cells
        .map((cell) => `<td${cell.className ? ` class="${cell.className}"` : ""}>${escapeHtml(cell.value)}</td>`)
        .join("")}</tr>`;
}

function renderBannerRow(text: string, className: string): string {
    return `<tr class="banner-row ${className}"><td colspan="${PDF_RESPONSE_HEADERS.length}">${escapeHtml(text)}</td></tr>`;
}

function renderPdfScoreRow(label: string, totals: AuditScoreTotals, kind: "raw" | "maximum" | "percentage"): string {
    const format = (value: number, maximum: number): SpreadsheetCell => {
        if (kind === "raw") return value;
        if (kind === "maximum") return maximum;
        return formatPercentage(value, maximum);
    };

    return [
        '<tr class="pdf-score-row">',
        `<td colspan="4" class="score-label-cell">${escapeHtml(label)}</td>`,
        `<td class="scale-provision">${escapeHtml(format(totals.provision_total, totals.provision_total_max))}</td>`,
        `<td class="scale-variety">${escapeHtml(format(totals.variety_total, totals.variety_total_max))}</td>`,
        `<td class="scale-sociability">${escapeHtml(format(totals.sociability_total, totals.sociability_total_max))}</td>`,
        `<td class="scale-challenge">${escapeHtml(format(totals.challenge_total, totals.challenge_total_max))}</td>`,
        `<td class="score-cell neutral-score-cell">${escapeHtml(format(totals.play_value_total, totals.play_value_total_max))}</td>`,
        `<td class="score-cell neutral-score-cell">${escapeHtml(format(totals.usability_total, totals.usability_total_max))}</td>`,
        "</tr>",
    ].join("");
}

function renderGenericTable(rows: readonly SpreadsheetRow[], tableName: string): string {
    const [headerRow, ...bodyRows] = rows;
    const headerHtml = (headerRow ?? []).map((cell) => `<th>${escapeHtml(cell)}</th>`).join("");
    const bodyHtml = bodyRows
        .map((row) => {
            const rowClass = getGenericRowClass(row);
            const classAttribute = rowClass.length > 0 ? ` class="${rowClass}"` : "";
            const cells = row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("");
            return `<tr${classAttribute}>${cells}</tr>`;
        })
        .join("");

    return [
        `<table class="generic-table" data-table-name="${escapeHtml(tableName)}">`,
        `<thead><tr>${headerHtml}</tr></thead>`,
        `<tbody>${bodyHtml}</tbody>`,
        "</table>",
    ].join("");
}

function getGenericRowClass(row: SpreadsheetRow): string {
    const isScoreRow = row[2] === SCORE_ROW_SENTINEL;
    const isCommentRow = row[1] === COMMENT_ROW_SENTINEL;
    const isSectionNoteRow = row[1] === SECTION_NOTE_SENTINEL;
    const isSectionNoteResponseRow = row[1] === SECTION_NOTE_RESPONSE_SENTINEL;
    const isSectionHeaderRow = typeof row[0] === "string" && /^\d+$/u.test(row[0]) && row[1] === "" && row[2] === "";

    if (isSectionHeaderRow) return "section-row";
    if (isScoreRow) return "summary-row";
    if (isCommentRow) return "comment-row";
    if (isSectionNoteRow) return "section-note-row";
    if (isSectionNoteResponseRow) return "section-note-response-row";
    return "";
}

function buildPdfCss(): string {
    return `
@page { size: A4 portrait; margin: 14mm; }
@page response { size: A4 landscape; margin: 6mm; }
:root {
  --header-fill: ${palette.headerFill};
  --header-text: ${palette.headerText};
  --section-fill: ${palette.sectionFill};
  --section-title-text: ${palette.sectionTitleText};
  --section-text: ${palette.sectionText};
  --section-instruction-text: ${palette.sectionInstructionText};
  --section-notes-text: ${palette.sectionNotesText};
  --row-even: ${palette.rowEven};
  --row-odd: ${palette.rowOdd};
  --body-text: ${palette.bodyText};
  --sheet-body-text: ${palette.sheetBodyText};
  --muted-text: ${palette.mutedText};
  --border: ${palette.border};
  --border-strong: ${palette.borderStrong};
  --summary-fill: ${palette.summaryFill};
  --summary-text: ${palette.summaryText};
  --summary-neutral-fill: ${palette.summaryNeutralFill};
  --scale-provision-fill: ${palette.scaleFill.provision};
  --scale-variety-fill: ${palette.scaleFill.variety};
  --scale-sociability-fill: ${palette.scaleFill.sociability};
  --scale-challenge-fill: ${palette.scaleFill.challenge};
  --scale-provision-text: ${palette.scaleAccent.provision};
  --scale-variety-text: ${palette.scaleAccent.variety};
  --scale-sociability-text: ${palette.scaleAccent.sociability};
  --scale-challenge-text: ${palette.scaleAccent.challenge};
}
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: var(--body-text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 10px; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.summary-page { page: auto; }
.response-page { page: response; break-before: page; }
.generic-page:first-of-type { break-before: auto; }
.page-break { break-before: page; }
.audit-header { background: var(--header-fill); color: var(--header-text); margin: -14mm -14mm 14mm; padding: 7mm 14mm 5mm; }
.floating-header { margin: 0 0 10mm; padding: 6mm 8mm; }
.audit-header h1 { margin: 0 0 2mm; font-size: 18px; letter-spacing: 0.01em; }
.audit-header p { margin: 0; color: #cbd5e1; font-size: 10px; }
h2 { margin: 0 0 5mm; color: var(--header-fill); font-size: 13px; }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-bottom: 8mm; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; }
th, td { border: 1px solid var(--border); padding: 2.5mm 3mm; vertical-align: top; text-align: left; overflow-wrap: anywhere; white-space: pre-wrap; }
thead th { background: var(--header-fill); color: var(--header-text); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.info-table thead th { background: var(--section-fill); color: var(--section-title-text); text-transform: none; letter-spacing: 0; }
.info-table tbody th { width: 38%; color: var(--muted-text); font-weight: 700; }
.info-table tbody td { color: var(--body-text); }
.score-summary th, .score-summary td { padding: 2.5mm 3mm; }
.score-summary tbody th { width: 65%; }
.score-summary tbody td { width: 35%; text-align: right; }
.score-row-primary th, .score-row-primary td { background: var(--summary-fill); color: var(--summary-text); font-weight: 700; border-color: var(--summary-fill); }
.score-row-neutral th, .score-row-neutral td { background: var(--row-even); color: var(--body-text); }
.strong th, .strong td { font-weight: 700; }
.response-matrix { font-size: 7px; line-height: 1.25; }
.response-matrix th, .response-matrix td { padding: 1.6mm 1.8mm; }
.response-matrix thead th { font-size: 7px; text-transform: none; }
.response-matrix tbody tr:nth-child(even):not(.banner-row):not(.pdf-score-row) td { background: var(--row-even); }
.response-matrix tbody tr:nth-child(odd):not(.banner-row):not(.pdf-score-row) td { background: var(--row-odd); }
.response-matrix th:nth-child(1) { width: 8%; }
.response-matrix th:nth-child(2) { width: 5.5%; }
.response-matrix th:nth-child(3) { width: 6.5%; }
.response-matrix th:nth-child(4) { width: 28%; }
.response-matrix th:nth-child(5), .response-matrix th:nth-child(6), .response-matrix th:nth-child(7), .response-matrix th:nth-child(8) { width: 10%; }
.response-matrix th:nth-child(9), .response-matrix th:nth-child(10) { width: 6%; }
.key-cell { font-weight: 700; }
.muted-cell { color: var(--muted-text); }
.scale-provision { background: var(--scale-provision-fill) !important; color: var(--scale-provision-text) !important; }
.scale-variety { background: var(--scale-variety-fill) !important; color: var(--scale-variety-text) !important; }
.scale-sociability { background: var(--scale-sociability-fill) !important; color: var(--scale-sociability-text) !important; }
.scale-challenge { background: var(--scale-challenge-fill) !important; color: var(--scale-challenge-text) !important; }
.score-cell { background: var(--summary-fill) !important; color: var(--summary-text) !important; font-weight: 700; text-align: right; }
.neutral-score-cell { background: var(--summary-neutral-fill) !important; color: var(--body-text) !important; }
.banner-row td { background: var(--section-fill) !important; border-color: var(--section-fill); color: var(--section-text); }
.section-title td { color: var(--section-title-text); font-weight: 700; font-size: 8.5px; padding-top: 2.5mm; }
.section-description td { color: var(--section-text); }
.section-instruction td { color: var(--section-instruction-text); font-weight: 700; font-style: italic; }
.section-notes td, .question-comment td { color: var(--section-notes-text); font-style: italic; }
.section-separator td { padding: 1mm; }
.pdf-score-row td { font-weight: 700; text-align: center; border-color: transparent; }
.pdf-score-row .score-label-cell { background: var(--summary-fill) !important; color: var(--summary-text) !important; text-align: left; }
.generic-table { font-size: 8px; margin-bottom: 6mm; }
.generic-table tbody tr:nth-child(even) td { background: var(--row-even); }
.generic-table .section-row td, .generic-table .comment-row td, .generic-table .section-note-row td, .generic-table .section-note-response-row td { background: var(--section-fill) !important; }
.generic-table .section-row td { font-weight: 700; color: var(--section-title-text); }
.generic-table .comment-row td, .generic-table .section-note-response-row td { color: var(--muted-text); font-style: italic; }
.generic-table .section-note-row td { color: var(--section-title-text); font-weight: 700; }
.generic-table .summary-row td { background: var(--summary-fill) !important; color: var(--summary-text); font-weight: 700; }
`;
}
