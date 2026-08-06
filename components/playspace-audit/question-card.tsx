import { Fragment } from "react";
import { TextInput } from "react-native";
import { useTranslation } from "react-i18next";
import { Button, type ColorTokens, Paragraph, Text, XStack, YStack } from "tamagui";
import { getScaleAccentColor, getScaleSoftColor, useDesignSystem } from "lib/design-system";
import { getOptionGridItemWidth } from "lib/option-grid";
import { useResponsiveLayout } from "lib/responsive-layout";
import type { InstrumentQuestion, QuestionResponsePayload, QuestionScale } from "lib/audit/types";
import { formatQuestionKeyForDisplay, parsePromptSegments } from "lib/audit/prompt-segments";
import { toggleChecklistOption, setChecklistOtherText } from "lib/audit/checklist-helpers";
import { isMultipleSelectionScale, readMultipleScaleSelection, toggleMultipleScaleOption } from "lib/audit/sociability";
import { ScaleMultiSelect } from "components/playspace-audit/scale-multi-select";

interface QuestionCardProps {
    readonly question: InstrumentQuestion;
    readonly questionIndex: number;
    readonly totalQuestions: number;
    readonly selectedAnswers: QuestionResponsePayload;
    readonly disabled: boolean;
    readonly onChangeAnswers: (questionKey: string, nextAnswers: QuestionResponsePayload) => void;
}

/**
 * Render one playspace question with vertically stacked scales and gated follow-ups.
 *
 * @param props Question rendering props.
 * @returns Styled audit question card.
 */
