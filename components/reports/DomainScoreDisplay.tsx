import { memo } from "react";
import { ScrollView } from "react-native";
import { Text, XStack, YStack } from "tamagui";
import { useTranslation } from "react-i18next";
import type { AuditScoreTotals } from "lib/audit/types";
import { formatPercentage, formatScoreValue, roundedPercentOfMax } from "lib/audit/score-helpers";
import { useDesignSystem } from "lib/design-system";
import { useResponsiveLayout } from "lib/responsive-layout";

import { getSociabilityDataColumnWidth, useReportScoreTableLayout } from "lib/report-table-layout";
import { DomainScoreTable } from "components/reports/DomainScoreTable";
import { type TFunction } from "i18next";

export interface DomainScoreDisplayProps {
    readonly scoreTotals: AuditScoreTotals | null;
    readonly itemCount: number;
}

// ── Metric definitions ───────────────────────────────────────────────────────

type MetricKey =
    | "provision"
    | "variety"
    | "challenge"
    | "sociability"
    | "sociability_play_alone"
    | "sociability_small_group"
    | "sociability_large_group"
    | "play_value"
    | "usability";

interface MetricConfig {
    readonly key: MetricKey;
    readonly labelKey: string;
    readonly value: (t: AuditScoreTotals) => number;
    readonly max: (t: AuditScoreTotals) => number;
}

const SCALE_METRICS: readonly MetricConfig[] = [
    {
        key: "provision",
        labelKey: "domain.barProvision",
        value: (t) => t.provision_total,
        max: (t) => t.provision_total_max,
    },
    {
        key: "variety",
        labelKey: "domain.barVariety",
        value: (t) => t.variety_total,
        max: (t) => t.variety_total_max,
    },
    {
        key: "challenge",
        labelKey: "domain.barChallenge",
        value: (t) => t.challenge_total,
        max: (t) => t.challenge_total_max,
    },
];

/**
 * Sociability as three independent opportunities.
 *
 * Order here is storage order, not rank. All three share one colour and one column width so the
 * chart never suggests that larger-group play is worth more than playing alone.
 */
const SOCIABILITY_DIMENSION_METRICS: readonly MetricConfig[] = [
    {
        key: "sociability_play_alone",
        labelKey: "domain.barSociabilityPlayAlone",
        value: (t) => t.sociability_breakdown?.play_alone.total ?? 0,
        max: (t) => t.sociability_breakdown?.play_alone.max ?? 0,
    },
    {
        key: "sociability_small_group",
        labelKey: "domain.barSociabilitySmallGroup",
        value: (t) => t.sociability_breakdown?.small_group.total ?? 0,
        max: (t) => t.sociability_breakdown?.small_group.max ?? 0,
    },
    {
        key: "sociability_large_group",
        labelKey: "domain.barSociabilityLargeGroup",
        value: (t) => t.sociability_breakdown?.large_group.total ?? 0,
        max: (t) => t.sociability_breakdown?.large_group.max ?? 0,
    },
];

/** Sociability as one aggregate, for instruments that never captured the three opportunities. */
const SOCIABILITY_TOTAL_METRICS: readonly MetricConfig[] = [
    {
        key: "sociability",
        labelKey: "domain.barSociability",
        value: (t) => t.sociability_total,
        max: (t) => t.sociability_total_max,
    },
];

const CONSTRUCT_METRICS: readonly MetricConfig[] = [
    {
        key: "play_value",
        labelKey: "domain.barPlayValue",
        value: (t) => t.play_value_total,
        max: (t) => t.play_value_total_max,
    },
    {
        key: "usability",
        labelKey: "domain.barUsability",
        value: (t) => t.usability_total,
        max: (t) => t.usability_total_max,
    },
];

/** Pick the Sociability bars that match what the source instrument actually captured. */
function resolveSociabilityMetrics(scoreTotals: AuditScoreTotals | null): readonly MetricConfig[] {
    return scoreTotals?.sociability_breakdown != null ? SOCIABILITY_DIMENSION_METRICS : SOCIABILITY_TOTAL_METRICS;
}

// Percentage cutoffs where the legacy bar color used to change. Now rendered as
// horizontal dotted lines across each bar, labeled at the start of each group.
const BAR_THRESHOLDS = [33.3, 66.6] as const;

/**
 * Bar color by metric identity (not score): the four PVUA scale bars use the
 * shared design-system scale colors; Play Value & Usability use the brand clay
 * family. Not-assessed bars fall back to the muted foreground.
 */
