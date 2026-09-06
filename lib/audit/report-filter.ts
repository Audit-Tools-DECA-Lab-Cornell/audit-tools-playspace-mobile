import {
    playspaceInstrumentSchema,
    type ConstructKey,
    type InstrumentQuestion,
    type PlayspaceInstrument,
} from "lib/audit/types";

/**
 * Which scoring constructs a report (or one domain within it) includes.
 *
 * Both flags true is the default and must reproduce the unfiltered report exactly.
 */
export interface ConstructSelection {
    readonly playValue: boolean;
    readonly usability: boolean;
}

/**
 * One report's filter configuration.
 *
 * `overall` is the report-level selection. Every domain inherits it until the
 * reader sets an override. Override keys are normalized domain keys — the same
 * keys `getQuestionDomainKeys` returns — not section keys.
 */
export interface ReportResultFilter {
    readonly overall: ConstructSelection;
    readonly domainOverrides: Readonly<Record<string, ConstructSelection>>;
}

/**
 * Which constructs the questions inside one domain actually carry.
 *
 * Used to hide controls that cannot do anything: 12 of the 22 instrument
 * sections are entirely single-construct, so rendering both toggles everywhere
 * would offer readers switches with no effect.
 */
export interface DomainConstructCoverage {
    readonly playValue: boolean;
    readonly usability: boolean;
}

const BOTH_CONSTRUCTS: ConstructSelection = { playValue: true, usability: true };

/**
 * Report filter that includes everything. A report with this configuration must
 * render and export byte-for-byte identically to the unfiltered report.
 *
 * @returns A filter enabling both constructs with no domain overrides.
 */
export function createDefaultReportFilter(): ReportResultFilter {
    return { overall: { ...BOTH_CONSTRUCTS }, domainOverrides: {} };
}

/**
 * Whether a filter excludes nothing.
 *
 * Drives the restored-filter banner: a report opening in any non-default state
 * must say so, because a stored selection can otherwise silently show a reader
 * less than the full audit.
 *
 * @param filter - Filter to test.
 * @returns True when both constructs are on and no override narrows a domain.
 */
export function isDefaultReportFilter(filter: ReportResultFilter): boolean {
    if (!filter.overall.playValue || !filter.overall.usability) {
        return false;
    }
    return Object.values(filter.domainOverrides).every((override) => override.playValue && override.usability);
}

/**
 * Whether a selection excludes at least one construct.
 *
 * @param selection - Selection to test.
 * @returns True when exactly one construct is enabled.
 */
export function isSingleConstructSelection(selection: ConstructSelection): boolean {
    return selection.playValue !== selection.usability;
}

/**
 * Build the question lookup that construct and domain inheritance both need.
 *
 * @param instrument - Full instrument definition.
 * @returns Every question in the instrument keyed by `question_key`.
 */
export function buildQuestionLookup(instrument: PlayspaceInstrument): Readonly<Record<string, InstrumentQuestion>> {
    const parsed = playspaceInstrumentSchema.parse(instrument);
    return Object.fromEntries(
        parsed.sections.flatMap((section) =>
            section.questions.map((question) => [question.question_key, question] as const),
        ),
    ) as Readonly<Record<string, InstrumentQuestion>>;
}