export function QuestionCard({
    question,
    questionIndex,
    totalQuestions,
    selectedAnswers,
    disabled,
    onChangeAnswers,
}: Readonly<QuestionCardProps>) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    const { t } = useTranslation("audit");
    const provisionScale = question.scales[0];
    const selectedProvisionKey = provisionScale !== undefined ? selectedAnswers[provisionScale.key] : undefined;
    const selectedProvisionOption = provisionScale?.options.find((option) => option.key === selectedProvisionKey);
    const showFollowUpScales = selectedProvisionOption?.allows_follow_up_scales === true;
    const promptSegments = parsePromptSegments(question.prompt);
    const selectedChecklistOptionKeys = readChecklistOptionKeys(selectedAnswers);
    const otherChecklistText = readChecklistOtherText(selectedAnswers);

    return (
        <YStack
            rounded={ds.radii.lg}
            borderWidth={1}
            borderColor={ds.colors.border}
            bg={ds.colors.surface}
            p={layout.cardPadding}
            gap={layout.isTablet ? "$4.5" : "$3.5"}
            style={{
                boxShadow: ds.shadows.card,
            }}
        >
            <XStack justify="space-between" items="center">
                <Text
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.bodySm.fontSize}
                >
                    {`${questionIndex} of ${totalQuestions}`}
                </Text>
                <Text
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodySm.fontSize}
                    textTransform="uppercase"
                    letterSpacing={1.1}
                >
                    {formatQuestionKeyForDisplay(question.question_key)}
                </Text>
            </XStack>
            <Text
                color={ds.colors.foreground}
                fontFamily={ds.fonts.bodyMedium}
                fontSize={layout.isTablet ? ds.typography.titleMd.fontSize : ds.typography.titleSm.fontSize}
                lineHeight={layout.isTablet ? ds.typography.titleMd.lineHeight : ds.typography.titleSm.lineHeight}
            >
                <Text
                    color={ds.colors.secondaryForeground}
                    fontFamily={ds.fonts.bodySemiBold}
                    fontSize={layout.isTablet ? ds.typography.titleSm.fontSize : ds.typography.bodyLg.fontSize}
                >
                    {`${t("thisPlayspace")}\n`}
                </Text>
                {promptSegments.map((segment, index) => (
                    <Fragment key={`${question.question_key}-seg-${index.toString()}`}>
                        <Text
                            fontFamily={segment.bold ? ds.fonts.bodyBold : ds.fonts.bodySemiBold}
                            fontSize={layout.isTablet ? ds.typography.titleMd.fontSize : ds.typography.titleSm.fontSize}
                            color={segment.bold ? ds.colors.primary : ds.colors.foreground}
                        >
                            {segment.text}
                        </Text>
                    </Fragment>
                ))}
            </Text>

            {question.question_type === "checklist" ? (
                <ChecklistSelector
                    question={question}
                    selectedOptionKeys={selectedChecklistOptionKeys}
                    otherText={otherChecklistText}
                    currentAnswers={selectedAnswers}
                    disabled={disabled}
                    onChangeAnswers={onChangeAnswers}
                />
            ) : (
                <>
                    {question.scales.map((scale, scaleIndex) => {
                        if (scaleIndex > 0 && !showFollowUpScales) {
                            return null;
                        }

                        if (isMultipleSelectionScale(scale)) {
                            return (
                                <MultiSelectScaleSurface
                                    key={`${question.question_key}.${scale.key}`}
                                    scale={scale}
                                    selectedOptionKeys={readMultipleScaleSelection(selectedAnswers, scale)}
                                    disabled={disabled}
                                    onToggleOption={(optionKey) => {
                                        onChangeAnswers(
                                            question.question_key,
                                            toggleMultipleScaleOption(selectedAnswers, scale, optionKey),
                                        );
                                    }}
                                />
                            );
                        }

                        return (
                            <ScaleSelector
                                key={`${question.question_key}.${scale.key}`}
                                questionKey={question.question_key}
                                scale={scale}
                                selectedOptionKey={
                                    typeof selectedAnswers[scale.key] === "string"
                                        ? (selectedAnswers[scale.key] as string)
                                        : undefined
                                }
                                disabled={disabled}
                                onChangeAnswers={onChangeAnswers}
                                currentAnswers={selectedAnswers}
                                question={question}
                            />
                        );
                    })}
                </>
            )}

            {question.question_type === "scaled" && question.scales.length > 1 && !showFollowUpScales ? (
                <Paragraph
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodyXs.fontSize}
                >
                    {t("section.followUpHidden")}
                </Paragraph>
            ) : null}

            {question.notes_prompt && (
                <YStack gap="$2">
                    <Text
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.bodySemiBold}
                        fontSize={ds.typography.bodySm.fontSize}
                    >
                        {question.notes_prompt}
                    </Text>
                    <TextInput
                        multiline
                        numberOfLines={4}
                        style={{
                            borderWidth: 1,
                            borderColor: ds.colors.border,
                            borderRadius: ds.radii.md,
                            padding: 12,
                            fontFamily: ds.fonts.bodyRegular,
                            fontSize: ds.typography.bodySm.fontSize,
                            color: ds.colors.foreground,
                            backgroundColor: ds.colors.surface,
                            minHeight: 100,
                        }}
                        placeholder={t("audit.enterComments", "Enter any comments")}
                        placeholderTextColor={ds.colors.mutedForeground}
                        editable={!disabled}
                        value={typeof selectedAnswers.question_note === "string" ? selectedAnswers.question_note : ""}
                        onChangeText={(text) => {
                            onChangeAnswers(question.question_key, {
                                ...selectedAnswers,
                                question_note: text || null,
                            });
                        }}
                    />
                </YStack>
            )}
        </YStack>
    );
}

interface ScaleSelectorProps {
    readonly questionKey: string;
    readonly question: InstrumentQuestion;
    readonly scale: QuestionScale;
    readonly selectedOptionKey: string | undefined;
    readonly currentAnswers: QuestionResponsePayload;
    readonly disabled: boolean;
    readonly onChangeAnswers: (questionKey: string, nextAnswers: QuestionResponsePayload) => void;
}

/**
 * Render one scale selector inside a playspace question card.
 *
 * @param props Scale selector props.
 * @returns Selector surface for one scale.
 */
