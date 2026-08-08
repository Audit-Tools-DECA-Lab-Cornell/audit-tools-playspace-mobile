import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Archive, FileX2, KeyRound, ShieldAlert, Trash2, TriangleAlert, UserMinus } from "@tamagui/lucide-icons-2";
import type { IconProps } from "@tamagui/helpers-icon";
import { useRouter } from "expo-router";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Button, type ColorTokens, Input, Paragraph, Text, XStack, YStack } from "tamagui";
import { AppButton } from "components/ui/app-button";
import { SkeletonBlock } from "components/ui/skeleton";
import { blockReasonCopyKey, isConfirmationWordValid, resolveDeletionGate } from "lib/account/deletion-plan";
import { fetchAccountDeletionPreview } from "lib/account/deletion-api";
import { DELETION_CONFIRMATION_WORD, type AccountDeletionPreview } from "lib/account/deletion-types";
import { PlayspaceAuditApiError } from "lib/audit/api";
import { useDesignSystem, type DesignSystemTheme } from "lib/design-system";
import { createModuleLogger } from "lib/logger";
import { useResponsiveLayout } from "lib/responsive-layout";
import { useAuthStore } from "stores/auth-store";
import { usePlayspaceAuditStore } from "stores/audit-store";

import type { FC } from "react";

const logger = createModuleLogger("settings.delete-account");

type ScreenPhase = "loading" | "unreachable" | "blocked" | "review" | "confirm" | "deleted";

/**
 * Permanent account deletion for the signed-in auditor.
 *
 * Structured as a review step followed by a verification step so the auditor
 * always learns what happens to their audits before they are asked to prove who
 * they are. Deletion is refused outright while finished audits are still on
 * their way to the organisation - the screen explains how to clear that instead
 * of presenting a dead button.
 */
