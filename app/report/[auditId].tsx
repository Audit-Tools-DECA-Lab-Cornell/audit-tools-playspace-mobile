import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Share, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import { useToastController } from "@tamagui/toast";
import { ChevronUp, FileBarChart, MapPin, Share2 } from "@tamagui/lucide-icons-2";
import { useTranslation } from "react-i18next";
import { type ColorTokens, Paragraph, Separator, Text, XStack, YStack } from "tamagui";
import { AuditHeaderTitle } from "components/ui/audit-header-title";
import { ActionButton } from "components/ui/action-button";
import { SubmittedReportContent } from "components/reports/SubmittedReportContent";
import { StatCard } from "components/ui/stat-card";
import { SkeletonLine } from "components/ui/skeleton";
import {
    buildReportScoreProjection,
    countIncludedUniqueScaledQuestionsWithDomains,
    countUniqueScaledQuestionsWithDomains,
    formatExecutionModeLabel,
    normalizeDomainKey,
} from "lib/audit/report-helpers";
import {
    formatPercentage,
    formatScoreValue,
    formatScoreWithPercentage,
    getScoreVariantBuckets,
    hasUnsureVariants,
    type ScoreSummaryLabels,
    type ScoreVariantKey,
} from "lib/audit/score-helpers";
import { fetchAuditSession } from "lib/audit/api";
import { shareSingleAuditExport, type AuditExportFormat } from "lib/exports/reports";
import {
    joinDisplayValues,
    readPreAuditQuestionValues,
    resolvePreAuditDisplayValues,
} from "lib/exports/reports/format-utils";
import { buildExportableAuditForPlace, loadOptionalExportAuditorProfile } from "lib/exports/reports/helpers";
import type { AuditorPlace } from "lib/audit/places-api";
import { deriveLocality, derivePlaceRequirementStatus } from "lib/audit/place-helpers";
import type { AuditScoreTotals, AuditSession } from "lib/audit/types";
import { useLocalFirstPlaces } from "lib/audit/use-local-first-places";
import { getPlaceStatusTone, getScaleAccentColor, getScaleSoftColor, useDesignSystem } from "lib/design-system";
import { useThemedHeaderOptions } from "lib/ui/themed-header";
import { getPlaceStatusLabel } from "lib/i18n/format";
import { useLocalizedInstrument } from "lib/i18n/instrument-translations";
import {
    getResponsiveContentContainerStyle,
    GLOBAL_FAB_BOTTOM_OFFSET,
    useResponsiveLayout,
} from "lib/responsive-layout";
import { useScreenshotScrollAutomation } from "lib/screenshot-automation";
import { useAuthStore } from "stores/auth-store";
import { createDefaultReportFilter, type ConstructSelection } from "lib/audit/report-filter";
import { buildReportIdentity } from "lib/audit/report-filter-keys";
import { useReportFilter } from "lib/audit/use-report-filter";
import {
    DomainFilterControls,
    ReportFilterBanner,
    ReportFilterControls,
} from "components/reports/ReportFilterControls";
import { usePlacesStore } from "stores/places-store";
import { usePlayspaceAuditStore } from "stores/audit-store";

interface SectionReportRow {
    readonly sectionKey: string;
    readonly sectionNumber: number;
    readonly title: string;
    readonly answeredCount: number;
    readonly totalCount: number;
    readonly scoreTotals: AuditScoreTotals | null;
}

/**
 * Thin ratio bar for one score metric (value vs maximum).
 *
 * @param props Raw value, maximum ceiling, and bar color.
 * @returns Full-width horizontal bar with filled portion.
 */
function ScoreRatioBar(props: Readonly<{ value: number; max: number; color: string }>) {
    const ds = useDesignSystem();
    const { value, max, color } = props;
    const safeRatio = max <= 0 ? 0 : Math.min(1, value / max);
    const widthPercent = `${Math.round(safeRatio * 1000) / 10}%`;

    return (
        <XStack height={7} width="100%" rounded={9999} overflow="hidden" style={{ backgroundColor: ds.colors.border }}>
            <XStack height="100%" style={{ width: widthPercent, backgroundColor: color }} />
        </XStack>
    );
}

/**
 * One labeled score row with fraction, percentage, and a progress bar.
 *
 * @param props Human label, numeric value, maximum, and accent color.
 * @returns Metric row with typography hierarchy and a ratio bar.
 */
function ScoreMetricRow(
    props: Readonly<{
        label: string;
        value: number;
        maximum: number;
        barColor: string;
        scaleColor?: ColorTokens | undefined;
    }>,
) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    const { t } = useTranslation("reports");
    const { label, value, maximum, barColor, scaleColor } = props;
    const isNotApplicable = maximum <= 0;
    const percentageText = formatPercentage(value, maximum);
    const fractionText = isNotApplicable
        ? t("detail.metricFractionNotApplicable")
        : `${formatScoreValue(value)} / ${formatScoreValue(maximum)}`;

    return (
        <YStack gap="$2" width="100%" bg={scaleColor ?? ds.colors.mutedSurface} px="$3" py="$3" rounded={ds.radii.sm}>
            <YStack justify="space-between" items="flex-start" gap="$2">
                <Paragraph
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.bodyLg.fontSize}
                    lineHeight={ds.typography.bodyLg.lineHeight}
                    flex={1}
                >
                    {label}:
                </Paragraph>
                <XStack items="center" justify="space-between" gap="$0.5" minW="100%">
                    <Text
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.monoMedium}
                        fontSize={layout.isTablet ? ds.typography.titleSm.fontSize : ds.typography.bodyXs.fontSize}
                    >
                        {fractionText}
                    </Text>
                    <Text
                        color={ds.colors.mutedForeground}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={layout.isTablet ? ds.typography.titleSm.fontSize : ds.typography.bodyXs.fontSize}
                    >
                        {isNotApplicable ? t("detail.metricNotAssessed") : percentageText}
                    </Text>
                </XStack>
            </YStack>
            {isNotApplicable ? null : <ScoreRatioBar value={value} max={maximum} color={barColor} />}
        </YStack>
    );
}

interface SectionScoreDetailProps {
    readonly scoreTotals: AuditScoreTotals;
    readonly scoreSummaryLabels: ScoreSummaryLabels;
}

/**
 * Structured breakdown for one section: PV/U/S outcomes and P/V/C scale columns.
 *
 * @param props Score totals and localized short labels for abbreviations.
 * @returns Grouped metrics with headings and ratio bars.
 */
