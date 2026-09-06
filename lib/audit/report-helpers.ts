import {
    addScoreTotals,
    calculateQuestionScores,
    createEmptyScoreTotals,
    formatScoreValue,
    getEffectiveAuditScoreTotals,
    getScoreVariantBuckets,
    type ScoreVariantKey,
    type UnsurePolicy,
} from "lib/audit/score-helpers";
import {
    buildQuestionLookup,
    createDefaultReportFilter,
    getVisibleReportConstructs,
    getQuestionConstructKeys,
    isDefaultReportFilter,
    maskScoreTotalsByConstructSelection,
    pruneUnknownDomainOverrides,
    questionMatchesConstructSelection,
    resolveDomainConstructSelection,
    resolveQuestionConstructSelection,
    type ConstructSelection,
    type DomainConstructCoverage,
    type ReportResultFilter,
} from "lib/audit/report-filter";
import { isQuestionVisible } from "lib/audit/selectors";
import {
    SOCIABILITY_CATEGORY_KEYS,
    readSociabilitySelectionState,
    type SociabilityCategorySelections,
} from "lib/audit/sociability";
import type {
    AuditScoreTotals,
    AuditScoreVariantBuckets,
    AuditSession,
    InstrumentQuestion,
    PlayspaceInstrument,
    QuestionResponsePayload,
} from "lib/audit/types";

/**
 * One domain bucket with data for short and extended report views.
 */
export interface DomainReportRow {
    readonly domainKey: string;
    readonly domainTitle: string;
    readonly scoreTotals: AuditScoreTotals | null;
    readonly itemCount: number;
    readonly sectionNotes: string[];
    readonly commentOnlyNotes: string[];
    readonly filteredOutQuestionCount: number;
    readonly questions: DomainQuestionRow[];
}

export interface ReportScoreProjection {
    readonly filter: ReportResultFilter;
    readonly isFiltered: boolean;
    readonly domainRows: readonly DomainReportRow[];
    readonly scoreBuckets: AuditScoreVariantBuckets;
    readonly overall: AuditScoreTotals | null;
    readonly unsureAnswerCount: number;
    readonly visibleConstructs: ConstructSelection;
    readonly domainCoverage: Readonly<Record<string, DomainConstructCoverage>>;
}

/**
 * One instrument question row for the extended report items table.
 */
export interface DomainQuestionRow {
    readonly questionKey: string;
    readonly questionText: string;
    readonly checklistAnswerLabel: string | null;
    readonly provisionLabel: string | null;
    readonly provisionApplicable: boolean;
    readonly provisionAnswered: boolean;
    readonly provisionIsNotApplicable: boolean;
    readonly provisionIsUnsure: boolean;
    readonly varietyLabel: string | null;
    readonly varietyApplicable: boolean;
    readonly varietyAnswered: boolean;
    readonly varietyIsNotApplicable: boolean;
    readonly varietyIsUnsure: boolean;
    /** When `false`, the challenge column must show N/A (scale not present on question). */
    readonly challengeApplicable: boolean;
    readonly challengeLabel: string | null;
    readonly challengeAnswered: boolean;
    readonly challengeIsNotApplicable: boolean;
    readonly challengeIsUnsure: boolean;
    readonly sociabilityLabel: string | null;
    readonly sociabilityApplicable: boolean;
    readonly sociabilityAnswered: boolean;
    readonly sociabilityIsNotApplicable: boolean;
    readonly sociabilityIsUnsure: boolean;
    readonly sociabilityCapturedAsMultiselect: boolean;
    readonly sociabilitySelections: SociabilityCategorySelections;
    readonly followUpScalesAsked: boolean;
    readonly playValueScore: number | null;
    readonly playValueMax: number | null;
    readonly usabilityScore: number | null;
    readonly usabilityMax: number | null;
}

/**
 * Best/worst domain ranking for one scoring construct.
 */
export interface ConstructRanking {
    readonly constructKey: "provision" | "variety" | "challenge" | "sociability" | "play_value" | "usability";
    readonly bestDomain: {
        domainTitle: string;
        score: number;
        max: number;
    } | null;
    readonly worstDomain: {
        domainTitle: string;
        score: number;
        max: number;
    } | null;
}

export interface RankedDomain {
    readonly domainTitle: string;
    readonly score: number;
    readonly max: number;
    /** Share of the maximum, 0-100, rounded for display. Ranking uses the unrounded ratio. */
    readonly percent: number;
}

export interface SociabilityCategoryRanking {
    readonly categoryKey: (typeof SOCIABILITY_CATEGORY_KEYS)[number];
    readonly capturedQuestionCount: number;
    readonly eligibleQuestionCount: number;
    /** First domain of {@link bestDomains}; kept so single-example callers stay simple. */
    readonly bestDomain: ConstructRanking["bestDomain"];
    /** First domain of {@link worstDomains}. */
    readonly worstDomain: ConstructRanking["worstDomain"];
    /** Every domain tied at the highest share of the maximum. */
    readonly bestDomains: readonly RankedDomain[];
    /** Every domain tied at the lowest share of the maximum. */
    readonly worstDomains: readonly RankedDomain[];
    /** Domains that have a positive maximum for this opportunity and can therefore be compared. */
    readonly comparableDomainCount: number;
    /**
     * False when nothing can be compared: no domain has a positive maximum, or only one domain does
     * and naming it both highest and lowest would mislead.
     */
    readonly hasSufficientData: boolean;
    /** Every comparable domain shares the same share of the maximum. */
    readonly allTied: boolean;
}

