import type {
    InstrumentQuestion,
    QuestionResponsePayload,
    QuestionScale,
    SociabilityBreakdown,
    SociabilityCategoryKey,
} from "./types";

export const SOCIABILITY_CATEGORY_KEYS = ["play_alone", "small_group", "large_group"] as const;

export const SOCIABILITY_EXPORT_HEADERS = [
    "Sociability - Play alone",
    "Sociability - Small group",
    "Sociability - Large group",
] as const;

export const SOCIABILITY_EXPORT_SELECTED = "Selected";
export const SOCIABILITY_EXPORT_NOT_SELECTED = "Not selected";
export const SOCIABILITY_EXPORT_NOT_CAPTURED = "Not captured";

export type SociabilityCategorySelections = Readonly<Record<SociabilityCategoryKey, boolean | null>>;

export interface SociabilitySelectionState {
    readonly selectionMode: QuestionScale["selection_mode"] | null;
    readonly captured: boolean;
    readonly selectedKeys: readonly SociabilityCategoryKey[];
    readonly selections: SociabilityCategorySelections;
}

const NOT_CAPTURED_SELECTIONS: SociabilityCategorySelections = {
    play_alone: null,
    small_group: null,
    large_group: null,
};

export function getSociabilityScale(question: InstrumentQuestion): QuestionScale | undefined {
    return question.scales.find((scale) => scale.key === "sociability");
}

export function isCanonicalMultipleSociabilityScale(scale: QuestionScale | undefined): boolean {
    if (scale?.key !== "sociability" || scale.selection_mode !== "multiple") {
        return false;
    }

    return (
        scale.options.length === SOCIABILITY_CATEGORY_KEYS.length &&
        SOCIABILITY_CATEGORY_KEYS.every((key, index) => scale.options[index]?.key === key)
    );
}

export function readSociabilitySelectionState(
    question: InstrumentQuestion,
    answers: QuestionResponsePayload,
): SociabilitySelectionState {
    const scale = getSociabilityScale(question);
    if (scale === undefined) {
        return {
            selectionMode: null,
            captured: false,
            selectedKeys: [],
            selections: NOT_CAPTURED_SELECTIONS,
        };
    }

    const rawAnswer = answers.sociability;
    if (scale.selection_mode !== "multiple") {
        return {
            selectionMode: "single",
            captured: typeof rawAnswer === "string" && rawAnswer.trim().length > 0,
            selectedKeys: [],
            selections: NOT_CAPTURED_SELECTIONS,
        };
    }

    if (!isCanonicalMultipleSociabilityScale(scale) || !isCanonicalSociabilityAnswer(rawAnswer)) {
        return {
            selectionMode: "multiple",
            captured: false,
            selectedKeys: [],
            selections: NOT_CAPTURED_SELECTIONS,
        };
    }

    const selectedKeySet = new Set(rawAnswer);
    return {
        selectionMode: "multiple",
        captured: true,
        selectedKeys: SOCIABILITY_CATEGORY_KEYS.filter((key) => selectedKeySet.has(key)),
        selections: {
            play_alone: selectedKeySet.has("play_alone"),
            small_group: selectedKeySet.has("small_group"),
            large_group: selectedKeySet.has("large_group"),
        },
    };
}

export function buildSociabilityExportCells(
    question: InstrumentQuestion,
    answers: QuestionResponsePayload,
): readonly [string, string, string] {
    const state = readSociabilitySelectionState(question, answers);
    if (!state.captured || state.selectionMode !== "multiple") {
        return [SOCIABILITY_EXPORT_NOT_CAPTURED, SOCIABILITY_EXPORT_NOT_CAPTURED, SOCIABILITY_EXPORT_NOT_CAPTURED];
    }

    return [
        state.selections.play_alone === true ? SOCIABILITY_EXPORT_SELECTED : SOCIABILITY_EXPORT_NOT_SELECTED,
        state.selections.small_group === true ? SOCIABILITY_EXPORT_SELECTED : SOCIABILITY_EXPORT_NOT_SELECTED,
        state.selections.large_group === true ? SOCIABILITY_EXPORT_SELECTED : SOCIABILITY_EXPORT_NOT_SELECTED,
    ];
}

export function formatMultipleSociabilityAnswer(
    question: InstrumentQuestion,
    answers: QuestionResponsePayload,
): string {
    const state = readSociabilitySelectionState(question, answers);
    const scale = getSociabilityScale(question);
    if (!state.captured || state.selectionMode !== "multiple" || scale === undefined) {
        return "";
    }

    return state.selectedKeys
        .map((selectedKey) => scale.options.find((option) => option.key === selectedKey)?.label ?? selectedKey)
        .join(" | ");
}

