import { useState } from "react";
import { RotateCcw, SlidersHorizontal } from "@tamagui/lucide-icons-2";
import { useTranslation } from "react-i18next";
import { Button, Paragraph, Separator, Sheet, Text, XStack, YStack } from "tamagui";
import type { ConstructSelection, DomainConstructCoverage, ReportResultFilter } from "lib/audit/report-filter";
import { isDefaultReportFilter, isSingleConstructSelection } from "lib/audit/report-filter";
import { useDesignSystem } from "lib/design-system";

/** Minimum touch target, per the platform accessibility guidance used across the app. */
const TOUCH_TARGET = 48;

interface ConstructToggleGroupProps {
    readonly selection: ConstructSelection;
    readonly onChange: (selection: ConstructSelection) => void;
    readonly testIDPrefix: string;
    readonly accessibilityContext: string;
}

/**
 * Paired Play Value / Usability toggles.
 *
 * Turning off the last enabled construct is disabled rather than ignored, so the
 * control visibly refuses instead of silently doing nothing.
 */
function ConstructToggleGroup({ selection, onChange, testIDPrefix, accessibilityContext }: ConstructToggleGroupProps) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");

    const options = [
        {
            key: "playValue" as const,
            label: t("extendedTable.columnPlayValue"),
            active: selection.playValue,
            locked: selection.playValue && !selection.usability,
        },
        {
            key: "usability" as const,
            label: t("extendedTable.columnUsability"),
            active: selection.usability,
            locked: selection.usability && !selection.playValue,
        },
    ];

    return (
        <XStack gap="$2" flexWrap="wrap">
            {options.map((option) => (
                <Button
                    key={option.key}
                    testID={`${testIDPrefix}-${option.key === "playValue" ? "play-value" : "usability"}`}
                    height={TOUCH_TARGET}
                    flex={1}
                    minW={130}
                    rounded={ds.radii.md}
                    bg={option.active ? ds.colors.primary : ds.colors.surface}
                    borderColor={option.active ? ds.colors.primary : ds.colors.border}
                    borderWidth={1}
                    disabled={option.locked}
                    opacity={option.locked ? 0.75 : 1}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.active, disabled: option.locked }}
                    accessibilityLabel={t("filter.constructToggleAccessible", {
                        construct: option.label,
                        context: accessibilityContext,
                    })}
                    onPress={() => {
                        onChange({ ...selection, [option.key]: !option.active });
                    }}
                >
                    <Text
                        color={option.active ? ds.colors.primaryForeground : ds.colors.foreground}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={ds.typography.bodyMd.fontSize}
                        numberOfLines={2}
                    >
                        {option.label}
                    </Text>
                </Button>
            ))}
        </XStack>
    );
}

interface ReportFilterBannerProps {
    readonly filter: ReportResultFilter;
    readonly onShowFullReport: () => void;
    readonly testIDPrefix?: string;
}

/**
 * Persistent notice shown whenever a report opens showing less than the full audit.
 *
 * A stored selection is restored without the reader acting, so the report says
 * what is missing and offers a one-tap way back to everything.
 */