function SectionScoreDetail({ scoreTotals, scoreSummaryLabels }: Readonly<SectionScoreDetailProps>) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");
    const provisionMatchesUsability =
        scoreTotals.provision_total === scoreTotals.usability_total &&
        scoreTotals.provision_total_max === scoreTotals.usability_total_max;
    // Keep report scale colors in sync with the question-card selected background accents.
    const provisionScaleAccent = getScaleAccentColor("provision", ds.colors);
    const varietyScaleAccent = getScaleAccentColor("variety", ds.colors);
    const challengeScaleAccent = getScaleAccentColor("challenge", ds.colors);
    const provisionScaleSoft = getScaleSoftColor("provision", ds.colors) as ColorTokens;
    const varietyScaleSoft = getScaleSoftColor("variety", ds.colors) as ColorTokens;
    const challengeScaleSoft = getScaleSoftColor("challenge", ds.colors) as ColorTokens;
    return (
        <YStack gap="$4" pt="$2">
            <YStack>
                <Text
                    color={ds.colors.primary}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.titleSm.fontSize}
                    lineHeight={ds.typography.titleSm.lineHeight}
                >
                    {t("detail.constructHeading", { ns: "reports" })}
                </Text>
                <YStack gap="$2" py="$2">
                    <ScoreMetricRow
                        label={t("detail.playValueCardLabel", { ns: "reports" })}
                        value={scoreTotals.play_value_total}
                        maximum={scoreTotals.play_value_total_max}
                        barColor={ds.colors.warning}
                    />
                    <ScoreMetricRow
                        label={t("detail.usabilityCardLabel", { ns: "reports" })}
                        value={scoreTotals.usability_total}
                        maximum={scoreTotals.usability_total_max}
                        barColor={ds.colors.primary}
                    />
                    <ScoreMetricRow
                        label={t("detail.sociabilityCardLabel", { ns: "reports" })}
                        value={scoreTotals.sociability_total}
                        maximum={scoreTotals.sociability_total_max}
                        barColor={ds.colors.success}
                    />
                </YStack>
            </YStack>
            <Separator />
            <YStack gap="$2">
                <Text
                    color={ds.colors.primary}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.titleSm.fontSize}
                    lineHeight={ds.typography.titleSm.lineHeight}
                >
                    {t("detail.scaleColumnsHeading", { ns: "reports" })}
                </Text>

                <YStack gap="$2" py="$2">
                    {provisionMatchesUsability ? null : (
                        <ScoreMetricRow
                            label={`${t("detail.metricProvision", { ns: "reports" })} (${scoreSummaryLabels.provisionShort})`}
                            value={scoreTotals.provision_total}
                            maximum={scoreTotals.provision_total_max}
                            barColor={provisionScaleAccent}
                            scaleColor={provisionScaleSoft}
                        />
                    )}
                    <ScoreMetricRow
                        label={`${t("detail.metricVariety", { ns: "reports" })} (${scoreSummaryLabels.varietyShort})`}
                        value={scoreTotals.variety_total}
                        maximum={scoreTotals.variety_total_max}
                        barColor={varietyScaleAccent}
                        scaleColor={varietyScaleSoft}
                    />
                    <ScoreMetricRow
                        label={`${t("detail.metricChallenge", { ns: "reports" })} (${scoreSummaryLabels.challengeShort})`}
                        value={scoreTotals.challenge_total}
                        maximum={scoreTotals.challenge_total_max}
                        barColor={challengeScaleAccent}
                        scaleColor={challengeScaleSoft}
                    />
                </YStack>
            </YStack>
        </YStack>
    );
}

interface SectionBreakdownCardProps {
    readonly sectionRows: SectionReportRow[];
    readonly scoreSummaryLabels: ScoreSummaryLabels;
    readonly onSectionLayout: (sectionKey: string, event: LayoutChangeEvent) => void;
}

interface SurfaceCardProps {
    readonly children: ReactNode;
    readonly padding?: number;
}

/**
 * Shared elevated card shell used across report detail panels.
 *
 * @param props Card content with optional spacing overrides.
 * @returns Consistent bordered surface card.
 */
function SurfaceCard({ children, padding }: Readonly<SurfaceCardProps>) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    return (
        <YStack
            rounded={ds.radii.lg}
            borderWidth={1}
            borderColor={ds.colors.border}
            bg={ds.colors.surface}
            p={padding ?? layout.cardPadding}
            gap="$3"
            style={{ boxShadow: ds.shadows.card }}
        >
            {children}
        </YStack>
    );
}

interface ScoreVariantSelectorProps {
    readonly selectedVariant: ScoreVariantKey;
    readonly unsureAnswerCount: number;
    readonly onSelectVariant: (variant: ScoreVariantKey) => void;
}

const SCORE_VARIANTS: readonly ScoreVariantKey[] = ["canonical", "unsure_as_zero", "unsure_as_max"];

function ScoreVariantSelector({
    selectedVariant,
    unsureAnswerCount,
    onSelectVariant,
}: Readonly<ScoreVariantSelectorProps>) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");

    return (
        <SurfaceCard>
            <YStack gap="$1">
                <Text
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.titleMd.fontSize}
                >
                    {t("scoreVariants.title", { ns: "reports" })}
                </Text>
                <Paragraph
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodySm.fontSize}
                >
                    {t("scoreVariants.description", { ns: "reports", count: unsureAnswerCount })}
                </Paragraph>
            </YStack>
            <YStack gap="$2">
                {SCORE_VARIANTS.map((variant) => {
                    const isSelected = selectedVariant === variant;
                    return (
                        <Pressable
                            key={variant}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isSelected }}
                            accessibilityLabel={t(`scoreVariants.${variant}.label`, { ns: "reports" })}
                            onPress={() => {
                                onSelectVariant(variant);
                            }}
                        >
                            {({ pressed }) => (
                                <YStack
                                    rounded={ds.radii.md}
                                    borderWidth={1}
                                    borderColor={isSelected ? ds.colors.primary : ds.colors.border}
                                    bg={isSelected ? ds.colors.surfaceMuted : ds.colors.input}
                                    px="$3"
                                    py="$3"
                                    gap="$1"
                                    opacity={pressed ? 0.85 : 1}
                                >
                                    <Text
                                        color={isSelected ? ds.colors.primary : ds.colors.foreground}
                                        fontFamily={ds.fonts.bodyBold}
                                        fontSize={ds.typography.bodySm.fontSize}
                                    >
                                        {t(`scoreVariants.${variant}.label`, { ns: "reports" })}
                                    </Text>
                                    <Paragraph
                                        color={ds.colors.mutedForeground}
                                        fontFamily={ds.fonts.bodyMedium}
                                        fontSize={ds.typography.bodyXs.fontSize}
                                    >
                                        {t(`scoreVariants.${variant}.helper`, { ns: "reports" })}
                                    </Paragraph>
                                </YStack>
                            )}
                        </Pressable>
                    );
                })}
            </YStack>
        </SurfaceCard>
    );
}

/**
 * Section list with per-section score cards and structured metric breakdowns.
 *
 * @param props Built section rows and localized score labels.
 * @returns Section breakdown card content.
 */
