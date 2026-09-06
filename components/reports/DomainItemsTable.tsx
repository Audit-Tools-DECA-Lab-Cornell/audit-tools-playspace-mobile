import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { ScrollView, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Text, XStack, YStack } from "tamagui";
import { useTranslation } from "react-i18next";
import type { DomainQuestionRow } from "lib/audit/report-helpers";
import type { ConstructSelection } from "lib/audit/report-filter";
import { SOCIABILITY_CATEGORY_KEYS } from "lib/audit/sociability";
import { formatQuestionKeyForDisplay } from "lib/audit/prompt-segments";
import { formatScoreValue } from "lib/audit/score-helpers";
import { useDesignSystem } from "lib/design-system";
import { useResponsiveLayout } from "lib/responsive-layout";
import { PromptRichText } from "components/reports/PromptRichText";

export interface DomainItemsTableProps {
    readonly questions: DomainQuestionRow[];
    readonly constructSelection?: ConstructSelection;
}

const SOCIABILITY_CATEGORY_LABEL_KEYS: Record<(typeof SOCIABILITY_CATEGORY_KEYS)[number], string> = {
    play_alone: "extendedTable.columnSociabilityPlayAlone",
    small_group: "extendedTable.columnSociabilitySmallGroup",
    large_group: "extendedTable.columnSociabilityLargeGroup",
};

/**
 * List the play opportunities an auditor selected for one item.
 *
 * Selections stay in storage order and share one type style - the auditor may pick any combination
 * and no combination outranks another.
 */
function formatSociabilitySelections(
    selections: DomainQuestionRow["sociabilitySelections"],
    translate: (key: string) => string,
): string {
    const selected = SOCIABILITY_CATEGORY_KEYS.filter((key) => selections[key] === true);
    if (selected.length === 0) {
        return translate("extendedTable.sociabilityNoneSelected");
    }
    return selected.map((key) => translate(SOCIABILITY_CATEGORY_LABEL_KEYS[key])).join("\n");
}

function formatPlayUsabilityCell(
    score: number | null,
    max: number | null,
    translate: {
        notApplicable: () => string;
        scoreAchieved: (scoreText: string) => string;
        maxScore: (maxText: string) => string;
    },
): string {
    const na = translate.notApplicable();
    if (score === null || max === null) {
        return `${translate.scoreAchieved(na)}\n${translate.maxScore(na)}`;
    }
    return `${translate.scoreAchieved(formatScoreValue(score))}\n${translate.maxScore(formatScoreValue(max))}`;
}

/** Column width constants scaled by viewport tier. */
interface ItemsTableLayout {
    readonly idColWidth: number;
    readonly itemColWidth: number;
    readonly scaleColWidth: number;
    readonly pvuColWidth: number;
    readonly minTableWidth: number;
}

function computeItemsTableLayout(
    isTablet: boolean,
    isWideTablet: boolean,
    constructColumnCount: number,
): ItemsTableLayout {
    const idColWidth = isTablet ? 92 : 80;
    const itemColWidth = isWideTablet ? 520 : isTablet ? 460 : 400;
    const scaleColWidth = isTablet ? 130 : 112;
    const pvuColWidth = isTablet ? 152 : 132;
    const minTableWidth = idColWidth + itemColWidth + scaleColWidth * 4 + pvuColWidth * constructColumnCount;
    return { idColWidth, itemColWidth, scaleColWidth, pvuColWidth, minTableWidth };
}

/**
 * Per-question breakdown table for the extended report view.
 * Column widths adapt to the viewport tier.
 */