export default function DeleteAccountScreen() {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    const router = useRouter();
    const { t } = useTranslation("settings");

    const session = useAuthStore((state) => state.session);
    const deleteAccount = useAuthStore((state) => state.deleteAccount);
    const isSubmitting = useAuthStore((state) => state.isSubmitting);
    const pendingUploadCount = usePlayspaceAuditStore((state) => state.pendingUploadCount);

    const [preview, setPreview] = useState<AccountDeletionPreview | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(true);
    const [previewFailed, setPreviewFailed] = useState(false);
    const [hasReviewed, setHasReviewed] = useState(false);
    const [currentPassword, setCurrentPassword] = useState("");
    const [confirmationWord, setConfirmationWord] = useState("");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isDeleted, setIsDeleted] = useState(false);

    const loadPreview = useCallback(async (): Promise<void> => {
        if (session === null) {
            return;
        }
        setIsLoadingPreview(true);
        setPreviewFailed(false);
        try {
            setPreview(await fetchAccountDeletionPreview(session));
        } catch (error) {
            logger.error("Failed to load account deletion preview", error instanceof Error ? error.message : "");
            setPreview(null);
            setPreviewFailed(true);
        } finally {
            setIsLoadingPreview(false);
        }
    }, [session]);

    useEffect(() => {
        void loadPreview();
    }, [loadPreview]);

    const gate = useMemo(
        () => (preview === null ? null : resolveDeletionGate({ preview, localPendingUploadCount: pendingUploadCount })),
        [preview, pendingUploadCount],
    );

    const phase = resolvePhase({ isDeleted, isLoadingPreview, previewFailed, gate, hasReviewed });

    const canSubmit =
        !isSubmitting && currentPassword.length > 0 && isConfirmationWordValid(confirmationWord) && phase === "confirm";

    const handleDelete = async (): Promise<void> => {
        if (!canSubmit) {
            return;
        }
        setErrorMessage(null);
        try {
            await deleteAccount(currentPassword);
            setIsDeleted(true);
        } catch (error) {
            // The account still exists and nothing on this device has changed;
            // the message tells the auditor which of those two facts matters.
            setErrorMessage(toDeletionErrorMessage(error, t));
            setCurrentPassword("");
        }
    };

    if (phase === "deleted") {
        return (
            <DeletedNotice
                ds={ds}
                layout={layout}
                title={t("deleteAccount.done.title")}
                message={t("deleteAccount.done.message")}
                actionLabel={t("deleteAccount.done.action")}
                onDone={() => {
                    router.replace("/(auth)/login");
                }}
            />
        );
    }

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 0}
            style={{ flex: 1, backgroundColor: ds.colors.background }}
        >
            <ScrollView
                contentInsetAdjustmentBehavior="automatic"
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{
                    flexGrow: 1,
                    paddingHorizontal: layout.screenPaddingHorizontal,
                    paddingVertical: layout.isTablet ? 48 : 28,
                }}
            >
                <YStack gap="$5" width="100%" style={{ maxWidth: layout.formMaxWidth, alignSelf: "center" }}>
                    <YStack gap="$1">
                        <Text
                            color={ds.colors.foreground}
                            fontFamily={ds.fonts.headingBold}
                            fontSize={
                                layout.isTablet ? ds.typography.displaySm.fontSize : ds.typography.titleMd.fontSize
                            }
                            textTransform="uppercase"
                            fontStyle="italic"
                            accessibilityRole="header"
                        >
                            {t("deleteAccount.title")}
                        </Text>
                        <Paragraph color={ds.colors.mutedForeground} fontFamily={ds.fonts.bodyMedium}>
                            {t("deleteAccount.subtitle")}
                        </Paragraph>
                    </YStack>

                    {phase === "loading" ? <PreviewSkeleton ds={ds} /> : null}

                    {phase === "unreachable" ? (
                        <NoticeCard
                            ds={ds}
                            tone="warning"
                            Icon={TriangleAlert}
                            title={t("deleteAccount.unreachable.title")}
                            message={t("deleteAccount.unreachable.message")}
                        />
                    ) : null}

                    {phase === "blocked" && gate !== null && gate.kind === "blocked" ? (
                        <NoticeCard
                            ds={ds}
                            tone="warning"
                            Icon={TriangleAlert}
                            title={t(`${blockReasonCopyKey(gate.reason)}.title`, {
                                count: gate.pendingUploadCount,
                            })}
                            message={t(`${blockReasonCopyKey(gate.reason)}.message`, {
                                count: gate.pendingUploadCount,
                            })}
                        />
                    ) : null}

                    {phase === "review" && preview !== null ? <ReviewStep ds={ds} preview={preview} t={t} /> : null}

                    {phase === "confirm" ? (
                        <ConfirmStep
                            ds={ds}
                            t={t}
                            currentPassword={currentPassword}
                            confirmationWord={confirmationWord}
                            onCurrentPasswordChange={setCurrentPassword}
                            onConfirmationWordChange={setConfirmationWord}
                            onSubmitEditing={() => {
                                void handleDelete();
                            }}
                        />
                    ) : null}

                    {errorMessage === null ? null : (
                        <YStack
                            borderWidth={1}
                            borderColor={ds.colors.danger}
                            bg={ds.colors.dangerSoft}
                            rounded={ds.radii.md}
                            p="$3"
                        >
                            <Paragraph color={ds.colors.danger} fontFamily={ds.fonts.bodyMedium}>
                                {errorMessage}
                            </Paragraph>
                        </YStack>
                    )}

                    <YStack gap="$2.5">
                        {phase === "unreachable" || phase === "blocked" ? (
                            <AppButton
                                variant="primary"
                                label={t("deleteAccount.actions.checkAgain")}
                                onPress={() => {
                                    void loadPreview();
                                }}
                            />
                        ) : null}

                        {phase === "review" ? (
                            <AppButton
                                variant="destructive"
                                label={t("deleteAccount.actions.continue")}
                                iconLeft={<Trash2 size={16} color={ds.colors.danger} />}
                                onPress={() => {
                                    setErrorMessage(null);
                                    setHasReviewed(true);
                                }}
                            />
                        ) : null}

                        {phase === "confirm" ? (
                            <Button
                                height={56}
                                rounded={ds.radii.md}
                                borderWidth={1}
                                borderColor={ds.colors.danger}
                                bg={canSubmit ? ds.colors.danger : ds.colors.dangerSoft}
                                disabled={!canSubmit}
                                opacity={canSubmit ? 1 : 0.7}
                                pressStyle={{ opacity: 0.92, scale: 0.985 }}
                                onPress={() => {
                                    void handleDelete();
                                }}
                                accessibilityRole="button"
                                accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
                                testID="delete-account-submit"
                            >
                                <Text
                                    color={canSubmit ? ds.colors.background : ds.colors.danger}
                                    fontFamily={ds.fonts.bodyBold}
                                    fontSize={ds.typography.labelLg.fontSize}
                                    numberOfLines={1}
                                >
                                    {isSubmitting
                                        ? t("deleteAccount.actions.deleting")
                                        : t("deleteAccount.actions.delete")}
                                </Text>
                            </Button>
                        ) : null}

                        {phase === "loading" ? null : (
                            <AppButton
                                variant="secondary"
                                label={
                                    phase === "confirm"
                                        ? t("deleteAccount.actions.back")
                                        : t("deleteAccount.actions.keepAccount")
                                }
                                disabled={isSubmitting}
                                onPress={() => {
                                    if (phase === "confirm") {
                                        setHasReviewed(false);
                                        setErrorMessage(null);
                                        setCurrentPassword("");
                                        setConfirmationWord("");
                                        return;
                                    }
                                    router.back();
                                }}
                            />
                        )}
                    </YStack>
                </YStack>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