function SectionBreakdownCard({
    sectionRows,
    scoreSummaryLabels,
    onSectionLayout,
}: Readonly<SectionBreakdownCardProps>) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    const { t } = useTranslation("reports");

    return (
        <SurfaceCard>
            <Text color={ds.colors.foreground} fontFamily={ds.fonts.bodyBold} fontSize={ds.typography.titleMd.fontSize}>
                {t("detail.sectionBreakdown", { ns: "reports" })}
            </Text>
            {sectionRows.length === 0 ? (
                <Paragraph
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodyMd.fontSize}
                >
                    {t("detail.scorePending", { ns: "reports" })}
                </Paragraph>
            ) : (
                <YStack gap="$3">
                    {sectionRows.map((sectionRow) => (
                        <YStack
                            key={sectionRow.sectionKey}
                            onLayout={(event) => {
                                onSectionLayout(sectionRow.sectionKey, event);
                            }}
                            rounded={ds.radii.md}
                            borderWidth={1}
                            borderColor={ds.colors.border}
                            bg={ds.colors.input}
                            p="$4"
                            gap="$2"
                        >
                            <XStack justify="space-between" items="flex-start" gap="$3">
                                <YStack flex={1} gap="$1">
                                    <Text
                                        color={ds.colors.foreground}
                                        fontFamily={ds.fonts.bodyBold}
                                        fontSize={ds.typography.titleMd.fontSize}
                                    >
                                        {`${sectionRow.sectionNumber}. ${sectionRow.title}`}
                                    </Text>
                                    <Paragraph
                                        color={ds.colors.mutedForeground}
                                        fontFamily={ds.fonts.bodyMedium}
                                        fontSize={ds.typography.bodySm.fontSize}
                                    >
                                        {t("detail.questionsAnswered", {
                                            ns: "reports",
                                            answered: sectionRow.answeredCount,
                                            total: sectionRow.totalCount,
                                        })}
                                    </Paragraph>
                                </YStack>
                                <YStack shrink={1} items="flex-end" gap="$0.5" maxW="48%">
                                    <Text
                                        color={
                                            sectionRow.scoreTotals === null
                                                ? ds.colors.mutedForeground
                                                : ds.colors.primary
                                        }
                                        fontFamily={ds.fonts.headingBold}
                                        fontSize={
                                            layout.isTablet
                                                ? ds.typography.metricXs.fontSize
                                                : ds.typography.titleMd.fontSize
                                        }
                                        lineHeight={
                                            layout.isTablet
                                                ? ds.typography.metricXs.lineHeight
                                                : ds.typography.titleMd.lineHeight
                                        }
                                        style={{ textAlign: "right" }}
                                    >
                                        {sectionRow.scoreTotals === null
                                            ? "-"
                                            : (() => {
                                                  const st = sectionRow.scoreTotals;
                                                  return `PV ${formatPercentage(st.play_value_total, st.play_value_total_max)} · U ${formatPercentage(st.usability_total, st.usability_total_max)}`;
                                              })()}
                                    </Text>
                                </YStack>
                            </XStack>
                            {sectionRow.scoreTotals === null ? (
                                <Paragraph
                                    color={ds.colors.mutedForeground}
                                    fontFamily={ds.fonts.bodyMedium}
                                    fontSize={ds.typography.bodySm.fontSize}
                                >
                                    {t("detail.scorePending", { ns: "reports" })}
                                </Paragraph>
                            ) : (
                                <SectionScoreDetail
                                    scoreTotals={sectionRow.scoreTotals}
                                    scoreSummaryLabels={scoreSummaryLabels}
                                />
                            )}
                        </YStack>
                    ))}
                </YStack>
            )}
        </SurfaceCard>
    );
}

interface SectionNavigatorCardProps {
    readonly sectionRows: SectionReportRow[];
    readonly onSectionPress: (sectionKey: string) => void;
}

function SectionNavigatorCard({ sectionRows, onSectionPress }: Readonly<SectionNavigatorCardProps>) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");

    const getScoreTone = useCallback(
        (percentage: number | null) => {
            if (percentage === null) {
                return ds.colors.border;
            }
            if (percentage >= 85) {
                return ds.colors.success;
            }
            if (percentage >= 60) {
                return ds.colors.warning;
            }
            return ds.colors.danger;
        },
        [ds.colors.border, ds.colors.danger, ds.colors.success, ds.colors.warning],
    );

    return (
        <SurfaceCard>
            <YStack gap="$1">
                <Text
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.titleMd.fontSize}
                >
                    {t("detail.sectionOverviewTitle", { ns: "reports" })}
                </Text>
                <Paragraph
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodySm.fontSize}
                >
                    {t("detail.sectionOverviewHint", { ns: "reports" })}
                </Paragraph>
            </YStack>

            <YStack gap="$3">
                {sectionRows.map((sectionRow) => {
                    const st = sectionRow.scoreTotals;
                    const pvPct =
                        st !== null && st.play_value_total_max > 0
                            ? (st.play_value_total / st.play_value_total_max) * 100
                            : null;
                    const uPct =
                        st !== null && st.usability_total_max > 0
                            ? (st.usability_total / st.usability_total_max) * 100
                            : null;
                    const percentage = pvPct === null || uPct === null ? null : (pvPct + uPct) / 2;
                    const barColor = getScoreTone(percentage);

                    return (
                        <Pressable
                            key={sectionRow.sectionKey}
                            accessibilityRole="button"
                            accessibilityLabel={`Jump to section ${sectionRow.sectionNumber}: ${sectionRow.title}`}
                            onPress={() => {
                                onSectionPress(sectionRow.sectionKey);
                            }}
                            style={{
                                borderColor: ds.colors.border,
                                borderWidth: 0.5,
                                paddingVertical: 12,
                                paddingHorizontal: 12,
                                borderRadius: 6,
                                backgroundColor: ds.colors.surfaceMuted,
                            }}
                        >
                            {({ pressed }) => (
                                <YStack gap="$2" opacity={pressed ? 0.85 : 1}>
                                    <YStack justify="center" gap="$2">
                                        <Text
                                            color={ds.colors.foreground}
                                            fontFamily={ds.fonts.bodyBold}
                                            fontSize={ds.typography.bodyMd.fontSize}
                                            flex={1}
                                        >
                                            {`${sectionRow.sectionNumber}. ${sectionRow.title}`}
                                        </Text>
                                        <XStack justify="space-between" items="center" gap="$2">
                                            {sectionRow.scoreTotals === null ? (
                                                <Text
                                                    color={ds.colors.mutedForeground}
                                                    fontFamily={ds.fonts.bodyMedium}
                                                    fontSize={ds.typography.bodySm.fontSize}
                                                    lineHeight={ds.typography.bodySm.lineHeight}
                                                    flex={1}
                                                >
                                                    {t("detail.scorePending", { ns: "reports" })}
                                                </Text>
                                            ) : (
                                                <>
                                                    <Text
                                                        color={ds.colors.mutedForeground}
                                                        fontFamily={ds.fonts.bodyMedium}
                                                        fontSize={ds.typography.bodySm.fontSize}
                                                        lineHeight={ds.typography.bodySm.lineHeight}
                                                        flex={1}
                                                    >
                                                        {(() => {
                                                            const st = sectionRow.scoreTotals;
                                                            if (st === null) {
                                                                return "-";
                                                            }
                                                            return `PV ${formatScoreValue(st.play_value_total)}/${formatScoreValue(st.play_value_total_max)} · U ${formatScoreValue(st.usability_total)}/${formatScoreValue(st.usability_total_max)}`;
                                                        })()}
                                                    </Text>
                                                    <Text
                                                        color={ds.colors.mutedForeground}
                                                        fontFamily={ds.fonts.bodyMedium}
                                                        fontSize={ds.typography.bodySm.fontSize}
                                                        lineHeight={ds.typography.bodySm.lineHeight}
                                                        self="flex-end"
                                                    >
                                                        {percentage !== null ? `${Math.round(percentage)}%` : "-"}
                                                    </Text>
                                                </>
                                            )}
                                        </XStack>
                                    </YStack>
                                    <XStack
                                        height={7}
                                        rounded={9999}
                                        overflow="hidden"
                                        style={{ backgroundColor: ds.colors.border }}
                                    >
                                        <XStack
                                            height="100%"
                                            style={{
                                                width: `${Math.round((percentage ?? 0) * 10) / 10}%`,
                                                backgroundColor: barColor,
                                            }}
                                        />
                                    </XStack>
                                </YStack>
                            )}
                        </Pressable>
                    );
                })}
            </YStack>
        </SurfaceCard>
    );
}