export function ReportFilterBanner({
    filter,
    onShowFullReport,
    testIDPrefix = "report-filter",
}: ReportFilterBannerProps) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");

    if (isDefaultReportFilter(filter)) {
        return null;
    }

    const hasOverrides = Object.keys(filter.domainOverrides).length > 0;
    const overallIsNarrowed = !filter.overall.playValue || !filter.overall.usability;

    let message: string;
    if (!filter.overall.playValue) {
        message = t("filter.bannerUsabilityOnly");
    } else if (!filter.overall.usability) {
        message = t("filter.bannerPlayValueOnly");
    } else {
        message = t("filter.bannerCustomized");
    }

    return (
        <YStack
            testID={`${testIDPrefix}-banner`}
            gap="$2"
            p="$3"
            rounded={ds.radii.md}
            bg={ds.colors.mutedSurface}
            borderColor={ds.colors.border}
            borderWidth={1}
            accessibilityRole="summary"
        >
            <Paragraph
                color={ds.colors.foreground}
                fontFamily={ds.fonts.bodyMedium}
                fontSize={ds.typography.bodyMd.fontSize}
            >
                {overallIsNarrowed && hasOverrides ? `${message} ${t("filter.bannerAlsoCustomized")}` : message}
            </Paragraph>
            <Button
                testID={`${testIDPrefix}-show-full`}
                height={TOUCH_TARGET}
                rounded={ds.radii.md}
                bg={ds.colors.surface}
                borderColor={ds.colors.border}
                borderWidth={1}
                accessibilityRole="button"
                accessibilityLabel={t("filter.showFullReport")}
                icon={<RotateCcw size={16} color={ds.colors.foreground} />}
                onPress={onShowFullReport}
            >
                <Text
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodyMd.fontSize}
                >
                    {t("filter.showFullReport")}
                </Text>
            </Button>
        </YStack>
    );
}

interface ReportFilterControlsProps {
    readonly filter: ReportResultFilter;
    readonly onOverallChange: (selection: ConstructSelection) => void;
    readonly onApplyToAllDomains: () => void;
    readonly onReset: () => void;
}

/**
 * Report-level construct controls for the single-report screen.
 */
export function ReportFilterControls({
    filter,
    onOverallChange,
    onApplyToAllDomains,
    onReset,
}: ReportFilterControlsProps) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");
    const hasOverrides = Object.keys(filter.domainOverrides).length > 0;

    return (
        <YStack gap="$2.5">
            <Text color={ds.colors.foreground} fontFamily={ds.fonts.bodyBold} fontSize={ds.typography.titleSm.fontSize}>
                {t("filter.title")}
            </Text>
            <ConstructToggleGroup
                selection={filter.overall}
                onChange={onOverallChange}
                testIDPrefix="report-filter-overall"
                accessibilityContext={t("filter.overallContext")}
            />
            <XStack gap="$2" flexWrap="wrap">
                {hasOverrides ? (
                    <Button
                        chromeless
                        height={TOUCH_TARGET}
                        accessibilityRole="button"
                        accessibilityLabel={t("filter.applyToAllSections")}
                        onPress={onApplyToAllDomains}
                    >
                        <Text
                            color={ds.colors.primary}
                            fontFamily={ds.fonts.bodyMedium}
                            fontSize={ds.typography.bodySm.fontSize}
                        >
                            {t("filter.applyToAllSections")}
                        </Text>
                    </Button>
                ) : null}
                <Button
                    testID="report-filter-reset"
                    chromeless
                    height={TOUCH_TARGET}
                    disabled={isDefaultReportFilter(filter)}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isDefaultReportFilter(filter) }}
                    accessibilityLabel={t("filter.resetToFullReport")}
                    onPress={onReset}
                >
                    <Text
                        color={isDefaultReportFilter(filter) ? ds.colors.mutedForeground : ds.colors.primary}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={ds.typography.bodySm.fontSize}
                    >
                        {t("filter.resetToFullReport")}
                    </Text>
                </Button>
            </XStack>
            <Paragraph
                color={ds.colors.mutedForeground}
                fontFamily={ds.fonts.bodyRegular}
                fontSize={ds.typography.bodySm.fontSize}
            >
                {t("filter.help")}
            </Paragraph>
        </YStack>
    );
}

interface DomainFilterControlsProps {
    readonly domainKey: string;
    readonly domainTitle: string;
    readonly selection: ConstructSelection;
    readonly coverage: DomainConstructCoverage | undefined;
    readonly hasOverride: boolean;
    readonly onChange: (selection: ConstructSelection) => void;
    readonly onUseReportSetting: () => void;
}

/**
 * Per-domain construct controls.
 *
 * A domain whose questions carry only one construct gets a short note instead
 * of a toggle pair, because both settings would render the same rows.
 */