function barColorForMetric(key: MetricKey, isNa: boolean, ds: ReturnType<typeof useDesignSystem>): string {
    if (isNa) {
        return ds.colors.mutedForeground;
    }
    switch (key) {
        case "provision":
            return ds.colors.provision;
        case "variety":
            return ds.colors.variety;
        case "challenge":
            return ds.colors.challenge;
        // One colour for all four Sociability bars: the three opportunities are equal measures, so
        // a per-dimension palette would read as a ranking.
        case "sociability":
        case "sociability_play_alone":
        case "sociability_small_group":
        case "sociability_large_group":
            return ds.colors.sociability;
        case "play_value":
            return ds.colors.playValue;
        case "usability":
            return ds.colors.usabilityConstruct;
    }
}

// ── Bar rendering ─────────────────────────────────────────────────────────────

/**
 * One vertical bar track (no labels), centered within its data column so it sits
 * directly above the matching table column. Labels and the threshold lines are
 * rendered by `BarBlock` so the lines can run continuously across the whole group.
 */
function BarTrackCell({
    metric,
    scoreTotals,
    colWidth,
    barWidth,
    trackHeight,
    ds,
    t,
}: {
    readonly metric: MetricConfig;
    readonly scoreTotals: AuditScoreTotals | null;
    readonly colWidth: number;
    readonly barWidth: number;
    readonly trackHeight: number;
    readonly ds: ReturnType<typeof useDesignSystem>;
    readonly t: TFunction<"reports", undefined>;
}) {
    const value = scoreTotals === null ? 0 : metric.value(scoreTotals);
    const maximum = scoreTotals === null ? 0 : metric.max(scoreTotals);
    const isNa = scoreTotals === null || maximum <= 0;
    const fillRatio = isNa ? 0 : Math.min(1, value / maximum);
    const fillHeight = Math.round(fillRatio * trackHeight * 100) / 100;
    const barColor = barColorForMetric(metric.key, isNa, ds);
    const a11yPct = isNa ? t("detail.metricNotAssessed", { ns: "reports" }) : formatPercentage(value, maximum);

    return (
        <YStack width={colWidth} height={trackHeight} items="center" justify="flex-end">
            <YStack
                height={trackHeight}
                width={barWidth}
                borderWidth={1}
                borderColor={ds.colors.border}
                rounded={ds.radii.sm}
                overflow="hidden"
                justify="flex-end"
                accessibilityRole="progressbar"
                accessibilityLabel={`${t(metric.labelKey, { ns: "reports" })}: ${a11yPct}`}
                style={{ backgroundColor: ds.colors.input }}
            >
                {!isNa && fillHeight > 0 ? (
                    <YStack height={fillHeight} width="100%" style={{ backgroundColor: barColor, opacity: 0.88 }} />
                ) : isNa ? (
                    <YStack flex={1} justify="center" items="center">
                        <Text
                            color={ds.colors.mutedForeground}
                            fontSize={ds.typography.bodyXs.fontSize}
                            style={{ textAlign: "center" }}
                        >
                            -
                        </Text>
                    </YStack>
                ) : null}
            </YStack>
        </YStack>
    );
}

/**
 * A group of bars rendered as three aligned rows - percentage labels, a fixed-height
 * track row, and metric labels - so each column lines up with the table below. The
 * two threshold cutoffs are drawn as single dotted lines running continuously across
 * the whole track row, with their values labeled once on the left axis.
 */
