import { memo, useMemo } from "react";
import { Paragraph, Text, XStack, YStack } from "tamagui";
import { useTranslation } from "react-i18next";
import type { DomainReportRow, RankedDomain, SociabilityCategoryRanking } from "lib/audit/report-helpers";
import type { ConstructSelection } from "lib/audit/report-filter";
import {
    buildConstructRankings,
    buildSociabilityCategoryRankings,
    formatConstructDomainLine,
} from "lib/audit/report-helpers";
import { SOCIABILITY_CATEGORY_KEYS } from "lib/audit/sociability";
import { formatPercentage } from "lib/audit/score-helpers";
import { getScaleAccentColor, useDesignSystem } from "lib/design-system";
import { useResponsiveLayout } from "lib/responsive-layout";

export interface BestWorstTableProps {
    readonly domainRows: readonly DomainReportRow[];
    readonly constructSelection?: ConstructSelection;
}

type ConstructKey = "provision" | "variety" | "challenge" | "sociability" | "play_value" | "usability";

const CONSTRUCT_KEYS: readonly ConstructKey[] = [
    "provision",
    "variety",
    "challenge",
    "sociability",
    "play_value",
    "usability",
];

const CONSTRUCT_LABEL_KEYS: Record<ConstructKey, string> = {
    provision: "bestWorst.constructProvision",
    variety: "bestWorst.constructVariety",
    challenge: "bestWorst.constructChallenge",
    sociability: "bestWorst.constructSociability",
    play_value: "bestWorst.constructPlayValue",
    usability: "bestWorst.constructUsability",
};

function getConstructAccentColor(key: ConstructKey, ds: ReturnType<typeof useDesignSystem>): string {
    if (key === "play_value") return ds.colors.warning;
    if (key === "usability") return ds.colors.primary;
    return getScaleAccentColor(key as Parameters<typeof getScaleAccentColor>[0], ds.colors);
}

interface ConstructCellProps {
    readonly constructKey: ConstructKey;
    readonly label: string;
    readonly ds: ReturnType<typeof useDesignSystem>;
    readonly best: { domainTitle: string; score: number; max: number } | null;
    readonly worst: { domainTitle: string; score: number; max: number } | null;
}

function ConstructCell({ constructKey, label, ds, best, worst }: ConstructCellProps) {
    const { t } = useTranslation("reports");
    const accentColor = getConstructAccentColor(constructKey, ds);

    return (
        <YStack
            flex={1}
            overflow="hidden"
            rounded={ds.radii.md}
            borderWidth={1}
            borderColor={ds.colors.border}
            style={{ minWidth: 130 }}
        >
            {/* Header */}
            <YStack px="$2.5" py="$1.5" style={{ backgroundColor: accentColor }}>
                <Text
                    color={ds.colors.primaryForeground}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.bodyXs.fontSize}
                    style={{ textAlign: "center" }}
                    numberOfLines={1}
                >
                    {label}
                </Text>
            </YStack>

            {/* Best scored */}
            <YStack
                px="$2.5"
                pt="$2"
                pb="$1.5"
                gap="$0.5"
                borderBottomWidth={1}
                borderColor={ds.colors.border}
                bg={ds.colors.successSoft}
            >
                <XStack items="center" gap="$1" mb="$0.5">
                    <YStack width={6} height={6} rounded={9999} style={{ backgroundColor: ds.colors.success }} />
                    <Text
                        color={ds.colors.mutedForeground}
                        fontFamily={ds.fonts.bodyBold}
                        fontSize={ds.typography.bodyXs.fontSize}
                    >
                        {t("bestWorst.bestScored")}
                    </Text>
                </XStack>
                {best === null ? (
                    <Text color={ds.colors.mutedForeground} fontSize={ds.typography.bodyXs.fontSize}>
                        -
                    </Text>
                ) : (
                    <>
                        <Text
                            color={ds.colors.foreground}
                            fontFamily={ds.fonts.bodyMedium}
                            fontSize={ds.typography.bodyXs.fontSize}
                            numberOfLines={2}
                        >
                            {best.domainTitle}
                        </Text>
                        <Text color={ds.colors.mutedForeground} fontSize={ds.typography.bodyXs.fontSize}>
                            {formatConstructDomainLine(best.score, best.max)} · {formatPercentage(best.score, best.max)}
                        </Text>
                    </>
                )}
            </YStack>

            {/* Worst scored */}
            <YStack px="$2.5" pt="$2" pb="$2" gap="$0.5" bg={ds.colors.dangerSoft}>
                <XStack items="center" gap="$1">
                    <YStack width={6} height={6} rounded={9999} style={{ backgroundColor: ds.colors.danger }} />
                    <Text
                        color={ds.colors.mutedForeground}
                        fontFamily={ds.fonts.bodyBold}
                        fontSize={ds.typography.bodyXs.fontSize}
                    >
                        {t("bestWorst.worstScored")}
                    </Text>
                </XStack>
                {worst === null ? (
                    <Text color={ds.colors.mutedForeground} fontSize={ds.typography.bodyXs.fontSize}>
                        -
                    </Text>
                ) : (
                    <>
                        <Text
                            color={ds.colors.foreground}
                            fontFamily={ds.fonts.bodyMedium}
                            fontSize={ds.typography.bodyXs.fontSize}
                            numberOfLines={2}
                        >
                            {worst.domainTitle}
                        </Text>
                        <Text color={ds.colors.mutedForeground} fontSize={ds.typography.bodyXs.fontSize}>
                            {formatConstructDomainLine(worst.score, worst.max)} ·{" "}
                            {formatPercentage(worst.score, worst.max)}
                        </Text>
                    </>
                )}
            </YStack>
        </YStack>
    );
}