/**
 * Full-screen audit detail shown from the reports tab.
 */
export default function AuditReportDetailScreen() {
    const ds = useDesignSystem();
    const themedHeaderOptions = useThemedHeaderOptions();
    const layout = useResponsiveLayout();
    const insets = useSafeAreaInsets();
    const { t } = useTranslation(["reports", "common", "places"]);
    const toast = useToastController();
    const params = useLocalSearchParams<{ auditId?: string | string[] }>();
    const session = useAuthStore((state) => state.session);
    const places = useLocalFirstPlaces();
    const isLoadingPlaces = usePlacesStore((state) => state.isLoading);
    const loadPlaces = usePlacesStore((state) => state.loadPlaces);
    const sessionsByAuditId = usePlayspaceAuditStore((state) => state.sessionsByAuditId);
    const [auditSession, setAuditSession] = useState<AuditSession | null>(null);
    const [isLoadingAudit, setIsLoadingAudit] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [activeExportKey, setActiveExportKey] = useState<string | null>(null);
    const [reportScrollY, setReportScrollY] = useState(0);
    const [selectedScoreVariant, setSelectedScoreVariant] = useState<ScoreVariantKey>("canonical");
    const auditId = readSingleParam(params.auditId);
    const scrollViewRef = useRef<ScrollView | null>(null);
    const sectionOffsetsRef = useRef<Record<string, number>>({});

    const cachedAudit = auditId === null ? undefined : sessionsByAuditId[auditId];
    const instrument = useLocalizedInstrument(auditSession?.instrument ?? cachedAudit?.instrument);
    const place = useMemo(() => {
        if (auditId === null) {
            return undefined;
        }
        return places.find((candidate) => candidate.audit_id === auditId);
    }, [auditId, places]);

    useEffect(() => {
        if (session !== null && (places.length === 0 || (auditId !== null && place === undefined))) {
            loadPlaces(session).catch(() => undefined);
        }
    }, [auditId, loadPlaces, place, places.length, session]);

    useEffect(() => {
        if (cachedAudit !== undefined) {
            setAuditSession(cachedAudit);
        }
    }, [cachedAudit]);

    useEffect(() => {
        let isCancelled = false;

        if (session === null || auditId === null) {
            setIsLoadingAudit(false);
            return () => {
                isCancelled = true;
            };
        }

        setIsLoadingAudit(cachedAudit === undefined);
        setErrorMessage(null);

        fetchAuditSession(session, auditId)
            .then((nextAuditSession) => {
                if (isCancelled) {
                    return;
                }
                setAuditSession(nextAuditSession);
            })
            .catch((error) => {
                if (isCancelled) {
                    return;
                }
                if (cachedAudit === undefined) {
                    setErrorMessage(
                        error instanceof Error && error.message.trim().length > 0
                            ? error.message
                            : t("detail.unavailableMessage", { ns: "reports" }),
                    );
                }
            })
            .finally(() => {
                if (isCancelled) {
                    return;
                }
                setIsLoadingAudit(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [auditId, cachedAudit, session, t]);

    useEffect(() => {
        if (auditSession !== null && !hasUnsureVariants(auditSession.scores)) {
            setSelectedScoreVariant("canonical");
        }
    }, [auditSession]);

    const selectedScoreBuckets = useMemo(() => {
        return auditSession === null ? null : getScoreVariantBuckets(auditSession.scores, selectedScoreVariant);
    }, [auditSession, selectedScoreVariant]);

    const scoreSummaryLabels: ScoreSummaryLabels = {
        playValueShort: t("playValueShort", { ns: "reports" }),
        usabilityShort: t("usabilityShort", { ns: "reports" }),
        sociabilityShort: t("sociabilityShort", { ns: "reports" }),
        provisionShort: t("provisionShort", { ns: "reports" }),
        varietyShort: t("varietyShort", { ns: "reports" }),
        challengeShort: t("challengeShort", { ns: "reports" }),
    };

    const sectionRows = useMemo(() => {
        if (auditSession === null) {
            return [];
        }

        const progressByKey = new Map(
            auditSession.progress.sections.map((section) => [section.section_key, section] as const),
        );
        const scoresByKey = selectedScoreBuckets?.by_section ?? auditSession.scores.by_section;

        return instrument!.sections.reduce<SectionReportRow[]>((rows, section) => {
            const progress = progressByKey.get(section.section_key);
            const scoreTotals = scoresByKey[section.section_key] ?? null;

            if (progress === undefined && scoreTotals === null) {
                return rows;
            }

            rows.push({
                sectionKey: section.section_key,
                sectionNumber: rows.length + 1,
                title: section.title,
                answeredCount: progress?.answered_question_count ?? 0,
                totalCount: progress?.visible_question_count ?? section.questions.length,
                scoreTotals,
            });
            return rows;
        }, []);
    }, [auditSession, instrument, selectedScoreBuckets]);

    const isSubmitted = auditSession?.status === "SUBMITTED";

    const knownDomainKeys = useMemo(() => {
        const buckets = selectedScoreBuckets ?? auditSession?.scores ?? null;
        return buckets === null ? [] : Object.keys(buckets.by_domain).map((key) => normalizeDomainKey(key));
    }, [auditSession, selectedScoreBuckets]);

    const reportFilter = useReportFilter(buildReportIdentity(auditId ?? ""), session?.user.id ?? null, knownDomainKeys);
    const filteringEnabled = instrument !== null && isSubmitted;
    const activeFilter = filteringEnabled ? reportFilter.filter : createDefaultReportFilter();

    const scoreProjection = useMemo(() => {
        if (auditSession === null || instrument === null) {
            return null;
        }
        return buildReportScoreProjection(auditSession, instrument, activeFilter, selectedScoreVariant);
    }, [auditSession, instrument, activeFilter, selectedScoreVariant]);
    const domainRows = scoreProjection?.domainRows ?? [];
    const domainConstructCoverage = scoreProjection?.domainCoverage ?? {};

    const overallItemCount = useMemo(() => {
        if (instrument === null) {
            return 0;
        }
        if (auditSession !== null && scoreProjection?.isFiltered === true) {
            return countIncludedUniqueScaledQuestionsWithDomains(auditSession, instrument, activeFilter);
        }
        return countUniqueScaledQuestionsWithDomains(instrument);
    }, [activeFilter, auditSession, instrument, scoreProjection?.isFiltered]);

    const playspaceContextRows = useMemo(() => {
        if (auditSession === null || instrument === null) {
            return [];
        }

        return instrument.pre_audit_questions
            .filter((question) => question.page_key === "space_setup")
            .map((question) => ({
                key: question.key,
                label: question.label,
                value:
                    joinDisplayValues(
                        resolvePreAuditDisplayValues(
                            question,
                            readPreAuditQuestionValues(auditSession, null, question),
                        ),
                    ) || t("detail.notProvided", { ns: "reports" }),
            }));
    }, [auditSession, instrument, t]);

    const showExportSuccess = useCallback(
        (fileName: string) => {
            toast.show(t("exportReadyTitle", { ns: "reports" }), {
                message: t("exportReadyMessage", { ns: "reports", fileName }),
                duration: 4000,
                variant: "success",
            });
        },
        [t, toast],
    );

    const showExportError = useCallback(
        (error: unknown) => {
            const message =
                error instanceof Error && error.message.trim().length > 0
                    ? error.message
                    : t("exportFailedMessage", { ns: "reports" });
            toast.show(t("exportFailedTitle", { ns: "reports" }), {
                message,
                duration: 5000,
                variant: "error",
            });
        },
        [t, toast],
    );

    const handleSingleAuditExport = useCallback(
        async (format: AuditExportFormat) => {
            if (place === undefined) {
                showExportError(new Error(t("exportAuditMissing", { ns: "reports" })));
                return;
            }

            const exportKey = `single:${place.place_id}:${format}`;
            setActiveExportKey(exportKey);
            try {
                const auditorProfile = await loadOptionalExportAuditorProfile(session);
                const exportableAudit = await buildExportableAuditForPlace({
                    session,
                    place,
                    cachedAudit,
                    exportSessionRequiredMessage: t("exportSessionRequired", { ns: "reports" }),
                    exportAuditMissingMessage: t("exportAuditMissing", { ns: "reports" }),
                    auditorProfile,
                });
                await shareSingleAuditExport(
                    { ...exportableAudit, resultFilter: activeFilter },
                    instrument!,
                    format,
                    ds.colors,
                );
                const placeAbbreviatedName = place.place_name
                    .split(" ")
                    .map((word) => word[0])
                    .join("")
                    .toUpperCase();
                const projectAbbreviatedName = place.project_name
                    .split(" ")
                    .map((word) => word[0])
                    .join("")
                    .toUpperCase();
                const auditorCode = auditorProfile?.auditorCode ?? "";
                const userFriendlyFileName = `PVUA ${projectAbbreviatedName} ${placeAbbreviatedName} ${auditorCode} ${format.toUpperCase()}`;

                showExportSuccess(userFriendlyFileName);
            } catch (error) {
                showExportError(error);
            } finally {
                setActiveExportKey((currentValue) => (currentValue === exportKey ? null : currentValue));
            }
        },
        [cachedAudit, instrument, place, session, showExportError, showExportSuccess, t, ds.colors, activeFilter],
    );

    const scrollReportDetailToOffset = useCallback((offset: number) => {
        scrollViewRef.current?.scrollTo({ animated: false, x: 0, y: offset });
    }, []);

    const handleSectionLayout = useCallback((sectionKey: string, event: LayoutChangeEvent) => {
        // Measure each section row against the scroll content instead of the
        // old hardcoded "+ 2900" guess, so navigator jumps stay accurate for
        // any locale, font scale, or viewport (6.2).
        const scrollView = scrollViewRef.current;
        const innerViewNode: unknown = scrollView?.getInnerViewNode();
        const target = event.currentTarget;
        if (scrollView == null || innerViewNode == null) {
            sectionOffsetsRef.current[sectionKey] = event.nativeEvent.layout.y;
            return;
        }
        target.measureLayout(
            innerViewNode as number,
            (_x: number, y: number) => {
                sectionOffsetsRef.current[sectionKey] = y;
            },
            () => {
                sectionOffsetsRef.current[sectionKey] = event.nativeEvent.layout.y;
            },
        );
    }, []);

    const scrollToSection = useCallback((sectionKey: string) => {
        const offset = sectionOffsetsRef.current[sectionKey];
        if (typeof offset === "number") {
            // Small breathing room so the row title is not glued to the header.
            scrollViewRef.current?.scrollTo({ animated: true, x: 0, y: Math.max(0, offset - 12) });
        }
    }, []);

    useScreenshotScrollAutomation({
        contentReady: auditSession !== null,
        rerunKey: auditSession?.audit_id ?? auditId ?? "report-detail",
        scrollToOffset: scrollReportDetailToOffset,
    });

    const title = place?.place_name ?? auditSession?.place_name ?? t("detail.screenTitle", { ns: "reports" });

    const showScrollToTopButton = isSubmitted && reportScrollY > 280;

    return (
        <>
            <Stack.Screen
                options={{
                    ...themedHeaderOptions,
                    title: t("detail.screenTitle", { ns: "reports" }),
                    headerTitle: () => <AuditHeaderTitle primary={title} size="lg" />,
                }}
            />

            {auditId === null ? (
                <DetailStateCard
                    title={t("detail.unavailableTitle", { ns: "reports" })}
                    message={t("detail.unavailableMessage", { ns: "reports" })}
                />
            ) : auditSession === null ? (
                <DetailStateCard
                    title={
                        errorMessage === null
                            ? t("detail.loadingTitle", { ns: "reports" })
                            : t("detail.unavailableTitle", { ns: "reports" })
                    }
                    message={errorMessage ?? t("detail.loadingMessage", { ns: "reports" })}
                    isLoading={errorMessage === null && (isLoadingAudit || isLoadingPlaces)}
                />
            ) : (
                <View style={{ flex: 1, backgroundColor: ds.colors.background }}>
                    <ScrollView
                        ref={scrollViewRef}
                        contentInsetAdjustmentBehavior="automatic"
                        style={{ backgroundColor: ds.colors.background }}
                        contentContainerStyle={getResponsiveContentContainerStyle(layout, {
                            bottomPadding: 112,
                            gap: layout.sectionGap,
                            includeTopPadding: false,
                        })}
                        onScroll={(event) => {
                            setReportScrollY(event.nativeEvent.contentOffset.y);
                        }}
                        scrollEventThrottle={16}
                    >
                        <AuditHeader auditSession={auditSession} place={place} />

                        <YStack gap="$3">
                            <SurfaceCard>
                                <Text
                                    color={ds.colors.foreground}
                                    fontFamily={ds.fonts.bodyBold}
                                    fontSize={ds.typography.titleMd.fontSize}
                                >
                                    {t("detail.auditMetadata", { ns: "reports" })}
                                </Text>
                                <MetadataRow
                                    label={t("detail.auditCode", { ns: "reports" })}
                                    value={auditSession.audit_code}
                                    selectable
                                />
                                <MetadataRow
                                    label={t("detail.status", { ns: "reports" })}
                                    value={getPlaceStatusLabel(derivePlaceRequirementStatus(place!), t)}
                                />
                                <MetadataRow
                                    label={t("detail.auditType", { ns: "reports" })}
                                    value={formatExecutionModeLabel(auditSession.scores.execution_mode, t)}
                                />
                                {place === undefined ? null : (
                                    <MetadataRow
                                        label={t("detail.project", { ns: "reports" })}
                                        value={place.project_name}
                                    />
                                )}
                                <MetadataRow
                                    label={t("detail.startedAt", { ns: "reports" })}
                                    value={formatDateTime(auditSession.started_at)}
                                />
                                <MetadataRow
                                    label={t("detail.submittedAt", { ns: "reports" })}
                                    value={
                                        auditSession.submitted_at === null
                                            ? t("filters.notScored", { ns: "common" })
                                            : formatDateTime(auditSession.submitted_at)
                                    }
                                />
                                <MetadataRow
                                    label={t("detail.progress", { ns: "reports" })}
                                    value={`${auditSession.progress.answered_visible_questions}/${auditSession.progress.total_visible_questions}`}
                                />
                            </SurfaceCard>

                            {playspaceContextRows.length === 0 ? null : (
                                <SurfaceCard>
                                    <Text
                                        color={ds.colors.foreground}
                                        fontFamily={ds.fonts.bodyBold}
                                        fontSize={ds.typography.titleMd.fontSize}
                                    >
                                        {t("detail.playspaceContext", { ns: "reports" })}
                                    </Text>
                                    {playspaceContextRows.map((row) => (
                                        <MetadataRow key={row.key} label={row.label} value={row.value} />
                                    ))}
                                </SurfaceCard>
                            )}

                            {filteringEnabled ? (
                                <SurfaceCard>
                                    <YStack gap="$3">
                                        <ReportFilterBanner
                                            filter={activeFilter}
                                            onShowFullReport={reportFilter.showFullReport}
                                        />
                                        <ReportFilterControls
                                            filter={activeFilter}
                                            onOverallChange={reportFilter.setOverall}
                                            onApplyToAllDomains={reportFilter.applyToAllDomains}
                                            onReset={reportFilter.reset}
                                        />
                                    </YStack>
                                </SurfaceCard>
                            ) : null}

                            {place === undefined ? null : (
                                <SurfaceCard>
                                    <XStack items="center" gap="$2">
                                        <FileBarChart size={16} color={ds.colors.primary} />
                                        <Text
                                            color={ds.colors.foreground}
                                            fontFamily={ds.fonts.bodyBold}
                                            fontSize={ds.typography.titleMd.fontSize}
                                        >
                                            {t("detail.exportThisAudit", { ns: "reports" })}
                                        </Text>
                                    </XStack>
                                    {/* One compact row on all form factors: the three
                                        format labels are short, and stacked full-width
                                        buttons out-shout the report content. */}
                                    <XStack gap="$2" mt="$1" width="100%">
                                        <ActionButton
                                            label={t("exportPdf", { ns: "reports" })}
                                            onPress={() => {
                                                handleSingleAuditExport("pdf").catch(() => undefined);
                                            }}
                                            disabled={activeExportKey !== null}
                                            isLoading={activeExportKey === `single:${place.place_id}:pdf`}
                                        />
                                        <ActionButton
                                            label={t("exportCsv", { ns: "reports" })}
                                            onPress={() => {
                                                handleSingleAuditExport("csv").catch(() => undefined);
                                            }}
                                            disabled={activeExportKey !== null}
                                            isLoading={activeExportKey === `single:${place.place_id}:csv`}
                                        />
                                        <ActionButton
                                            label={t("exportExcel", { ns: "reports" })}
                                            onPress={() => {
                                                handleSingleAuditExport("xlsx").catch(() => undefined);
                                            }}
                                            disabled={activeExportKey !== null}
                                            isLoading={activeExportKey === `single:${place.place_id}:xlsx`}
                                        />
                                    </XStack>
                                </SurfaceCard>
                            )}

                            <AuditMetrics
                                overall={scoreProjection?.overall ?? null}
                                constructSelection={
                                    scoreProjection?.visibleConstructs ?? { playValue: true, usability: true }
                                }
                            />
                            {isSubmitted &&
                            hasUnsureVariants(auditSession.scores) &&
                            (scoreProjection?.unsureAnswerCount ?? auditSession.scores.unsure_answer_count) > 0 ? (
                                <ScoreVariantSelector
                                    selectedVariant={selectedScoreVariant}
                                    unsureAnswerCount={
                                        scoreProjection?.unsureAnswerCount ?? auditSession.scores.unsure_answer_count
                                    }
                                    onSelectVariant={setSelectedScoreVariant}
                                />
                            ) : null}
                            {isSubmitted ? (
                                <SubmittedReportContent
                                    domainRows={domainRows}
                                    overallScores={scoreProjection?.overall ?? null}
                                    overallItemCount={overallItemCount}
                                    resultFilter={activeFilter}
                                    overallConstructSelection={
                                        scoreProjection?.visibleConstructs ?? { playValue: true, usability: true }
                                    }
                                    domainCoverage={domainConstructCoverage}
                                    renderDomainFilter={(domainKey, domainTitle) => (
                                        <DomainFilterControls
                                            domainKey={domainKey}
                                            domainTitle={domainTitle}
                                            selection={activeFilter.domainOverrides[domainKey] ?? activeFilter.overall}
                                            coverage={domainConstructCoverage[domainKey]}
                                            hasOverride={domainKey in activeFilter.domainOverrides}
                                            onChange={(selection) => {
                                                reportFilter.setDomain(domainKey, selection);
                                            }}
                                            onUseReportSetting={() => {
                                                reportFilter.clearDomain(domainKey);
                                            }}
                                        />
                                    )}
                                />
                            ) : (
                                <YStack gap="$2">
                                    <SectionNavigatorCard sectionRows={sectionRows} onSectionPress={scrollToSection} />
                                    <SectionBreakdownCard
                                        sectionRows={sectionRows}
                                        scoreSummaryLabels={scoreSummaryLabels}
                                        onSectionLayout={handleSectionLayout}
                                    />
                                </YStack>
                            )}
                        </YStack>
                    </ScrollView>
                    {showScrollToTopButton ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("detail.scrollToTop", { ns: "reports" })}
                            onPress={() => {
                                scrollViewRef.current?.scrollTo({ y: 0, animated: true });
                            }}
                            style={{
                                // Bottom-left keeps this clear of the global bug-report FAB
                                // (bottom-right) and the right-aligned score values in tables.
                                // Vertically aligned with the bug-report FAB via the shared
                                // geometry constants (1.6/G8).
                                position: "absolute",
                                left: 16,
                                bottom: Math.max(insets.bottom, 0) + GLOBAL_FAB_BOTTOM_OFFSET,
                                zIndex: 40,
                                elevation: 8,
                            }}
                        >
                            <YStack
                                width={48}
                                height={48}
                                rounded={9999}
                                bg={ds.colors.primary}
                                items="center"
                                justify="center"
                                style={{ boxShadow: ds.shadows.card }}
                            >
                                <ChevronUp size={24} color={ds.colors.primaryForeground} />
                            </YStack>
                        </Pressable>
                    ) : null}
                </View>
            )}
        </>
    );
}

interface AuditHeaderProps {
    readonly auditSession: AuditSession;
    readonly place: AuditorPlace | undefined;
}

/**
 * Header block for the audit detail screen.
 *
 * @param props Loaded audit session, optional place summary, and active language.
 * @returns Audit header card cluster.
 */
function AuditHeader({ auditSession, place }: Readonly<AuditHeaderProps>) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    const { t } = useTranslation(["reports", "common"]);
    const status = derivePlaceRequirementStatus(place!);
    const statusTone = getPlaceStatusTone(status, ds.colors);
    const locality = place === undefined ? null : deriveLocality(place, "");

    return (
        <YStack gap="$3">
            <XStack justify="space-between" items="flex-start" gap="$3">
                <YStack flex={1} gap="$1.5">
                    <Text
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.headingBold}
                        fontSize={layout.isTablet ? ds.typography.metricLg.fontSize : ds.typography.metricMd.fontSize}
                        lineHeight={
                            layout.isTablet ? ds.typography.metricLg.lineHeight : ds.typography.metricMd.lineHeight
                        }
                    >
                        {place?.place_name ?? auditSession.place_name}
                    </Text>
                    {place === undefined ? null : (
                        <Paragraph
                            color={ds.colors.mutedForeground}
                            fontFamily={ds.fonts.bodyMedium}
                            fontSize={ds.typography.bodyMd.fontSize}
                        >
                            {place.project_name}
                        </Paragraph>
                    )}
                </YStack>
                <YStack
                    rounded={ds.radii.full}
                    px="$3"
                    py="$1.5"
                    style={{ backgroundColor: statusTone.surface, maxWidth: "45%" }}
                >
                    <Text
                        style={{ color: statusTone.text }}
                        fontFamily={ds.fonts.bodyBold}
                        fontSize={ds.typography.labelXs.fontSize}
                        textTransform="uppercase"
                        letterSpacing={1}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                    >
                        {getPlaceStatusLabel(status, t)}
                    </Text>
                </YStack>
            </XStack>
            {locality === null || locality.length <= 0 ? null : (
                <XStack items="center" gap="$2">
                    <MapPin size={layout.isTablet ? 18 : 16} color={ds.colors.mutedForeground} />
                    <Paragraph
                        color={ds.colors.mutedForeground}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={ds.typography.bodyLg.fontSize}
                    >
                        {locality}
                    </Paragraph>
                </XStack>
            )}
            <Paragraph
                color={ds.colors.mutedForeground}
                fontFamily={ds.fonts.bodyMedium}
                fontSize={ds.typography.bodyLg.fontSize}
            >
                {formatDateTime(auditSession.started_at)}
            </Paragraph>
        </YStack>
    );
}