interface ResolvePhaseArgs {
    readonly isDeleted: boolean;
    readonly isLoadingPreview: boolean;
    readonly previewFailed: boolean;
    readonly gate: ReturnType<typeof resolveDeletionGate> | null;
    readonly hasReviewed: boolean;
}

/**
 * Pick the single state the screen is in. Ordered so a newly discovered blocker
 * always wins over a review the auditor already started.
 */
function resolvePhase({
    isDeleted,
    isLoadingPreview,
    previewFailed,
    gate,
    hasReviewed,
}: ResolvePhaseArgs): ScreenPhase {
    if (isDeleted) {
        return "deleted";
    }
    if (isLoadingPreview) {
        return "loading";
    }
    if (previewFailed || gate === null) {
        return "unreachable";
    }
    if (gate.kind === "blocked") {
        return "blocked";
    }
    return hasReviewed ? "confirm" : "review";
}

/**
 * Turn a failed deletion request into copy that says what happened and what to
 * do next, and never exposes a status code or server code to the auditor.
 */
function toDeletionErrorMessage(error: unknown, t: (key: string) => string): string {
    if (!(error instanceof PlayspaceAuditApiError)) {
        return t("deleteAccount.errors.generic");
    }
    switch (error.statusCode) {
        case 0:
            return t("deleteAccount.errors.offline");
        case 400:
        case 401:
            return t("deleteAccount.errors.wrongPassword");
        case 403:
            return t("deleteAccount.errors.notAllowed");
        case 409:
            return t("deleteAccount.errors.changedSinceReview");
        case 422:
            return t("deleteAccount.errors.confirmationWord");
        default:
            return t("deleteAccount.errors.generic");
    }
}

interface ReviewStepProps {
    readonly ds: DesignSystemTheme;
    readonly preview: AccountDeletionPreview;
    readonly t: TFunction<"settings">;
}

/**
 * Step one: what deleting the account does to the auditor's work, stated in
 * their own terms - kept audits first, so the reassuring fact is read before
 * the losses.
 */
function ReviewStep({ ds, preview, t }: ReviewStepProps) {
    const outcomes: OutcomeRowProps[] = [
        {
            ds,
            Icon: Archive,
            tone: "success",
            title: countCopy(t, "deleteAccount.review.submitted", preview.submitted_audits_preserved),
            description: t("deleteAccount.review.submittedDetail"),
        },
    ];

    if (preview.draft_audits_to_delete > 0) {
        outcomes.push({
            ds,
            Icon: FileX2,
            tone: "danger",
            title: countCopy(t, "deleteAccount.review.drafts", preview.draft_audits_to_delete),
            description: t("deleteAccount.review.draftsDetail"),
        });
    }

    if (preview.active_assignments_to_delete > 0) {
        outcomes.push({
            ds,
            Icon: UserMinus,
            tone: "muted",
            title: countCopy(t, "deleteAccount.review.assignments", preview.active_assignments_to_delete),
            description: t("deleteAccount.review.assignmentsDetail"),
        });
    }

    outcomes.push({
        ds,
        Icon: Trash2,
        tone: "muted",
        title: t("deleteAccount.review.device"),
        description: t("deleteAccount.review.deviceDetail"),
    });

    return (
        <YStack gap="$3">
            <StepLabel ds={ds} label={t("deleteAccount.steps.one")} />
            <YStack
                rounded={ds.radii.lg}
                borderWidth={1}
                borderColor={ds.colors.border}
                bg={ds.colors.surface}
                p="$4"
                gap="$4"
                style={{ boxShadow: ds.shadows.card }}
            >
                {outcomes.map((outcome) => (
                    <OutcomeRow key={outcome.title} {...outcome} />
                ))}
            </YStack>
            <Paragraph
                color={ds.colors.danger}
                fontFamily={ds.fonts.bodyBold}
                fontSize={ds.typography.bodySm.fontSize}
                px="$1"
            >
                {t("deleteAccount.review.permanent")}
            </Paragraph>
        </YStack>
    );
}

