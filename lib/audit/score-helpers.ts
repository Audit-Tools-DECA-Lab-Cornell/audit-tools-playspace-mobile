import type {
    AuditScoreTotals,
    AuditScoreVariantBuckets,
    AuditSession,
    InstrumentQuestion,
    QuestionResponsePayload,
    QuestionScale,
    ScaleOption,
} from "lib/audit/types";
import {
    SOCIABILITY_CATEGORY_KEYS,
    addSociabilityBreakdowns,
    createEmptySociabilityBreakdown,
    getSociabilityScale,
    isCanonicalMultipleSociabilityScale,
} from "lib/audit/sociability";
import type { AuditorPlace } from "./places-api";

/**
 * Localized short labels used when rendering compact score summaries.
 */
export interface ScoreSummaryLabels {
    readonly playValueShort: string;
    readonly usabilityShort: string;
    readonly sociabilityShort: string;
    readonly provisionShort: string;
    readonly varietyShort: string;
    readonly challengeShort: string;
}

export interface ScorePair {
    readonly pv: number;
    readonly u: number;
}

interface MultiplierScaleScore {
    readonly columnTotal: number;
    readonly boostValue: number;
}

interface MultiplierScaleResult {
    readonly columnTotal: number;
    readonly columnTotalMax: number;
    readonly boostValue: number;
    readonly boostValueMax: number;
}

export type UnsurePolicy = "unsure_as_excluded" | "unsure_as_zero" | "unsure_as_max";
export type ScoreVariantKey = "canonical" | "unsure_as_zero" | "unsure_as_max";

const EMPTY_SCORE_TOTALS: AuditScoreTotals = {
    provision_total: 0,
    provision_total_max: 0,
    variety_total: 0,
    variety_total_max: 0,
    challenge_total: 0,
    challenge_total_max: 0,
    sociability_total: 0,
    sociability_total_max: 0,
    sociability_breakdown: null,
    play_value_total: 0,
    play_value_total_max: 0,
    usability_total: 0,
    usability_total_max: 0,
};

/**
 * Format one raw score value for compact UI surfaces.
 *
 * @param value Numeric score total.
 * @returns Integer-style text when possible, otherwise one decimal place.
 */
