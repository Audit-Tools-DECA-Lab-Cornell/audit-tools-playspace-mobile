import { Check } from "@tamagui/lucide-icons-2";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, type ColorTokens, Paragraph, Text, XStack, YStack } from "tamagui";

import { getScaleAccentColor, getScaleSoftColor, useDesignSystem } from "lib/design-system";
import type { QuestionScale } from "lib/audit/types";

/**
 * Minimum touch target: 44pt satisfies iOS, 48dp satisfies Android. One value covers both.
 */
const MINIMUM_TOUCH_TARGET = 48;

interface ScaleMultiSelectProps {
    readonly scale: QuestionScale;
    readonly selectedOptionKeys: readonly string[];
    readonly onToggleOption: (optionKey: string) => void;
    readonly disabled: boolean;
    /** `card` is the stacked phone layout; `table` is a tablet matrix cell. */
    readonly variant?: "card" | "table";
    /** Hide the scale title when the surrounding layout already shows it. */
    readonly showTitle?: boolean;
}

/**
 * Render a scale that accepts any non-empty combination of its options.
 *
 * Every option carries the same weight, so all options share one width, one type size, and one
 * colour. Nothing in the layout may rank them.
 *
 * Each row is one checkbox: the whole row is the touch target, and label plus box are announced
 * together with the current checked state.
 */
export function ScaleMultiSelect({
    scale,
    selectedOptionKeys,
    onToggleOption,
    disabled,
    variant = "card",
    showTitle = true,
}: Readonly<ScaleMultiSelectProps>) {
    const ds = useDesignSystem();
    const { t } = useTranslation("audit");
    const [hasCleared, setHasCleared] = useState(false);

    const scaleAccent = getScaleAccentColor(scale.key, ds.colors);
    const scaleSoft = getScaleSoftColor(scale.key, ds.colors);
    const isCompact = variant === "table";
    const selectedCount = selectedOptionKeys.length;
    const isInvalid = hasCleared && selectedCount === 0;

    return (
        <YStack gap={isCompact ? "$2" : "$2.5"}>
            {showTitle ? (
                <YStack gap="$1">
                    <Text
                        color={scaleAccent as ColorTokens}
                        fontFamily={ds.fonts.bodyBold}
                        fontSize={ds.typography.titleSm.fontSize}
                        textTransform="uppercase"
                        letterSpacing={1.2}
                    >
                        {scale.title}
                    </Text>
                    <Paragraph
                        color={ds.colors.mutedForeground}
                        fontFamily={ds.fonts.bodyRegular}
                        fontSize={ds.typography.bodySm.fontSize}
                        lineHeight={ds.typography.bodySm.lineHeight}
                    >
                        {scale.prompt}
                    </Paragraph>
                </YStack>
            ) : null}

            <YStack gap="$2">
                {scale.options.map((option) => {
                    const isChecked = selectedOptionKeys.includes(option.key);

                    return (
                        <Button
                            key={`${scale.key}.${option.key}`}
                            width="100%"
                            height="auto"
                            minH={MINIMUM_TOUCH_TARGET}
                            // Zero frame padding: the inner row carries the padding so long labels
                            // use the full width instead of wrapping early.
                            px={0}
                            py={0}
                            rounded={ds.radii.md}
                            disabled={disabled}
                            accessibilityRole="checkbox"
                            accessibilityLabel={option.label}
                            accessibilityState={{ checked: isChecked, disabled }}
                            borderWidth={isChecked ? 2 : 1}
                            borderColor={
                                isChecked
                                    ? (scaleAccent as ColorTokens)
                                    : isInvalid
                                      ? (ds.colors.warning as ColorTokens)
                                      : (ds.colors.border as ColorTokens)
                            }
                            bg={isChecked ? (scaleSoft as ColorTokens) : (ds.colors.input as ColorTokens)}
                            opacity={disabled ? 0.6 : 1}
                            pressStyle={{ opacity: 0.92, scale: 0.985 }}
                            onPress={() => {
                                if (disabled) {
                                    return;
                                }
                                setHasCleared(isChecked && selectedCount === 1);
                                onToggleOption(option.key);
                            }}
                        >
                            <XStack width="100%" px={isCompact ? "$2.5" : "$3"} py="$2.5" gap="$2.5" items="center">
                                <YStack
                                    width={24}
                                    height={24}
                                    rounded={ds.radii.sm}
                                    borderWidth={2}
                                    borderColor={
                                        isChecked ? (scaleAccent as ColorTokens) : (ds.colors.border as ColorTokens)
                                    }
                                    bg={isChecked ? (scaleAccent as ColorTokens) : "transparent"}
                                    items="center"
                                    justify="center"
                                >
                                    {isChecked ? <Check size={16} color={ds.colors.primaryForeground} /> : null}
                                </YStack>
                                <Text
                                    flex={1}
                                    color={
                                        isChecked ? (scaleAccent as ColorTokens) : (ds.colors.foreground as ColorTokens)
                                    }
                                    fontFamily={isChecked ? ds.fonts.bodyBold : ds.fonts.bodyMedium}
                                    fontSize={ds.typography.bodySm.fontSize}
                                    lineHeight={ds.typography.bodySm.lineHeight}
                                >
                                    {option.label}
                                </Text>
                            </XStack>
                        </Button>
                    );
                })}
            </YStack>

            <Paragraph
                color={isInvalid ? (ds.colors.warning as ColorTokens) : (ds.colors.mutedForeground as ColorTokens)}
                fontFamily={isInvalid ? ds.fonts.bodySemiBold : ds.fonts.bodyMedium}
                fontSize={ds.typography.bodyXs.fontSize}
                lineHeight={ds.typography.bodyXs.lineHeight}
            >
                {isInvalid
                    ? t("multiSelect.required")
                    : selectedCount === 0
                      ? t("multiSelect.hint")
                      : t("multiSelect.selectedCount", { count: selectedCount, total: scale.options.length })}
            </Paragraph>
        </YStack>
    );
}