/**
 * Format helper text that only shows the maximum score ceiling for a metric.
 *
 * @param maximum Maximum possible score.
 * @returns Helper text or undefined when the ceiling is unavailable.
 */
function formatMetricMaxHelper(maximum: number | null): string | undefined {
    if (maximum === null || maximum <= 0) {
        return undefined;
    }
    return `Max score = ${formatScoreValue(maximum)}`;
}

interface AuditMetricsProps {
    readonly overall: AuditScoreTotals | null;
    readonly constructSelection: ConstructSelection;
}

/**
 * Top-line audit score cards shown above the section breakdown.
 *
 * @param props Loaded audit session.
 * @returns Summary metric card grid.
 */
function AuditMetrics({ overall, constructSelection }: Readonly<AuditMetricsProps>) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    const { t } = useTranslation("reports");
    const overallMaximum =
        overall === null ? null : { pv: overall.play_value_total_max, u: overall.usability_total_max };
    const pendingMetricText = t("detail.pendingMetric", { ns: "reports" });
    const overallMetricValue =
        overall === null || overallMaximum === null
            ? pendingMetricText
            : [
                  constructSelection.playValue
                      ? `${t("playValueShort", { ns: "reports" })} ${formatScoreValue(overall.play_value_total)}`
                      : null,
                  constructSelection.usability
                      ? `${t("usabilityShort", { ns: "reports" })} ${formatScoreValue(overall.usability_total)}`
                      : null,
              ]
                  .filter((value): value is string => value !== null)
                  .join("\n") || pendingMetricText;
    const playValueMetricValue =
        overall === null
            ? pendingMetricText
            : formatScoreWithPercentage(overall.play_value_total, overall.play_value_total_max);
    const usabilityMetricValue =
        overall === null
            ? pendingMetricText
            : formatScoreWithPercentage(overall.usability_total, overall.usability_total_max);
    const sociabilityMetricValue =
        overall === null
            ? pendingMetricText
            : formatScoreWithPercentage(overall.sociability_total, overall.sociability_total_max);

    const overallHelperText =
        overall === null || overallMaximum === null
            ? undefined
            : `${t("detail.overallScoreHint", { ns: "reports" })}\n${[
                  constructSelection.playValue
                      ? `${t("playValueShort", { ns: "reports" })} ${formatScoreValue(overallMaximum.pv)}`
                      : null,
                  constructSelection.usability
                      ? `${t("usabilityShort", { ns: "reports" })} ${formatScoreValue(overallMaximum.u)}`
                      : null,
              ]
                  .filter((value): value is string => value !== null)
                  .join("\n")}`;
    const summaryCardMinHeight = layout.isTablet
        ? Math.max(140, layout.summaryCardMinHeight - 18)
        : layout.summaryCardMinHeight;

    return (
        <YStack gap="$3">
            <Text color={ds.colors.foreground} fontFamily={ds.fonts.bodyBold} fontSize={ds.typography.titleMd.fontSize}>
                {t("detail.scoreSummaryTitle", { ns: "reports" })}
            </Text>
            {layout.isTablet ? (
                <XStack gap="$2">
                    <StatCard
                        label={t("detail.overallScore", { ns: "reports" })}
                        value={overallMetricValue}
                        accentColor={ds.colors.primary}
                        helperText={overallHelperText}
                        minHeight={summaryCardMinHeight}
                        dense={layout.isTablet}
                    />
                    {constructSelection.playValue ? (
                        <StatCard
                            label={t("detail.playValueCardLabel", { ns: "reports" })}
                            value={playValueMetricValue}
                            accentColor={ds.colors.primary}
                            helperText={
                                overall === null ? undefined : formatMetricMaxHelper(overall.play_value_total_max)
                            }
                            minHeight={summaryCardMinHeight}
                            dense={layout.isTablet}
                        />
                    ) : null}
                    {constructSelection.usability ? (
                        <StatCard
                            label={t("detail.usabilityCardLabel", { ns: "reports" })}
                            value={usabilityMetricValue}
                            accentColor={ds.colors.primary}
                            helperText={
                                overall === null ? undefined : formatMetricMaxHelper(overall.usability_total_max)
                            }
                            minHeight={summaryCardMinHeight}
                            dense={layout.isTablet}
                        />
                    ) : null}
                    <StatCard
                        label={t("detail.sociabilityCardLabel", { ns: "reports" })}
                        value={sociabilityMetricValue}
                        accentColor={ds.colors.primary}
                        helperText={overall === null ? undefined : formatMetricMaxHelper(overall.sociability_total_max)}
                        minHeight={summaryCardMinHeight}
                        dense={layout.isTablet}
                    />
                </XStack>
            ) : (
                <YStack gap="$2">
                    <XStack gap="$3">
                        <StatCard
                            label={t("detail.overallScore", { ns: "reports" })}
                            value={overallMetricValue}
                            accentColor={ds.colors.primary}
                            helperText={overallHelperText}
                            minHeight={layout.summaryCardMinHeight}
                            dense={layout.isTablet}
                        />
                        {constructSelection.playValue ? (
                            <StatCard
                                label={t("detail.playValueCardLabel", { ns: "reports" })}
                                value={playValueMetricValue}
                                accentColor={ds.colors.primary}
                                helperText={
                                    overall === null ? undefined : formatMetricMaxHelper(overall.play_value_total_max)
                                }
                                minHeight={layout.summaryCardMinHeight}
                                dense={layout.isTablet}
                            />
                        ) : null}
                    </XStack>
                    <XStack gap="$3">
                        {constructSelection.usability ? (
                            <StatCard
                                label={t("detail.usabilityCardLabel", { ns: "reports" })}
                                value={usabilityMetricValue}
                                accentColor={ds.colors.primary}
                                helperText={
                                    overall === null ? undefined : formatMetricMaxHelper(overall.usability_total_max)
                                }
                                minHeight={layout.summaryCardMinHeight}
                                dense={layout.isTablet}
                            />
                        ) : null}
                        <StatCard
                            label={t("detail.sociabilityCardLabel", { ns: "reports" })}
                            value={sociabilityMetricValue}
                            accentColor={ds.colors.primary}
                            helperText={
                                overall === null ? undefined : formatMetricMaxHelper(overall.sociability_total_max)
                            }
                            minHeight={layout.summaryCardMinHeight}
                            dense={layout.isTablet}
                        />
                    </XStack>
                </YStack>
            )}
        </YStack>
    );
}