function ScaleSelector({
    questionKey,
    question,
    scale,
    selectedOptionKey,
    currentAnswers,
    disabled,
    onChangeAnswers,
}: Readonly<ScaleSelectorProps>) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    const isPhone = !layout.isTablet;
    const optionWidth = getOptionGridItemWidth(
        scale.options.length,
        Math.max(...scale.options.map((option) => option.label.length)),
        isPhone,
    );
    const scaleAccent = getScaleAccentColor(scale.key, ds.colors);
    const scaleSoft = getScaleSoftColor(scale.key, ds.colors);
    return (
        <YStack
            rounded={ds.radii.md}
            borderWidth={1}
            borderColor={ds.colors.border}
            bg={ds.colors.input}
            p={layout.isTablet ? 16 : 12}
            gap={layout.isTablet ? "$3" : "$2.5"}
            borderLeftWidth={3}
            borderLeftColor={scaleAccent as ColorTokens}
        >
            <YStack gap="$1">
                <Text
                    color={scaleAccent as ColorTokens}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={layout.isTablet ? ds.typography.titleMd.fontSize : ds.typography.titleSm.fontSize}
                    textTransform="uppercase"
                    letterSpacing={1.2}
                >
                    {scale.title}
                </Text>
                <Paragraph
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyRegular}
                    fontSize={ds.typography.bodySm.fontSize}
                >
                    {scale.prompt}
                </Paragraph>
            </YStack>

            <XStack gap="$2" flexWrap="wrap" justify="space-between">
                {scale.options.map((option) => {
                    const isSelected = selectedOptionKey === option.key;

                    return (
                        <Button
                            key={`${scale.key}.${option.key}`}
                            width={optionWidth}
                            rounded={ds.radii.md}
                            height={layout.isTablet ? layout.formOptionHeight : 52}
                            disabled={disabled}
                            borderWidth={isSelected ? 2 : 1}
                            borderColor={isSelected ? (scaleAccent as ColorTokens) : (ds.colors.border as ColorTokens)}
                            bg={isSelected ? (scaleSoft as ColorTokens) : (ds.colors.surfaceMuted as ColorTokens)}
                            opacity={disabled ? 0.6 : 1}
                            pressStyle={{ opacity: 0.92, scale: 0.985 }}
                            onPress={() => {
                                if (disabled) {
                                    return;
                                }
                                onChangeAnswers(
                                    questionKey,
                                    buildNextScaledQuestionAnswers(currentAnswers, question, scale.key, option.key),
                                );
                            }}
                        >
                            <Text
                                color={
                                    isSelected ? (scaleAccent as ColorTokens) : (ds.colors.foreground as ColorTokens)
                                }
                                fontFamily={isSelected ? ds.fonts.bodyBold : ds.fonts.bodyMedium}
                                fontSize={
                                    layout.isTablet ? ds.typography.bodyMd.fontSize : ds.typography.bodySm.fontSize
                                }
                                numberOfLines={2}
                                style={{ textAlign: "center" }}
                            >
                                {option.label}
                            </Text>
                        </Button>
                    );
                })}
            </XStack>
        </YStack>
    );
}

interface MultiSelectScaleSurfaceProps {
    readonly scale: QuestionScale;
    readonly selectedOptionKeys: readonly string[];
    readonly disabled: boolean;
    readonly onToggleOption: (optionKey: string) => void;
}

/**
 * Frame a multiple-selection scale in the same surface the single-select scales use, so a question
 * that mixes both reads as one consistent card.
 */
function MultiSelectScaleSurface({
    scale,
    selectedOptionKeys,
    disabled,
    onToggleOption,
}: Readonly<MultiSelectScaleSurfaceProps>) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();

    return (
        <YStack
            rounded={ds.radii.md}
            borderWidth={1}
            borderColor={ds.colors.border}
            bg={ds.colors.input}
            p={layout.isTablet ? 16 : 12}
            borderLeftWidth={3}
            borderLeftColor={getScaleAccentColor(scale.key, ds.colors) as ColorTokens}
        >
            <ScaleMultiSelect
                scale={scale}
                selectedOptionKeys={selectedOptionKeys}
                disabled={disabled}
                onToggleOption={onToggleOption}
            />
        </YStack>
    );
}

interface ChecklistSelectorProps {
    readonly question: InstrumentQuestion;
    readonly selectedOptionKeys: readonly string[];
    readonly otherText: string;
    readonly currentAnswers: QuestionResponsePayload;
    readonly disabled: boolean;
    readonly onChangeAnswers: (questionKey: string, nextAnswers: QuestionResponsePayload) => void;
}