function BarBlock({
    metrics,
    scoreTotals,
    getColWidth,
    barWidth,
    trackHeight,
    labelColWidth,
    ds,
    t,
}: {
    readonly metrics: readonly MetricConfig[];
    readonly scoreTotals: AuditScoreTotals | null;
    readonly getColWidth: (metric: MetricConfig) => number;
    readonly barWidth: number;
    readonly trackHeight: number;
    readonly labelColWidth: number;
    readonly ds: ReturnType<typeof useDesignSystem>;
    readonly t: TFunction<"reports", undefined>;
}) {
    const totalWidth = labelColWidth + metrics.reduce((sum, m) => sum + getColWidth(m), 0);

    return (
        <YStack width={totalWidth}>
            {/* Percentage labels */}
            <XStack pb="$1">
                <YStack width={labelColWidth} />
                {metrics.map((m) => {
                    const value = scoreTotals === null ? 0 : m.value(scoreTotals);
                    const maximum = scoreTotals === null ? 0 : m.max(scoreTotals);
                    const isNa = scoreTotals === null || maximum <= 0;
                    const pctRounded = roundedPercentOfMax(value, maximum);
                    const pctLabel = isNa ? t("extendedTable.notApplicable", { ns: "reports" }) : `${pctRounded}%`;
                    return (
                        <YStack key={m.key} width={getColWidth(m)} items="center">
                            <Text
                                color={isNa ? ds.colors.mutedForeground : ds.colors.foreground}
                                fontFamily={ds.fonts.bodyBold}
                                fontSize={ds.typography.bodyXs.fontSize}
                                numberOfLines={1}
                                style={{ textAlign: "center" }}
                            >
                                {pctLabel}
                            </Text>
                        </YStack>
                    );
                })}
            </XStack>

            {/* Track row with continuous threshold lines */}
            <YStack width={totalWidth} height={trackHeight}>
                <XStack height={trackHeight} items="flex-end">
                    {/* Left axis - threshold values labeled once */}
                    <YStack width={labelColWidth} height={trackHeight}>
                        {BAR_THRESHOLDS.map((th) => (
                            <Text
                                key={th}
                                color={ds.colors.mutedForeground}
                                fontFamily={ds.fonts.bodyMedium}
                                fontSize={10}
                                lineHeight={12}
                                style={{
                                    position: "absolute",
                                    right: 6,
                                    bottom: (th / 100) * trackHeight - 6,
                                }}
                            >
                                {th}%
                            </Text>
                        ))}
                    </YStack>
                    {metrics.map((m) => (
                        <BarTrackCell
                            key={m.key}
                            metric={m}
                            scoreTotals={scoreTotals}
                            colWidth={getColWidth(m)}
                            barWidth={barWidth}
                            trackHeight={trackHeight}
                            ds={ds}
                            t={t}
                        />
                    ))}
                </XStack>
                {/* Continuous dotted cutoff lines spanning the data columns */}
                {BAR_THRESHOLDS.map((th) => (
                    <YStack
                        key={`line-${th}`}
                        borderTopWidth={1}
                        borderColor={ds.colors.foreground}
                        style={{
                            position: "absolute",
                            left: labelColWidth,
                            right: 0,
                            bottom: (th / 100) * trackHeight,
                            borderStyle: "dashed",
                            opacity: 0.45,
                            pointerEvents: "none",
                        }}
                    />
                ))}
            </YStack>

            {/* Metric labels */}
            <XStack pt="$1">
                <YStack width={labelColWidth} />
                {metrics.map((m) => (
                    <YStack key={m.key} width={getColWidth(m)} items="center">
                        <Text
                            color={ds.colors.mutedForeground}
                            fontSize={ds.typography.bodyXs.fontSize}
                            lineHeight={ds.typography.bodyXs.lineHeight}
                            numberOfLines={3}
                            style={{ textAlign: "center" }}
                        >
                            {t(m.labelKey, { ns: "reports" })}
                        </Text>
                    </YStack>
                ))}
            </XStack>
        </YStack>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Adaptive score visualization: bars + tables in a coordinated layout.
 *
 * Phone
 * ─────
 * Bars and their corresponding table scroll together horizontally
 * so every bar sits directly above its matching column - two separate
 * scrollable groups (scale scores, then construct scores):
 *
 *   ┌────────────────────────────────────────── scroll ───────────┐
 *   │ [spacer] │ Provision │ Variety │ Challenge │ Sociability  │
 *   │  Achieved │  12  │  8  │  6   │  3  │  ← table              │
 *   │  Max      │  18  │  10 │  8   │  6  │                       │
 *   └─────────────────────────────────────────────────────────────┘
 *   ┌──────────────────────────── scroll ───┐
 *   │ [spacer]  │ Play Value │ Usability │  │
 *   │  Achieved │     24     │    18     │  │
 *   │  Max      │     36     │    28     │  │
 *   └───────────────────────────────────────┘
 *
 * Tablet
 * ──────
 * One row of six bars (label-column spacer + scale + construct columns) colored by metric
 * identity, then one joined score table (matches web `AlignedScoreDisplay`).
 */
export const DomainScoreDisplay = memo(function DomainScoreDisplay({
    scoreTotals,
    itemCount,
}: DomainScoreDisplayProps) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    const tableLayout = useReportScoreTableLayout();
    const { t } = useTranslation("reports");

    // Bar visual dimensions - scale with viewport tier
    const trackHeight = layout.isTablet ? 180 : 144;
    const barWidth = layout.isTablet ? 50 : 38;

    const sociabilityMetrics = resolveSociabilityMetrics(scoreTotals);
    // Keeps the Sociability group the same width whether it shows three opportunities or the single
    // legacy aggregate, so a `5.31` report has no stranded narrow column.
    const sociabilityDataColWidth = getSociabilityDataColumnWidth(tableLayout, sociabilityMetrics.length);

    const getColWidth = (metric: MetricConfig): number => {
        if (CONSTRUCT_METRICS.some((construct) => construct.key === metric.key)) {
            return tableLayout.rightDataColWidth;
        }
        return sociabilityMetrics.some((sociability) => sociability.key === metric.key)
            ? sociabilityDataColWidth
            : tableLayout.leftDataColWidth;
    };

    // ── Tablet layout - three bar groups over the matching three tables (web parity) ────
    //
    // Both rows lay their groups out side by side with the same `$4` gap and the same per-group
    // widths, so every bar stays directly above its own table column.
    if (layout.isTablet) {
        return (
            <YStack gap="$3" width="100%">
                <ScrollView horizontal showsHorizontalScrollIndicator>
                    <XStack gap="$4" items="flex-end">
                        {[SCALE_METRICS, sociabilityMetrics, CONSTRUCT_METRICS].map((metrics, groupIndex) => (
                            <BarBlock
                                key={metrics[0]?.key ?? `group-${groupIndex.toString()}`}
                                metrics={metrics}
                                scoreTotals={scoreTotals}
                                getColWidth={getColWidth}
                                barWidth={barWidth}
                                trackHeight={trackHeight}
                                labelColWidth={tableLayout.labelColWidth}
                                ds={ds}
                                t={t}
                            />
                        ))}
                    </XStack>
                </ScrollView>

                <DomainScoreTable scoreTotals={scoreTotals} itemCount={itemCount} />
            </YStack>
        );
    }

    // ── Phone layout: three independently scrollable groups ──────────────────
    //
    // `useReportScoreTableLayout` sizes every group to the same content track: the scale columns
    // divide it three ways and the construct columns two ways, so all three groups end up the
    // same width and none of them gains a horizontal scroll the others lack.
    //
    const phoneBarWidth = barWidth;
    const phoneLeftDataColWidth = tableLayout.leftDataColWidth;
    const phoneRightDataColWidth = tableLayout.rightDataColWidth;
    const phoneLabelColWidth = tableLayout.labelColWidth;

    const scaleGroupWidth = phoneLabelColWidth + phoneLeftDataColWidth * SCALE_METRICS.length;
    const sociabilityGroupWidth = tableLayout.sociabilityTableWidth;
    const constructGroupWidth = phoneLabelColWidth + phoneRightDataColWidth * CONSTRUCT_METRICS.length;

    const renderPhoneSection = (
        metrics: readonly MetricConfig[],
        groupWidth: number,
        dataColWidth: number,
        sectionLabelKey: string,
        tableGroup: PhoneSubTableGroup,
        footnote?: string,
    ) => (
        <YStack gap="$1" width="100%">
            {/* Section label */}
            <Text
                color={ds.colors.mutedForeground}
                fontFamily={ds.fonts.bodyBold}
                fontSize={ds.typography.bodyXs.fontSize}
                style={{ textTransform: "uppercase", letterSpacing: 0.6 }}
            >
                {t(sectionLabelKey, { ns: "reports" })}
            </Text>

            {/* Bars + table in one shared horizontal scroll */}
            <ScrollView horizontal showsHorizontalScrollIndicator>
                <YStack gap="$0">
                    {/* Bars as three aligned rows with continuous threshold lines */}
                    <BarBlock
                        metrics={metrics}
                        scoreTotals={scoreTotals}
                        getColWidth={() => dataColWidth}
                        barWidth={phoneBarWidth}
                        trackHeight={trackHeight}
                        labelColWidth={phoneLabelColWidth}
                        ds={ds}
                        t={t}
                    />

                    {/* Sub-table - same column widths, so bars are perfectly aligned */}
                    <PhoneSubTable
                        group={tableGroup}
                        scoreTotals={scoreTotals}
                        itemCount={itemCount}
                        tableWidth={groupWidth}
                        labelColWidth={phoneLabelColWidth}
                        dataColWidth={dataColWidth}
                        ds={ds}
                        t={t}
                    />
                </YStack>
            </ScrollView>

            {footnote === undefined ? null : (
                <Text
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodyXs.fontSize}
                    lineHeight={ds.typography.bodyXs.lineHeight}
                >
                    {footnote}
                </Text>
            )}
        </YStack>
    );

    return (
        <YStack gap="$4" width="100%">
            {renderPhoneSection(
                SCALE_METRICS,
                scaleGroupWidth,
                phoneLeftDataColWidth,
                "domain.barRowScaleScores",
                "scale",
            )}
            {renderPhoneSection(
                sociabilityMetrics,
                sociabilityGroupWidth,
                sociabilityDataColWidth,
                "domain.barRowSociability",
                "sociability",
                scoreTotals?.sociability_breakdown == null
                    ? t("domain.sociabilityBreakdownNotCaptured", { ns: "reports" })
                    : undefined,
            )}
            {renderPhoneSection(
                CONSTRUCT_METRICS,
                constructGroupWidth,
                phoneRightDataColWidth,
                "domain.barRowPlayValueUsability",
                "construct",
            )}
        </YStack>
    );
});