interface MetadataRowProps {
    readonly label: string;
    readonly value: string;
    readonly selectable?: boolean;
    readonly isCode?: boolean;
}

/**
 * Label/value row used in the audit metadata card.
 *
 * @param props Metadata label and value.
 * @returns Horizontal metadata row.
 */
function MetadataRow({ label, value, selectable = false, isCode = false }: Readonly<MetadataRowProps>) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");
    return (
        <XStack items="flex-start" gap="$3">
            <Paragraph
                color={ds.colors.mutedForeground}
                fontFamily={ds.fonts.bodyBold}
                fontSize={ds.typography.bodySm.fontSize}
                width={140}
                shrink={0}
            >
                {label}
            </Paragraph>
            {isCode ? (
                <XStack flex={1} items="center" gap="$2">
                    <Text
                        selectable
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.monoMedium}
                        fontSize={ds.typography.bodySm.fontSize}
                        lineHeight={ds.typography.bodySm.lineHeight}
                        flex={1}
                        style={{ textAlign: "left" }}
                    >
                        {formatCodeInChunks(value)}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("detail.shareCode", { ns: "reports" })}
                        onPress={() => {
                            void Share.share({ message: value }).catch(() => undefined);
                        }}
                        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, padding: 6 })}
                    >
                        <Share2 size={14} color={ds.colors.primary} />
                    </Pressable>
                </XStack>
            ) : (
                <Text
                    selectable={selectable}
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodySm.fontSize}
                    lineHeight={ds.typography.bodySm.lineHeight}
                    flex={1}
                    style={{ textAlign: "left" }}
                >
                    {value}
                </Text>
            )}
        </XStack>
    );
}

