import { useCallback, useEffect, useMemo, useState } from "react";

import type { ConstructSelection, ReportResultFilter } from "lib/audit/report-filter";
import {
    applySelectionToAllDomains,
    clearDomainOverride,
    createDefaultReportFilter,
    pruneUnknownDomainOverrides,
    setDomainOverride,
    setOverallSelection,
} from "lib/audit/report-filter";
import { loadReportFilter, saveReportFilter } from "lib/audit/report-filter-cache";

export interface ReportFilterController {
    readonly filter: ReportResultFilter;
    readonly setOverall: (selection: ConstructSelection) => void;
    readonly setDomain: (domainKey: string, selection: ConstructSelection) => void;
    readonly clearDomain: (domainKey: string) => void;
    readonly applyToAllDomains: () => void;
    readonly showFullReport: () => void;
    readonly reset: () => void;
}

export interface ReportFilterRuntimeState {
    readonly identityKey: string;
    readonly persistedFilter: ReportResultFilter;
    readonly temporaryFilter: ReportResultFilter | null;
}

export function reportFilterRuntimeIdentity(userId: string | null, reportIdentity: string): string {
    return JSON.stringify([userId, reportIdentity]);
}

export function resolveReportFilterRuntimeState(
    state: ReportFilterRuntimeState,
    userId: string | null,
    reportIdentity: string,
    load: typeof loadReportFilter = loadReportFilter,
): ReportFilterRuntimeState {
    const identityKey = reportFilterRuntimeIdentity(userId, reportIdentity);
    if (state.identityKey === identityKey) {
        return state;
    }
    return {
        identityKey,
        persistedFilter: load(userId, reportIdentity),
        temporaryFilter: null,
    };
}

/**
 * Own one report's filter state and its stored-selection lifecycle.
 *
 * MMKV reads are synchronous and there is no server render on device, so the
 * stored selection is read once during the initial state computation rather than
 * applied later in an effect. That keeps the first frame correct and avoids a
 * visible jump from an unfiltered report to a filtered one.
 *
 * @param reportIdentity Report key from `buildReportIdentity`.
 * @param userId Signed-in auditor's id, used to namespace stored selections.
 * @param knownDomainKeys Domain keys present in this report. Omit from callers
 * that are not rendering a per-section breakdown (bulk export, for instance):
 * passing an empty list would prune every override rather than leave them alone.
 * @returns The active filter and the operations that change it.
 */
export function useReportFilter(
    reportIdentity: string,
    userId: string | null,
    knownDomainKeys?: readonly string[],
): ReportFilterController {
    const identityKey = reportFilterRuntimeIdentity(userId, reportIdentity);
    const [state, setState] = useState<ReportFilterRuntimeState>(() => ({
        identityKey,
        persistedFilter: loadReportFilter(userId, reportIdentity),
        temporaryFilter: null,
    }));
    const currentState = useMemo(
        () => resolveReportFilterRuntimeState(state, userId, reportIdentity),
        [state, userId, reportIdentity],
    );
    const displayedFilter = currentState.temporaryFilter ?? currentState.persistedFilter;

    useEffect(() => {
        setState((current) => resolveReportFilterRuntimeState(current, userId, reportIdentity));
    }, [identityKey, reportIdentity, userId]);

    // Pruning is derived during render rather than written back, so a report
    // missing a domain today does not destroy a selection another report uses.
    const domainKeysSignature = knownDomainKeys === undefined ? null : knownDomainKeys.join("|");
    const filter = useMemo(
        () =>
            domainKeysSignature === null
                ? displayedFilter
                : pruneUnknownDomainOverrides(
                      displayedFilter,
                      domainKeysSignature.split("|").filter((key) => key.length > 0),
                  ),
        [displayedFilter, domainKeysSignature],
    );

    const update = useCallback(
        (change: (current: ReportResultFilter) => ReportResultFilter) => {
            setState((current) => {
                const resolved = resolveReportFilterRuntimeState(current, userId, reportIdentity);
                const displayed = resolved.temporaryFilter ?? resolved.persistedFilter;
                const next = change(displayed);
                if (next === displayed && resolved.temporaryFilter === null) {
                    return resolved;
                }
                saveReportFilter(userId, reportIdentity, next, Date.now());
                return {
                    identityKey: reportFilterRuntimeIdentity(userId, reportIdentity),
                    persistedFilter: next,
                    temporaryFilter: null,
                };
            });
        },
        [userId, reportIdentity],
    );

    const setOverall = useCallback(
        (selection: ConstructSelection) => {
            update((current) => setOverallSelection(current, selection));
        },
        [update],
    );

    const setDomain = useCallback(
        (domainKey: string, selection: ConstructSelection) => {
            update((current) => setDomainOverride(current, domainKey, selection));
        },
        [update],
    );

    const clearDomain = useCallback(
        (domainKey: string) => {
            update((current) => clearDomainOverride(current, domainKey));
        },
        [update],
    );

    const applyToAllDomains = useCallback(() => {
        update((current) => applySelectionToAllDomains(current));
    }, [update]);

    const showFullReport = useCallback(() => {
        setState((current) => {
            const resolved = resolveReportFilterRuntimeState(current, userId, reportIdentity);
            return {
                ...resolved,
                temporaryFilter: createDefaultReportFilter(),
            };
        });
    }, [reportIdentity, userId]);

    const reset = useCallback(() => {
        const next = createDefaultReportFilter();
        saveReportFilter(userId, reportIdentity, next, Date.now());
        setState({
            identityKey: reportFilterRuntimeIdentity(userId, reportIdentity),
            persistedFilter: next,
            temporaryFilter: null,
        });
    }, [reportIdentity, userId]);

    return { filter, setOverall, setDomain, clearDomain, applyToAllDomains, showFullReport, reset };
}
