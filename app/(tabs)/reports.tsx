import { FlashList, FlashListRef, type ListRenderItemInfo } from "@shopify/flash-list";
import { ArrowRight, Clock3, FileBarChart, MapPin, TriangleAlert } from "@tamagui/lucide-icons-2";
import { useToastController } from "@tamagui/toast";
import { ActionButton } from "components/ui/action-button";
import { CollapsibleCard } from "components/ui/collapsible-card";
import { ProjectFilterSelect } from "components/ui/project-filter-select";
import { TypeFilterSelect } from "components/ui/type-filter-select";
import { SearchInput } from "components/ui/search-input";
import { StatCard } from "components/ui/stat-card";
import { ScreenHeader } from "components/ui/screen-header";
import { QueueCardHeader, QueueCardMetaRow, QueueCardShell } from "components/ui/queue-card";
import { ScoreLegendInfo } from "components/reports/score-legend-info";
import { useRouter, type Href } from "expo-router";
import type { AuditExportFormat, AuditExportPreview, ExportAuditorProfile } from "lib/exports/reports";
import { buildAuditExportPreview, shareBulkAuditExport } from "lib/exports/reports";
import { buildBulkReportIdentity } from "lib/audit/report-filter-keys";
import { useReportFilter } from "lib/audit/use-report-filter";
import { BulkFilterSheet, ReportFilterBanner } from "components/reports/ReportFilterControls";
import { buildExportableAuditForPlace, loadOptionalExportAuditorProfile } from "lib/exports/reports/helpers";
import { getProjectPlaceKey } from "lib/audit/pair-key";
import {
    deriveLocality,
    derivePlaceRequirementStatus,
    getPlaceLastActivityTimestamp,
    matchesPlaceSearch,
} from "lib/audit/place-helpers";
import type { AuditorPlace } from "lib/audit/places-api";
import { resolveAuditScopedInstrument } from "lib/audit/instrument-resolution";
import {
    formatColumnSummary,
    formatScorePair,
    formatScorePairStacked,
    formatScoreValue,
    getEffectivePlaceScores,
    type ScoreSummaryLabels,
} from "lib/audit/score-helpers";
import { useLocalFirstPlaces } from "lib/audit/use-local-first-places";
import { getPlaceStatusTone, isGlassUiEnabled, useDesignSystem } from "lib/design-system";
import { formatRelativeTimeLabel, getPlaceStatusLabel } from "lib/i18n/format";
import { useLocalizedInstrument } from "lib/i18n/instrument-translations";
import { getResponsiveContentContainerStyle, useResponsiveLayout } from "lib/responsive-layout";
import { useFabAwareBottomPadding } from "lib/responsive-insets";
import { useScreenshotScrollAutomation } from "lib/screenshot-automation";
import { buildPairGridRows, type PairGridRow } from "lib/ui/pair-grid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView } from "react-native";
import { usePlayspaceAuditStore } from "stores/audit-store";
import { useAuthStore } from "stores/auth-store";
import { usePlacesStore } from "stores/places-store";
import { Paragraph, Text, XStack, YStack } from "tamagui";

type ReportProjectFilter = "all" | string;
type ReportFilter = "all" | "submitted" | "scored" | "not_scored";
type ReportModeFilter = "all" | "audit" | "survey" | "both";
type ReportSortOption = "score" | "recent" | "name";
type ReportsListItem = AuditorPlace | PairGridRow<AuditorPlace>;

/**
 * Scoring tab with audit performance visuals derived from assigned places.
 * Keeps summary analytics on the tab and pushes deeper audit detail into a dedicated screen.
 */
