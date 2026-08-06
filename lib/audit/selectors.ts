import type {
    AuditSession,
    ExecutionMode,
    InstrumentQuestion,
    QuestionResponsePayload,
    InstrumentSection,
    PlayspaceInstrument,
    PreAuditQuestion,
} from "lib/audit/types";
import { isQuestionScaleAnswerComplete } from "lib/audit/sociability";

/**
 * Progress for one instrument section derived from locally stored responses.
 * Mirrors visibility rules in `QuestionCard` so the execute overview stays
 * accurate before server `progress` updates arrive.
 */
export interface InstrumentSectionLocalProgress {
    readonly visibleQuestionCount: number;
    readonly answeredQuestionCount: number;
    readonly isComplete: boolean;
}

/**
 * Filter instrument sections down to those visible in the active execution mode.
 *
 * @param instrument Loaded playspace instrument.
 * @param executionMode Active execution mode.
 * @returns Sections that contain at least one visible question.
 */
export function getVisibleSections(
    instrument: PlayspaceInstrument,
    executionMode: ExecutionMode | null,
    sectionResponsesBySection: Record<string, Record<string, QuestionResponsePayload>> = {},
): InstrumentSection[] {
    if (executionMode === null) {
        return [];
    }

    return instrument.sections
        .map((section) => {
            return {
                ...section,
                questions: getVisibleQuestions(
                    section.questions,
                    executionMode,
                    sectionResponsesBySection[section.section_key] ?? {},
                ),
            };
        })
        .filter((section) => section.questions.length > 0);
}

/**
 * Filter questions down to those visible for one execution mode.
 *
 * @param questions Section question list.
 * @param executionMode Active execution mode.
 * @returns Question list visible to the current participant mode.
 */
export function getVisibleQuestions(
    questions: readonly InstrumentQuestion[],
    executionMode: ExecutionMode,
    sectionResponses: Record<string, QuestionResponsePayload> = {},
): InstrumentQuestion[] {
    return questions.filter((question) => {
        if (executionMode !== "both" && question.mode !== "both" && question.mode !== executionMode) {
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
            return selectedValue.some((entry) => question.display_if?.any_of_option_keys.includes(entry));
        }

        return false;
    });
}

/**
 * Read one section's nested question answers from the raw audit payload.
 *
 * @param auditSession Current audit session payload.
 * @param sectionKey Section key to inspect.
 * @returns Nested map of question answers.
 */
export function getSectionResponses(
    auditSession: AuditSession,
    sectionKey: string,
): Record<string, QuestionResponsePayload> {
    return auditSession.sections[sectionKey]?.responses ?? {};
}

/**
 * Read one section note from the raw audit payload.
 *
 * @param auditSession Current audit session payload.
 * @param sectionKey Section key to inspect.
 * @returns Stored note string or an empty string.
 */
export function getSectionNote(auditSession: AuditSession, sectionKey: string): string {
    return auditSession.sections[sectionKey]?.note ?? "";
}

/**
 * Read the stored pre-audit values from the raw audit payload.
 *
 * @param auditSession Current audit session payload.
 * @returns String-or-array map of saved pre-audit values.
 */
export function getPreAuditValues(auditSession: AuditSession): Record<string, string | string[]> {
    return {
        place_size: auditSession.pre_audit.place_size ?? "",
        current_users_0_5: auditSession.pre_audit.current_users_0_5 ?? "",
        current_users_6_12: auditSession.pre_audit.current_users_6_12 ?? "",
        current_users_13_17: auditSession.pre_audit.current_users_13_17 ?? "",
        current_users_18_plus: auditSession.pre_audit.current_users_18_plus ?? "",
        playspace_busyness: auditSession.pre_audit.playspace_busyness ?? "",
        season: auditSession.pre_audit.season ?? "",
        weather_conditions: [...auditSession.pre_audit.weather_conditions],
        wind_conditions: auditSession.pre_audit.wind_conditions ?? "",
    };
}

/**
 * Filter pre-audit questions down to those visible for the active execution mode.
 *
 * @param questions All configured setup questions.
 * @param executionMode Active execution mode.
 * @returns Questions that should be shown for the current mode.
 */
export function getVisiblePreAuditQuestions(
    questions: readonly PreAuditQuestion[],
    executionMode: ExecutionMode | null,
): PreAuditQuestion[] {
    if (executionMode === null) {
        return [...questions];
    }

    return questions.filter((question) => question.visible_modes.includes(executionMode));
}

/**
 * Determine whether one pre-audit question is complete.
 *
 * @param question Question definition.
 * @param value Current value for that question.
 * @returns True when the question should count as answered.
 */