export function formatScoreValue(value: number): string {
    return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

/**
 * Format a compact PV/U score pair for mobile summary surfaces.
 *
 * @param value Score pair or null.
 * @returns `PV x | U y` or `null` when unavailable.
 */
export function formatScorePair(value: ScorePair | null | undefined): string | null {
    if (value === null || value === undefined) {
        return null;
    }

    return `PV ${formatScoreValue(value.pv)} | U ${formatScoreValue(value.u)}`;
}

/**
 * Format a PV/U score pair stacked one score per line.
 *
 * Used by the report stat cards, where each construct reads as its own metric
 * line instead of a single inline pair.
 *
 * @param value Score pair or null.
 * @returns `PV x\nU y` or `null` when unavailable.
 */
export function formatScorePairStacked(value: ScorePair | null | undefined): string | null {
    if (value === null || value === undefined) {
        return null;
    }

    return `PV ${formatScoreValue(value.pv)}\nU ${formatScoreValue(value.u)}`;
}

/**
 * Returns the score totals that correspond to what the auditor actually completed.
 * For audit-only sessions use the `audit` scores; for survey-only use `survey`;
 * for combined ("both") or unknown fall back to `overall`.
 */
export function getScoreVariantBuckets(
    scores: AuditSession["scores"],
    variant: ScoreVariantKey = "canonical",
): AuditSession["scores"] | AuditScoreVariantBuckets {
    if (variant === "unsure_as_zero") {
        return scores.unsure_variants?.unsure_as_zero ?? scores;
    }
    if (variant === "unsure_as_max") {
        return scores.unsure_variants?.unsure_as_max ?? scores;
    }
    return scores;
}

export function hasUnsureVariants(scores: AuditSession["scores"]): boolean {
    return scores.unsure_answer_count > 0 && scores.unsure_variants !== null;
}

export function getEffectiveAuditScoreTotals(
    scores: AuditSession["scores"],
    variant: ScoreVariantKey = "canonical",
): AuditScoreTotals | null {
    const selectedScores = getScoreVariantBuckets(scores, variant);
    if (selectedScores.execution_mode === "audit") {
        return selectedScores.audit ?? null;
    }
    if (selectedScores.execution_mode === "survey") {
        return selectedScores.survey ?? null;
    }
    return selectedScores.overall ?? null;
}

/**
 * Returns the score pair that reflects what the auditor actually submitted.
 * For audit-only submissions use `audit_scores`; for survey-only use `survey_scores`;
 * for combined ("both") or unknown mode fall back to `overall_scores`.
 */
export function getEffectivePlaceScores(place: AuditorPlace): ScorePair | null {
    if (place.selected_execution_mode === "audit") {
        return place.audit_scores ?? null;
    }
    if (place.selected_execution_mode === "survey") {
        return place.survey_scores ?? null;
    }
    return place.overall_scores ?? null;
}

/**
 * Create a new zeroed score bucket that mirrors the backend contract.
 *
 * @returns Empty raw/max score totals.
 */
export function createEmptyScoreTotals(): AuditScoreTotals {
    return { ...EMPTY_SCORE_TOTALS };
}

function createEmptyQuestionScoreTotals(question: InstrumentQuestion): AuditScoreTotals {
    const sociabilityScale = getSociabilityScale(question);
    if (sociabilityScale?.selection_mode !== "multiple") {
        return createEmptyScoreTotals();
    }

    return {
        ...createEmptyScoreTotals(),
        sociability_breakdown: createEmptySociabilityBreakdown(),
    };
}

/**
 * Add two score buckets together while preserving raw and max totals.
 *
 * @param left Left score bucket.
 * @param right Right score bucket.
 * @returns Summed score bucket.
 */
export function addScoreTotals(left: AuditScoreTotals, right: AuditScoreTotals): AuditScoreTotals {
    return {
        provision_total: left.provision_total + right.provision_total,
        provision_total_max: left.provision_total_max + right.provision_total_max,
        variety_total: left.variety_total + right.variety_total,
        variety_total_max: left.variety_total_max + right.variety_total_max,
        challenge_total: left.challenge_total + right.challenge_total,
        challenge_total_max: left.challenge_total_max + right.challenge_total_max,
        sociability_total: left.sociability_total + right.sociability_total,
        sociability_total_max: left.sociability_total_max + right.sociability_total_max,
        sociability_breakdown: addSociabilityBreakdowns(left.sociability_breakdown, right.sociability_breakdown),
        play_value_total: left.play_value_total + right.play_value_total,
        play_value_total_max: left.play_value_total_max + right.play_value_total_max,
        usability_total: left.usability_total + right.usability_total,
        usability_total_max: left.usability_total_max + right.usability_total_max,
    };
}

/**
 * Calculate one question's raw and maximum score totals using the same rules as
 * the backend response payload.
 *
 * @param question Instrument question definition.
 * @param answers Stored answer payload for the question.
 * @returns Question-level raw and maximum score totals.
 */
export function calculateQuestionScores(
    question: InstrumentQuestion,
    answers: QuestionResponsePayload,
    unsurePolicy: UnsurePolicy = "unsure_as_excluded",
): AuditScoreTotals {
    const emptyQuestionTotals = createEmptyQuestionScoreTotals(question);
    if (question.question_type !== "scaled" || question.scales.length === 0) {
        return emptyQuestionTotals;
    }

    const provisionScale = findScale(question, "provision");
    const provisionAnswerKey = typeof answers.provision === "string" ? answers.provision : undefined;
    if (provisionScale === undefined || provisionAnswerKey === undefined) {
        return emptyQuestionTotals;
    }

    const provisionOption = findScaleOption(provisionScale, provisionAnswerKey);
    if (provisionOption === undefined || isExcludingOption(provisionOption, unsurePolicy)) {
        return emptyQuestionTotals;
    }

    const provisionTotalMax = readProvisionScaleMaximum(question);
    const varietyMaximum = readMultiplierScaleMaximum(question, "variety");
    const challengeMaximum = readMultiplierScaleMaximum(question, "challenge");
    const sociabilityTotalMax = readSociabilityScaleMaximum(question);

    const provisionTotal =
        provisionOption.is_unsure && unsurePolicy === "unsure_as_max"
            ? provisionTotalMax
            : provisionOption.addition_value;
    let varietyTotal = 0;
    let varietyTotalMax = varietyMaximum.columnTotal;
    let varietyMultiplier = 1;
    let varietyMultiplierMax = varietyMaximum.boostValue;
    let challengeTotal = 0;
    let challengeTotalMax = challengeMaximum.columnTotal;
    let challengeMultiplier = 1;
    let challengeMultiplierMax = challengeMaximum.boostValue;
    let sociabilityTotal = 0;
    let resolvedSociabilityTotalMax = sociabilityTotalMax;
    let sociabilityBreakdown = emptyQuestionTotals.sociability_breakdown;

    if (provisionOption.is_unsure && unsurePolicy === "unsure_as_max") {
        varietyTotal = varietyTotalMax;
        varietyMultiplier = varietyMultiplierMax;
        challengeTotal = challengeTotalMax;
        challengeMultiplier = challengeMultiplierMax;
        sociabilityTotal = resolvedSociabilityTotalMax;
        if (sociabilityBreakdown !== null) {
            sociabilityBreakdown = {
                model: "multi_select_v1",
                play_alone: { total: 1, max: 1 },
                small_group: { total: 1, max: 1 },
                large_group: { total: 1, max: 1 },
                captured_question_count: 0,
                eligible_question_count: 1,
            };
        }
    } else if (provisionOption.allows_follow_up_scales) {
        const varietyResult = readMultiplierScaleResult(question, answers, "variety", unsurePolicy);
        varietyTotal = varietyResult.columnTotal;
        varietyTotalMax = varietyResult.columnTotalMax;
        varietyMultiplier = varietyResult.boostValue;
        varietyMultiplierMax = varietyResult.boostValueMax;

        const challengeResult = readMultiplierScaleResult(question, answers, "challenge", unsurePolicy);
        challengeTotal = challengeResult.columnTotal;
        challengeTotalMax = challengeResult.columnTotalMax;
        challengeMultiplier = challengeResult.boostValue;
        challengeMultiplierMax = challengeResult.boostValueMax;

        const sociabilityResult = readSociabilityScaleResult(question, answers, unsurePolicy);
        sociabilityTotal = sociabilityResult.total;
        resolvedSociabilityTotalMax = sociabilityResult.totalMax;
        sociabilityBreakdown = sociabilityResult.breakdown;
    } else if (sociabilityBreakdown !== null && provisionOption.is_unsure === true) {
        sociabilityBreakdown = {
            model: "multi_select_v1",
            play_alone: { total: 0, max: 1 },
            small_group: { total: 0, max: 1 },
            large_group: { total: 0, max: 1 },
            captured_question_count: 0,
            eligible_question_count: 1,
        };
    } else if (sociabilityBreakdown !== null) {
        resolvedSociabilityTotalMax = 0;
    }

    const constructTotal = provisionTotal * varietyMultiplier * challengeMultiplier;
    const constructTotalMax = provisionTotalMax * varietyMultiplierMax * challengeMultiplierMax;

    return {
        provision_total: roundScore(provisionTotal),
        provision_total_max: roundScore(provisionTotalMax),
        variety_total: roundScore(varietyTotal),
        variety_total_max: roundScore(varietyTotalMax),
        challenge_total: roundScore(challengeTotal),
        challenge_total_max: roundScore(challengeTotalMax),
        sociability_total: roundScore(sociabilityTotal),
        sociability_total_max: roundScore(resolvedSociabilityTotalMax),
        sociability_breakdown: sociabilityBreakdown,
        play_value_total: question.constructs.includes("play_value") ? roundScore(constructTotal) : 0,
        play_value_total_max: question.constructs.includes("play_value") ? roundScore(constructTotalMax) : 0,
        usability_total: question.constructs.includes("usability") ? roundScore(constructTotal) : 0,
        usability_total_max: question.constructs.includes("usability") ? roundScore(constructTotalMax) : 0,
    };
}

/**
 * Format a numeric result as a percentage of its maximum possible score.
 *
 * @param value Raw score.
 * @param maximum Maximum possible score.
 * @returns Compact percentage text or `--` when not available.
 */
export function formatPercentage(value: number, maximum: number): string {
    if (maximum <= 0) {
        return "--";
    }

    const percentage = (value / maximum) * 100;
    const roundedPercentage = Math.round(percentage * 10) / 10;
    return Number.isInteger(roundedPercentage)
        ? `${roundedPercentage.toFixed(0)}%`
        : `${roundedPercentage.toFixed(1)}%`;
}

/**
 * Rounded percent of max (0–100), used for report bar fill tiering. Mirrors web `report-helpers`.
 * @returns `null` when `max <= 0`.
 */
export function roundedPercentOfMax(value: number, max: number): number | null {
    if (max <= 0) {
        return null;
    }
    return Math.round((value / max) * 100);
}

/**
 * Bar color band from percentage: 70+ high, 40+ mid, below low, null for not assessed.
 * Matches `reportBarScoreTier` in `copa-frontend/src/lib/audit/report-helpers.ts`.
 */
export type ReportBarScoreTier = "na" | "high" | "mid" | "low";

export function reportBarScoreTier(percent: number | null): ReportBarScoreTier {
    if (percent === null) {
        return "na";
    }
    if (percent >= 70) {
        return "high";
    }
    if (percent >= 40) {
        return "mid";
    }
    return "low";
}

/**
 * Format a raw score followed by its percentage of the max score.
 *
 * @param value Raw score.
 * @param maximum Maximum possible score.
 * @returns Combined raw score and percentage display.
 */
export function formatScoreWithPercentage(value: number, maximum: number): string {
    const percentageText = formatPercentage(value, maximum);
    if (percentageText === "--") {
        return formatScoreValue(value);
    }
    return `${formatScoreValue(value)} (${percentageText})`;
}

/**
 * Build a short helper string that shows both the maximum score and percentage.
 *
 * @param value Raw score.
 * @param maximum Maximum possible score.
 * @returns Compact helper text for cards or summaries.
 */
export function formatScoreMeta(value: number, maximum: number): string {
    if (maximum <= 0) {
        return "--";
    }

    return `max = ${formatScoreValue(maximum)} | ${formatPercentage(value, maximum)}`;
}

/**
 * Collapse the two construct totals into one compact ranking value.
 *
 * @param scoreTotals Optional overall score totals.
 * @returns Combined play value plus usability score or `null` when unavailable.
 */
export function getCombinedConstructScore(scoreTotals: AuditScoreTotals | null | undefined): number | null {
    if (scoreTotals === null || scoreTotals === undefined) {
        return null;
    }
    return scoreTotals.play_value_total + scoreTotals.usability_total;
}

/**
 * Build a short construct summary for cards and list rows.
 *
 * @param scoreTotals Optional overall score totals.
 * @param labels Localized score labels.
 * @returns Compact summary text or a placeholder when scores are unavailable.
 */
export function formatConstructSummary(
    scoreTotals: AuditScoreTotals | null | undefined,
    labels: ScoreSummaryLabels,
): string {
    if (scoreTotals === null || scoreTotals === undefined) {
        return "--";
    }

    return [
        `${labels.playValueShort} ${formatScoreValue(scoreTotals.play_value_total)}`,
        `${labels.usabilityShort} ${formatScoreValue(scoreTotals.usability_total)}`,
        `${labels.sociabilityShort} ${formatScoreValue(scoreTotals.sociability_total)}`,
    ].join(" | ");
}

/**
 * Build a short column-total summary for the reports list.
 *
 * @param scoreTotals Optional overall score totals.
 * @param labels Localized score labels.
 * @returns Compact provision/variety/challenge summary or a placeholder.
 */
export function formatColumnSummary(
    scoreTotals: AuditScoreTotals | null | undefined,
    labels: ScoreSummaryLabels,
): string {
    if (scoreTotals === null || scoreTotals === undefined) {
        return "--";
    }

    return [
        `${labels.provisionShort} ${formatScoreValue(scoreTotals.provision_total)}`,
        `${labels.varietyShort} ${formatScoreValue(scoreTotals.variety_total)}`,
        `${labels.challengeShort} ${formatScoreValue(scoreTotals.challenge_total)}`,
    ].join(" | ");
}

/**
 * Find one scale definition on an instrument question.
 *
 * @param question Instrument question definition.
 * @param scaleKey Scale key to locate.
 * @returns Matching scale when present.
 */
function findScale(question: InstrumentQuestion, scaleKey: QuestionScale["key"]): QuestionScale | undefined {
    return question.scales.find((scale) => scale.key === scaleKey);
}

/**
 * Find one option definition inside a scale.
 *
 * @param scale Scale definition.
 * @param optionKey Stable option key.
 * @returns Matching option when present.
 */
function findScaleOption(scale: QuestionScale, optionKey: string): ScaleOption | undefined {
    return scale.options.find((option) => option.key === optionKey);
}

function isExcludingOption(option: ScaleOption, unsurePolicy: UnsurePolicy): boolean {
    return option.is_not_applicable || (option.is_unsure && unsurePolicy === "unsure_as_excluded");
}

function maxCandidateOptions(options: readonly ScaleOption[]): ScaleOption[] {
    return options.filter((option) => option.is_not_applicable !== true && option.is_unsure !== true);
}

function roundScore(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Read one variety/challenge answer as total, max, multiplier, and multiplier max.
 */
function readMultiplierScaleResult(
    question: InstrumentQuestion,
    answers: QuestionResponsePayload,
    scaleKey: "variety" | "challenge",
    unsurePolicy: UnsurePolicy,
): MultiplierScaleResult {
    const scale = findScale(question, scaleKey);
    if (scale === undefined) {
        return { columnTotal: 0, columnTotalMax: 0, boostValue: 1, boostValueMax: 1 };
    }

    const maximum = readMultiplierScaleMaximum(question, scaleKey);
    const answerKey = typeof answers[scaleKey] === "string" ? answers[scaleKey] : undefined;
    if (answerKey === undefined) {
        return {
            columnTotal: 0,
            columnTotalMax: maximum.columnTotal,
            boostValue: 1,
            boostValueMax: maximum.boostValue,
        };
    }

    const selectedOption = findScaleOption(scale, answerKey);
    if (selectedOption === undefined) {
        return {
            columnTotal: 0,
            columnTotalMax: maximum.columnTotal,
            boostValue: 1,
            boostValueMax: maximum.boostValue,
        };
    }

    if (isExcludingOption(selectedOption, unsurePolicy)) {
        return { columnTotal: 0, columnTotalMax: 0, boostValue: 1, boostValueMax: 1 };
    }

    if (selectedOption.is_unsure === true) {
        if (unsurePolicy === "unsure_as_max") {
            return {
                columnTotal: maximum.columnTotal,
                columnTotalMax: maximum.columnTotal,
                boostValue: maximum.boostValue,
                boostValueMax: maximum.boostValue,
            };
        }
        return {
            columnTotal: 0,
            columnTotalMax: maximum.columnTotal,
            boostValue: 1,
            boostValueMax: maximum.boostValue,
        };
    }

    const columnTotal = Math.max(selectedOption.addition_value - 1, 0);
    const boostValue = selectedOption.addition_value <= 0 ? 1 : selectedOption.boost_value;
    return {
        columnTotal,
        columnTotalMax: maximum.columnTotal,
        boostValue,
        boostValueMax: maximum.boostValue,
    };
}

/**
 * Read the highest possible variety/challenge total and multiplier for one question.
 *
 * @param question Instrument question definition.
 * @param scaleKey Scale to inspect.
 * @returns Maximum column total plus maximum boost multiplier.
 */
function readMultiplierScaleMaximum(
    question: InstrumentQuestion,
    scaleKey: "variety" | "challenge",
): MultiplierScaleScore {
    const scale = findScale(question, scaleKey);
    if (scale === undefined) {
        return { columnTotal: 0, boostValue: 1 };
    }

    const candidateOptions = maxCandidateOptions(scale.options);
    const columnTotal = candidateOptions.reduce((currentMaximum, option) => {
        return Math.max(currentMaximum, Math.max(option.addition_value - 1, 0));
    }, 0);
    const boostValue = candidateOptions.reduce((currentMaximum, option) => {
        return Math.max(currentMaximum, option.boost_value);
    }, 1);
    return { columnTotal, boostValue: Math.max(boostValue, 1) };
}

/**
 * Read the selected sociability column score and response-aware max for one question.
 */
function readSociabilityScaleResult(
    question: InstrumentQuestion,
    answers: QuestionResponsePayload,
    unsurePolicy: UnsurePolicy,
): {
    readonly total: number;
    readonly totalMax: number;
    readonly breakdown: AuditScoreTotals["sociability_breakdown"];
} {
    const scale = findScale(question, "sociability");
    if (scale === undefined) {
        return { total: 0, totalMax: 0, breakdown: null };
    }

    if (scale.selection_mode === "multiple") {
        return readMultipleSociabilityScaleResult(question, answers);
    }

    const totalMax = readSociabilityScaleMaximum(question);
    const answerKey = typeof answers.sociability === "string" ? answers.sociability : undefined;
    if (answerKey === undefined) {
        return { total: 0, totalMax, breakdown: null };
    }

    const selectedOption = findScaleOption(scale, answerKey);
    if (selectedOption === undefined) {
        return { total: 0, totalMax, breakdown: null };
    }

    if (isExcludingOption(selectedOption, unsurePolicy)) {
        return { total: 0, totalMax: 0, breakdown: null };
    }

    if (selectedOption.is_unsure === true) {
        return unsurePolicy === "unsure_as_max"
            ? { total: totalMax, totalMax, breakdown: null }
            : { total: 0, totalMax, breakdown: null };
    }

    return { total: Math.max(selectedOption.addition_value - 1, 0), totalMax, breakdown: null };
}

function readMultipleSociabilityScaleResult(
    question: InstrumentQuestion,
    answers: QuestionResponsePayload,
): {
    readonly total: number;
    readonly totalMax: number;
    readonly breakdown: NonNullable<AuditScoreTotals["sociability_breakdown"]>;
} {
    const scale = getSociabilityScale(question);
    if (!isCanonicalMultipleSociabilityScale(scale)) {
        throw new Error(
            `Question ${JSON.stringify(question.question_key)} multiple Sociability options must use the canonical ordered keys.`,
        );
    }

    const rawAnswer = answers.sociability;
    if (rawAnswer === undefined) {
        return {
            total: 0,
            totalMax: 3,
            breakdown: {
                model: "multi_select_v1",
                play_alone: { total: 0, max: 1 },
                small_group: { total: 0, max: 1 },
                large_group: { total: 0, max: 1 },
                captured_question_count: 0,
                eligible_question_count: 1,
            },
        };
    }

    if (!Array.isArray(rawAnswer)) {
        throw new Error(
            `Question ${JSON.stringify(question.question_key)} multiple Sociability answer must be a list.`,
        );
    }
    if (rawAnswer.length === 0) {
        throw new Error(
            `Question ${JSON.stringify(question.question_key)} multiple Sociability answer must be non-empty.`,
        );
    }
    if (rawAnswer.some((answerKey) => typeof answerKey !== "string")) {
        throw new Error(
            `Question ${JSON.stringify(question.question_key)} multiple Sociability answer must contain strings only.`,
        );
    }

    const selectedKeys = rawAnswer.filter((answerKey): answerKey is string => typeof answerKey === "string");
    if (new Set(selectedKeys).size !== selectedKeys.length) {
        throw new Error(
            `Question ${JSON.stringify(question.question_key)} multiple Sociability answer contains duplicate keys.`,
        );
    }
    const unknownKeys = selectedKeys.filter(
        (answerKey) => !SOCIABILITY_CATEGORY_KEYS.includes(answerKey as (typeof SOCIABILITY_CATEGORY_KEYS)[number]),
    );
    if (unknownKeys.length > 0) {
        throw new Error(
            `Question ${JSON.stringify(question.question_key)} multiple Sociability answer contains unknown keys: ${JSON.stringify(unknownKeys)}.`,
        );
    }

    const selectedKeySet = new Set(selectedKeys);
    return {
        total: selectedKeys.length,
        totalMax: 3,
        breakdown: {
            model: "multi_select_v1",
            play_alone: { total: selectedKeySet.has("play_alone") ? 1 : 0, max: 1 },
            small_group: { total: selectedKeySet.has("small_group") ? 1 : 0, max: 1 },
            large_group: { total: selectedKeySet.has("large_group") ? 1 : 0, max: 1 },
            captured_question_count: 1,
            eligible_question_count: 1,
        },
    };
}

/**
 * Read the highest available sociability score for one question.
 *
 * @param question Instrument question definition.
 * @returns Maximum sociability total.
 */
function readSociabilityScaleMaximum(question: InstrumentQuestion): number {
    const scale = findScale(question, "sociability");
    if (scale === undefined) {
        return 0;
    }

    if (scale.selection_mode === "multiple") {
        return 3;
    }

    return maxCandidateOptions(scale.options).reduce((currentMaximum, option) => {
        return Math.max(currentMaximum, Math.max(option.addition_value - 1, 0));
    }, 0);
}

/**
 * Read the highest available provision score for one question.
 *
 * @param question Instrument question definition.
 * @returns Maximum provision/provision total.
 */
function readProvisionScaleMaximum(question: InstrumentQuestion): number {
    const scale = findScale(question, "provision");
    if (scale === undefined) {
        return 0;
    }

    return maxCandidateOptions(scale.options).reduce((currentMaximum, option) => {
        return Math.max(currentMaximum, option.addition_value);
    }, 0);
}
