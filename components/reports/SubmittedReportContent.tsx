import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable } from "react-native";
import { ChevronDown, ChevronUp, List } from "@tamagui/lucide-icons-2";
import { Paragraph, Separator, Text, XStack, YStack } from "tamagui";
import { useTranslation } from "react-i18next";
import type { DomainReportRow } from "lib/audit/report-helpers";
import { getSociabilityBreakdownCoverage } from "lib/audit/report-helpers";
import type { AuditScoreTotals } from "lib/audit/types";
import {
    createDefaultReportFilter,
    resolveDomainConstructSelection,
    type ConstructSelection,
    type DomainConstructCoverage,
    type ReportResultFilter,
} from "lib/audit/report-filter";
import { useDesignSystem } from "lib/design-system";
import { BestWorstTable } from "components/reports/BestWorstTable";
import { DomainCard } from "components/reports/DomainCard";
import { DomainItemsTable } from "components/reports/DomainItemsTable";
import { DomainScoreDisplay } from "components/reports/DomainScoreDisplay";
import { DomainSectionHeader, ExpandCollapseControl } from "components/reports/DomainSectionHeader";
import { ScoreLegendInfo } from "components/reports/score-legend-info";
import { useDomainExpansion } from "components/reports/use-domain-expansion";
import { FilteredScopeNote } from "components/reports/ReportFilterControls";

export interface SubmittedReportContentProps {
    readonly domainRows: readonly DomainReportRow[];
    readonly overallScores: AuditScoreTotals | null;
    readonly overallItemCount: number;
    readonly resultFilter?: ReportResultFilter;
    readonly overallConstructSelection?: ConstructSelection;
    readonly domainCoverage?: Readonly<Record<string, DomainConstructCoverage>>;
    /**
     * Construct toggles for one domain, rendered inside its expanded card.
     * Omitted when filtering is unavailable for this report.
     */
    readonly renderDomainFilter?: (domainKey: string, domainTitle: string) => ReactNode;
}

/**
 * Submitted-audit report: domain breakdown with optional item tables behind a per-domain toggle (web parity).
 */