const SOCIABILITY_CATEGORY_LABEL_KEYS: Record<(typeof SOCIABILITY_CATEGORY_KEYS)[number], string> = {
    play_alone: "bestWorst.sociabilityPlayAlone",
    small_group: "bestWorst.sociabilitySmallGroup",
    large_group: "bestWorst.sociabilityLargeGroup",
};

/** Every domain tied at one rank, each with its raw score and percentage. */
function RankedDomainList({
    domains,
    ds,
    t,
}: {
    readonly domains: readonly RankedDomain[];
    readonly ds: ReturnType<typeof useDesignSystem>;
    readonly t: ReturnType<typeof useTranslation<"reports">>["t"];
}) {
    if (domains.length === 0) {
        return (
            <Text color={ds.colors.mutedForeground} fontSize={ds.typography.bodyXs.fontSize}>
                -
            </Text>
        );
    }

    return (
        <YStack gap="$1">
            {domains.map((domain) => (
                <YStack key={domain.domainTitle} gap="$0.5">
                    <Text
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={ds.typography.bodyXs.fontSize}
                        numberOfLines={2}
                    >
                        {domain.domainTitle}
                    </Text>
                    <Text color={ds.colors.mutedForeground} fontSize={ds.typography.bodyXs.fontSize}>
                        {formatConstructDomainLine(domain.score, domain.max)} · {domain.percent}%
                    </Text>
                </YStack>
            ))}
            {domains.length > 1 ? (
                <Text color={ds.colors.mutedForeground} fontSize={ds.typography.bodyXs.fontSize}>
                    {t("bestWorst.tiedCount", { count: domains.length })}
                </Text>
            ) : null}
        </YStack>
    );
}

/**
 * Highest and lowest domains for one Sociability opportunity.
 *
 * Each opportunity gets its own card - the three are separate measures, so one combined
 * "best Sociability domain" would hide which opportunity a place actually supports.
 */
function SociabilityCategoryCell({
    ranking,
    label,
    ds,
    t,
}: {
    readonly ranking: SociabilityCategoryRanking;
    readonly label: string;
    readonly ds: ReturnType<typeof useDesignSystem>;
    readonly t: ReturnType<typeof useTranslation<"reports">>["t"];
}) {
    const accentColor = getScaleAccentColor("sociability", ds.colors);

    return (
        <YStack
            flex={1}
            overflow="hidden"
            rounded={ds.radii.md}
            borderWidth={1}
            borderColor={ds.colors.border}
            style={{ minWidth: 130 }}
        >
            <YStack px="$2.5" py="$1.5" style={{ backgroundColor: accentColor }}>
                <Text
                    color={ds.colors.primaryForeground}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.bodyXs.fontSize}
                    numberOfLines={2}
                    style={{ textAlign: "center" }}
                >
                    {label}
                </Text>
            </YStack>

            {!ranking.hasSufficientData ? (
                <YStack px="$2.5" py="$2.5" flex={1}>
                    <Text
                        color={ds.colors.mutedForeground}
                        fontSize={ds.typography.bodyXs.fontSize}
                        lineHeight={ds.typography.bodyXs.lineHeight}
                    >
                        {ranking.comparableDomainCount === 0
                            ? t("bestWorst.sociabilityNoData")
                            : t("bestWorst.sociabilitySingleDomain", {
                                  domain: ranking.bestDomains[0]?.domainTitle ?? "",
                              })}
                    </Text>
                </YStack>
            ) : ranking.allTied ? (
                <YStack px="$2.5" py="$2.5" gap="$1" flex={1}>
                    <Text
                        color={ds.colors.mutedForeground}
                        fontFamily={ds.fonts.bodyBold}
                        fontSize={ds.typography.bodyXs.fontSize}
                    >
                        {t("bestWorst.sociabilityAllTied")}
                    </Text>
                    <RankedDomainList domains={ranking.bestDomains} ds={ds} t={t} />
                </YStack>
            ) : (
                <>
                    <YStack
                        px="$2.5"
                        pt="$2"
                        pb="$1.5"
                        gap="$0.5"
                        borderBottomWidth={1}
                        borderColor={ds.colors.border}
                        bg={ds.colors.successSoft}
                    >
                        <XStack items="center" gap="$1" mb="$0.5">
                            <YStack
                                width={6}
                                height={6}
                                rounded={9999}
                                style={{ backgroundColor: ds.colors.success }}
                            />
                            <Text
                                color={ds.colors.mutedForeground}
                                fontFamily={ds.fonts.bodyBold}
                                fontSize={ds.typography.bodyXs.fontSize}
                            >
                                {t("bestWorst.bestScored")}
                            </Text>
                        </XStack>
                        <RankedDomainList domains={ranking.bestDomains} ds={ds} t={t} />
                    </YStack>
                    <YStack px="$2.5" pt="$2" pb="$2" gap="$0.5" flex={1} bg={ds.colors.dangerSoft}>
                        <XStack items="center" gap="$1">
                            <YStack width={6} height={6} rounded={9999} style={{ backgroundColor: ds.colors.danger }} />
                            <Text
                                color={ds.colors.mutedForeground}
                                fontFamily={ds.fonts.bodyBold}
                                fontSize={ds.typography.bodyXs.fontSize}
                            >
                                {t("bestWorst.worstScored")}
                            </Text>
                        </XStack>
                        <RankedDomainList domains={ranking.worstDomains} ds={ds} t={t} />
                    </YStack>
                </>
            )}
        </YStack>
    );
}