// ── PhoneSubTable ─────────────────────────────────────────────────────────────

type PhoneSubTableGroup = "scale" | "sociability" | "construct";

interface PhoneSubTableProps {
    readonly group: PhoneSubTableGroup;
    readonly scoreTotals: AuditScoreTotals | null;
    readonly itemCount: number;
    readonly tableWidth: number;
    readonly labelColWidth: number;
    readonly dataColWidth: number;
    readonly ds: ReturnType<typeof useDesignSystem>;
    readonly t: TFunction<"reports", undefined>;
}

interface ColDef {
    readonly key: string;
    readonly headerKey: string;
    readonly value: (r: AuditScoreTotals) => number;
    readonly max: (r: AuditScoreTotals) => number;
}

const SCALE_COLDEFS: readonly ColDef[] = [
    {
        key: "provision",
        headerKey: "extendedTable.columnProvision",
        value: (r) => r.provision_total,
        max: (r) => r.provision_total_max,
    },
    {
        key: "variety",
        headerKey: "extendedTable.columnVariety",
        value: (r) => r.variety_total,
        max: (r) => r.variety_total_max,
    },
    {
        key: "challenge",
        headerKey: "extendedTable.columnChallenge",
        value: (r) => r.challenge_total,
        max: (r) => r.challenge_total_max,
    },
];