export function isPreAuditQuestionComplete(question: PreAuditQuestion, value: string | string[] | undefined): boolean {
    if (!question.required || question.input_type === "auto_timestamp") {
        return true;
    }

    if (question.input_type === "multi_select") {
        return Array.isArray(value) && value.some((optionValue) => optionValue.trim().length > 0);
    }

    return typeof value === "string" && value.trim().length > 0;
}

/**
 * Determine whether every required visible pre-audit field is complete.
 *
 * @param questions All configured setup questions.
 * @param values Current local values.
 * @param executionMode Active execution mode.
 * @returns True when every required visible setup field is answered.
 */
export function isRequiredPreAuditComplete(
    questions: readonly PreAuditQuestion[],
    values: Record<string, string | string[]>,
    executionMode: ExecutionMode | null,
): boolean {
    if (executionMode === null) {
        return false;
    }

    return getVisiblePreAuditQuestions(questions, executionMode).every((question) =>
        isPreAuditQuestionComplete(question, values[question.key]),
    );
}

/**
 * Read one question's selected scale answers.
 *
 * @param auditSession Current audit session payload.
 * @param sectionKey Section containing the question.
 * @param questionKey Question key to inspect.
 * @returns Flat scale-to-option map.
 */
export function getQuestionAnswers(
    auditSession: AuditSession,
    sectionKey: string,
    questionKey: string,
): QuestionResponsePayload {
    return auditSession.sections[sectionKey]?.responses[questionKey] ?? {};
}

/**
 * List scale keys the user must answer for one question, given current selections.
 * Follow-up scales (variety, etc.) apply only when the provision option allows them.
 *
 * @param question Instrument question including scales and options.
 * @param selectedAnswers Current scale key → option key map for the question.
 * @returns Scale keys that must have a non-empty selection for the question to count as answered.
 */
export function getActiveScaleKeysForQuestion(
    question: InstrumentQuestion,
    selectedAnswers: QuestionResponsePayload,
): readonly string[] {
    if (question.question_type !== "scaled" || question.scales.length === 0) {
        return [];
    }

    const provisionScale = question.scales[0];
    if (provisionScale === undefined) {
        return [];
    }

    const selectedProvisionKey = selectedAnswers[provisionScale.key];
    const selectedProvisionOption = provisionScale.options.find((option) => option.key === selectedProvisionKey);
    const showFollowUpScales = selectedProvisionOption?.allows_follow_up_scales === true;
    const keys: string[] = [provisionScale.key];

    if (showFollowUpScales) {
        for (let index = 1; index < question.scales.length; index += 1) {
            const scale = question.scales[index];
            if (scale !== undefined) {
                keys.push(scale.key);
            }
        }
    }

    return keys;
}

/**
 * Whether every visible scale for the question has a selected option.
 *
 * @param question Question definition.
 * @param selectedAnswers Scale selections for that question.
 * @returns True when the question is fully answered under gating rules.
 */
export function isInstrumentQuestionComplete(
    question: InstrumentQuestion,
    selectedAnswers: QuestionResponsePayload,
): boolean {
    if (question.question_type === "checklist") {
        const selectedOptionKeys = selectedAnswers["selected_option_keys"];
        return Array.isArray(selectedOptionKeys) && selectedOptionKeys.length > 0;
    }

    if (question.scales.length === 0) {
        return false;
    }

    const requiredKeys = getActiveScaleKeysForQuestion(question, selectedAnswers);
    if (requiredKeys.length === 0) {
        return false;
    }

    return requiredKeys.every((scaleKey) => {
        const scale = question.scales.find((candidate) => candidate.key === scaleKey);
        return scale !== undefined && isQuestionScaleAnswerComplete(scale, selectedAnswers[scaleKey]);
    });
}

/**
 * Aggregate answered count and completion for one section using the audit session draft.
 *
 * @param auditSession Session containing nested section responses.
 * @param section Section with questions already filtered to the active execution mode.
 * @returns Counts and completion flag aligned with on-device answers.
 */
export function getInstrumentSectionLocalProgress(
    auditSession: AuditSession,
    section: InstrumentSection,
): InstrumentSectionLocalProgress {
    const completionQuestions = section.questions.filter((question) => question.required);
    const visibleQuestionCount = completionQuestions.length;
    let answeredQuestionCount = 0;

    for (const question of completionQuestions) {
        const selectedAnswers = getQuestionAnswers(auditSession, section.section_key, question.question_key);
        if (isInstrumentQuestionComplete(question, selectedAnswers)) {
            answeredQuestionCount += 1;
        }
    }

    const isComplete = visibleQuestionCount === 0 || answeredQuestionCount === visibleQuestionCount;

    return {
        visibleQuestionCount,
        answeredQuestionCount,
        isComplete,
    };
}