export interface SociabilityBreakdownCoverage {
    readonly capturedQuestionCount: number;
    readonly eligibleQuestionCount: number;
    readonly isComplete: boolean;
}

type ConstructAccessor = {
    readonly key: ConstructRanking["constructKey"];
    readonly value: (totals: AuditScoreTotals) => number;
    readonly max: (totals: AuditScoreTotals) => number;
};

type InstrumentSectionDefinition = PlayspaceInstrument["sections"][number];
type InstrumentScaleDefinition = InstrumentQuestion["scales"][number];
type InstrumentScaleOptionDefinition = InstrumentScaleDefinition["options"][number];

const CONSTRUCT_ACCESSORS: readonly ConstructAccessor[] = [
    { key: "provision", value: (t) => t.provision_total, max: (t) => t.provision_total_max },
    { key: "variety", value: (t) => t.variety_total, max: (t) => t.variety_total_max },
    { key: "challenge", value: (t) => t.challenge_total, max: (t) => t.challenge_total_max },
    { key: "sociability", value: (t) => t.sociability_total, max: (t) => t.sociability_total_max },
    { key: "play_value", value: (t) => t.play_value_total, max: (t) => t.play_value_total_max },
    { key: "usability", value: (t) => t.usability_total, max: (t) => t.usability_total_max },
];

const UNSURE_POLICY_BY_VARIANT: Record<ScoreVariantKey, UnsurePolicy> = {
    canonical: "unsure_as_excluded",
    unsure_as_zero: "unsure_as_zero",
    unsure_as_max: "unsure_as_max",
};

/**
 * Convert a snake_case domain key to a human title.
 *
 * @param domainKey Backend domain identifier.
 * @returns Title-cased label.
 */