export function DomainFilterControls({
    domainKey,
    domainTitle,
    selection,
    coverage,
    hasOverride,
    onChange,
    onUseReportSetting,
}: DomainFilterControlsProps) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");

    if (coverage === undefined || (!coverage.playValue && !coverage.usability)) {
        return null;
    }

    if (!coverage.playValue || !coverage.usability) {
        const isPlayValue = coverage.playValue;
        const isIncluded = isPlayValue ? selection.playValue : selection.usability;
        const construct = isPlayValue ? t("extendedTable.columnPlayValue") : t("extendedTable.columnUsability");
        return (
            <YStack gap="$2">
                <Paragraph
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyRegular}
                    fontSize={ds.typography.bodySm.fontSize}
                >
                    {t("filter.sectionMeasuresOnly", { construct })}
                </Paragraph>
                <XStack gap="$2" flexWrap="wrap">
                    <Button
                        testID={`report-filter-domain-${domainKey}-${isPlayValue ? "play-value" : "usability"}`}
                        height={TOUCH_TARGET}
                        rounded={ds.radii.md}
                        bg={isIncluded ? ds.colors.primary : ds.colors.surface}
                        borderColor={isIncluded ? ds.colors.primary : ds.colors.border}
                        borderWidth={1}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isIncluded }}
                        accessibilityLabel={t(
                            isIncluded ? "filter.excludeConstructAccessible" : "filter.includeConstructAccessible",
                            { construct, context: domainTitle },
                        )}
                        onPress={() => {
                            onChange(
                                isPlayValue
                                    ? { playValue: !isIncluded, usability: isIncluded }
                                    : { playValue: isIncluded, usability: !isIncluded },
                            );
                        }}
                    >
                        <Text
                            color={isIncluded ? ds.colors.primaryForeground : ds.colors.foreground}
                            fontFamily={ds.fonts.bodyMedium}
                            fontSize={ds.typography.bodySm.fontSize}
                        >
                            {t(isIncluded ? "filter.excludeConstruct" : "filter.includeConstruct", { construct })}
                        </Text>
                    </Button>
                    {hasOverride ? (
                        <Button
                            testID={`report-filter-domain-${domainKey}-use-report-setting`}
                            chromeless
                            height={TOUCH_TARGET}
                            accessibilityRole="button"
                            accessibilityLabel={t("filter.useReportSetting")}
                            onPress={onUseReportSetting}
                        >
                            <Text
                                color={ds.colors.primary}
                                fontFamily={ds.fonts.bodyMedium}
                                fontSize={ds.typography.bodySm.fontSize}
                            >
                                {t("filter.useReportSetting")}
                            </Text>
                        </Button>
                    ) : null}
                </XStack>
            </YStack>
        );
    }

    return (
        <YStack gap="$2">
            <ConstructToggleGroup
                selection={selection}
                onChange={onChange}
                testIDPrefix={`report-filter-domain-${domainKey}`}
                accessibilityContext={domainTitle}
            />
            {hasOverride ? (
                <Button
                    testID={`report-filter-domain-${domainKey}-use-report-setting`}
                    chromeless
                    height={TOUCH_TARGET}
                    self="flex-start"
                    accessibilityRole="button"
                    accessibilityLabel={t("filter.useReportSetting")}
                    onPress={onUseReportSetting}
                >
                    <Text
                        color={ds.colors.primary}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={ds.typography.bodySm.fontSize}
                    >
                        {t("filter.useReportSetting")}
                    </Text>
                </Button>
            ) : null}
        </YStack>
    );
}

interface FilteredScopeNoteProps {
    readonly selection: ConstructSelection;
}

/**
 * Scope label for shared-scale totals under a single-construct filter.
 *
 * Provision, Variety, Challenge and Sociability are not construct-scoped, so
 * under a single-construct filter their totals cover only part of the
 * instrument. Saying so stops a partial total reading as the whole one.
 */