interface DetailStateCardProps {
    readonly title: string;
    readonly message: string;
    readonly isLoading?: boolean;
}

/**
 * Compact placeholder state used while a report detail route is loading or unavailable.
 *
 * @param props Placeholder title, message, and loading state.
 * @returns Full-screen centered placeholder card.
 */
function DetailStateCard({ title, message, isLoading = false }: Readonly<DetailStateCardProps>) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    return (
        <YStack flex={1} justify="center" px={layout.screenPaddingHorizontal} bg={ds.colors.background}>
            <YStack
                width="100%"
                style={{ maxWidth: layout.formMaxWidth, alignSelf: "center" }}
                rounded={ds.radii.lg}
                borderWidth={1}
                borderColor={ds.colors.border}
                bg={ds.colors.surface}
                p="$4"
                gap="$3"
            >
                <Text
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.titleLg.fontSize}
                >
                    {title}
                </Text>
                <Paragraph color={ds.colors.mutedForeground} fontFamily={ds.fonts.bodyMedium}>
                    {message}
                </Paragraph>
                {isLoading ? (
                    <YStack gap="$2" pt="$2">
                        <SkeletonLine width="86%" />
                        <SkeletonLine width="70%" />
                        <SkeletonLine width="78%" />
                    </YStack>
                ) : null}
            </YStack>
        </YStack>
    );
}

/**
 * Read one string route parameter from `useLocalSearchParams`.
 *
 * @param value Raw route parameter.
 * @returns First string value or null.
 */
function readSingleParam(value: string | string[] | undefined): string | null {
    if (typeof value === "string" && value.trim().length > 0) {
        return value;
    }
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim().length > 0) {
        return value[0];
    }
    return null;
}

/**
 * Format an ISO timestamp into a localized date/time label.
 *
 * @param value ISO timestamp.
 * @returns Localized date and time string.
 */
function formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    const dateLabel = new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(date);
    const timeLabel = new Intl.DateTimeFormat("en-GB", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    })
        .format(date)
        .replace(/\b(am|pm)\b/i, (match) => match.toUpperCase());

    return `${dateLabel}, ${timeLabel}`;
}

/**
 * Break a long identifier into 4-character groups so field auditors can read
 * it aloud or transcribe it without losing their place (6.4/G6).
 */
function formatCodeInChunks(code: string): string {
    return code.replace(/(.{4})/g, "$1 ").trim();
}