interface ConfirmStepProps {
    readonly ds: DesignSystemTheme;
    readonly t: TFunction<"settings">;
    readonly currentPassword: string;
    readonly confirmationWord: string;
    readonly onCurrentPasswordChange: (value: string) => void;
    readonly onConfirmationWordChange: (value: string) => void;
    readonly onSubmitEditing: () => void;
}

/**
 * Step two: prove it is really the account holder, and type the confirmation
 * word so the final tap cannot be a slip.
 */
function ConfirmStep({
    ds,
    t,
    currentPassword,
    confirmationWord,
    onCurrentPasswordChange,
    onConfirmationWordChange,
    onSubmitEditing,
}: ConfirmStepProps) {
    const typedSomething = confirmationWord.trim().length > 0;
    const confirmationMatches = isConfirmationWordValid(confirmationWord);

    return (
        <YStack gap="$3">
            <StepLabel ds={ds} label={t("deleteAccount.steps.two")} />

            <YStack gap="$2">
                <FieldLabel ds={ds} label={t("deleteAccount.confirm.passwordLabel")} />
                <XStack
                    items="center"
                    gap="$3"
                    px="$4"
                    height={56}
                    rounded={ds.radii.md}
                    borderWidth={1}
                    borderColor={ds.colors.border}
                    bg={ds.colors.input}
                >
                    <KeyRound size={18} color={ds.colors.mutedForeground} />
                    <Input
                        unstyled
                        flex={1}
                        value={currentPassword}
                        onChangeText={onCurrentPasswordChange}
                        autoCapitalize="none"
                        autoCorrect={false}
                        textContentType="password"
                        secureTextEntry
                        placeholder={t("deleteAccount.confirm.passwordPlaceholder")}
                        placeholderTextColor={ds.colors.placeholderColor as ColorTokens}
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={ds.typography.titleSm.fontSize}
                        returnKeyType="next"
                        testID="delete-account-password"
                    />
                </XStack>
            </YStack>

            <YStack gap="$2">
                <FieldLabel ds={ds} label={t("deleteAccount.confirm.wordLabel")} />
                <Paragraph
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodySm.fontSize}
                    px="$1"
                >
                    {t("deleteAccount.confirm.wordHint", { word: DELETION_CONFIRMATION_WORD })}
                </Paragraph>
                <XStack
                    items="center"
                    gap="$3"
                    px="$4"
                    height={56}
                    rounded={ds.radii.md}
                    borderWidth={1}
                    borderColor={
                        typedSomething && !confirmationMatches
                            ? ds.colors.danger
                            : confirmationMatches
                              ? ds.colors.success
                              : ds.colors.border
                    }
                    bg={ds.colors.input}
                >
                    <ShieldAlert size={18} color={ds.colors.mutedForeground} />
                    <Input
                        unstyled
                        flex={1}
                        value={confirmationWord}
                        onChangeText={onConfirmationWordChange}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        autoComplete="off"
                        placeholder={DELETION_CONFIRMATION_WORD}
                        placeholderTextColor={ds.colors.placeholderColor as ColorTokens}
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.monoBold}
                        fontSize={ds.typography.titleSm.fontSize}
                        returnKeyType="done"
                        onSubmitEditing={onSubmitEditing}
                        testID="delete-account-confirmation"
                    />
                </XStack>
                {typedSomething && !confirmationMatches ? (
                    <Paragraph
                        color={ds.colors.danger}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={ds.typography.bodySm.fontSize}
                        px="$1"
                    >
                        {t("deleteAccount.confirm.wordMismatch", { word: DELETION_CONFIRMATION_WORD })}
                    </Paragraph>
                ) : null}
            </YStack>
        </YStack>
    );
}

interface DeletedNoticeProps {
    readonly ds: DesignSystemTheme;
    readonly layout: ReturnType<typeof useResponsiveLayout>;
    readonly title: string;
    readonly message: string;
    readonly actionLabel: string;
    readonly onDone: () => void;
}

/**
 * Terminal confirmation. The only way forward is back to sign-in - the account
 * this screen belonged to no longer exists.
 */
