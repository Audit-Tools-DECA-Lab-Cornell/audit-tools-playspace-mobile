import { memo } from "react";
import { ScrollView } from "react-native";
import { Text, XStack, YStack } from "tamagui";
import { useTranslation } from "react-i18next";
import type { AuditScoreTotals } from "lib/audit/types";
import type { ConstructSelection } from "lib/audit/report-filter";
import { formatScoreValue } from "lib/audit/score-helpers";
import { useDesignSystem } from "lib/design-system";
import { useResponsiveLayout } from "lib/responsive-layout";
import { getSociabilityDataColumnWidth, useReportScoreTableLayout } from "lib/report-table-layout";

export interface DomainScoreTableProps {
    readonly scoreTotals: AuditScoreTotals | null;
    readonly itemCount: number;
    readonly constructSelection?: ConstructSelection;
}

// ── Legacy constants (kept for any external consumers) ──
export const REPORT_SCORE_LABEL_COL_WIDTH = 120;
export const REPORT_SCORE_LEFT_DATA_COL_WIDTH = 72;
export const REPORT_SCORE_RIGHT_DATA_COL_WIDTH_TABLET = 132;
export const REPORT_SCORE_LEFT_TABLE_WIDTH = REPORT_SCORE_LABEL_COL_WIDTH + REPORT_SCORE_LEFT_DATA_COL_WIDTH * 4;
export const REPORT_SCORE_RIGHT_TABLE_WIDTH =
    REPORT_SCORE_LABEL_COL_WIDTH + REPORT_SCORE_RIGHT_DATA_COL_WIDTH_TABLET * 2;

function cellValue(totals: AuditScoreTotals | null, value: (row: AuditScoreTotals) => number): string {
    if (totals === null) return "-";
    return formatScoreValue(value(totals));
}

function cellMax(totals: AuditScoreTotals | null, max: (row: AuditScoreTotals) => number): string {
    if (totals === null) return "-";
    const raw = max(totals);
    if (raw <= 0) return "-";
    return formatScoreValue(raw);
}

interface ColumnDef {
    readonly key: string;
    readonly value: (row: AuditScoreTotals) => number;
    readonly max: (row: AuditScoreTotals) => number;
    readonly headerKey: string;
}

const LEFT_COLUMNS: readonly ColumnDef[] = [
    {
        key: "provision",
        value: (r) => r.provision_total,
        max: (r) => r.provision_total_max,
        headerKey: "extendedTable.columnProvision",
    },
    {
        key: "variety",
        value: (r) => r.variety_total,
        max: (r) => r.variety_total_max,
        headerKey: "extendedTable.columnVariety",
    },
    {
        key: "challenge",
        value: (r) => r.challenge_total,
        max: (r) => r.challenge_total_max,
        headerKey: "extendedTable.columnChallenge",
    },
];

/**
 * Sociability as three independent opportunities.
 *
 * Column order is storage order, not rank - the three carry equal weight and share one column
 * width, so nothing in the table suggests one opportunity outranks another.
 */
export const SOCIABILITY_DIMENSION_COLUMNS: readonly ColumnDef[] = [
    {
        key: "sociability_play_alone",
        value: (r) => r.sociability_breakdown?.play_alone.total ?? 0,
        max: (r) => r.sociability_breakdown?.play_alone.max ?? 0,
        headerKey: "extendedTable.columnSociabilityPlayAlone",
    },
    {
        key: "sociability_small_group",
        value: (r) => r.sociability_breakdown?.small_group.total ?? 0,
        max: (r) => r.sociability_breakdown?.small_group.max ?? 0,
        headerKey: "extendedTable.columnSociabilitySmallGroup",
    },
    {
        key: "sociability_large_group",
        value: (r) => r.sociability_breakdown?.large_group.total ?? 0,
        max: (r) => r.sociability_breakdown?.large_group.max ?? 0,
        headerKey: "extendedTable.columnSociabilityLargeGroup",
    },
];

/** Sociability as one aggregate, for instruments that never captured the three opportunities. */
export const SOCIABILITY_TOTAL_COLUMNS: readonly ColumnDef[] = [
    {
        key: "sociability",
        value: (r) => r.sociability_total,
        max: (r) => r.sociability_total_max,
        headerKey: "extendedTable.columnSociability",
    },
];

/** Pick the Sociability columns that match what the source instrument actually captured. */
export function resolveSociabilityColumns(scoreTotals: AuditScoreTotals | null): readonly ColumnDef[] {
    return scoreTotals?.sociability_breakdown != null ? SOCIABILITY_DIMENSION_COLUMNS : SOCIABILITY_TOTAL_COLUMNS;
}