export default function ReportsScreen() {
    const ds = useDesignSystem();
    const isGlassEnabled = isGlassUiEnabled();
    const layout = useResponsiveLayout();
    const listBottomPadding = useFabAwareBottomPadding();
    const { t } = useTranslation(["reports", "common"]);
    const instrument = useLocalizedInstrument();
    const toast = useToastController();
    const session = useAuthStore((state) => state.session);
    // One selection applied to every report this screen exports, remembered
    // per auditor so a repeat export does not need re-picking.
    const bulkFilter = useReportFilter(buildBulkReportIdentity(), session?.user.id ?? null);
    const places = useLocalFirstPlaces();
    const loadPlaces = usePlacesStore((state) => state.loadPlaces);
    const sessionsByAuditId = usePlayspaceAuditStore((state) => state.sessionsByAuditId);
    const [previewData, setPreviewData] = useState<AuditExportPreview | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [activeExportKey, setActiveExportKey] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [projectFilter, setProjectFilter] = useState<ReportProjectFilter>("all");
    const [reportFilter, setReportFilter] = useState<ReportFilter>("all");
    const [modeFilter, setModeFilter] = useState<ReportModeFilter>("all");
    const [sortOption, setSortOption] = useState<ReportSortOption>("score");
    const listRef = useRef<FlashListRef<ReportsListItem> | null>(null);

    useEffect(() => {
        if (session !== null) {
            loadPlaces(session).catch(() => undefined);
        }
    }, [session, loadPlaces]);

    const reportPlaces = useMemo(() => {
        return places.filter((place) => place.audit_id !== null);
    }, [places]);

    const placesWithScores = useMemo(() => {
        return reportPlaces.filter((place) => place.overall_scores !== null);
    }, [reportPlaces]);

    const exportablePlaces = useMemo(() => {
        return placesWithScores.filter((place) => place.audit_id !== null);
    }, [placesWithScores]);

    const averageCombinedConstructScore = useMemo(() => {
        if (placesWithScores.length === 0) {
            return null;
        }
        return {
            pv:
                placesWithScores.reduce((total, place) => total + (place.overall_scores?.pv ?? 0), 0) /
                placesWithScores.length,
            u:
                placesWithScores.reduce((total, place) => total + (place.overall_scores?.u ?? 0), 0) /
                placesWithScores.length,
        };
    }, [placesWithScores]);

    const averageSociabilityScore = useMemo(() => {
        if (placesWithScores.length === 0) {
            return 0;
        }
        const sum = placesWithScores.reduce((total, place) => {
            return total + (place.score_totals?.sociability_total ?? 0);
        }, 0);
        return sum / placesWithScores.length;
    }, [placesWithScores]);

    const topScoringPlace = useMemo(() => {
        if (exportablePlaces.length === 0) {
            return null;
        }
        return exportablePlaces.reduce((best, current) => {
            return (current.overall_scores?.pv ?? 0) + (current.overall_scores?.u ?? 0) >
                (best.overall_scores?.pv ?? 0) + (best.overall_scores?.u ?? 0)
                ? current
                : best;
        });
    }, [exportablePlaces]);

    /** Unique projects derived from report places for the project filter chips. */
    const uniqueProjects = useMemo(() => {
        const projectMap = new Map<string, string>();
        for (const place of reportPlaces) {
            if (!projectMap.has(place.project_id)) {
                projectMap.set(place.project_id, place.project_name);
            }
        }
        return Array.from(projectMap.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [reportPlaces]);

    const filteredReportPlaces = useMemo(() => {
        const visiblePlaces = reportPlaces.filter((place) => {
            if (!matchesPlaceSearch(place, searchQuery)) {
                return false;
            }

            if (projectFilter !== "all" && place.project_id !== projectFilter) {
                return false;
            }

            if (modeFilter !== "all" && place.selected_execution_mode !== modeFilter) {
                return false;
            }

            if (reportFilter === "submitted") {
                return place.submitted_at !== null;
            }
            if (reportFilter === "scored") {
                return place.overall_scores !== null;
            }
            if (reportFilter === "not_scored") {
                return place.overall_scores === null;
            }
            return true;
        });

        return visiblePlaces.sort((leftPlace, rightPlace) => {
            if (sortOption === "name") {
                return leftPlace.place_name.localeCompare(rightPlace.place_name);
            }

            if (sortOption === "score") {
                const scoreDifference =
                    (rightPlace.overall_scores?.pv ?? -1) +
                    (rightPlace.overall_scores?.u ?? -1) -
                    ((leftPlace.overall_scores?.pv ?? -1) + (leftPlace.overall_scores?.u ?? -1));
                if (scoreDifference !== 0) {
                    return scoreDifference;
                }
            }

            const recentDifference =
                getPlaceLastActivityTimestamp(rightPlace) - getPlaceLastActivityTimestamp(leftPlace);
            if (recentDifference !== 0) {
                return recentDifference;
            }

            return leftPlace.place_name.localeCompare(rightPlace.place_name);
        });
    }, [modeFilter, projectFilter, reportFilter, reportPlaces, searchQuery, sortOption]);
    const tabletRows = useMemo(() => {
        return buildPairGridRows(filteredReportPlaces, (place) => {
            return getProjectPlaceKey(place.project_id, place.place_id);
        });
    }, [filteredReportPlaces]);
    const listItems: ReportsListItem[] = layout.isTablet ? tabletRows : filteredReportPlaces;

    const scrollReportsToOffset = useCallback((offset: number) => {
        listRef.current?.scrollToOffset({ animated: false, offset });
    }, []);

    useScreenshotScrollAutomation({
        contentReady: true,
        rerunKey: listItems.length,
        scrollToOffset: scrollReportsToOffset,
    });

    const previewPlace = useMemo(() => {
        const filteredScoredPlace = filteredReportPlaces.find((place) => place.overall_scores !== null);
        if (filteredScoredPlace !== undefined) {
            return filteredScoredPlace;
        }

        if (searchQuery.trim().length > 0 || reportFilter !== "all") {
            return null;
        }

        return topScoringPlace ?? exportablePlaces[0] ?? null;
    }, [exportablePlaces, filteredReportPlaces, reportFilter, searchQuery, topScoringPlace]);

    const buildExportableAudit = useCallback(
        async (place: AuditorPlace, auditorProfile?: ExportAuditorProfile | null) => {
            const exportParams = {
                session,
                place,
                cachedAudit: place.audit_id === null ? undefined : sessionsByAuditId[place.audit_id],
                exportSessionRequiredMessage: t("exportSessionRequired"),
                exportAuditMissingMessage: t("exportAuditMissing"),
                ...(auditorProfile === undefined ? {} : { auditorProfile }),
            };

            return buildExportableAuditForPlace(exportParams);
        },
        [session, sessionsByAuditId, t],
    );

    useEffect(() => {
        let isCancelled = false;

        if (previewPlace === null) {
            setPreviewData(null);
            setIsLoadingPreview(false);
            return () => {
                isCancelled = true;
            };
        }

        setIsLoadingPreview(true);
        buildExportableAudit(previewPlace)
            .then((exportableAudit) => {
                if (isCancelled) {
                    return;
                }
                const previewInstrument = resolveAuditScopedInstrument({
                    activeInstrument: instrument,
                    auditSession: exportableAudit.auditSession,
                });
                if (previewInstrument === null) {
                    setPreviewData(null);
                    return;
                }
                setPreviewData(
                    buildAuditExportPreview({ ...exportableAudit, resultFilter: bulkFilter.filter }, previewInstrument),
                );
            })
            .catch(() => {
                if (isCancelled) {
                    return;
                }
                setPreviewData(null);
            })
            .finally(() => {
                if (isCancelled) {
                    return;
                }
                setIsLoadingPreview(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [buildExportableAudit, bulkFilter.filter, instrument, previewPlace]);

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
                error instanceof Error && error.message.trim().length > 0 ? error.message : t("exportFailedMessage");
            toast.show(t("exportFailedTitle"), {
                message,
                duration: 5000,
                variant: "error",
            });
        },
        [t, toast],
    );

    const handleBulkExport = useCallback(
        async (format: AuditExportFormat) => {
            const exportKey = `bulk:${format}`;
            setActiveExportKey(exportKey);
            try {
                const auditorProfile = await loadOptionalExportAuditorProfile(session);
                const exportableAudits = (
                    await Promise.all(exportablePlaces.map((place) => buildExportableAudit(place, auditorProfile)))
                ).map((exportableAudit) => ({ ...exportableAudit, resultFilter: bulkFilter.filter }));
                const fileName = await shareBulkAuditExport(
                    exportableAudits,
                    auditorProfile,
                    instrument!,
                    format,
                    ds.colors,
                );
                showExportSuccess(fileName);
            } catch (error) {
                showExportError(error);
            } finally {
                setActiveExportKey((currentValue) => (currentValue === exportKey ? null : currentValue));
            }
        },
        [
            buildExportableAudit,
            exportablePlaces,
            instrument,
            session,
            showExportError,
            showExportSuccess,
            ds.colors,
            bulkFilter.filter,
        ],
    );

    const hasActiveFilters =
        searchQuery.trim().length > 0 || projectFilter !== "all" || reportFilter !== "all" || modeFilter !== "all";
    const keyExtractor = useCallback((item: ReportsListItem) => {
        return isPairGridRow(item) ? item.id : getProjectPlaceKey(item.project_id, item.place_id);
    }, []);
    const renderSeparator = useCallback(() => {
        return <YStack height={layout.isTablet ? 16 : 12} />;
    }, [layout.isTablet]);
    const renderItem = useCallback(({ item }: ListRenderItemInfo<ReportsListItem>) => {
        if (isPairGridRow(item)) {
            const rightPlace = item.right;

            if (rightPlace === null) {
                return (
                    <XStack gap="$3" items="stretch">
                        <ReportQueueCard place={item.left} />
                        <YStack width="48.5%"></YStack>
                    </XStack>
                );
            }

            return (
                <XStack gap="$3" items="stretch">
                    <ReportQueueCard place={item.left} />
                    <ReportQueueCard place={rightPlace} />
                </XStack>
            );
        }

        return <ReportQueueCard place={item} />;
    }, []);

    return (
        <FlashList<ReportsListItem>
            ref={listRef}
            data={listItems}
            keyExtractor={keyExtractor}
            contentInsetAdjustmentBehavior="automatic"
            maintainVisibleContentPosition={{ disabled: true }}
            style={{ backgroundColor: ds.colors.background }}
            contentContainerStyle={getResponsiveContentContainerStyle(layout, {
                bottomPadding: listBottomPadding,
            })}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
                <YStack gap="$4">
                    <ScreenHeader title={t("title")} subtitle={t("subtitle")} actions={<ScoreLegendInfo />} />

                    {layout.isTablet ? (
                        <XStack gap="$3">
                            <StatCard
                                label={t("averageConstructScore")}
                                value={
                                    averageCombinedConstructScore
                                        ? (formatScorePairStacked(averageCombinedConstructScore) ?? "--")
                                        : "--"
                                }
                                accentColor={ds.colors.primary}
                                helperText={t("scoredPlacesHelper", {
                                    scored: placesWithScores.length,
                                    total: reportPlaces.length,
                                })}
                                minHeight={layout.summaryCardMinHeight}
                            />
                            <StatCard
                                label={t("averageSociabilityScore")}
                                value={placesWithScores.length > 0 ? formatScoreValue(averageSociabilityScore) : "--"}
                                accentColor={ds.colors.success}
                                helperText={t("sociabilityHelper")}
                                minHeight={layout.summaryCardMinHeight}
                            />
                            <StatCard
                                label={t("topScoringPlace")}
                                value={
                                    topScoringPlace === null
                                        ? "Pending"
                                        : (formatScorePairStacked(topScoringPlace.overall_scores) ?? "Pending")
                                }
                                accentColor={ds.colors.warning}
                                helperText={topScoringPlace?.place_name ?? t("noScoredPlacesYet")}
                                minHeight={layout.summaryCardMinHeight}
                            />
                        </XStack>
                    ) : (
                        <YStack gap="$3">
                            <XStack gap="$3">
                                <StatCard
                                    label={t("averageConstructScore")}
                                    value={
                                        averageCombinedConstructScore
                                            ? (formatScorePairStacked(averageCombinedConstructScore) ?? "--")
                                            : "--"
                                    }
                                    accentColor={ds.colors.primary}
                                    helperText={t("scoredPlacesHelper", {
                                        scored: placesWithScores.length,
                                        total: reportPlaces.length,
                                    })}
                                />
                                <StatCard
                                    label={t("averageSociabilityScore")}
                                    value={
                                        placesWithScores.length > 0 ? formatScoreValue(averageSociabilityScore) : "--"
                                    }
                                    accentColor={ds.colors.success}
                                    helperText={t("sociabilityHelper")}
                                />
                            </XStack>
                            <StatCard
                                label={t("topScoringPlace")}
                                value={
                                    topScoringPlace === null
                                        ? "Pending"
                                        : (formatScorePairStacked(topScoringPlace.overall_scores) ?? "Pending")
                                }
                                accentColor={ds.colors.warning}
                                helperText={topScoringPlace?.place_name ?? t("noScoredPlacesYet")}
                            />
                        </YStack>
                    )}

                    <YStack
                        rounded={ds.radii.lg}
                        borderWidth={1}
                        borderColor={ds.colors.warning}
                        bg={ds.colors.warningSoft}
                        p={layout.cardPadding}
                        gap="$2"
                    >
                        <XStack items="center" gap="$2" width="100%">
                            <TriangleAlert size={16} color={ds.colors.warning} />
                            <Text
                                flex={1}
                                color={ds.colors.warning}
                                fontFamily={ds.fonts.bodyBold}
                                fontSize={ds.typography.bodySm.fontSize}
                                lineHeight={ds.typography.bodySm.lineHeight}
                                textTransform="uppercase"
                                letterSpacing={0.7}
                                style={{ flexShrink: 1 }}
                            >
                                {t("combinedScoringComingSoon", { ns: "reports" })}
                            </Text>
                        </XStack>
                        <Paragraph
                            color={ds.colors.secondaryForeground}
                            fontFamily={ds.fonts.bodyMedium}
                            fontSize={ds.typography.bodySm.fontSize}
                            lineHeight={ds.typography.bodySm.lineHeight}
                        >
                            {t("combinedScoringDescription", { ns: "reports" })}
                        </Paragraph>
                    </YStack>

                    <SearchInput
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder={t("searchPlaceholder", { ns: "reports" })}
                    />

                    {uniqueProjects.length > 1 ? (
                        <ProjectFilterSelect
                            uniqueProjects={uniqueProjects}
                            value={projectFilter}
                            onChange={setProjectFilter}
                            sectionLabel={t("projectFilter", { ns: "reports", defaultValue: "Project" })}
                            allProjectsLabel={t("filters.all", { ns: "common" })}
                        />
                    ) : null}

                    <XStack gap="$2">
                        <TypeFilterSelect
                            label={t("filtersLabel", { ns: "reports" })}
                            options={[
                                { id: "all", label: t("filters.all", { ns: "common" }) },
                                { id: "submitted", label: t("filters.submitted", { ns: "common" }) },
                                { id: "scored", label: t("filters.scored", { ns: "common" }) },
                                { id: "not_scored", label: t("filters.notScored", { ns: "common" }) },
                            ]}
                            value={reportFilter}
                            onChange={(next) => {
                                setReportFilter(next as ReportFilter);
                            }}
                        />
                        <TypeFilterSelect
                            label={t("modeFilterLabel", { ns: "reports" })}
                            options={[
                                { id: "all", label: t("filters.all", { ns: "common" }) },
                                { id: "audit", label: t("detail.auditTypePlaceAudit", { ns: "reports" }) },
                                { id: "survey", label: t("detail.auditTypePlaceSurvey", { ns: "reports" }) },
                                { id: "both", label: t("detail.auditTypeFullAssessment", { ns: "reports" }) },
                            ]}
                            value={modeFilter}
                            onChange={(next) => {
                                setModeFilter(next as ReportModeFilter);
                            }}
                        />
                        <TypeFilterSelect
                            label={t("sortByLabel", { ns: "reports" })}
                            options={[
                                { id: "score", label: t("sort.score", { ns: "common" }) },
                                { id: "recent", label: t("sort.recent", { ns: "common" }) },
                                { id: "name", label: t("sort.name", { ns: "common" }) },
                            ]}
                            value={sortOption}
                            onChange={(next) => {
                                setSortOption(next as ReportSortOption);
                            }}
                        />
                    </XStack>
                </YStack>
            }
            ListHeaderComponentStyle={{ marginBottom: layout.isTablet ? 28 : 24 }}
            ItemSeparatorComponent={renderSeparator}
            ListEmptyComponent={
                <YStack
                    rounded={ds.radii.lg}
                    borderWidth={1}
                    borderColor={isGlassEnabled ? ds.glass.elevatedBorder : ds.colors.border}
                    bg={isGlassEnabled ? ds.glass.elevatedSurface : ds.colors.surface}
                    p="$4"
                    gap="$2"
                    style={{
                        boxShadow: isGlassEnabled ? ds.glass.elevatedShadow : ds.shadows.card,
                    }}
                >
                    <Text
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.bodyBold}
                        fontSize={ds.typography.titleLg.fontSize}
                    >
                        {hasActiveFilters ? t("emptyTitle", { ns: "reports" }) : t("title")}
                    </Text>
                    <Paragraph color={ds.colors.mutedForeground} fontFamily={ds.fonts.bodyMedium}>
                        {hasActiveFilters ? t("emptyMessage", { ns: "reports" }) : t("subtitle")}
                    </Paragraph>
                </YStack>
            }
            ListFooterComponent={
                <YStack gap="$4">
                    {exportablePlaces.length > 0 ? (
                        <CollapsibleCard
                            title={t("exportPreview", { ns: "reports" })}
                            subtitle={t("exportDescription", { ns: "reports" })}
                            icon={<FileBarChart size={32} color={ds.colors.primary} />}
                        >
                            <YStack
                                rounded={ds.radii.md}
                                borderWidth={1}
                                borderColor={ds.colors.border}
                                bg={ds.colors.mutedSurface}
                                p="$3"
                                gap="$2"
                            >
                                <XStack justify="space-between" items="center" gap="$3">
                                    <YStack flex={1}>
                                        <Text
                                            color={ds.colors.foreground}
                                            fontFamily={ds.fonts.bodyBold}
                                            fontSize={ds.typography.bodyMd.fontSize}
                                        >
                                            {t("previewRowsLabel")}
                                        </Text>
                                        <Paragraph
                                            color={ds.colors.mutedForeground}
                                            fontFamily={ds.fonts.bodyMedium}
                                            fontSize={ds.typography.bodyXs.fontSize}
                                        >
                                            {previewPlace !== null
                                                ? t("previewingPlace", {
                                                      ns: "reports",
                                                      placeName: previewPlace.place_name,
                                                  })
                                                : previewData === null
                                                  ? t("previewUnavailable")
                                                  : t("previewSource", {
                                                        auditCode: previewData.auditCode,
                                                    })}
                                        </Paragraph>
                                    </YStack>
                                    {isLoadingPreview ? <ActivityIndicator color={ds.colors.primary} /> : null}
                                </XStack>

                                {previewData === null ? (
                                    <Paragraph
                                        color={ds.colors.mutedForeground}
                                        fontFamily={ds.fonts.bodyMedium}
                                        fontSize={ds.typography.bodySm.fontSize}
                                    >
                                        {t("previewUnavailable")}
                                    </Paragraph>
                                ) : (
                                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                        <YStack
                                            style={{ minWidth: 980 }}
                                            rounded={ds.radii.md}
                                            overflow="hidden"
                                            borderWidth={1}
                                            borderColor={ds.colors.border}
                                        >
                                            <XStack bg={ds.colors.mutedSurface}>
                                                {previewData.headers.map((header, index) => (
                                                    <YStack
                                                        key={`${header}-${index.toString()}`}
                                                        width={150}
                                                        px="$2"
                                                        py="$2"
                                                        borderRightWidth={
                                                            index === previewData.headers.length - 1 ? 0 : 1
                                                        }
                                                        borderColor={ds.colors.border}
                                                    >
                                                        <Text
                                                            color={ds.colors.foreground}
                                                            fontFamily={ds.fonts.bodyBold}
                                                            fontSize={ds.typography.labelXs.fontSize}
                                                        >
                                                            {header}
                                                        </Text>
                                                    </YStack>
                                                ))}
                                            </XStack>
                                            {previewData.rows.map((row, rowIndex) => (
                                                <XStack
                                                    key={`preview-row-${rowIndex.toString()}`}
                                                    borderTopWidth={1}
                                                    borderColor={ds.colors.border}
                                                    bg={rowIndex % 2 === 0 ? ds.colors.surface : ds.colors.mutedSurface}
                                                >
                                                    {row.map((value, valueIndex) => (
                                                        <YStack
                                                            key={`${rowIndex.toString()}-${valueIndex.toString()}`}
                                                            width={150}
                                                            px="$2"
                                                            py="$2"
                                                            borderRightWidth={valueIndex === row.length - 1 ? 0 : 1}
                                                            borderColor={ds.colors.border}
                                                        >
                                                            <Text
                                                                color={ds.colors.mutedForeground}
                                                                fontFamily={ds.fonts.bodyMedium}
                                                                fontSize={ds.typography.bodyXs.fontSize}
                                                            >
                                                                {value}
                                                            </Text>
                                                        </YStack>
                                                    ))}
                                                </XStack>
                                            ))}
                                        </YStack>
                                    </ScrollView>
                                )}
                            </YStack>
                        </CollapsibleCard>
                    ) : null}

                    <YStack
                        rounded={ds.radii.lg}
                        borderWidth={1}
                        borderColor={isGlassEnabled ? ds.glass.elevatedBorder : ds.colors.border}
                        bg={isGlassEnabled ? ds.glass.elevatedSurface : ds.colors.surface}
                        p={layout.cardPadding}
                        gap="$4"
                        style={{
                            boxShadow: isGlassEnabled ? ds.glass.elevatedShadow : ds.shadows.card,
                        }}
                    >
                        <Text
                            color={ds.colors.mutedForeground}
                            fontFamily={ds.fonts.bodyBold}
                            fontSize={ds.typography.labelMd.fontSize}
                            textTransform="uppercase"
                            letterSpacing={1.2}
                        >
                            {t("bulkExportTitle", { ns: "reports" })}
                        </Text>
                        <ReportFilterBanner
                            filter={bulkFilter.filter}
                            onShowFullReport={bulkFilter.showFullReport}
                            testIDPrefix="report-filter-bulk"
                        />
                        <BulkFilterSheet
                            filter={bulkFilter.filter}
                            onOverallChange={bulkFilter.setOverall}
                            onReset={bulkFilter.reset}
                        />
                        <XStack gap="$2">
                            <ActionButton
                                variant="default"
                                label={t("exportCsv", { ns: "reports" })}
                                onPress={() => {
                                    handleBulkExport("csv").catch(() => undefined);
                                }}
                                disabled={exportablePlaces.length === 0 || activeExportKey !== null}
                                isLoading={activeExportKey === "bulk:csv"}
                            />
                            <ActionButton
                                variant="default"
                                label={t("exportExcel", { ns: "reports" })}
                                onPress={() => {
                                    handleBulkExport("xlsx").catch(() => undefined);
                                }}
                                disabled={exportablePlaces.length === 0 || activeExportKey !== null}
                                isLoading={activeExportKey === "bulk:xlsx"}
                            />
                            <ActionButton
                                variant="default"
                                label={t("exportPdf", { ns: "reports" })}
                                onPress={() => {
                                    handleBulkExport("pdf").catch(() => undefined);
                                }}
                                disabled={exportablePlaces.length === 0 || activeExportKey !== null}
                                isLoading={activeExportKey === "bulk:pdf"}
                            />
                        </XStack>
                    </YStack>
                </YStack>
            }
            ListFooterComponentStyle={{ marginTop: layout.isTablet ? 28 : 24 }}
            renderItem={renderItem}
        />
    );
}

interface ReportQueueCardProps {
    readonly place: AuditorPlace;
}

function ReportQueueCard({ place }: Readonly<ReportQueueCardProps>) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    const router = useRouter();
    const { t, i18n } = useTranslation(["reports", "common"]);

    const scoreSummaryLabels = useMemo<ScoreSummaryLabels>(
        () => ({
            playValueShort: t("playValueShort"),
            usabilityShort: t("usabilityShort"),
            sociabilityShort: t("sociabilityShort"),
            provisionShort: t("provisionShort"),
            varietyShort: t("varietyShort"),
            challengeShort: t("challengeShort"),
        }),
        [t],
    );

    const status = derivePlaceRequirementStatus(place);
    const statusTone = getPlaceStatusTone(status, ds.colors);
    const locality = deriveLocality(place, "");
    const effectiveScores = getEffectivePlaceScores(place);
    const hasScore = effectiveScores !== null;
    const combinedConstructScore = effectiveScores === null ? null : effectiveScores.pv + effectiveScores.u;

    /** Max PV+U achievable for this submission based on its own score totals. */
    const maxPossibleScore =
        (place.score_totals?.play_value_total_max ?? 0) + (place.score_totals?.usability_total_max ?? 0);
    const barPercent =
        hasScore && combinedConstructScore !== null && maxPossibleScore > 0
            ? Math.round((combinedConstructScore / maxPossibleScore) * 100)
            : null;
    const barWidth = barPercent !== null ? `${Math.max(barPercent, 6)}%` : "0%";

    const executionModeLabel =
        place.selected_execution_mode === "audit"
            ? t("detail.auditTypePlaceAudit", { ns: "reports" })
            : place.selected_execution_mode === "survey"
              ? t("detail.auditTypePlaceSurvey", { ns: "reports" })
              : place.selected_execution_mode === "both"
                ? t("detail.auditTypeFullAssessment", { ns: "reports" })
                : null;

    const updatedLabel = formatRelativeTimeLabel(place.started_at, place.submitted_at, i18n.language, t);

    return (
        <QueueCardShell
            tone={statusTone}
            onPress={() => {
                if (place.audit_id !== null) {
                    router.push(`/report/${place.audit_id}` as Href);
                }
            }}
        >
            <QueueCardHeader
                title={place.place_name}
                subtitle={place.project_name}
                statusLabel={getPlaceStatusLabel(status, t)}
                tone={statusTone}
                trailing={
                    hasScore ? (
                        <Text
                            color={ds.colors.primary}
                            fontFamily={ds.fonts.headingBold}
                            fontSize={layout.isTablet ? ds.typography.titleMd.fontSize : ds.typography.titleSm.fontSize}
                            numberOfLines={1}
                        >
                            {formatScorePair(effectiveScores)}
                        </Text>
                    ) : undefined
                }
            />

            <YStack gap="$1.5">
                {locality !== null && locality.length > 0 && (
                    <QueueCardMetaRow
                        icon={<MapPin size={14} color={ds.colors.mutedForeground} opacity={0.8} />}
                        text={locality}
                    />
                )}
                <QueueCardMetaRow
                    icon={<Clock3 size={14} color={ds.colors.mutedForeground} opacity={0.8} />}
                    text={updatedLabel}
                />
                {executionModeLabel !== null && (
                    <XStack items="center" gap="$2">
                        <YStack
                            rounded={ds.radii.sm}
                            px="$1.5"
                            py="$0.5"
                            style={{ backgroundColor: ds.colors.mutedSurface }}
                        >
                            <Text
                                color={ds.colors.mutedForeground}
                                fontFamily={ds.fonts.bodyBold}
                                fontSize={ds.typography.labelXs.fontSize}
                                textTransform="uppercase"
                                letterSpacing={0.4}
                            >
                                {executionModeLabel}
                            </Text>
                        </YStack>
                    </XStack>
                )}
            </YStack>

            <YStack flex={1} justify="flex-end" gap="$2">
                {hasScore ? (
                    <YStack gap="$2" pt="$2" borderTopWidth={1} borderColor={ds.colors.border}>
                        <XStack items="center" justify="space-between">
                            <Paragraph
                                color={ds.colors.primary}
                                fontFamily={ds.fonts.bodyBold}
                                fontSize={ds.typography.bodyXs.fontSize}
                                numberOfLines={1}
                            >
                                {formatColumnSummary(place.score_totals, scoreSummaryLabels)}
                            </Paragraph>
                            {barPercent !== null && (
                                <Text
                                    color={ds.colors.mutedForeground}
                                    fontFamily={ds.fonts.bodyMedium}
                                    fontSize={ds.typography.labelLg.fontSize}
                                >
                                    {t("scoreShare", {
                                        ns: "reports",
                                        defaultValue: "{{percent}}% of max score",
                                        percent: barPercent,
                                    })}
                                </Text>
                            )}
                        </XStack>
                        <YStack
                            height={layout.isTablet ? 6 : 4}
                            rounded={ds.radii.full}
                            bg={ds.colors.mutedSurface}
                            overflow="hidden"
                        >
                            <YStack
                                height="100%"
                                rounded={ds.radii.full}
                                bg={ds.colors.primary}
                                style={{ width: barWidth }}
                            />
                        </YStack>
                    </YStack>
                ) : (
                    <Paragraph
                        pt="$2"
                        borderTopWidth={1}
                        borderColor={ds.colors.border}
                        color={ds.colors.mutedForeground}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={ds.typography.bodySm.fontSize}
                    >
                        {t("detail.scorePending", { ns: "reports" })}
                    </Paragraph>
                )}

                <XStack justify="flex-end" items="center" gap="$1.5" mt="$1">
                    <Text
                        color={ds.colors.primary}
                        fontFamily={ds.fonts.bodyBold}
                        fontSize={ds.typography.labelSm.fontSize}
                        textTransform="uppercase"
                        letterSpacing={0.5}
                    >
                        {t("actions.viewDetails", { ns: "common" })}
                    </Text>
                    <ArrowRight size={14} color={ds.colors.primary} />
                </XStack>
            </YStack>
        </QueueCardShell>
    );
}

function isPairGridRow(item: ReportsListItem): item is PairGridRow<AuditorPlace> {
    return "left" in item;
}