export const SubmittedReportContent = memo(function SubmittedReportContent({
    domainRows,
    overallScores,
    overallItemCount,
    resultFilter = createDefaultReportFilter(),
    overallConstructSelection = { playValue: true, usability: true },
    domainCoverage = {},
    renderDomainFilter,
}: SubmittedReportContentProps) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");
    const [itemsOpenByDomain, setItemsOpenByDomain] = useState<Record<string, boolean>>({});

    const expansionKeys = useMemo(() => [...domainRows.map((row) => row.domainKey), "__overall__"], [domainRows]);

    // Null for instruments that never captured the three opportunities - the report says so rather
    // than implying three zero scores.
    const sociabilityCoverage = getSociabilityBreakdownCoverage(overallScores);

    // Domains with no scoreable content (all N/A) start collapsed so scored
    // results lead the report; they stay expandable (6.1, presentation only).
    const defaultCollapsedKeys = useMemo(
        () => domainRows.filter((row) => isUnscoredDomainRow(row)).map((row) => row.domainKey),
        [domainRows],
    );

    const {
        expandAll,
        collapseAll: collapseDomains,
        toggle,
        isExpanded,
        allExpanded,
    } = useDomainExpansion(expansionKeys, defaultCollapsedKeys);

    const collapseAll = useCallback(() => {
        collapseDomains();
        setItemsOpenByDomain({});
    }, [collapseDomains]);

    const toggleDomainItems = useCallback((domainKey: string) => {
        setItemsOpenByDomain((previous) => ({
            ...previous,
            [domainKey]: previous[domainKey] !== true,
        }));
    }, []);

    return (
        <YStack gap="$4" width="100%">
            {domainRows.length > 0 ? (
                <XStack items="center" justify="space-between" gap="$2">
                    <YStack flex={1}>
                        <ExpandCollapseControl
                            onExpandAll={expandAll}
                            onCollapseAll={collapseAll}
                            allExpanded={allExpanded}
                        />
                    </YStack>
                    <ScoreLegendInfo />
                </XStack>
            ) : null}

            {domainRows.map((row, index) => {
                const open = isExpanded(row.domainKey);
                const itemsOpen = itemsOpenByDomain[row.domainKey] === true;
                const hasQuestions = row.questions.length > 0;
                const selectedConstructs = resolveDomainConstructSelection(resultFilter, row.domainKey);
                const coverage = domainCoverage[row.domainKey];
                const visibleConstructs =
                    coverage === undefined
                        ? selectedConstructs
                        : {
                              playValue: selectedConstructs.playValue && coverage.playValue,
                              usability: selectedConstructs.usability && coverage.usability,
                          };
                const filteredEmptyKey =
                    row.filteredOutQuestionCount <= 0 || hasQuestions
                        ? null
                        : selectedConstructs.playValue
                          ? "filter.sectionEmptyPlayValue"
                          : "filter.sectionEmptyUsability";

                return (
                    <YStack key={row.domainKey} gap="$3" width="100%">
                        <DomainCard accessibilityLabel={row.domainTitle}>
                            <DomainSectionHeader
                                title={row.domainTitle}
                                isExpanded={open}
                                onToggle={() => {
                                    toggle(row.domainKey);
                                }}
                                scoreTotals={row.scoreTotals}
                                constructSelection={visibleConstructs}
                            />
                            {open && renderDomainFilter !== undefined
                                ? renderDomainFilter(row.domainKey, row.domainTitle)
                                : null}
                            {open ? (
                                <YStack gap="$3" width="100%">
                                    <FilteredScopeNote selection={selectedConstructs} />
                                    {filteredEmptyKey === null ? (
                                        <DomainScoreDisplay
                                            scoreTotals={row.scoreTotals}
                                            itemCount={row.itemCount}
                                            constructSelection={visibleConstructs}
                                        />
                                    ) : (
                                        <Paragraph
                                            color={ds.colors.mutedForeground}
                                            fontFamily={ds.fonts.bodyMedium}
                                            fontSize={ds.typography.bodySm.fontSize}
                                        >
                                            {t(filteredEmptyKey)}
                                        </Paragraph>
                                    )}
                                    <AuditorNotes
                                        notes={row.sectionNotes}
                                        commentOnlyNotes={row.commentOnlyNotes}
                                        domainKey={row.domainKey}
                                    />

                                    {hasQuestions ? (
                                        <YStack gap="$2" width="100%">
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityState={{ expanded: itemsOpen }}
                                                onPress={() => {
                                                    toggleDomainItems(row.domainKey);
                                                }}
                                            >
                                                {({ pressed }) => (
                                                    <XStack
                                                        items="center"
                                                        gap="$2"
                                                        py="$1"
                                                        self="flex-start"
                                                        opacity={pressed ? 0.85 : 1}
                                                    >
                                                        <List size={16} color={ds.colors.mutedForeground} />
                                                        <Text
                                                            color={ds.colors.mutedForeground}
                                                            fontFamily={ds.fonts.bodyBold}
                                                            fontSize={ds.typography.bodySm.fontSize}
                                                        >
                                                            {itemsOpen
                                                                ? t("domain.hideItems", { ns: "reports" })
                                                                : t("domain.showItems", {
                                                                      ns: "reports",
                                                                      count: row.questions.length,
                                                                  })}
                                                        </Text>
                                                        {itemsOpen ? (
                                                            <ChevronUp size={16} color={ds.colors.mutedForeground} />
                                                        ) : (
                                                            <ChevronDown size={16} color={ds.colors.mutedForeground} />
                                                        )}
                                                    </XStack>
                                                )}
                                            </Pressable>
                                            {itemsOpen ? (
                                                <DomainItemsTable
                                                    questions={row.questions}
                                                    constructSelection={visibleConstructs}
                                                />
                                            ) : null}
                                        </YStack>
                                    ) : null}
                                </YStack>
                            ) : null}
                        </DomainCard>
                        {index < domainRows.length - 1 ? <Separator borderColor={ds.colors.border} /> : null}
                    </YStack>
                );
            })}

            <DomainCard accessibilityLabel={t("domain.overallScoresTitle")}>
                <DomainSectionHeader
                    title={t("domain.overallScoresTitle")}
                    isExpanded={isExpanded("__overall__")}
                    onToggle={() => {
                        toggle("__overall__");
                    }}
                    scoreTotals={overallScores}
                    constructSelection={overallConstructSelection}
                />
                {isExpanded("__overall__") ? (
                    <YStack gap="$2" width="100%">
                        <FilteredScopeNote selection={overallConstructSelection} />
                        <DomainScoreDisplay
                            scoreTotals={overallScores}
                            itemCount={overallItemCount}
                            constructSelection={overallConstructSelection}
                        />
                        {sociabilityCoverage === null ? null : (
                            <Text
                                color={ds.colors.mutedForeground}
                                fontFamily={ds.fonts.bodyMedium}
                                fontSize={ds.typography.bodyXs.fontSize}
                                lineHeight={ds.typography.bodyXs.lineHeight}
                            >
                                {t("domain.sociabilityCoverage", {
                                    ns: "reports",
                                    captured: sociabilityCoverage.capturedQuestionCount,
                                    eligible: sociabilityCoverage.eligibleQuestionCount,
                                })}
                            </Text>
                        )}
                    </YStack>
                ) : null}
            </DomainCard>

            <BestWorstTable domainRows={domainRows} constructSelection={overallConstructSelection} />
        </YStack>
    );
});