export function FilteredScopeNote({ selection }: FilteredScopeNoteProps) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");

    if (!isSingleConstructSelection(selection)) {
        return null;
    }

    return (
        <Paragraph
            color={ds.colors.mutedForeground}
            fontFamily={ds.fonts.bodyRegular}
            fontSize={ds.typography.bodySm.fontSize}
        >
            {t("filter.scopeNote", {
                construct: selection.playValue
                    ? t("extendedTable.columnPlayValue")
                    : t("extendedTable.columnUsability"),
            })}
        </Paragraph>
    );
}

interface BulkFilterSheetProps {
    readonly filter: ReportResultFilter;
    readonly onOverallChange: (selection: ConstructSelection) => void;
    readonly onReset: () => void;
}

/**
 * Bulk export construct picker.
 *
 * Bulk export applies one selection to every report it produces, so the sheet
 * shows the report-level toggles only. The trigger states the active selection
 * so an auditor sees what is about to be exported before opening anything.
 */
export function BulkFilterSheet({ filter, onOverallChange, onReset }: BulkFilterSheetProps) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");
    const [isOpen, setIsOpen] = useState(false);

    let summary: string;
    if (!filter.overall.playValue) {
        summary = t("extendedTable.columnUsability");
    } else if (!filter.overall.usability) {
        summary = t("extendedTable.columnPlayValue");
    } else {
        summary = t("filter.bothConstructs");
    }

    return (
        <>
            <Button
                testID="report-filter-bulk-trigger"
                height={TOUCH_TARGET}
                rounded={ds.radii.md}
                bg={ds.colors.surface}
                borderColor={isDefaultReportFilter(filter) ? ds.colors.border : ds.colors.primary}
                borderWidth={1}
                accessibilityRole="button"
                accessibilityLabel={t("filter.bulkTriggerAccessible", { selection: summary })}
                icon={<SlidersHorizontal size={16} color={ds.colors.foreground} />}
                onPress={() => {
                    setIsOpen(true);
                }}
            >
                <Text
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodyMd.fontSize}
                    numberOfLines={1}
                >
                    {t("filter.bulkTrigger", { selection: summary })}
                </Text>
            </Button>
            <Sheet
                modal
                open={isOpen}
                onOpenChange={setIsOpen}
                snapPoints={[50]}
                snapPointsMode="percent"
                dismissOnSnapToBottom
            >
                <Sheet.Overlay opacity={0.5} />
                <Sheet.Frame bg={ds.colors.surface} p="$4" gap="$3">
                    <Sheet.Handle bg={ds.colors.border} />
                    <Text
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.bodyBold}
                        fontSize={ds.typography.titleMd.fontSize}
                        lineHeight={ds.typography.titleMd.lineHeight}
                    >
                        {t("filter.bulkTitle")}
                    </Text>
                    <Paragraph
                        color={ds.colors.mutedForeground}
                        fontFamily={ds.fonts.bodyRegular}
                        fontSize={ds.typography.bodySm.fontSize}
                    >
                        {t("filter.bulkHelp")}
                    </Paragraph>
                    <Separator borderColor={ds.colors.border} />
                    <ConstructToggleGroup
                        selection={filter.overall}
                        onChange={onOverallChange}
                        testIDPrefix="report-filter-bulk"
                        accessibilityContext={t("filter.bulkContext")}
                    />
                    <Button
                        testID="report-filter-bulk-reset"
                        chromeless
                        height={TOUCH_TARGET}
                        self="flex-start"
                        disabled={isDefaultReportFilter(filter)}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: isDefaultReportFilter(filter) }}
                        accessibilityLabel={t("filter.resetToFullReport")}
                        onPress={onReset}
                    >
                        <Text
                            color={isDefaultReportFilter(filter) ? ds.colors.mutedForeground : ds.colors.primary}
                            fontFamily={ds.fonts.bodyMedium}
                            fontSize={ds.typography.bodySm.fontSize}
                        >
                            {t("filter.resetToFullReport")}
                        </Text>
                    </Button>
                </Sheet.Frame>
            </Sheet>
        </>
    );
}