function resolveQuestionConstructKeys(
    question: InstrumentQuestion,
    questionLookup: Readonly<Record<string, InstrumentQuestion>> | undefined,
    visitedQuestionKeys: Set<string>,
): ConstructKey[] {
    const ordered: ConstructKey[] = [];
    const seen = new Set<ConstructKey>();
    question.constructs.forEach((constructKey) => {
        if (seen.has(constructKey)) {
            return;
        }
        seen.add(constructKey);
        ordered.push(constructKey);
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
    return resolveQuestionConstructKeys(parentQuestion, questionLookup, nextVisitedQuestionKeys);
}

/**
 * Return the construct keys a question is filtered by, inheriting from a
 * conditional parent when the question declares none of its own.
 *
 * This mirrors `getQuestionDomainKeys`. Checklist follow-ups carry no constructs
 * in the instrument, so without inheritance a construct filter would drop them
 * from every report. Inheriting the parent's constructs keeps a follow-up with
 * the question it qualifies: the loose-parts checklists follow Play Value
 * parents, and the seating checklists follow dual-construct parents.
 *
 * @param question - Instrument question to resolve.
 * @param questionLookup - Lookup used to reach a conditional parent question.
 * @returns Construct keys in first-seen order; empty when none can be resolved.
 */
export function getQuestionConstructKeys(
    question: InstrumentQuestion,
    questionLookup?: Readonly<Record<string, InstrumentQuestion>>,
): ConstructKey[] {
    return resolveQuestionConstructKeys(question, questionLookup, new Set([question.question_key]));
}

/**
 * Resolve the selection in force for one domain.
 *
 * @param filter - The report's filter configuration.
 * @param domainKey - Normalized domain key.
 * @returns The domain's override when set, otherwise the report-level selection.
 */
export function resolveDomainConstructSelection(filter: ReportResultFilter, domainKey: string): ConstructSelection {
    return filter.domainOverrides[domainKey] ?? filter.overall;
}

export function resolveQuestionConstructSelection(
    question: InstrumentQuestion,
    questionLookup: Readonly<Record<string, InstrumentQuestion>>,
    resolveDomainKeys: (
        question: InstrumentQuestion,
        questionLookup: Readonly<Record<string, InstrumentQuestion>>,
    ) => string[],
    filter: ReportResultFilter,
): ConstructSelection {
    const domainKeys = resolveDomainKeys(question, questionLookup);
    if (domainKeys.length === 0) {
        return filter.overall;
    }
    return domainKeys.reduce<ConstructSelection>(
        (selection, domainKey) => {
            const domainSelection = resolveDomainConstructSelection(filter, domainKey);
            return {
                playValue: selection.playValue || domainSelection.playValue,
                usability: selection.usability || domainSelection.usability,
            };
        },
        { playValue: false, usability: false },
    );
}

/**
 * Whether a question's results belong in a report under the given selection.
 *
 * A question is included when it carries at least one enabled construct. A
 * question whose constructs cannot be resolved even through its parent is always
 * included, so an instrument change can never silently delete content from a
 * report.
 *
 * @param constructKeys - Result of `getQuestionConstructKeys` for the question.
 * @param selection - Selection in force for the question's domain.
 * @returns True when the question should be rendered and exported.
 */
export function questionMatchesConstructSelection(
    constructKeys: readonly ConstructKey[],
    selection: ConstructSelection,
): boolean {
    if (constructKeys.length === 0) {
        return true;
    }
    return constructKeys.some((constructKey) =>
        constructKey === "play_value" ? selection.playValue : selection.usability,
    );
}

/**
 * Whether a question belongs in a report that is organized by section rather
 * than by domain — exports, chiefly.
 *
 * A question can carry several domains whose overrides disagree. It is included
 * when **any** of its domains would include it, so a per-domain override can
 * never silently remove a question another domain still shows.
 *
 * @param question Instrument question to test.
 * @param questionLookup Lookup used to reach a conditional parent question.
 * @param resolveDomainKeys Domain resolver, normally `getQuestionDomainKeys`.
 * @param filter The report's filter configuration.
 * @returns True when the question should be rendered and exported.
 */
export function questionMatchesReportFilter(
    question: InstrumentQuestion,
    questionLookup: Readonly<Record<string, InstrumentQuestion>>,
    resolveDomainKeys: (
        question: InstrumentQuestion,
        questionLookup: Readonly<Record<string, InstrumentQuestion>>,
    ) => string[],
    filter: ReportResultFilter,
): boolean {
    const constructKeys = getQuestionConstructKeys(question, questionLookup);
    if (constructKeys.length === 0) {
        return true;
    }
    return questionMatchesConstructSelection(
        constructKeys,
        resolveQuestionConstructSelection(question, questionLookup, resolveDomainKeys, filter),
    );
}

export function maskScoreTotalsByConstructSelection<
    T extends {
        readonly play_value_total: number;
        readonly play_value_total_max: number;
        readonly usability_total: number;
        readonly usability_total_max: number;
    },
>(totals: T, selection: ConstructSelection): T {
    if (selection.playValue && selection.usability) {
        return totals;
    }
    return {
        ...totals,
        play_value_total: selection.playValue ? totals.play_value_total : 0,
        play_value_total_max: selection.playValue ? totals.play_value_total_max : 0,
        usability_total: selection.usability ? totals.usability_total : 0,
        usability_total_max: selection.usability ? totals.usability_total_max : 0,
    };
}

export function getVisibleReportConstructs(
    filter: ReportResultFilter,
    domainCoverage: Readonly<Record<string, DomainConstructCoverage>>,
): ConstructSelection {
    const entries = Object.entries(domainCoverage);
    if (entries.length === 0) {
        return filter.overall;
    }
    return entries.reduce<ConstructSelection>(
        (visible, [domainKey, coverage]) => {
            const selection = resolveDomainConstructSelection(filter, domainKey);
            return {
                playValue: visible.playValue || (coverage.playValue && selection.playValue),
                usability: visible.usability || (coverage.usability && selection.usability),
            };
        },
        { playValue: false, usability: false },
    );
}

/**
 * Set the report-level selection, leaving domain overrides untouched.
 *
 * At least one construct must stay enabled; disabling the last one is ignored so
 * a reader cannot reach an empty report.
 *
 * @param filter - Current filter.
 * @param selection - Requested report-level selection.
 * @returns The updated filter, or the original when the change was rejected.
 */
export function setOverallSelection(filter: ReportResultFilter, selection: ConstructSelection): ReportResultFilter {
    if (!selection.playValue && !selection.usability) {
        return filter;
    }
    return { overall: { ...selection }, domainOverrides: filter.domainOverrides };
}

/**
 * Override one domain's selection.
 *
 * @param filter - Current filter.
 * @param domainKey - Normalized domain key to override.
 * @param selection - Requested selection for that domain.
 * @returns The updated filter, or the original when the change was rejected.
 */
export function setDomainOverride(
    filter: ReportResultFilter,
    domainKey: string,
    selection: ConstructSelection,
): ReportResultFilter {
    if (!selection.playValue && !selection.usability) {
        return filter;
    }
    return {
        overall: filter.overall,
        domainOverrides: { ...filter.domainOverrides, [domainKey]: { ...selection } },
    };
}

/**
 * Return one domain to inheriting the report-level selection.
 *
 * @param filter - Current filter.
 * @param domainKey - Normalized domain key to clear.
 * @returns The updated filter.
 */
export function clearDomainOverride(filter: ReportResultFilter, domainKey: string): ReportResultFilter {
    if (!(domainKey in filter.domainOverrides)) {
        return filter;
    }
    const nextOverrides = { ...filter.domainOverrides };
    delete nextOverrides[domainKey];
    return { overall: filter.overall, domainOverrides: nextOverrides };
}

/**
 * Apply the report-level selection everywhere by dropping all overrides.
 *
 * @param filter - Current filter.
 * @returns The updated filter with no domain overrides.
 */
export function applySelectionToAllDomains(filter: ReportResultFilter): ReportResultFilter {
    return { overall: filter.overall, domainOverrides: {} };
}

/**
 * Drop overrides for domains the current report does not contain.
 *
 * Invalidation is by domain key rather than instrument version so that adding
 * questions to an instrument does not discard a reader's stored selections.
 *
 * @param filter - Filter loaded from the cache.
 * @param knownDomainKeys - Domain keys present in the report being rendered.
 * @returns A filter whose overrides all refer to present domains.
 */
export function pruneUnknownDomainOverrides(
    filter: ReportResultFilter,
    knownDomainKeys: readonly string[],
): ReportResultFilter {
    const known = new Set(knownDomainKeys);
    const entries = Object.entries(filter.domainOverrides).filter(([domainKey]) => known.has(domainKey));
    if (entries.length === Object.keys(filter.domainOverrides).length) {
        return filter;
    }
    return { overall: filter.overall, domainOverrides: Object.fromEntries(entries) };
}

/**
 * Report which constructs each domain's questions actually carry.
 *
 * A domain covering one construct gets no toggle pair in the UI, because both
 * settings would render the same rows.
 *
 * @param instrument - Full instrument definition.
 * @param resolveDomainKeys - Domain resolver, normally `getQuestionDomainKeys`.
 * @returns Coverage keyed by normalized domain key.
 */
export function getDomainConstructCoverage(
    instrument: PlayspaceInstrument,
    resolveDomainKeys: (
        question: InstrumentQuestion,
        questionLookup: Readonly<Record<string, InstrumentQuestion>>,
    ) => string[],
): Readonly<Record<string, DomainConstructCoverage>> {
    const parsed = playspaceInstrumentSchema.parse(instrument);
    const questionLookup = buildQuestionLookup(instrument);
    const coverage: Record<string, { playValue: boolean; usability: boolean }> = {};

    parsed.sections.forEach((section) => {
        section.questions.forEach((question) => {
            const constructKeys = getQuestionConstructKeys(question, questionLookup);
            if (constructKeys.length === 0) {
                return;
            }
            resolveDomainKeys(question, questionLookup).forEach((domainKey) => {
                const entry = coverage[domainKey] ?? { playValue: false, usability: false };
                entry.playValue = entry.playValue || constructKeys.includes("play_value");
                entry.usability = entry.usability || constructKeys.includes("usability");
                coverage[domainKey] = entry;
            });
        });
    });

    return coverage;
}
