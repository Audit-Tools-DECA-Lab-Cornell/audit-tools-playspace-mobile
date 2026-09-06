import { memo } from "react";
import { Pressable } from "react-native";
import { Text, XStack, YStack } from "tamagui";
import { ChevronDown } from "@tamagui/lucide-icons-2";
import { useTranslation } from "react-i18next";
import { useDesignSystem } from "lib/design-system";
import { formatPercentage } from "lib/audit/score-helpers";
import type { ConstructSelection } from "lib/audit/report-filter";
import type { AuditScoreTotals } from "lib/audit/types";

interface DomainSectionHeaderProps {
    readonly title: string;
    readonly isExpanded: boolean;
    readonly onToggle: () => void;
    readonly scoreTotals?: AuditScoreTotals | null;
    readonly constructSelection?: ConstructSelection;
    readonly accessibilityLabel?: string;
}

/**
 * Collapsible section header shared by short and extended domain rows.
 * Optionally shows a compact combined score badge when collapsed.
 */
export const DomainSectionHeader = memo(function DomainSectionHeader({
    title,
    isExpanded,
    onToggle,
    scoreTotals,
    constructSelection = { playValue: true, usability: true },
    accessibilityLabel,
}: DomainSectionHeaderProps) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");

    const st = scoreTotals ?? null;
    const pvPct =
        st !== null && st.play_value_total_max > 0
            ? formatPercentage(st.play_value_total, st.play_value_total_max)
            : null;
    const uPct =
        st !== null && st.usability_total_max > 0 ? formatPercentage(st.usability_total, st.usability_total_max) : null;
    const scoreParts = [
        constructSelection.playValue && pvPct !== null && pvPct !== "--" ? `${t("playValueShort")} ${pvPct}` : null,
        constructSelection.usability && uPct !== null && uPct !== "--" ? `${t("usabilityShort")} ${uPct}` : null,
    ].filter((value): value is string => value !== null);
    const dualPctText = scoreParts.length === 0 ? null : scoreParts.join(" · ");

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: isExpanded }}
            accessibilityLabel={
                accessibilityLabel ??
                `${title}. ${isExpanded ? t("domain.collapseSection") : t("domain.expandSection")}`
            }
            onPress={onToggle}
        >
            <XStack justify="space-between" items="center" gap="$2" width="100%">
                <Text
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.titleMd.fontSize}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                    flex={1}
                >
                    {title}
                </Text>

                <XStack items="center" gap="$2">
                    {/* Score badge - visible only when collapsed and score available */}
                    {!isExpanded && dualPctText !== null ? (
                        <YStack
                            px="$2"
                            py="$0.5"
                            rounded={ds.radii.full}
                            style={{ backgroundColor: ds.colors.primarySoft }}
                        >
                            <Text
                                color={ds.colors.primary}
                                fontFamily={ds.fonts.bodyBold}
                                fontSize={ds.typography.bodyXs.fontSize}
                            >
                                {dualPctText}
                            </Text>
                        </YStack>
                    ) : null}

                    <ChevronDown
                        size={20}
                        color={ds.colors.mutedForeground}
                        style={{
                            transform: [{ rotate: isExpanded ? "0deg" : "-90deg" }],
                        }}
                    />
                </XStack>
            </XStack>
        </Pressable>
    );
});

interface ExpandCollapseControlProps {
    readonly onExpandAll: () => void;
    readonly onCollapseAll: () => void;
    readonly allExpanded: boolean;
}

/**
 * Expand all / Collapse all control row shown above domain sections.
 */
export const ExpandCollapseControl = memo(function ExpandCollapseControl({
    onExpandAll,
    onCollapseAll,
    allExpanded,
}: ExpandCollapseControlProps) {
    const ds = useDesignSystem();
    const { t } = useTranslation("reports");

    return (
        <XStack justify="flex-end" items="center" gap="$3" flexWrap="wrap">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("domain.expandAll")}
                onPress={onExpandAll}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
            >
                <Text
                    color={ds.colors.primary}
                    fontFamily={allExpanded ? ds.fonts.bodyBold : ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodySm.fontSize}
                    style={{ textDecorationLine: allExpanded ? "underline" : "none" }}
                >
                    {t("domain.expandAll")}
                </Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("domain.collapseAll")}
                onPress={onCollapseAll}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
            >
                <Text
                    color={ds.colors.primary}
                    fontFamily={allExpanded ? ds.fonts.bodyMedium : ds.fonts.bodyBold}
                    fontSize={ds.typography.bodySm.fontSize}
                    style={{ textDecorationLine: allExpanded ? "none" : "underline" }}
                >
                    {t("domain.collapseAll")}
                </Text>
            </Pressable>
        </XStack>
    );
});