const SOCIABILITY_DIMENSION_COLDEFS: readonly ColDef[] = [
    {
        key: "sociability_play_alone",
        headerKey: "extendedTable.columnSociabilityPlayAlone",
        value: (r) => r.sociability_breakdown?.play_alone.total ?? 0,
        max: (r) => r.sociability_breakdown?.play_alone.max ?? 0,
    },
    {
        key: "sociability_small_group",
        headerKey: "extendedTable.columnSociabilitySmallGroup",
        value: (r) => r.sociability_breakdown?.small_group.total ?? 0,
        max: (r) => r.sociability_breakdown?.small_group.max ?? 0,
    },
    {
        key: "sociability_large_group",
        headerKey: "extendedTable.columnSociabilityLargeGroup",
        value: (r) => r.sociability_breakdown?.large_group.total ?? 0,
        max: (r) => r.sociability_breakdown?.large_group.max ?? 0,
    },
];

const SOCIABILITY_TOTAL_COLDEFS: readonly ColDef[] = [
    {
        key: "sociability",
        headerKey: "extendedTable.columnSociability",
        value: (r) => r.sociability_total,
        max: (r) => r.sociability_total_max,
    },
];

const CONSTRUCT_COLDEFS: readonly ColDef[] = [
    {
        key: "play_value",
        headerKey: "extendedTable.columnPlayValue",
        value: (r) => r.play_value_total,
        max: (r) => r.play_value_total_max,
    },
    {
        key: "usability",
        headerKey: "extendedTable.columnUsability",
        value: (r) => r.usability_total,
        max: (r) => r.usability_total_max,
    },
];

/** Choose the columns for one phone group, falling back to the Sociability aggregate when the
 * source instrument never captured the three opportunities. */