const RIGHT_COLUMNS: readonly ColumnDef[] = [
    {
        key: "play_value",
        value: (r) => r.play_value_total,
        max: (r) => r.play_value_total_max,
        headerKey: "extendedTable.columnPlayValue",
    },
    {
        key: "usability",
        value: (r) => r.usability_total,
        max: (r) => r.usability_total_max,
        headerKey: "extendedTable.columnUsability",
    },
];

export { LEFT_COLUMNS as SCALE_COLUMNS, RIGHT_COLUMNS as CONSTRUCT_COLUMNS };
export type { ColumnDef as ReportScoreColumnDef };

function isConstructColumn(col: ColumnDef): boolean {
    return col.key === "play_value" || col.key === "usability";
}

interface DataCellProps {
    readonly children: string;
    readonly borderLeft: boolean;
    readonly width: number;
    readonly ds: ReturnType<typeof useDesignSystem>;
    readonly isAlt?: boolean;
}

function DataCell({ children, borderLeft, width, ds, isAlt }: DataCellProps) {
    return (
        <YStack
            width={width}
            p="$2"
            items="center"
            justify="center"
            borderLeftWidth={borderLeft ? 1 : 0}
            borderColor={ds.colors.border}
            style={{ backgroundColor: isAlt ? ds.colors.mutedSurface : undefined }}
        >
            <Text
                color={ds.colors.foreground}
                fontFamily={ds.fonts.monoMedium}
                fontSize={ds.typography.bodyXs.fontSize}
                width="100%"
                style={{ textAlign: "center" }}
            >
                {children}
            </Text>
        </YStack>
    );
}

interface SubTableProps {
    readonly columns: readonly ColumnDef[];
    readonly scoreTotals: AuditScoreTotals | null;
    readonly itemCount: number;
    readonly labels: readonly { readonly text: string }[];
    readonly getColumnWidth: (col: ColumnDef) => number;
    readonly tableWidth: number;
    readonly labelColWidth: number;
}

function ScoreSubTable({
    columns,
    scoreTotals,
    itemCount,
    labels,
    getColumnWidth,
    tableWidth,
    labelColWidth,
}: SubTableProps) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");

    const LabelCell = ({ text }: { text: string }) => (
        <YStack
            width={labelColWidth}
            p="$2"
            justify="center"
            items="flex-start"
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
                {text}
            </Text>
        </YStack>
    );

    return (
        <YStack
            borderWidth={1}
            borderColor={ds.colors.border}
            rounded={ds.radii.sm}
            overflow="hidden"
            width={tableWidth}
        >
            {/* Header row */}
            <XStack bg={ds.colors.primary} borderBottomWidth={1} borderColor={ds.colors.border}>
                <YStack
                    width={labelColWidth}
                    p="$2"
                    justify="center"
                    items="center"
                    borderRightWidth={1}
                    borderColor={ds.colors.primaryForeground}
                />
                {columns.map((col, i) => {
                    const w = getColumnWidth(col);
                    return (
                        <YStack
                            key={col.key}
                            width={w}
                            p="$2"
                            items="center"
                            justify="center"
                            borderLeftWidth={i === 0 ? 0 : 1}
                            borderColor={ds.colors.primaryForeground}
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
                    );
                })}
            </XStack>

            {/* Score achieved row */}
            <XStack bg={ds.colors.input} borderColor={ds.colors.border}>
                <LabelCell text={labels[0]?.text ?? ""} />
                {columns.map((col, i) => {
                    const w = getColumnWidth(col);
                    return (
                        <DataCell key={`${col.key}-achieved`} borderLeft={i !== 0} ds={ds} width={w}>
                            {cellValue(scoreTotals, col.value)}
                        </DataCell>
                    );
                })}
            </XStack>

            <XStack bg={ds.colors.mutedSurface} borderColor={ds.colors.border}>
                <LabelCell text={labels[1]?.text ?? ""} />
                {columns.map((col, i) => {
                    const w = getColumnWidth(col);
                    return (
                        <DataCell key={`${col.key}-max`} borderLeft={i !== 0} ds={ds} width={w} isAlt>
                            {cellMax(scoreTotals, col.max)}
                        </DataCell>
                    );
                })}
            </XStack>
            <XStack bg={ds.colors.input}>
                <LabelCell text={labels[2]?.text ?? ""} />
                {columns.map((col, i) => (
                    <DataCell key={`${col.key}-items`} borderLeft={i !== 0} ds={ds} width={getColumnWidth(col)}>
                        {itemCount.toString()}
                    </DataCell>
                ))}
            </XStack>
        </YStack>
    );
}