export const DomainItemsTable = memo(function DomainItemsTable({
    questions,
    constructSelection = { playValue: true, usability: true },
}: DomainItemsTableProps) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    const { t } = useTranslation("reports");

    const cols = useMemo(
        () =>
            computeItemsTableLayout(
                layout.isTablet,
                layout.isWideTablet,
                Number(constructSelection.playValue) + Number(constructSelection.usability),
            ),
        [constructSelection.playValue, constructSelection.usability, layout.isTablet, layout.isWideTablet],
    );

    // Edge-fade affordance: the table is ~1436px wide, so on every device some
    // columns start off-screen. The fade signals hidden content (G8) and
    // disappears once the user reaches the right edge (or content fits).
    const [scrollX, setScrollX] = useState(0);
    const [contentWidth, setContentWidth] = useState(0);
    const [viewportWidth, setViewportWidth] = useState(0);

    const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        setScrollX(event.nativeEvent.contentOffset.x);
    }, []);
    const handleContentSizeChange = useCallback((width: number) => {
        setContentWidth(width);
    }, []);
    const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
        setViewportWidth(event.nativeEvent.layout.width);
    }, []);

    const showEndFade = contentWidth - scrollX - viewportWidth > 12;

    const translatePv = {
        notApplicable: () => t("extendedTable.notApplicable"),
        scoreAchieved: (scoreText: string) => t("extendedTable.scoreAchieved", { score: scoreText }),
        maxScore: (maxText: string) => t("extendedTable.maxScore", { max: maxText }),
    };

    if (questions.length === 0) return null;

    const cellFont = ds.typography.bodyXs.fontSize;
    const cellLine = ds.typography.bodyXs.lineHeight;
    const mutedDashOpacity = 0.55;

    const HeaderCell = ({
        children,
        width,
        isFirst = false,
    }: {
        children: string;
        width: number;
        isFirst?: boolean;
    }) => (
        <YStack
            width={width}
            p="$2"
            items="center"
            justify="center"
            borderLeftWidth={isFirst ? 0 : 1}
            borderColor={ds.colors.primaryForeground}
        >
            <Text
                color={ds.colors.primaryForeground}
                fontFamily={ds.fonts.bodyBold}
                fontSize={cellFont}
                width="100%"
                style={{ textAlign: "center" }}
            >
                {children}
            </Text>
        </YStack>
    );

    const DataText = ({
        children,
        textAlign = "center",
        mono = false,
        muted = false,
        opacity,
        bold = false,
    }: {
        children: ReactNode;
        textAlign?: "center" | "left";
        mono?: boolean;
        muted?: boolean;
        opacity?: number;
        bold?: boolean;
    }) => (
        <Text
            color={muted ? ds.colors.mutedForeground : ds.colors.foreground}
            fontFamily={mono ? ds.fonts.monoMedium : bold ? ds.fonts.bodyBold : undefined}
            fontSize={cellFont}
            lineHeight={cellLine}
            width="100%"
            opacity={opacity}
            style={{ textAlign }}
        >
            {children}
        </Text>
    );

    function renderScaleCellState(options: {
        label: string | null;
        applicable: boolean;
        isNotApplicable: boolean;
        isUnsure: boolean;
        followUpScalesAsked?: boolean;
    }): ReactNode {
        const { label, applicable, isNotApplicable, isUnsure, followUpScalesAsked = true } = options;
        if (!applicable || !followUpScalesAsked) {
            return (
                <DataText textAlign="center" muted opacity={mutedDashOpacity}>
                    -
                </DataText>
            );
        }
        if (isNotApplicable) {
            return (
                <DataText textAlign="center" bold>
                    {t("extendedTable.notApplicableFull", { ns: "reports" })}
                </DataText>
            );
        }
        if (isUnsure) {
            return (
                <DataText textAlign="center" bold>
                    {t("extendedTable.unsure", { ns: "reports" })}
                </DataText>
            );
        }
        return <DataText textAlign="center">{label ?? "-"}</DataText>;
    }

    // ── Phone layout (6.3/G8): priority-column rows instead of a ~1436px
    // horizontal grid. Every value wraps into view - nothing hides off-screen.
    if (!layout.isTablet) {
        const formatPvuCompact = (score: number | null, max: number | null): string => {
            if (score === null || max === null) {
                return t("extendedTable.notApplicable");
            }
            return `${formatScoreValue(score)} / ${formatScoreValue(max)}`;
        };

        const scaleValueText = (options: {
            label: string | null;
            applicable: boolean;
            isNotApplicable: boolean;
            isUnsure: boolean;
            followUpScalesAsked?: boolean;
        }): { text: string; muted: boolean } => {
            const { label, applicable, isNotApplicable, isUnsure, followUpScalesAsked = true } = options;
            if (!applicable || !followUpScalesAsked) {
                return { text: "-", muted: true };
            }
            if (isNotApplicable) {
                return { text: t("extendedTable.notApplicableFull"), muted: false };
            }
            if (isUnsure) {
                return { text: t("extendedTable.unsure"), muted: false };
            }
            return { text: label ?? "-", muted: label === null };
        };

        return (
            <YStack width="100%" rounded={ds.radii.sm} borderWidth={1} borderColor={ds.colors.border} overflow="hidden">
                {questions.map((question, index) => {
                    const rowBg = index % 2 === 0 ? ds.colors.input : ds.colors.surface;
                    const scaleCells = [
                        {
                            label: t("extendedTable.columnProvision"),
                            ...scaleValueText({
                                label: question.provisionLabel,
                                applicable: question.provisionApplicable,
                                isNotApplicable: question.provisionIsNotApplicable,
                                isUnsure: question.provisionIsUnsure,
                            }),
                        },
                        {
                            label: t("extendedTable.columnVariety"),
                            ...scaleValueText({
                                label: question.varietyLabel,
                                applicable: question.varietyApplicable,
                                isNotApplicable: question.varietyIsNotApplicable,
                                isUnsure: question.varietyIsUnsure,
                                followUpScalesAsked: question.followUpScalesAsked,
                            }),
                        },
                        {
                            label: t("extendedTable.columnChallenge"),
                            ...scaleValueText({
                                label: question.challengeLabel,
                                applicable: question.challengeApplicable,
                                isNotApplicable: question.challengeIsNotApplicable,
                                isUnsure: question.challengeIsUnsure,
                                followUpScalesAsked: question.followUpScalesAsked,
                            }),
                        },
                        {
                            label: t("extendedTable.columnSociability"),
                            ...(question.sociabilityCapturedAsMultiselect
                                ? {
                                      text: formatSociabilitySelections(question.sociabilitySelections, t),
                                      muted: false,
                                  }
                                : scaleValueText({
                                      label: question.sociabilityLabel,
                                      applicable: question.sociabilityApplicable,
                                      isNotApplicable: question.sociabilityIsNotApplicable,
                                      isUnsure: question.sociabilityIsUnsure,
                                      followUpScalesAsked: question.followUpScalesAsked,
                                  })),
                        },
                    ];

                    return (
                        <YStack
                            key={question.questionKey}
                            bg={rowBg}
                            p="$3"
                            gap="$2"
                            borderTopWidth={index === 0 ? 0 : 1}
                            borderColor={ds.colors.border}
                        >
                            <XStack justify="space-between" items="center" gap="$2">
                                <Text
                                    color={ds.colors.mutedForeground}
                                    fontFamily={ds.fonts.monoMedium}
                                    fontSize={cellFont}
                                >
                                    {formatQuestionKeyForDisplay(question.questionKey)}
                                </Text>
                                <XStack gap="$3">
                                    {constructSelection.playValue ? (
                                        <Text
                                            color={ds.colors.foreground}
                                            fontFamily={ds.fonts.bodyBold}
                                            fontSize={cellFont}
                                        >
                                            {`${t("extendedTable.columnPlayValue")}: ${formatPvuCompact(question.playValueScore, question.playValueMax)}`}
                                        </Text>
                                    ) : null}
                                    {constructSelection.usability ? (
                                        <Text
                                            color={ds.colors.foreground}
                                            fontFamily={ds.fonts.bodyBold}
                                            fontSize={cellFont}
                                        >
                                            {`${t("extendedTable.columnUsability")}: ${formatPvuCompact(question.usabilityScore, question.usabilityMax)}`}
                                        </Text>
                                    ) : null}
                                </XStack>
                            </XStack>

                            <PromptRichText raw={question.questionText} fontSize={cellFont} lineHeight={cellLine} />
                            {question.checklistAnswerLabel !== null ? (
                                <YStack
                                    rounded={ds.radii.sm}
                                    borderWidth={1}
                                    borderColor={ds.colors.border}
                                    bg={ds.colors.mutedSurface}
                                    px="$2"
                                    py="$1"
                                    self="flex-start"
                                >
                                    <Text
                                        color={ds.colors.mutedForeground}
                                        fontFamily={ds.fonts.bodyMedium}
                                        fontSize={cellFont}
                                        lineHeight={cellLine}
                                    >
                                        <Text color={ds.colors.foreground} fontFamily={ds.fonts.bodyBold}>
                                            {t("extendedTable.selectedLabel", { defaultValue: "Selected: " })}
                                        </Text>
                                        {question.checklistAnswerLabel}
                                    </Text>
                                </YStack>
                            ) : null}

                            <XStack flexWrap="wrap" gap="$2">
                                {scaleCells.map((cell) => (
                                    <YStack
                                        key={cell.label}
                                        rounded={ds.radii.sm}
                                        bg={ds.colors.mutedSurface}
                                        px="$2"
                                        py="$1.5"
                                        gap="$0.5"
                                        style={{ minWidth: "47%", flexGrow: 1 }}
                                    >
                                        <Text
                                            color={ds.colors.mutedForeground}
                                            fontFamily={ds.fonts.bodyBold}
                                            fontSize={ds.typography.labelSm.fontSize}
                                            textTransform="uppercase"
                                            letterSpacing={0.5}
                                        >
                                            {cell.label}
                                        </Text>
                                        <Text
                                            color={cell.muted ? ds.colors.mutedForeground : ds.colors.foreground}
                                            fontFamily={ds.fonts.bodyMedium}
                                            fontSize={cellFont}
                                            lineHeight={cellLine}
                                            opacity={cell.muted ? mutedDashOpacity : 1}
                                        >
                                            {cell.text}
                                        </Text>
                                    </YStack>
                                ))}
                            </XStack>
                        </YStack>
                    );
                })}
            </YStack>
        );
    }

    return (
        <YStack position="relative" width="100%">
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                persistentScrollbar
                onScroll={handleScroll}
                scrollEventThrottle={32}
                onContentSizeChange={handleContentSizeChange}
                onLayout={handleViewportLayout}
            >
                <YStack
                    style={{
                        minWidth: cols.minTableWidth,
                        borderWidth: 1,
                        borderColor: ds.colors.border,
                        borderRadius: ds.radii.sm,
                    }}
                    overflow="hidden"
                >
                    {/* Header */}
                    <XStack bg={ds.colors.primary} borderBottomWidth={1} borderColor={ds.colors.border}>
                        <HeaderCell width={cols.idColWidth} isFirst>
                            {t("extendedTable.columnQuestionId", { ns: "reports" })}
                        </HeaderCell>
                        <HeaderCell width={cols.itemColWidth}>
                            {t("extendedTable.columnItems", { ns: "reports" })}
                        </HeaderCell>
                        <HeaderCell width={cols.scaleColWidth}>
                            {t("extendedTable.columnProvision", { ns: "reports" })}
                        </HeaderCell>
                        <HeaderCell width={cols.scaleColWidth}>
                            {t("extendedTable.columnVariety", { ns: "reports" })}
                        </HeaderCell>
                        <HeaderCell width={cols.scaleColWidth}>
                            {t("extendedTable.columnChallenge", { ns: "reports" })}
                        </HeaderCell>
                        <HeaderCell width={cols.scaleColWidth}>
                            {t("extendedTable.columnSociability", { ns: "reports" })}
                        </HeaderCell>
                        {constructSelection.playValue ? (
                            <HeaderCell width={cols.pvuColWidth}>
                                {t("extendedTable.columnPlayValue", { ns: "reports" })}
                            </HeaderCell>
                        ) : null}
                        {constructSelection.usability ? (
                            <HeaderCell width={cols.pvuColWidth}>
                                {t("extendedTable.columnUsability", { ns: "reports" })}
                            </HeaderCell>
                        ) : null}
                    </XStack>

                    {/* Data rows */}
                    {questions.map((question, index) => {
                        const isEven = index % 2 === 0;
                        const rowBg = isEven ? ds.colors.input : ds.colors.surface;
                        const borderProps = {
                            borderTopWidth: 1,
                            borderColor: ds.colors.border,
                        } as const;

                        const CellWrapper = ({
                            children,
                            width,
                            align = "center",
                            first = false,
                        }: {
                            children: ReactNode;
                            width: number;
                            align?: "center" | "flex-start";
                            first?: boolean;
                        }) => (
                            <YStack
                                width={width}
                                p="$2"
                                items={align}
                                justify="center"
                                borderLeftWidth={first ? 0 : 1}
                                borderColor={ds.colors.border}
                                bg={rowBg}
                            >
                                {children}
                            </YStack>
                        );

                        return (
                            <XStack key={question.questionKey} {...borderProps} accessibilityRole="none">
                                {/* Question ID */}
                                <CellWrapper width={cols.idColWidth} first>
                                    <DataText textAlign="center" mono muted>
                                        {formatQuestionKeyForDisplay(question.questionKey)}
                                    </DataText>
                                </CellWrapper>

                                {/* Prompt text */}
                                <CellWrapper width={cols.itemColWidth} align="flex-start">
                                    <YStack gap="$1.5" width="100%">
                                        <PromptRichText
                                            raw={question.questionText}
                                            fontSize={cellFont}
                                            lineHeight={cellLine}
                                        />
                                        {question.checklistAnswerLabel !== null ? (
                                            <YStack
                                                rounded={ds.radii.sm}
                                                borderWidth={1}
                                                borderColor={ds.colors.border}
                                                bg={ds.colors.mutedSurface}
                                                px="$2"
                                                py="$1"
                                            >
                                                <Text
                                                    color={ds.colors.mutedForeground}
                                                    fontFamily={ds.fonts.bodyMedium}
                                                    fontSize={ds.typography.bodyXs.fontSize}
                                                    lineHeight={ds.typography.bodyXs.lineHeight}
                                                >
                                                    <Text color={ds.colors.foreground} fontFamily={ds.fonts.bodyBold}>
                                                        {t("extendedTable.selectedLabel", {
                                                            ns: "reports",
                                                            defaultValue: "Selected: ",
                                                        })}
                                                    </Text>
                                                    {question.checklistAnswerLabel}
                                                </Text>
                                            </YStack>
                                        ) : null}
                                    </YStack>
                                </CellWrapper>

                                {/* Provision */}
                                <CellWrapper width={cols.scaleColWidth}>
                                    {renderScaleCellState({
                                        label: question.provisionLabel,
                                        applicable: question.provisionApplicable,
                                        isNotApplicable: question.provisionIsNotApplicable,
                                        isUnsure: question.provisionIsUnsure,
                                    })}
                                </CellWrapper>

                                {/* Variety */}
                                <CellWrapper width={cols.scaleColWidth}>
                                    {renderScaleCellState({
                                        label: question.varietyLabel,
                                        applicable: question.varietyApplicable,
                                        isNotApplicable: question.varietyIsNotApplicable,
                                        isUnsure: question.varietyIsUnsure,
                                        followUpScalesAsked: question.followUpScalesAsked,
                                    })}
                                </CellWrapper>

                                {/* Challenge */}
                                <CellWrapper width={cols.scaleColWidth}>
                                    {renderScaleCellState({
                                        label: question.challengeLabel,
                                        applicable: question.challengeApplicable,
                                        isNotApplicable: question.challengeIsNotApplicable,
                                        isUnsure: question.challengeIsUnsure,
                                        followUpScalesAsked: question.followUpScalesAsked,
                                    })}
                                </CellWrapper>

                                {/* Sociability */}
                                <CellWrapper width={cols.scaleColWidth}>
                                    {question.sociabilityCapturedAsMultiselect ? (
                                        <DataText textAlign="left">
                                            {formatSociabilitySelections(question.sociabilitySelections, t)}
                                        </DataText>
                                    ) : (
                                        renderScaleCellState({
                                            label: question.sociabilityLabel,
                                            applicable: question.sociabilityApplicable,
                                            isNotApplicable: question.sociabilityIsNotApplicable,
                                            isUnsure: question.sociabilityIsUnsure,
                                            followUpScalesAsked: question.followUpScalesAsked,
                                        })
                                    )}
                                </CellWrapper>

                                {/* Play value */}
                                {constructSelection.playValue ? (
                                    <CellWrapper width={cols.pvuColWidth} align="flex-start">
                                        <DataText textAlign="left">
                                            {formatPlayUsabilityCell(
                                                question.playValueScore,
                                                question.playValueMax,
                                                translatePv,
                                            )}
                                        </DataText>
                                    </CellWrapper>
                                ) : null}

                                {/* Usability */}
                                {constructSelection.usability ? (
                                    <CellWrapper width={cols.pvuColWidth} align="flex-start">
                                        <DataText textAlign="left">
                                            {formatPlayUsabilityCell(
                                                question.usabilityScore,
                                                question.usabilityMax,
                                                translatePv,
                                            )}
                                        </DataText>
                                    </CellWrapper>
                                ) : null}
                            </XStack>
                        );
                    })}
                </YStack>
            </ScrollView>
            {showEndFade ? (
                <XStack position="absolute" t={0} b={0} r={0} pointerEvents="none">
                    {END_FADE_OPACITIES.map((opacity, index) => (
                        <YStack
                            key={`fade-${index.toString()}`}
                            width={5}
                            height="100%"
                            bg={ds.colors.background}
                            opacity={opacity}
                        />
                    ))}
                </XStack>
            ) : null}
        </YStack>
    );
});

/** Stepped strips approximating a right-edge fade without a gradient dependency. */
const END_FADE_OPACITIES = [0.08, 0.16, 0.28, 0.42, 0.58, 0.72] as const;