export function isQuestionScaleAnswerComplete(scale: QuestionScale, rawAnswer: unknown): boolean {
    if (scale.selection_mode === "multiple") {
        if (scale.key === "sociability") {
            return isCanonicalMultipleSociabilityScale(scale) && isCanonicalSociabilityAnswer(rawAnswer);
        }
        return (
            Array.isArray(rawAnswer) &&
            rawAnswer.length > 0 &&
            rawAnswer.every(
                (key, index): key is string =>
                    typeof key === "string" &&
                    key.trim().length > 0 &&
                    rawAnswer.indexOf(key) === index &&
                    scale.options.some((option) => option.key === key),
            )
        );
    }

    return (
        typeof rawAnswer === "string" &&
        rawAnswer.trim().length > 0 &&
        scale.options.some((option) => option.key === rawAnswer)
    );
}

/**
 * Report whether a scale captures an array answer instead of a single option key.
 */
export function isMultipleSelectionScale(scale: Pick<QuestionScale, "selection_mode">): boolean {
    return scale.selection_mode === "multiple";
}

/**
 * Read the stored selections of a multiple-selection scale in instrument option order.
 */
export function readMultipleScaleSelection(answers: QuestionResponsePayload, scale: QuestionScale): string[] {
    const rawAnswer = answers[scale.key];
    if (!Array.isArray(rawAnswer)) {
        return [];
    }

    const storedOptionKeys = new Set(rawAnswer.filter((entry): entry is string => typeof entry === "string"));
    return scale.options.filter((option) => storedOptionKeys.has(option.key)).map((option) => option.key);
}

/**
 * Toggle one option of a multiple-selection scale, keeping instrument option order.
 *
 * Clearing the last selection removes the scale key so the question reads as unanswered; the
 * backend rejects empty arrays, and an empty array would otherwise sync as a real answer.
 */
export function toggleMultipleScaleOption(
    currentAnswers: QuestionResponsePayload,
    scale: QuestionScale,
    optionKey: string,
): QuestionResponsePayload {
    const selectedOptionKeys = readMultipleScaleSelection(currentAnswers, scale);
    const nextSelectedOptionKeys = selectedOptionKeys.includes(optionKey)
        ? selectedOptionKeys.filter((currentKey) => currentKey !== optionKey)
        : scale.options
              .filter((option) => option.key === optionKey || selectedOptionKeys.includes(option.key))
              .map((option) => option.key);

    if (nextSelectedOptionKeys.length === 0) {
        const clearedAnswers: QuestionResponsePayload = { ...currentAnswers };
        delete clearedAnswers[scale.key];
        return clearedAnswers;
    }

    return { ...currentAnswers, [scale.key]: nextSelectedOptionKeys };
}

export function createEmptySociabilityBreakdown(): SociabilityBreakdown {
    return {
        model: "multi_select_v1",
        play_alone: { total: 0, max: 0 },
        small_group: { total: 0, max: 0 },
        large_group: { total: 0, max: 0 },
        captured_question_count: 0,
        eligible_question_count: 0,
    };
}

export function cloneSociabilityBreakdown(value: SociabilityBreakdown): SociabilityBreakdown {
    return {
        ...value,
        play_alone: { ...value.play_alone },
        small_group: { ...value.small_group },
        large_group: { ...value.large_group },
    };
}

export function addSociabilityBreakdowns(
    left: SociabilityBreakdown | null,
    right: SociabilityBreakdown | null,
): SociabilityBreakdown | null {
    if (left === null) {
        return right === null ? null : cloneSociabilityBreakdown(right);
    }
    if (right === null) {
        return cloneSociabilityBreakdown(left);
    }

    return {
        model: "multi_select_v1",
        play_alone: {
            total: left.play_alone.total + right.play_alone.total,
            max: left.play_alone.max + right.play_alone.max,
        },
        small_group: {
            total: left.small_group.total + right.small_group.total,
            max: left.small_group.max + right.small_group.max,
        },
        large_group: {
            total: left.large_group.total + right.large_group.total,
            max: left.large_group.max + right.large_group.max,
        },
        captured_question_count: left.captured_question_count + right.captured_question_count,
        eligible_question_count: left.eligible_question_count + right.eligible_question_count,
    };
}

function isCanonicalSociabilityAnswer(value: unknown): value is SociabilityCategoryKey[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > SOCIABILITY_CATEGORY_KEYS.length) {
        return false;
    }

    return value.every(
        (key, index): key is SociabilityCategoryKey =>
            typeof key === "string" &&
            SOCIABILITY_CATEGORY_KEYS.includes(key as SociabilityCategoryKey) &&
            value.indexOf(key) === index,
    );
}