function DeletedNotice({ ds, layout, title, message, actionLabel, onDone }: DeletedNoticeProps) {
    return (
        <YStack
            flex={1}
            bg={ds.colors.background}
            justify="center"
            px={layout.screenPaddingHorizontal}
            gap="$5"
            testID="delete-account-done"
        >
            <YStack gap="$3" width="100%" style={{ maxWidth: layout.formMaxWidth, alignSelf: "center" }}>
                <Text
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.headingBold}
                    fontSize={ds.typography.titleMd.fontSize}
                    accessibilityRole="header"
                >
                    {title}
                </Text>
                <Paragraph color={ds.colors.mutedForeground} fontFamily={ds.fonts.bodyMedium}>
                    {message}
                </Paragraph>
                <AppButton variant="primary" label={actionLabel} onPress={onDone} />
            </YStack>
        </YStack>
    );
}

interface OutcomeRowProps {
    readonly ds: DesignSystemTheme;
    readonly Icon: FC<IconProps>;
    readonly tone: "success" | "danger" | "muted";
    readonly title: string;
    readonly description: string;
}

/** One consequence of deleting, with a tone that matches whether it is a loss. */
function OutcomeRow({ ds, Icon, tone, title, description }: OutcomeRowProps) {
    const accent = tone === "success" ? ds.colors.success : tone === "danger" ? ds.colors.danger : ds.colors.primary;

    return (
        <XStack gap="$3" items="flex-start">
            <YStack pt="$0.5">
                <Icon size={18} color={accent} />
            </YStack>
            <YStack flex={1} gap="$1">
                <Text
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.bodyMd.fontSize}
                    lineHeight={ds.typography.bodyMd.lineHeight}
                >
                    {title}
                </Text>
                <Paragraph
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodySm.fontSize}
                >
                    {description}
                </Paragraph>
            </YStack>
        </XStack>
    );
}

interface NoticeCardProps {
    readonly ds: DesignSystemTheme;
    readonly tone: "warning";
    readonly Icon: FC<IconProps>;
    readonly title: string;
    readonly message: string;
}

/** Full-width explanation used when deletion cannot go ahead right now. */
function NoticeCard({ ds, Icon, title, message }: NoticeCardProps) {
    return (
        <YStack
            rounded={ds.radii.lg}
            borderWidth={1}
            borderColor={ds.colors.warning}
            bg={ds.colors.warningSoft}
            p="$4"
            gap="$2"
            testID="delete-account-blocked"
        >
            <XStack items="center" gap="$2">
                <Icon size={18} color={ds.colors.warning} />
                <Text
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.bodyMd.fontSize}
                    flex={1}
                >
                    {title}
                </Text>
            </XStack>
            <Paragraph color={ds.colors.mutedForeground} fontFamily={ds.fonts.bodyMedium}>
                {message}
            </Paragraph>
        </YStack>
    );
}

/** Uppercase step marker so the auditor always knows where they are (1 of 2). */
function StepLabel({ ds, label }: { readonly ds: DesignSystemTheme; readonly label: string }) {
    return (
        <Text
            color={ds.colors.primary}
            fontFamily={ds.fonts.bodyBold}
            fontSize={ds.typography.labelMd.fontSize}
            textTransform="uppercase"
            letterSpacing={1.4}
            px="$1"
        >
            {label}
        </Text>
    );
}

function FieldLabel({ ds, label }: { readonly ds: DesignSystemTheme; readonly label: string }) {
    return (
        <Paragraph
            color={ds.colors.mutedForeground}
            fontFamily={ds.fonts.bodyBold}
            fontSize={ds.typography.labelMd.fontSize}
            textTransform="uppercase"
            letterSpacing={1.5}
            px="$1"
        >
            {label}
        </Paragraph>
    );
}

/** Placeholder shaped like the review card, so the layout does not jump. */
function PreviewSkeleton({ ds }: { readonly ds: DesignSystemTheme }) {
    return (
        <YStack
            rounded={ds.radii.lg}
            borderWidth={1}
            borderColor={ds.colors.border}
            bg={ds.colors.surface}
            p="$4"
            gap="$4"
        >
            <SkeletonBlock width="72%" height={20} rounded={ds.radii.sm} />
            <SkeletonBlock width="94%" height={20} rounded={ds.radii.sm} />
            <SkeletonBlock width="60%" height={20} rounded={ds.radii.sm} />
        </YStack>
    );
}

/**
 * Resolve a singular/plural variant by count. The app keeps explicit `One` and
 * `Other` keys rather than i18next plural suffixes so every locale file holds
 * exactly the same key set.
 */
function countCopy(t: TFunction<"settings">, baseKey: string, count: number): string {
    return t(`${baseKey}${count === 1 ? "One" : "Other"}`, { count });
}