function resolvePhoneColumns(group: PhoneSubTableGroup, scoreTotals: AuditScoreTotals | null): readonly ColDef[] {
    if (group === "scale") {
        return SCALE_COLDEFS;
    }
    if (group === "construct") {
        return CONSTRUCT_COLDEFS;
    }
    return scoreTotals?.sociability_breakdown != null ? SOCIABILITY_DIMENSION_COLDEFS : SOCIABILITY_TOTAL_COLDEFS;
}

function cellVal(totals: AuditScoreTotals | null, fn: (r: AuditScoreTotals) => number): string {
    if (totals === null) return "-";
    return formatScoreValue(fn(totals));
}

function cellMx(totals: AuditScoreTotals | null, fn: (r: AuditScoreTotals) => number): string {
    if (totals === null) return "-";
    const v = fn(totals);
    return v <= 0 ? "-" : formatScoreValue(v);
}

/**
 * Minimal inline sub-table for phone, rendered inside the shared scroll view.
 * Column widths exactly match the bar cells above.
 */
function PhoneSubTable({
    group,
    scoreTotals,
    itemCount,
    tableWidth,
    labelColWidth,
    dataColWidth,
    ds,
    t,
}: PhoneSubTableProps) {
    const columns = resolvePhoneColumns(group, scoreTotals);

    const rows = [
        {
            labelKey: "domain.scoreAchievedLabel",
            getValue: (col: ColDef) => cellVal(scoreTotals, col.value),
            bg: ds.colors.input,
        },
        {
            labelKey: "domain.maxScoreLabel",
            getValue: (col: ColDef) => cellMx(scoreTotals, col.max),
            bg: ds.colors.mutedSurface,
        },
        {
            labelKey: "domain.itemsContributingLabel",
            getValue: () => itemCount.toString(),
            bg: ds.colors.input,
        },
    ];

    return (
        <YStack
            minW={tableWidth}
            borderWidth={1}
            borderColor={ds.colors.border}
            rounded={ds.radii.sm}
            overflow="hidden"
        >
            {/* Header */}
            <XStack bg={ds.colors.primary} borderBottomWidth={1} borderColor={ds.colors.border}>
                <YStack
                    width={labelColWidth}
                    p="$2"
                    borderRightWidth={1}
                    borderColor={ds.colors.border}
                    style={{ opacity: 0 }}
                />
                {columns.map((col, i) => (
                    <YStack
                        key={col.key}
                        minW={dataColWidth}
                        p="$2"
                        items="center"
                        justify="center"
                        borderLeftWidth={i === 0 ? 0 : 1}
                        borderColor={ds.colors.border}
                    >
                        <Text
                            color={ds.colors.primaryForeground}
                            fontFamily={ds.fonts.bodyBold}
                            fontSize={ds.typography.bodyXs.fontSize}
                            numberOfLines={2}
                            width="100%"
                            style={{ textAlign: "center" }}
                        >
                            {t(col.headerKey, { ns: "reports" })}
                        </Text>
                    </YStack>
                ))}
            </XStack>

            {/* Data rows */}
            {rows.map((row, rowIndex) => (
                <XStack
                    key={row.labelKey}
                    borderBottomWidth={rowIndex < rows.length - 1 ? 1 : 0}
                    borderColor={ds.colors.border}
                    style={{ backgroundColor: row.bg }}
                >
                    <YStack
                        width={labelColWidth}
                        p="$2"
                        justify="center"
                        borderRightWidth={1}
                        borderColor={ds.colors.border}
                    >
                        <Text
                            color={ds.colors.mutedForeground}
                            fontFamily={ds.fonts.bodyBold}
                            fontSize={ds.typography.bodyXs.fontSize}
                            numberOfLines={3}
                            width="100%"
                        >
                            {t(row.labelKey, { ns: "reports" })}
                        </Text>
                    </YStack>
                    {columns.map((col, i) => (
                        <YStack
                            key={col.key}
                            minW={dataColWidth}
                            p="$2"
                            items="center"
                            justify="center"
                            borderLeftWidth={i !== 0 ? 1 : 0}
                            borderColor={ds.colors.border}
                        >
                            <Text
                                color={ds.colors.foreground}
                                fontFamily={ds.fonts.monoMedium}
                                fontSize={ds.typography.bodyXs.fontSize}
                                width="100%"
                                style={{ textAlign: "center" }}
                            >
                                {row.getValue(col)}
                            </Text>
                        </YStack>
                    ))}
                </XStack>
            ))}
        </YStack>
    );
}