export function toDomainTitle(domainKey: string): string {
    return domainKey
        .split("_")
        .map((word) => (word.length === 0 ? "" : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
        .join(" ");
}

/**
 * Normalize a raw domain label into the key domain rows and filter overrides use.
 *
 * @param domainKey Raw domain label from the instrument or `scores.by_domain`.
 * @returns Lowercased key with whitespace collapsed to underscores.
 */
export function normalizeDomainKey(domainKey: string): string {
    return domainKey.trim().toLowerCase().replace(/\s+/g, "_");
}

function toTokenSet(value: string): Set<string> {
    return new Set(
        value
            .toLowerCase()
            .replace(/[^a-z0-9\s_]/g, " ")
            .split(/[\s_]+/)
            .map((part) => part.trim())
            .filter((part) => part.length > 0),
    );
}

function countTokenOverlap(a: Set<string>, b: Set<string>): number {
    let count = 0;
    a.forEach((token) => {
        if (b.has(token)) {
            count += 1;
        }
    });
    return count;
}

/**
 * Resolve the human label and state for a selected scale option.
 *
 * @param question Instrument question.
 * @param scaleKey Scale key (provision, variety, etc.).
 * @param answerKey Selected option key from responses.
 * @returns Label and answer-state metadata for report rendering.
 */
export function resolveScaleOptionInfo(
    question: InstrumentQuestion,
    scaleKey: string,
    answerKey: string | undefined,
): { label: string | null; answered: boolean; isNotApplicable: boolean; isUnsure: boolean } {
    if (answerKey === undefined || answerKey.length === 0) {
        return { label: null, answered: false, isNotApplicable: false, isUnsure: false };
    }
    const scale = question.scales.find((candidate: InstrumentScaleDefinition) => candidate.key === scaleKey);
    if (scale === undefined) {
        return { label: null, answered: false, isNotApplicable: false, isUnsure: false };
    }
    const option = scale.options.find((candidate: InstrumentScaleOptionDefinition) => candidate.key === answerKey);
    return {
        label: option?.label ?? null,
        answered: option !== undefined,
        isNotApplicable: option?.is_not_applicable === true,
        isUnsure: option?.is_unsure === true,
    };
}

function readStringAnswer(answers: QuestionResponsePayload, key: string): string | undefined {
    const raw = answers[key];
    return typeof raw === "string" ? raw : undefined;
}

function formatChecklistAnswerLabel(question: InstrumentQuestion, answers: QuestionResponsePayload): string | null {
    const selectedOptionKeys = answers.selected_option_keys;
    if (!Array.isArray(selectedOptionKeys) || selectedOptionKeys.length === 0) {
        return null;
    }

    const labels = selectedOptionKeys
        .filter((key): key is string => typeof key === "string")
        .map((key) => question.options.find((option) => option.key === key)?.label ?? key);
    const otherDetails = answers.other_details;
    if (typeof otherDetails === "object" && otherDetails !== null && !Array.isArray(otherDetails)) {
        const text = otherDetails.text;
        if (typeof text === "string" && text.trim().length > 0) {
            labels.push(`Other: ${text.trim()}`);
        }
    }

    return labels.length > 0 ? labels.join(" | ") : null;
}

function resolveQuestionDomainKeys(
    question: InstrumentQuestion,
    questionLookup: Readonly<Record<string, InstrumentQuestion>> | undefined,
    visitedQuestionKeys: Set<string>,
): string[] {
    const ordered: string[] = [];
    const seen = new Set<string>();
    question.domains.forEach((domainKey: string) => {
        const normalized = normalizeDomainKey(domainKey);
        if (normalized.length === 0 || seen.has(normalized)) {
            return;
        }
        seen.add(normalized);
        ordered.push(normalized);
    });
    if (ordered.length > 0) {
        return ordered;
    }

    const parentQuestionKey = question.display_if?.question_key;
    if (questionLookup === undefined || parentQuestionKey === undefined || visitedQuestionKeys.has(parentQuestionKey)) {
        return ordered;
    }

    const parentQuestion = questionLookup[parentQuestionKey];
    if (parentQuestion === undefined) {
        return ordered;
    }

    const nextVisitedQuestionKeys = new Set(visitedQuestionKeys);
    nextVisitedQuestionKeys.add(parentQuestionKey);
    return resolveQuestionDomainKeys(parentQuestion, questionLookup, nextVisitedQuestionKeys);
}

/**
 * Return distinct non-empty domain keys for a question, preserving instrument order.
 * Questions may list multiple domains; each is included once.
 */
export function getQuestionDomainKeys(
    question: InstrumentQuestion,
    questionLookup?: Readonly<Record<string, InstrumentQuestion>>,
): string[] {
    return resolveQuestionDomainKeys(question, questionLookup, new Set([question.question_key]));
}

/**
 * Count distinct scaled questions that carry at least one domain (for the overall score table row).
 * Avoids double-counting questions that appear under multiple domain sections.
 */
export function countUniqueScaledQuestionsWithDomains(instrument: PlayspaceInstrument): number {
    const questionLookup = Object.fromEntries(
        instrument.sections.flatMap((section: InstrumentSectionDefinition) =>
            section.questions.map((question: InstrumentQuestion) => [question.question_key, question] as const),
        ),
    ) as Readonly<Record<string, InstrumentQuestion>>;
    const questionKeys = new Set<string>();
    instrument.sections.forEach((section: InstrumentSectionDefinition) => {
        section.questions.forEach((question: InstrumentQuestion) => {
            if (question.question_type !== "scaled") {
                return;
            }
            if (getQuestionDomainKeys(question, questionLookup).length === 0) {
                return;
            }
            questionKeys.add(question.question_key);
        });
    });
    return questionKeys.size;
}

export function countIncludedUniqueScaledQuestionsWithDomains(
    auditSession: AuditSession,
    instrument: PlayspaceInstrument,
    filter: ReportResultFilter,
): number {
    const questionLookup = buildQuestionLookup(instrument);
    const executionMode =
        auditSession.selected_execution_mode ?? auditSession.meta.execution_mode ?? auditSession.scores.execution_mode;
    const includedQuestionKeys = new Set<string>();

    instrument.sections.forEach((section) => {
        const sectionResponses = auditSession.aggregate.sections[section.section_key]?.responses ?? {};
        section.questions
            .filter((question) => isQuestionVisible(question, executionMode, sectionResponses))
            .forEach((question) => {
                if (
                    question.question_type !== "scaled" ||
                    getQuestionDomainKeys(question, questionLookup).length === 0
                ) {
                    return;
                }
                const selection = resolveQuestionConstructSelection(
                    question,
                    questionLookup,
                    getQuestionDomainKeys,
                    filter,
                );
                if (questionMatchesConstructSelection(getQuestionConstructKeys(question, questionLookup), selection)) {
                    includedQuestionKeys.add(question.question_key);
                }
            });
    });

    return includedQuestionKeys.size;
}

function buildDomainQuestionRow(
    question: InstrumentQuestion,
    answers: QuestionResponsePayload,
    selection: ConstructSelection | null,
    unsurePolicy: UnsurePolicy,
): DomainQuestionRow {
    const rawScores = calculateQuestionScores(question, answers, unsurePolicy);
    const scores = selection === null ? rawScores : maskScoreTotalsByConstructSelection(rawScores, selection);
    const provisionAnswerKey = readStringAnswer(answers, "provision");
    const provisionInfo = resolveScaleOptionInfo(question, "provision", provisionAnswerKey);
    const provisionScale = question.scales.find((scale: InstrumentScaleDefinition) => scale.key === "provision");
    const provisionApplicable = provisionScale !== undefined;
    const provisionOption =
        provisionScale === undefined || provisionAnswerKey === undefined
            ? undefined
            : provisionScale.options.find(
                  (option: InstrumentScaleOptionDefinition) => option.key === provisionAnswerKey,
              );
    const followUpScalesAsked = provisionOption?.allows_follow_up_scales === true;
    const varietyInfo = resolveScaleOptionInfo(question, "variety", readStringAnswer(answers, "variety"));
    const varietyApplicable = question.scales.some((scale: InstrumentScaleDefinition) => scale.key === "variety");
    const challengeInfo = resolveScaleOptionInfo(question, "challenge", readStringAnswer(answers, "challenge"));
    const challengeApplicable = question.scales.some((scale: InstrumentScaleDefinition) => scale.key === "challenge");
    const sociabilityInfo = resolveScaleOptionInfo(question, "sociability", readStringAnswer(answers, "sociability"));
    const sociabilitySelectionState = readSociabilitySelectionState(question, answers);
    const sociabilityApplicable = question.scales.some(
        (scale: InstrumentScaleDefinition) => scale.key === "sociability",
    );

    const playValueMax = scores.play_value_total_max;
    const usabilityMax = scores.usability_total_max;

    return {
        questionKey: question.question_key,
        questionText: question.prompt,
        checklistAnswerLabel:
            question.question_type === "checklist" ? formatChecklistAnswerLabel(question, answers) : null,
        provisionLabel: provisionInfo.label,
        provisionApplicable,
        provisionAnswered: provisionInfo.answered,
        provisionIsNotApplicable: provisionInfo.isNotApplicable,
        provisionIsUnsure: provisionInfo.isUnsure,
        varietyLabel: varietyInfo.label,
        varietyApplicable,
        varietyAnswered: varietyInfo.answered,
        varietyIsNotApplicable: varietyInfo.isNotApplicable,
        varietyIsUnsure: varietyInfo.isUnsure,
        challengeApplicable,
        challengeLabel: challengeInfo.label,
        challengeAnswered: challengeInfo.answered,
        challengeIsNotApplicable: challengeInfo.isNotApplicable,
        challengeIsUnsure: challengeInfo.isUnsure,
        sociabilityLabel: sociabilityInfo.label,
        sociabilityApplicable,
        sociabilityAnswered: sociabilityInfo.answered,
        sociabilityIsNotApplicable: sociabilityInfo.isNotApplicable,
        sociabilityIsUnsure: sociabilityInfo.isUnsure,
        sociabilityCapturedAsMultiselect:
            sociabilitySelectionState.selectionMode === "multiple" && sociabilitySelectionState.captured,
        sociabilitySelections: sociabilitySelectionState.selections,
        followUpScalesAsked,
        playValueScore: playValueMax <= 0 ? null : scores.play_value_total,
        playValueMax: playValueMax <= 0 ? null : playValueMax,
        usabilityScore: usabilityMax <= 0 ? null : scores.usability_total,
        usabilityMax: usabilityMax <= 0 ? null : usabilityMax,
    };
}

function collectSectionNote(
    auditSession: AuditSession,
    sectionKey: string,
    sectionIndex: number,
    sectionTitle: string,
): string | null {
    const sectionState = auditSession.aggregate.sections[sectionKey];
    const raw = sectionState?.note;
    if (raw === null || raw === undefined) {
        return null;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return null;
    }
    return `${sectionIndex}. ${sectionTitle}: ${trimmed}`;
}

function collectQuestionNote(
    question: InstrumentQuestion,
    answers: QuestionResponsePayload,
    sectionIndex: number,
): string | null {
    const raw = answers.question_note;
    if (typeof raw !== "string") {
        return null;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const parts = question.question_key.match(/\d+/g);
    const localIndex = parts !== null ? parts[parts.length - 1] : "?";
    return `${sectionIndex}.${localIndex} ${question.prompt.replaceAll("**", "")}: ${trimmed}`;
}

function parseQuestionKeyParts(questionKey: string): number[] {
    const matches = questionKey.match(/\d+/g);
    if (matches === null) {
        return [];
    }
    return matches.map((part) => Number.parseInt(part, 10)).filter((value) => Number.isFinite(value));
}

function compareQuestionRowsByIdentifier(a: DomainQuestionRow, b: DomainQuestionRow): number {
    const aParts = parseQuestionKeyParts(a.questionKey);
    const bParts = parseQuestionKeyParts(b.questionKey);
    const maxLength = Math.max(aParts.length, bParts.length);

    for (let index = 0; index < maxLength; index += 1) {
        const aValue = aParts[index];
        const bValue = bParts[index];
        if (aValue === undefined && bValue === undefined) {
            break;
        }
        if (aValue === undefined) {
            return -1;
        }
        if (bValue === undefined) {
            return 1;
        }
        if (aValue !== bValue) {
            return aValue - bValue;
        }
    }

    return a.questionKey.localeCompare(b.questionKey);
}

/**
 * Build ordered domain rows from session scores and the instrument definition.
 *
 * @param auditSession Loaded audit with scores and aggregate responses.
 * @param instrument Localized instrument definition.
 * @returns One row per domain in first-seen instrument order, plus orphan `by_domain` keys.
 * Questions may belong to multiple domains; each domain row lists every question that includes that domain.
 */
export interface BuildDomainReportRowsOptions {
    /** Report filter. Omitted or default-valued leaves the report unfiltered. */
    readonly filter?: ReportResultFilter;
    /** Unsure policy matching the selected score variant, used when recomputing filtered totals. */
    readonly unsurePolicy?: UnsurePolicy;
}

export function buildDomainReportRows(
    auditSession: AuditSession,
    instrument: PlayspaceInstrument,
    scoreBuckets: AuditSession["scores"] | AuditScoreVariantBuckets = auditSession.scores,
    options: BuildDomainReportRowsOptions = {},
): DomainReportRow[] {
    const filter = options.filter;
    const isFiltering = filter !== undefined && !isDefaultReportFilter(filter);
    const unsurePolicy = options.unsurePolicy ?? "unsure_as_excluded";
    const questionLookup = Object.fromEntries(
        instrument.sections.flatMap((section: InstrumentSectionDefinition) =>
            section.questions.map((question: InstrumentQuestion) => [question.question_key, question] as const),
        ),
    ) as Readonly<Record<string, InstrumentQuestion>>;
    const executionMode =
        auditSession.selected_execution_mode ?? auditSession.meta.execution_mode ?? scoreBuckets.execution_mode;
    const byDomain = scoreBuckets.by_domain;
    const normalizedScoreByDomain = new Map<string, AuditScoreTotals | null>();
    Object.entries(byDomain).forEach(([rawDomainKey, totals]) => {
        const normalizedKey = normalizeDomainKey(rawDomainKey);
        if (normalizedKey.length === 0) {
            return;
        }
        const existing = normalizedScoreByDomain.get(normalizedKey) ?? null;
        if (existing === null && totals !== null) {
            normalizedScoreByDomain.set(normalizedKey, totals);
            return;
        }
        if (!normalizedScoreByDomain.has(normalizedKey)) {
            normalizedScoreByDomain.set(normalizedKey, totals);
        }
    });

    const firstSeenDomainOrder: string[] = [];
    const firstSeenSet = new Set<string>();
    const dominantDomainOrder: string[] = [];
    const dominantSet = new Set<string>();

    instrument.sections.forEach((section: InstrumentSectionDefinition) => {
        const sectionDomainCounts = new Map<string, number>();
        const sectionFirstSeenIndex = new Map<string, number>();
        let sectionOrderCounter = 0;

        const sectionResponses = auditSession.aggregate.sections[section.section_key]?.responses ?? {};
        section.questions
            .filter((question: InstrumentQuestion) => isQuestionVisible(question, executionMode, sectionResponses))
            .forEach((question: InstrumentQuestion) => {
                getQuestionDomainKeys(question, questionLookup).forEach((domainKey) => {
                    sectionDomainCounts.set(domainKey, (sectionDomainCounts.get(domainKey) ?? 0) + 1);
                    if (!sectionFirstSeenIndex.has(domainKey)) {
                        sectionFirstSeenIndex.set(domainKey, sectionOrderCounter);
                        sectionOrderCounter += 1;
                    }
                    if (!firstSeenSet.has(domainKey)) {
                        firstSeenSet.add(domainKey);
                        firstSeenDomainOrder.push(domainKey);
                    }
                });
            });

        let dominantDomain: string | null = null;
        let dominantCount = -1;
        let dominantIndex = Number.POSITIVE_INFINITY;
        const sectionTitleTokens = toTokenSet(section.title);
        let dominantTitleOverlap = -1;
        sectionDomainCounts.forEach((count, domainKey) => {
            const candidateIndex = sectionFirstSeenIndex.get(domainKey) ?? Number.POSITIVE_INFINITY;
            const domainTitleTokens = toTokenSet(toDomainTitle(domainKey));
            const titleOverlap = countTokenOverlap(sectionTitleTokens, domainTitleTokens);

            if (count > dominantCount) {
                dominantDomain = domainKey;
                dominantCount = count;
                dominantIndex = candidateIndex;
                dominantTitleOverlap = titleOverlap;
                return;
            }

            if (count === dominantCount) {
                // No clear majority in this section: use section title overlap as tie-break.
                if (titleOverlap > dominantTitleOverlap) {
                    dominantDomain = domainKey;
                    dominantCount = count;
                    dominantIndex = candidateIndex;
                    dominantTitleOverlap = titleOverlap;
                    return;
                }
                if (titleOverlap === dominantTitleOverlap && candidateIndex < dominantIndex) {
                    dominantDomain = domainKey;
                    dominantCount = count;
                    dominantIndex = candidateIndex;
                    dominantTitleOverlap = titleOverlap;
                }
            }
        });

        if (dominantDomain !== null && !dominantSet.has(dominantDomain)) {
            dominantSet.add(dominantDomain);
            dominantDomainOrder.push(dominantDomain);
        }
    });

    const domainOrder: string[] = [...dominantDomainOrder];
    firstSeenDomainOrder.forEach((domainKey) => {
        if (!dominantSet.has(domainKey)) {
            domainOrder.push(domainKey);
            dominantSet.add(domainKey);
        }
    });
    normalizedScoreByDomain.forEach((_totals, domainKey) => {
        if (!dominantSet.has(domainKey)) {
            domainOrder.push(domainKey);
            dominantSet.add(domainKey);
        }
    });

    return domainOrder.map((domainKey) => {
        const domainSelection = filter === undefined ? null : resolveDomainConstructSelection(filter, domainKey);
        const domainIsFiltered =
            isFiltering && domainSelection !== null && !(domainSelection.playValue && domainSelection.usability);
        let recomputedTotals = domainIsFiltered ? createEmptyScoreTotals() : null;
        let scoreTotals = normalizedScoreByDomain.get(domainKey) ?? null;
        let itemCount = 0;
        let scoredItemCount = 0;
        let filteredOutQuestionCount = 0;
        const questions: DomainQuestionRow[] = [];
        const sectionNotes: string[] = [];
        const commentOnlyNotes: string[] = [];

        instrument.sections.forEach((section: InstrumentSectionDefinition, sectionIndex: number) => {
            let sectionTouchesDomain = false;
            const sectionResponses = auditSession.aggregate.sections[section.section_key]?.responses ?? {};
            section.questions
                .filter((question: InstrumentQuestion) => isQuestionVisible(question, executionMode, sectionResponses))
                .forEach((question: InstrumentQuestion) => {
                    const domainKeysForQuestion = getQuestionDomainKeys(question, questionLookup);
                    if (!domainKeysForQuestion.includes(domainKey)) {
                        return;
                    }
                    sectionTouchesDomain = true;
                    const responses = sectionResponses[question.question_key] ?? {};
                    const questionNote = collectQuestionNote(question, responses, sectionIndex + 1);
                    if (
                        domainSelection !== null &&
                        !questionMatchesConstructSelection(
                            getQuestionConstructKeys(question, questionLookup),
                            domainSelection,
                        )
                    ) {
                        filteredOutQuestionCount += 1;
                        if (questionNote !== null) {
                            commentOnlyNotes.push(questionNote);
                        }
                        return;
                    }
                    itemCount += 1;
                    if (recomputedTotals !== null && question.question_type === "scaled") {
                        scoredItemCount += 1;
                        recomputedTotals = addScoreTotals(
                            recomputedTotals,
                            calculateQuestionScores(question, responses, unsurePolicy),
                        );
                    }
                    if (question.question_type === "scaled" || question.question_type === "checklist") {
                        questions.push(buildDomainQuestionRow(question, responses, domainSelection, unsurePolicy));
                    }
                    if (questionNote !== null) {
                        sectionNotes.push(questionNote);
                    }
                });
            if (sectionTouchesDomain) {
                const note = collectSectionNote(auditSession, section.section_key, sectionIndex + 1, section.title);
                if (note !== null) {
                    sectionNotes.push(note);
                }
            }
        });

        questions.sort(compareQuestionRowsByIdentifier);

        if (recomputedTotals !== null) {
            scoreTotals =
                scoredItemCount === 0 || domainSelection === null
                    ? null
                    : maskScoreTotalsByConstructSelection(recomputedTotals, domainSelection);
        }

        return {
            domainKey,
            domainTitle: toDomainTitle(domainKey),
            scoreTotals,
            itemCount,
            sectionNotes,
            commentOnlyNotes,
            filteredOutQuestionCount,
            questions,
        };
    });
}

/**
 * Sum domain totals into one overall total.
 *
 * Overall figures are built by summing domain buckets, so a filtered report's
 * overall total is the sum of the domain totals it still contains.
 *
 * @param domainRows Domain rows, already filtered.
 * @returns Combined totals, or null when no domain carries a score.
 */
export function sumDomainScoreTotals(domainRows: readonly DomainReportRow[]): AuditScoreTotals | null {
    const scored = domainRows.filter((row) => row.scoreTotals !== null);
    if (scored.length === 0) {
        return null;
    }
    return scored.reduce<AuditScoreTotals>(
        (accumulated, row) => addScoreTotals(accumulated, row.scoreTotals as AuditScoreTotals),
        createEmptyScoreTotals(),
    );
}

export function getReportDomainConstructCoverage(
    auditSession: AuditSession,
    instrument: PlayspaceInstrument,
): Readonly<Record<string, DomainConstructCoverage>> {
    const questionLookup = buildQuestionLookup(instrument);
    const executionMode =
        auditSession.selected_execution_mode ?? auditSession.meta.execution_mode ?? auditSession.scores.execution_mode;
    const coverage: Record<string, DomainConstructCoverage> = {};

    instrument.sections.forEach((section) => {
        const sectionResponses = auditSession.aggregate.sections[section.section_key]?.responses ?? {};
        section.questions
            .filter((question) => isQuestionVisible(question, executionMode, sectionResponses))
            .forEach((question) => {
                const constructKeys = getQuestionConstructKeys(question, questionLookup);
                getQuestionDomainKeys(question, questionLookup).forEach((domainKey) => {
                    const current = coverage[domainKey] ?? { playValue: false, usability: false };
                    coverage[domainKey] = {
                        playValue: current.playValue || constructKeys.includes("play_value"),
                        usability: current.usability || constructKeys.includes("usability"),
                    };
                });
            });
    });

    return coverage;
}

interface FilteredScoreBuckets {
    readonly buckets: AuditScoreVariantBuckets;
    readonly unsureAnswerCount: number;
}

function countQuestionUnsureAnswers(question: InstrumentQuestion, answers: QuestionResponsePayload): number {
    const provisionScale = question.scales.find((scale) => scale.key === "provision");
    const provisionAnswer = typeof answers.provision === "string" ? answers.provision : null;
    const provisionOption = provisionScale?.options.find((option) => option.key === provisionAnswer);
    if (provisionOption === undefined) {
        return 0;
    }
    let count = provisionOption.is_unsure ? 1 : 0;
    if (!provisionOption.allows_follow_up_scales) {
        return count;
    }
    question.scales.forEach((scale) => {
        if (scale.key === "provision") {
            return;
        }
        const answer = answers[scale.key];
        if (typeof answer === "string" && scale.options.some((option) => option.key === answer && option.is_unsure)) {
            count += 1;
        }
    });
    return count;
}

function buildFilteredScoreBuckets(
    auditSession: AuditSession,
    instrument: PlayspaceInstrument,
    filter: ReportResultFilter,
    variant: ScoreVariantKey,
    domainRows: readonly DomainReportRow[],
): FilteredScoreBuckets {
    const selectedScores = getScoreVariantBuckets(auditSession.scores, variant);
    const executionMode =
        auditSession.selected_execution_mode ?? auditSession.meta.execution_mode ?? selectedScores.execution_mode;
    const unsurePolicy = UNSURE_POLICY_BY_VARIANT[variant];
    const questionLookup = buildQuestionLookup(instrument);
    const bySection: Record<string, AuditScoreTotals> = {};
    let auditTotals = createEmptyScoreTotals();
    let surveyTotals = createEmptyScoreTotals();
    let hasAuditQuestions = false;
    let hasSurveyQuestions = false;
    let unsureAnswerCount = 0;

    instrument.sections.forEach((section) => {
        const sectionResponses = auditSession.aggregate.sections[section.section_key]?.responses ?? {};
        let sectionTotals = createEmptyScoreTotals();
        let hasIncludedQuestions = false;

        section.questions
            .filter((question) => isQuestionVisible(question, executionMode, sectionResponses))
            .forEach((question) => {
                const selection = resolveQuestionConstructSelection(
                    question,
                    questionLookup,
                    getQuestionDomainKeys,
                    filter,
                );
                if (!questionMatchesConstructSelection(getQuestionConstructKeys(question, questionLookup), selection)) {
                    return;
                }

                hasIncludedQuestions = true;
                const answers = sectionResponses[question.question_key] ?? {};
                unsureAnswerCount += countQuestionUnsureAnswers(question, answers);
                const questionTotals = maskScoreTotalsByConstructSelection(
                    calculateQuestionScores(question, answers, unsurePolicy),
                    selection,
                );
                sectionTotals = addScoreTotals(sectionTotals, questionTotals);
                if (selectedScores.audit !== null && (question.mode === "audit" || question.mode === "both")) {
                    auditTotals = addScoreTotals(auditTotals, questionTotals);
                    hasAuditQuestions = true;
                }
                if (selectedScores.survey !== null && (question.mode === "survey" || question.mode === "both")) {
                    surveyTotals = addScoreTotals(surveyTotals, questionTotals);
                    hasSurveyQuestions = true;
                }
            });

        if (hasIncludedQuestions) {
            bySection[section.section_key] = sectionTotals;
        }
    });

    const byDomain = Object.fromEntries(
        domainRows.flatMap((row) => (row.scoreTotals === null ? [] : [[row.domainKey, row.scoreTotals] as const])),
    );

    return {
        buckets: {
            execution_mode: selectedScores.execution_mode,
            audit: hasAuditQuestions ? auditTotals : null,
            survey: hasSurveyQuestions ? surveyTotals : null,
            overall: sumDomainScoreTotals(domainRows),
            by_section: bySection,
            by_domain: byDomain,
        },
        unsureAnswerCount,
    };
}

export function buildReportScoreProjection(
    auditSession: AuditSession,
    instrument: PlayspaceInstrument,
    filterInput?: ReportResultFilter,
    variant: ScoreVariantKey = "canonical",
): ReportScoreProjection {
    const selectedScores = getScoreVariantBuckets(auditSession.scores, variant);
    const unfilteredRows = buildDomainReportRows(auditSession, instrument, selectedScores);
    const filter = pruneUnknownDomainOverrides(
        filterInput ?? createDefaultReportFilter(),
        unfilteredRows.map((row) => row.domainKey),
    );
    const isFiltered = !isDefaultReportFilter(filter);
    const domainRows = isFiltered
        ? buildDomainReportRows(auditSession, instrument, selectedScores, {
              filter,
              unsurePolicy: UNSURE_POLICY_BY_VARIANT[variant],
          })
        : unfilteredRows;
    const domainCoverage = getReportDomainConstructCoverage(auditSession, instrument);
    const filteredScoreBuckets = isFiltered
        ? buildFilteredScoreBuckets(auditSession, instrument, filter, variant, domainRows)
        : null;
    const scoreBuckets = filteredScoreBuckets?.buckets ?? selectedScores;

    return {
        filter,
        isFiltered,
        domainRows,
        scoreBuckets,
        overall: isFiltered ? scoreBuckets.overall : getEffectiveAuditScoreTotals(auditSession.scores, variant),
        unsureAnswerCount: filteredScoreBuckets?.unsureAnswerCount ?? auditSession.scores.unsure_answer_count,
        visibleConstructs: isFiltered
            ? getVisibleReportConstructs(filter, domainCoverage)
            : { playValue: true, usability: true },
        domainCoverage,
    };
}

/**
 * Build best- and worst-domain rankings for each construct.
 *
 * @param domainRows Domain rows with titles and score totals.
 * @returns Six construct rankings in a stable order.
 */
export function buildConstructRankings(domainRows: readonly DomainReportRow[]): ConstructRanking[] {
    return CONSTRUCT_ACCESSORS.map((accessor) => {
        const candidates: { title: string; score: number; max: number; ratio: number }[] = [];
        domainRows.forEach((row) => {
            if (row.scoreTotals === null) {
                return;
            }
            const maximum = accessor.max(row.scoreTotals);
            if (maximum <= 0) {
                return;
            }
            const value = accessor.value(row.scoreTotals);
            const ratio = value / maximum;
            candidates.push({
                title: row.domainTitle,
                score: value,
                max: maximum,
                ratio,
            });
        });

        if (candidates.length === 0) {
            return { constructKey: accessor.key, bestDomain: null, worstDomain: null };
        }

        const firstCandidate = candidates[0];
        if (firstCandidate === undefined) {
            return { constructKey: accessor.key, bestDomain: null, worstDomain: null };
        }

        let best = firstCandidate;
        let worst = firstCandidate;
        for (let index = 1; index < candidates.length; index += 1) {
            const current = candidates[index];
            if (current === undefined) {
                continue;
            }
            if (current.ratio > best.ratio) {
                best = current;
            }
            if (current.ratio < worst.ratio) {
                worst = current;
            }
        }

        return {
            constructKey: accessor.key,
            bestDomain: {
                domainTitle: best.title,
                score: best.score,
                max: best.max,
            },
            worstDomain: {
                domainTitle: worst.title,
                score: worst.score,
                max: worst.max,
            },
        };
    });
}

export function getSociabilityBreakdownCoverage(
    scoreTotals: AuditScoreTotals | null | undefined,
): SociabilityBreakdownCoverage | null {
    const breakdown = scoreTotals?.sociability_breakdown;
    if (breakdown === null || breakdown === undefined) {
        return null;
    }

    return {
        capturedQuestionCount: breakdown.captured_question_count,
        eligibleQuestionCount: breakdown.eligible_question_count,
        isComplete: breakdown.captured_question_count === breakdown.eligible_question_count,
    };
}

export function buildSociabilityCategoryRankings(domainRows: readonly DomainReportRow[]): SociabilityCategoryRanking[] {
    return SOCIABILITY_CATEGORY_KEYS.map((categoryKey) => {
        const candidates: { title: string; score: number; max: number; ratio: number }[] = [];
        let capturedQuestionCount = 0;
        let eligibleQuestionCount = 0;

        domainRows.forEach((row) => {
            const breakdown = row.scoreTotals?.sociability_breakdown;
            if (breakdown === null || breakdown === undefined) {
                return;
            }
            capturedQuestionCount += breakdown.captured_question_count;
            eligibleQuestionCount += breakdown.eligible_question_count;
            const category = breakdown[categoryKey];
            if (category.max <= 0) {
                return;
            }
            candidates.push({
                title: row.domainTitle,
                score: category.total,
                max: category.max,
                ratio: category.total / category.max,
            });
        });

        const { best, worst, allTied } = rankSociabilityCandidates(candidates);
        const bestDomain = best[0];
        const worstDomain = worst[0];

        return {
            categoryKey,
            capturedQuestionCount,
            eligibleQuestionCount,
            bestDomain:
                bestDomain === undefined
                    ? null
                    : { domainTitle: bestDomain.domainTitle, score: bestDomain.score, max: bestDomain.max },
            worstDomain:
                worstDomain === undefined
                    ? null
                    : { domainTitle: worstDomain.domainTitle, score: worstDomain.score, max: worstDomain.max },
            bestDomains: best,
            worstDomains: worst,
            comparableDomainCount: candidates.length,
            hasSufficientData: candidates.length >= 2,
            allTied,
        };
    });
}

/**
 * Ranking tolerance: ratios closer than this count as tied, so 1/3 and 2/6 rank together instead of
 * splitting on floating-point noise.
 */
const RANKING_TIE_TOLERANCE = 1e-9;

/**
 * Split ranked candidates into every domain tied at the top and every domain tied at the bottom.
 *
 * Ranking is by share of the maximum, so domains with different maximums stay comparable.
 */
function rankSociabilityCandidates(
    candidates: readonly { title: string; score: number; max: number; ratio: number }[],
): { best: readonly RankedDomain[]; worst: readonly RankedDomain[]; allTied: boolean } {
    if (candidates.length === 0) {
        return { best: [], worst: [], allTied: false };
    }

    const ratios = candidates.map((candidate) => candidate.ratio);
    const highest = Math.max(...ratios);
    const lowest = Math.min(...ratios);

    const toRanked = (candidate: (typeof candidates)[number]): RankedDomain => ({
        domainTitle: candidate.title,
        score: candidate.score,
        max: candidate.max,
        percent: Math.round(candidate.ratio * 100),
    });

    return {
        best: candidates
            .filter((candidate) => Math.abs(candidate.ratio - highest) <= RANKING_TIE_TOLERANCE)
            .map(toRanked),
        worst: candidates
            .filter((candidate) => Math.abs(candidate.ratio - lowest) <= RANKING_TIE_TOLERANCE)
            .map(toRanked),
        allTied: Math.abs(highest - lowest) <= RANKING_TIE_TOLERANCE,
    };
}

/**
 * Format a construct score line for best/worst cells.
 *
 * @param score Raw score total.
 * @param max Maximum score.
 * @returns Compact text for tables.
 */
export function formatConstructDomainLine(score: number, max: number): string {
    return `${formatScoreValue(score)} / ${formatScoreValue(max)}`;
}

/**
 * Returns a human-readable label for the audit execution mode.
 * "audit" → Place Audit, "survey" → Place Survey, "both" → Full Assessment.
 *
 * @param mode Execution mode from the audit scores object.
 * @param t Active translate function from the reports namespace.
 * @returns Localised label string.
 */
export function formatExecutionModeLabel(
    mode: AuditSession["scores"]["execution_mode"],
    t: (key: string, options: Record<string, string>) => string,
): string {
    if (mode === "audit") {
        return t("detail.auditTypePlaceAudit", { ns: "reports" });
    }
    if (mode === "survey") {
        return t("detail.auditTypePlaceSurvey", { ns: "reports" });
    }
    if (mode === "both") {
        return t("detail.auditTypeFullAssessment", { ns: "reports" });
    }
    return "-";
}