/**
 * Best and worst domain per construct.
 *
 * Phone: 2-column grid (3 rows).
 * Tablet: 3-column grid (2 rows).
 */
export const BestWorstTable = memo(function BestWorstTable({
    domainRows,
    constructSelection = { playValue: true, usability: true },
}: BestWorstTableProps) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    const { t } = useTranslation("reports");

    const rankings = useMemo(() => buildConstructRankings(domainRows), [domainRows]);
    const rankingByKey = useMemo(() => new Map(rankings.map((r) => [r.constructKey, r] as const)), [rankings]);
    const capturesSociabilityBreakdown = domainRows.some((row) => row.scoreTotals?.sociability_breakdown != null);
    const sociabilityRankings = useMemo(
        () => (capturesSociabilityBreakdown ? buildSociabilityCategoryRankings(domainRows) : []),
        [capturesSociabilityBreakdown, domainRows],
    );
    const constructRows = useMemo(() => {
        const visibleKeys = CONSTRUCT_KEYS.filter((key) => {
            if (key === "play_value") return constructSelection.playValue;
            if (key === "usability") return constructSelection.usability;
            return true;
        });
        const columnsPerRow = layout.isTablet ? 3 : 2;
        return Array.from({ length: Math.ceil(visibleKeys.length / columnsPerRow) }, (_unused, index) =>
            visibleKeys.slice(index * columnsPerRow, (index + 1) * columnsPerRow),
        );
    }, [constructSelection.playValue, constructSelection.usability, layout.isTablet]);

    return (
        <YStack gap="$3" width="100%">
            <XStack items="center" gap="$2">
                <YStack width={3} height={18} rounded={2} style={{ backgroundColor: ds.colors.primary }} />
                <Text
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.titleMd.fontSize}
                >
                    {t("domain.bestWorstTitle")}
                </Text>
            </XStack>

            {domainRows.length < 2 ? (
                <Paragraph
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodySm.fontSize}
                >
                    {t("bestWorst.insufficientData")}
                </Paragraph>
            ) : (
                <YStack gap="$2">
                    {constructRows.map((row, rowIndex) => (
                        <XStack key={`row-${rowIndex}`} gap="$2">
                            {row.map((constructKey) => {
                                const ranking = rankingByKey.get(constructKey);
                                return (
                                    <ConstructCell
                                        key={constructKey}
                                        constructKey={constructKey}
                                        label={t(CONSTRUCT_LABEL_KEYS[constructKey])}
                                        ds={ds}
                                        best={ranking?.bestDomain ?? null}
                                        worst={ranking?.worstDomain ?? null}
                                    />
                                );
                            })}
                        </XStack>
                    ))}
                </YStack>
            )}

            {sociabilityRankings.length > 0 ? (
                <YStack gap="$2">
                    <Text
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.bodyBold}
                        fontSize={ds.typography.titleSm.fontSize}
                    >
                        {t("domain.sociabilityBestWorstTitle")}
                    </Text>
                    {layout.isTablet ? (
                        <XStack gap="$2">
                            {sociabilityRankings.map((ranking) => (
                                <SociabilityCategoryCell
                                    key={ranking.categoryKey}
                                    ranking={ranking}
                                    label={t(SOCIABILITY_CATEGORY_LABEL_KEYS[ranking.categoryKey])}
                                    ds={ds}
                                    t={t}
                                />
                            ))}
                        </XStack>
                    ) : (
                        <YStack gap="$2">
                            {sociabilityRankings.map((ranking) => (
                                <SociabilityCategoryCell
                                    key={ranking.categoryKey}
                                    ranking={ranking}
                                    label={t(SOCIABILITY_CATEGORY_LABEL_KEYS[ranking.categoryKey])}
                                    ds={ds}
                                    t={t}
                                />
                            ))}
                        </YStack>
                    )}
                </YStack>
            ) : null}
        </YStack>
    );
});