/**
 * Score achieved / max / item count in three separately scrollable tables: the scored scales, the
 * Sociability opportunities, and the two headline constructs.
 *
 * The groups stay separate on every screen size. Joining all eight measures into one table would
 * squeeze each column past the point where the numbers stay readable. Aligns with web
 * `AlignedScoreDisplay`.
 */
export const DomainScoreTable = memo(function DomainScoreTable({
    scoreTotals,
    itemCount,
    constructSelection = { playValue: true, usability: true },
}: DomainScoreTableProps) {
    const layout = useResponsiveLayout();
    const tableLayout = useReportScoreTableLayout();
    const { t } = useTranslation("reports");

    const labels = [
        { text: t("domain.scoreAchievedLabel", { ns: "reports" }) },
        { text: t("domain.maxScoreLabel", { ns: "reports" }) },
        { text: t("domain.itemsContributingLabel", { ns: "reports" }) },
    ];

    const sociabilityColumns = resolveSociabilityColumns(scoreTotals);
    const constructColumns = RIGHT_COLUMNS.filter((column) =>
        column.key === "play_value" ? constructSelection.playValue : constructSelection.usability,
    );
    const capturesDimensions = scoreTotals?.sociability_breakdown != null;
    const sociabilityDataColWidth = getSociabilityDataColumnWidth(tableLayout, sociabilityColumns.length);

    const getWidthForColumn = (col: ColumnDef): number => {
        if (isConstructColumn(col)) {
            return tableLayout.rightDataColWidth;
        }
        return isSociabilityColumn(col) ? sociabilityDataColWidth : tableLayout.leftDataColWidth;
    };

    const commonProps = {
        scoreTotals,
        itemCount,
        labels,
        getColumnWidth: getWidthForColumn,
        labelColWidth: tableLayout.labelColWidth,
    } as const;

    const scaleTable = (
        <ScoreSubTable {...commonProps} columns={LEFT_COLUMNS} tableWidth={tableLayout.leftTableWidth} />
    );
    const sociabilityTable = (
        <YStack gap="$1.5">
            <ScoreSubTable
                {...commonProps}
                columns={sociabilityColumns}
                tableWidth={tableLayout.sociabilityTableWidth}
            />
            {capturesDimensions ? null : (
                <SociabilityNotCapturedNote
                    text={t("domain.sociabilityBreakdownNotCaptured", { ns: "reports" })}
                    width={tableLayout.sociabilityTableWidth}
                />
            )}
        </YStack>
    );
    const constructTable = (
        <ScoreSubTable
            {...commonProps}
            columns={constructColumns}
            tableWidth={tableLayout.labelColWidth + tableLayout.rightDataColWidth * constructColumns.length}
        />
    );

    // Tablet lays the three groups out side by side in one scroller, matching the bar row above so
    // every bar still sits directly over its own column. The gap must stay in step with the
    // `XStack` gap in `DomainScoreDisplay`.
    if (layout.isTablet) {
        return (
            <ScrollView horizontal showsHorizontalScrollIndicator style={{ width: "100%" }}>
                <XStack gap="$4" items="flex-start">
                    {scaleTable}
                    {sociabilityTable}
                    {constructColumns.length === 0 ? null : constructTable}
                </XStack>
            </ScrollView>
        );
    }

    return (
        <YStack gap="$3" width="100%">
            <ScrollView horizontal showsHorizontalScrollIndicator>
                {scaleTable}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator>
                {sociabilityTable}
            </ScrollView>
            {constructColumns.length === 0 ? null : (
                <ScrollView horizontal showsHorizontalScrollIndicator>
                    {constructTable}
                </ScrollView>
            )}
        </YStack>
    );
});

function isSociabilityColumn(col: ColumnDef): boolean {
    return col.key === "sociability" || col.key.startsWith("sociability_");
}

/** Explain an absent breakdown instead of leaving three empty columns to be read as zeros. */
function SociabilityNotCapturedNote({ text, width }: Readonly<{ text: string; width: number }>) {
    const ds = useDesignSystem();

    return (
        <Text
            width={width}
            color={ds.colors.mutedForeground}
            fontFamily={ds.fonts.bodyMedium}
            fontSize={ds.typography.bodyXs.fontSize}
            lineHeight={ds.typography.bodyXs.lineHeight}
        >
            {text}
        </Text>
    );
}