interface AuditorNotesProps {
    readonly notes: string[];
    readonly commentOnlyNotes: string[];
    readonly domainKey: string;
}

const AuditorNotes = memo(function AuditorNotes({ notes, commentOnlyNotes, domainKey }: AuditorNotesProps) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");

    if (notes.length === 0 && commentOnlyNotes.length === 0) {
        return (
            <YStack gap="$1">
                <Text
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.bodySm.fontSize}
                >
                    {t("domain.auditorNotesLabel")}
                </Text>
                <Paragraph
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodySm.fontSize}
                    style={{ fontStyle: "italic" }}
                >
                    {t("domain.noNotesPlaceholder")}
                </Paragraph>
            </YStack>
        );
    }

    return (
        <>
            {notes.map((note, noteIndex) => (
                <YStack key={`${domainKey}-note-${noteIndex.toString()}`} gap="$1">
                    <Text
                        color={ds.colors.mutedForeground}
                        fontFamily={ds.fonts.bodyBold}
                        fontSize={ds.typography.bodySm.fontSize}
                    >
                        {t("domain.auditorNotesLabel")}
                    </Text>
                    <Paragraph
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={ds.typography.bodySm.fontSize}
                    >
                        {note}
                    </Paragraph>
                </YStack>
            ))}
            {commentOnlyNotes.map((note, noteIndex) => (
                <YStack key={`${domainKey}-comment-only-${noteIndex.toString()}`} gap="$1">
                    <Text
                        color={ds.colors.mutedForeground}
                        fontFamily={ds.fonts.bodyBold}
                        fontSize={ds.typography.bodySm.fontSize}
                    >
                        {`${t("filter.commentOnly")} · ${t("domain.auditorNotesLabel")}`}
                    </Text>
                    <Paragraph
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={ds.typography.bodySm.fontSize}
                    >
                        {note}
                    </Paragraph>
                </YStack>
            ))}
        </>
    );
});

/**
 * A domain is "unscored" when every scale max is zero (all answers N/A) or it
 * has no score totals at all.
 */
function isUnscoredDomainRow(row: DomainReportRow): boolean {
    const totals = row.scoreTotals;
    if (totals === null) {
        return true;
    }
    return (
        totals.play_value_total_max <= 0 &&
        totals.usability_total_max <= 0 &&
        totals.provision_total_max <= 0 &&
        totals.variety_total_max <= 0 &&
        totals.challenge_total_max <= 0 &&
        totals.sociability_total_max <= 0
    );
}