function ChecklistSelector({
    question,
    selectedOptionKeys,
    otherText,
    currentAnswers,
    disabled,
    onChangeAnswers,
}: Readonly<ChecklistSelectorProps>) {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    const isPhone = !layout.isTablet;

    return (
        <YStack
            rounded={ds.radii.md}
            borderWidth={1}
            borderColor={ds.colors.border}
            bg={ds.colors.input}
            p={layout.isTablet ? 16 : 12}
            gap={layout.isTablet ? "$3" : "$2.5"}
        >
            <XStack gap="$2" flexWrap="wrap" justify="space-between">
                {question.options.map((option) => {
                    const isSelected = selectedOptionKeys.includes(option.key);

                    return (
                        <Button
                            key={`${question.question_key}.${option.key}`}
                            width={getOptionGridItemWidth(
                                question.options.length,
                                Math.max(...question.options.map((option) => option.label.length)),
                                isPhone,
                            )}
                            rounded={ds.radii.md}
                            height={layout.isTablet ? layout.formOptionHeight : 42}
                            disabled={disabled}
                            borderWidth={isSelected ? 2 : 1}
                            borderColor={
                                isSelected ? (ds.colors.primary as ColorTokens) : (ds.colors.border as ColorTokens)
                            }
                            bg={
                                isSelected
                                    ? (ds.colors.primarySoft as ColorTokens)
                                    : (ds.colors.surfaceMuted as ColorTokens)
                            }
                            opacity={disabled ? 0.6 : 1}
                            pressStyle={{ opacity: 0.92, scale: 0.985 }}
                            onPress={() => {
                                if (disabled) {
                                    return;
                                }
                                onChangeAnswers(
                                    question.question_key,
                                    toggleChecklistOption(selectedOptionKeys, option.key, otherText, currentAnswers),
                                );
                            }}
                        >
                            <Text
                                color={
                                    isSelected
                                        ? (ds.colors.primary as ColorTokens)
                                        : (ds.colors.foreground as ColorTokens)
                                }
                                fontFamily={isSelected ? ds.fonts.bodyBold : ds.fonts.bodyMedium}
                                fontSize={
                                    layout.isTablet ? ds.typography.bodyMd.fontSize : ds.typography.bodySm.fontSize
                                }
                                numberOfLines={2}
                                style={{ textAlign: "center" }}
                            >
                                {option.label}
                            </Text>
                        </Button>
                    );
                })}
            </XStack>
            {selectedOptionKeys.includes("other") ? (
                <TextInput
                    multiline
                    value={otherText}
                    editable={!disabled}
                    onChangeText={(nextText) => {
                        onChangeAnswers(
                            question.question_key,
                            setChecklistOtherText(selectedOptionKeys, nextText, currentAnswers),
                        );
                    }}
                    placeholder="Describe other"
                    placeholderTextColor={ds.colors.placeholderColor}
                    style={{
                        minHeight: layout.isTablet ? 96 : 88,
                        borderRadius: ds.radii.md,
                        borderWidth: 1,
                        borderColor: ds.colors.border,
                        backgroundColor: ds.colors.surface,
                        color: ds.colors.foreground,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        textAlignVertical: "top",
                    }}
                />
            ) : null}
        </YStack>
    );
}

function readChecklistOptionKeys(selectedAnswers: QuestionResponsePayload): string[] {
    const selectedOptionKeys = selectedAnswers["selected_option_keys"];
    if (!Array.isArray(selectedOptionKeys)) {
        return [];
    }

    return selectedOptionKeys.filter((entry): entry is string => typeof entry === "string");
}

function readChecklistOtherText(selectedAnswers: QuestionResponsePayload): string {
    const otherDetails = selectedAnswers["other_details"];
    if (typeof otherDetails !== "object" || otherDetails === null) {
        return "";
    }
    if (!("text" in otherDetails)) {
        return "";
    }

    const text = otherDetails["text"];
    return typeof text === "string" ? text : "";
}

function buildNextScaledQuestionAnswers(
    currentAnswers: QuestionResponsePayload,
    question: InstrumentQuestion,
    scaleKey: string,
    optionKey: string,
): QuestionResponsePayload {
    const nextAnswers: QuestionResponsePayload = {
        ...currentAnswers,
        [scaleKey]: optionKey,
    };

    if (scaleKey !== "provision") {
        return nextAnswers;
    }

    const provisionScale = question.scales.find((currentScale) => currentScale.key === "provision");
    const selectedOption = provisionScale?.options.find((option) => option.key === optionKey);
    if (selectedOption?.allows_follow_up_scales !== false) {
        return nextAnswers;
    }

    const questionNote = typeof currentAnswers.question_note === "string" ? currentAnswers.question_note : null;
    return questionNote === null ? { provision: optionKey } : { provision: optionKey, question_note: questionNote };
}
