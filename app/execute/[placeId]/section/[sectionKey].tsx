import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ScrollView, TextInput } from "react-native";
import { type Href, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { ArrowLeft, ArrowRight, LayoutDashboard } from "@tamagui/lucide-icons-2";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Paragraph, Text, XStack, YStack } from "tamagui";
import { AppButton, buttonForegroundColor } from "components/ui/app-button";
import { AuditHeaderTitle } from "components/ui/audit-header-title";
import { LoggedInAsNotice } from "components/ui/logged-in-as-notice";
import { CenteredMessageCard } from "components/ui/centered-message-card";
import { useConfirm } from "components/ui/confirm-dialog";
import { QuestionCard } from "components/playspace-audit/question-card";
import { SectionQuestionTable } from "components/playspace-audit/section-question-table";
import {
    buildFinalCommentsRoute,
    buildHomeRoute,
    buildSectionOverviewRoute,
    buildSectionRoute,
    getNextSection,
    getPreviousSection,
} from "lib/audit/section-navigation";
import { canEditAuditInputs, shouldPersistCleanupWrite } from "lib/audit/store-sync-core";
import { useDesignSystem } from "lib/design-system";
import { useThemedHeaderOptions } from "lib/ui/themed-header";
import { getProjectPlaceKey } from "lib/audit/pair-key";
import {
    getQuestionAnswers,
    getSectionNote,
    getVisibleSections,
    isInstrumentQuestionComplete,
} from "lib/audit/selectors";
import { toggleMultipleScaleOption } from "lib/audit/sociability";
import type {
    AuditSession,
    ExecutionMode,
    InstrumentSection,
    PlayspaceInstrument,
    QuestionResponsePayload,
    QuestionScale,
} from "lib/audit/types";
import { useLocalizedInstrument } from "lib/i18n/instrument-translations";
import { getResponsiveContentContainerStyle, useResponsiveLayout } from "lib/responsive-layout";
import { useScreenshotScrollAutomation } from "lib/screenshot-automation";
import { requestImmediateAuditSync } from "lib/audit/use-audit-sync";
import { useAuthStore } from "stores/auth-store";
import { usePlayspaceAuditStore } from "stores/audit-store";
import { parsePromptSegments } from "lib/audit/prompt-segments";

/**
 * One section page.
 *
 * Answers are written directly to the Zustand store on every tap so they
 * persist across navigation and survive app restarts.  The store debounces
 * disk writes; foreground sync batches API pushes about 1.5–2s after edits,
 * with extra flushes on note blur, section change, and app background.
 *
 * The section note is kept in local state for responsive typing and flushed
 * to the store on blur, explicit save, or component unmount.
 */
export default function ExecuteSectionScreen() {
    const ds = useDesignSystem();
    const layout = useResponsiveLayout();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation();
    const router = useRouter();
    const { t } = useTranslation(["audit", "common"]);
    const requestConfirm = useConfirm();
    const params = useLocalSearchParams<{
        placeId?: string | string[];
        projectId?: string | string[];
        sectionKey?: string | string[];
    }>();
    const authSession = useAuthStore((state) => state.session);
    const hydrate = usePlayspaceAuditStore((state) => state.hydrate);
    const currentUserId = usePlayspaceAuditStore((state) => state.currentUserId);
    const ensurePlaceAudit = usePlayspaceAuditStore((state) => state.ensurePlaceAudit);
    const applyLocalQuestionAnswer = usePlayspaceAuditStore((state) => state.applyLocalQuestionAnswer);
    const applyLocalSectionNote = usePlayspaceAuditStore((state) => state.applyLocalSectionNote);
    const isSavingDraft = usePlayspaceAuditStore((state) => state.isSavingDraft);
    const sessionsByPairKey = usePlayspaceAuditStore((state) => state.sessionsByPairKey);
    const syncStateByAuditId = usePlayspaceAuditStore((state) => state.syncStateByAuditId);
    const isHydrated = usePlayspaceAuditStore((state) => state.isHydrated);
    const errorMessage = usePlayspaceAuditStore((state) => state.errorMessage);
    const dirtySections = usePlayspaceAuditStore((state) => state.dirtySections);

    const placeId = readSingleParam(params.placeId);
    const projectId = readSingleParam(params.projectId);
    const sectionKey = readSingleParam(params.sectionKey);
    const pairKey = placeId === null || projectId === null ? null : getProjectPlaceKey(projectId, placeId);
    const auditSession = pairKey === null ? undefined : sessionsByPairKey[pairKey];
    const instrument = useLocalizedInstrument(auditSession?.instrument);

    const visibleSections = getVisibleSectionsStable(instrument!, auditSession);

    const activeSection =
        sectionKey === null ? undefined : visibleSections.find((section) => section.section_key === sectionKey);

    const [localNote, setLocalNote] = useState("");
    const [isNoteFocused, setIsNoteFocused] = useState(false);
    const [hasPreparingTimedOut, setHasPreparingTimedOut] = useState(false);
    const [preparingRetryNonce, setPreparingRetryNonce] = useState(0);
    const localNoteRef = useRef("");
    const noteInitializedRef = useRef(false);
    const latestAuditSessionRef = useRef<AuditSession | undefined>(auditSession);
    const canEditInputsRef = useRef(false);
    const scrollViewRef = useRef<ScrollView | null>(null);
    const [scrollLayoutVersion, setScrollLayoutVersion] = useState(0);

    const themedHeaderOptions = useThemedHeaderOptions();

    useEffect(() => {
        hydrate(authSession?.user.id ?? null).catch(() => undefined);
    }, [authSession, hydrate]);

    useEffect(() => {
        if (
            !isHydrated ||
            authSession === null ||
            currentUserId !== authSession.user.id ||
            placeId === null ||
            projectId === null
        ) {
            return;
        }
        ensurePlaceAudit(authSession, projectId, placeId).catch(() => undefined);
    }, [authSession, currentUserId, ensurePlaceAudit, isHydrated, placeId, projectId]);

    useEffect(() => {
        noteInitializedRef.current = false;
    }, [activeSection?.section_key, auditSession?.audit_id]);

    const canEditInputs =
        auditSession !== undefined &&
        canEditAuditInputs({
            session: auditSession,
            phase: syncStateByAuditId[auditSession.audit_id]?.phase,
        });

    useEffect(() => {
        latestAuditSessionRef.current = auditSession;
    }, [auditSession]);

    useEffect(() => {
        canEditInputsRef.current = canEditInputs;
    }, [canEditInputs]);

    useEffect(() => {
        if (noteInitializedRef.current || auditSession === undefined || activeSection === undefined) {
            return;
        }
        const storedNote = getSectionNote(auditSession, activeSection.section_key);
        setLocalNote(storedNote);
        localNoteRef.current = storedNote;
        noteInitializedRef.current = true;
    }, [auditSession, activeSection]);

    const flushNoteToStore = useCallback(() => {
        const latestAuditSession = latestAuditSessionRef.current;
        if (
            pairKey === null ||
            sectionKey === null ||
            latestAuditSession === undefined ||
            !noteInitializedRef.current ||
            !canEditInputsRef.current
        ) {
            return;
        }

        if (
            !shouldPersistCleanupWrite({
                currentValue: getSectionNote(latestAuditSession, sectionKey),
                nextValue: localNoteRef.current,
            })
        ) {
            return;
        }

        applyLocalSectionNote(pairKey, sectionKey, localNoteRef.current);
    }, [pairKey, sectionKey, applyLocalSectionNote]);

    useEffect(() => {
        return () => {
            flushNoteToStore();
            requestImmediateAuditSync("section_change");
        };
    }, [sectionKey, flushNoteToStore]);

    const handleNoteChange = useCallback((text: string) => {
        setLocalNote(text);
        localNoteRef.current = text;
    }, []);

    const handleReturnHome = useCallback(() => {
        flushNoteToStore();
        requestImmediateAuditSync("section_change");
        router.replace(buildHomeRoute() as Href);
    }, [flushNoteToStore, router]);

    useLayoutEffect(() => {
        // Single setOptions per render: the localized fallback title always
        // applies so the header never shows the raw route slug (G1), and the
        // data-driven headerTitle/headerRight merge in once data resolves.
        navigation.setOptions({
            ...themedHeaderOptions,
            animation: "ios_from_right",
            title: t("stack.sectionFallback", { ns: "audit" }),
            ...(activeSection === undefined
                ? {}
                : {
                      headerTitle: () => (
                          <AuditHeaderTitle
                              primary={auditSession?.place_name ?? ""}
                              secondary={t("section.headerSecondary", {
                                  ns: "audit",
                                  title: activeSection.title,
                              })}
                          />
                      ),
                      headerRight: () => (
                          <Button
                              chromeless
                              onPress={handleReturnHome}
                              accessibilityLabel={t("tabs.home", { ns: "common" })}
                          >
                              <XStack gap="$1.5" items="center">
                                  <LayoutDashboard size={16} color={ds.colors.primary} />
                                  <Text
                                      color={ds.colors.primary}
                                      fontFamily={ds.fonts.bodyBold}
                                      fontSize={ds.typography.labelSm.fontSize}
                                      textTransform="uppercase"
                                      letterSpacing={1}
                                  >
                                      {t("tabs.home", { ns: "common" })}
                                  </Text>
                              </XStack>
                          </Button>
                      ),
                  }),
        });
    }, [themedHeaderOptions, navigation, activeSection, auditSession, handleReturnHome, t, ds]);

    const scrollSectionToOffset = useCallback((offset: number) => {
        scrollViewRef.current?.scrollTo({ animated: false, x: 0, y: offset });
    }, []);
    const handleScreenshotContentSizeChange = useCallback(() => {
        setScrollLayoutVersion((value) => value + 1);
    }, []);

    useScreenshotScrollAutomation({
        contentReady: auditSession !== undefined && activeSection !== undefined,
        rerunKey: `${auditSession?.audit_id ?? "pending"}:${activeSection?.section_key ?? "none"}:${scrollLayoutVersion}`,
        scrollToOffset: scrollSectionToOffset,
    });

    const hasPendingLocalChanges =
        auditSession !== undefined && Object.keys(dirtySections[auditSession.audit_id] ?? {}).length > 0;

    // "Preparing Section" must never spin forever (G2): after a timeout the
    // wait state gains explicit Retry and Back exits. Sync itself is never
    // aborted - retry only re-requests the audit session.
    const isWaitingForAuditData =
        placeId !== null &&
        projectId !== null &&
        sectionKey !== null &&
        authSession !== null &&
        errorMessage === null &&
        (currentUserId !== authSession.user.id || auditSession === undefined || activeSection === undefined);

    useEffect(() => {
        if (!isWaitingForAuditData) {
            setHasPreparingTimedOut(false);
            return;
        }
        const timer = setTimeout(() => {
            setHasPreparingTimedOut(true);
        }, SECTION_PREPARING_TIMEOUT_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [isWaitingForAuditData, preparingRetryNonce]);

    const handlePreparingRetry = useCallback(() => {
        setHasPreparingTimedOut(false);
        setPreparingRetryNonce((value) => value + 1);
        if (authSession !== null && projectId !== null && placeId !== null) {
            hydrate(authSession.user.id).catch(() => undefined);
            ensurePlaceAudit(authSession, projectId, placeId).catch(() => undefined);
        }
    }, [authSession, ensurePlaceAudit, hydrate, placeId, projectId]);

    const handlePreparingBack = useCallback(() => {
        if (router.canGoBack()) {
            router.back();
            return;
        }
        router.replace(buildHomeRoute() as Href);
    }, [router]);

    if (
        placeId === null ||
        projectId === null ||
        pairKey === null ||
        sectionKey === null ||
        authSession === null ||
        currentUserId !== authSession.user.id ||
        auditSession === undefined ||
        activeSection === undefined
    ) {
        if (
            placeId !== null &&
            projectId !== null &&
            pairKey !== null &&
            sectionKey !== null &&
            authSession !== null &&
            errorMessage !== null
        ) {
            return (
                <CenteredMessageCard
                    title={
                        errorMessage.includes("403")
                            ? t("overview.accessDeniedTitle", { ns: "audit" })
                            : t("section.unavailableTitle", { ns: "audit" })
                    }
                    message={errorMessage}
                    actionLabel={t("actions.retry", { ns: "common" })}
                    onAction={() => {
                        ensurePlaceAudit(authSession, projectId, placeId).catch(() => undefined);
                    }}
                />
            );
        }

        if (hasPreparingTimedOut) {
            return (
                <CenteredMessageCard
                    title={t("section.stillPreparingTitle", { ns: "audit" })}
                    message={t("section.stillPreparingMessage", { ns: "audit" })}
                    actionLabel={t("actions.retry", { ns: "common" })}
                    onAction={handlePreparingRetry}
                    secondaryActionLabel={t("actions.back", { ns: "common" })}
                    onSecondaryAction={handlePreparingBack}
                />
            );
        }

        return (
            <CenteredMessageCard
                title={t("section.preparingTitle", { ns: "audit" })}
                message={t("section.preparingMessage", { ns: "audit" })}
            />
        );
    }

    const resolvedPlaceId = placeId;
    const resolvedProjectId = projectId;
    const resolvedPairKey = pairKey;
    const resolvedAuditSession = auditSession;
    const resolvedActiveSection = activeSection;
    const sectionInstructionsPromptSegments = parsePromptSegments(
        resolvedActiveSection.description ?? resolvedActiveSection.instruction,
    );
    const nextSection = getNextSection(visibleSections, resolvedActiveSection.section_key);
    const previousSection = getPreviousSection(visibleSections, resolvedActiveSection.section_key);
    const activeSectionNumber =
        visibleSections.findIndex((s) => s.section_key === resolvedActiveSection.section_key) + 1;
    const questionByKey = new Map(resolvedActiveSection.questions.map((question) => [question.question_key, question]));
    const questionRows = resolvedActiveSection.questions.map((question) => {
        return {
            question,
            selectedAnswers: getQuestionAnswers(
                resolvedAuditSession,
                resolvedActiveSection.section_key,
                question.question_key,
            ),
        };
    });
    const proceedToNextStep = async (): Promise<void> => {
        if (nextSection !== undefined) {
            router.replace(buildSectionRoute(resolvedPlaceId, resolvedProjectId, nextSection.section_key) as Href);
            return;
        }
        router.push(
            buildFinalCommentsRoute(resolvedPlaceId, resolvedProjectId, resolvedActiveSection.section_key) as Href,
        );
    };

    const handlePrimaryAction = async (): Promise<void> => {
        flushNoteToStore();

        const unansweredQuestions = resolvedActiveSection.questions.filter((question) => {
            if (!question.required) {
                return false;
            }
            const answers = getQuestionAnswers(
                resolvedAuditSession,
                resolvedActiveSection.section_key,
                question.question_key,
            );
            return !isInstrumentQuestionComplete(question, answers);
        });

        if (unansweredQuestions.length > 0) {
            const shouldContinue = await requestConfirm({
                title: t("section.incompleteTitle", { ns: "audit" }),
                message: t("section.incompleteMessage", { ns: "audit" }),
                listLabel: t("section.incompleteListLabel", { ns: "audit" }),
                items: unansweredQuestions.map((q) => formatQuestionKey(q.question_key)),
                confirmLabel: t("section.incompleteConfirmContinue", { ns: "audit" }),
                cancelLabel: t("section.incompleteGoBack", { ns: "audit" }),
            });

            if (!shouldContinue) {
                return;
            }
        }

        await proceedToNextStep();
    };

    const handleSelectAnswer = (
        question: InstrumentSection["questions"][number],
        questionKey: string,
        scaleKey: string,
        optionKey: string,
    ) => {
        if (!canEditInputs) {
            return;
        }

        const currentAnswers = getQuestionAnswers(resolvedAuditSession, resolvedActiveSection.section_key, questionKey);
        const nextAnswers = buildNextQuestionAnswers(currentAnswers, question, scaleKey, optionKey);
        applyLocalQuestionAnswer(resolvedPairKey, resolvedActiveSection.section_key, questionKey, nextAnswers);
    };

    const handleToggleMultipleOption = (
        question: InstrumentSection["questions"][number],
        questionKey: string,
        scaleKey: string,
        optionKey: string,
    ) => {
        if (!canEditInputs) {
            return;
        }

        const scale = question.scales.find((currentScale) => currentScale.key === scaleKey);
        if (scale === undefined) {
            return;
        }

        const currentAnswers = getQuestionAnswers(resolvedAuditSession, resolvedActiveSection.section_key, questionKey);
        const nextAnswers = toggleMultipleScaleOption(currentAnswers, scale, optionKey);
        applyLocalQuestionAnswer(resolvedPairKey, resolvedActiveSection.section_key, questionKey, nextAnswers);
    };
    const notesPanel = (
        <YStack
            rounded={ds.radii.lg}
            borderWidth={1}
            borderColor={ds.colors.border}
            bg={ds.colors.surface}
            p={layout.cardPadding}
            gap="$3"
            style={{ boxShadow: ds.shadows.card }}
        >
            <Text
                color={ds.colors.foreground}
                fontFamily={ds.fonts.bodyBold}
                fontSize={ds.typography.titleMd.fontSize}
                lineHeight={ds.typography.titleMd.lineHeight}
            >
                {t("section.sectionNotes", { ns: "audit" })}
            </Text>
            <Paragraph
                color={ds.colors.mutedForeground}
                fontFamily={ds.fonts.bodyMedium}
                fontSize={ds.typography.bodyLg.fontSize}
                lineHeight={ds.typography.bodyLg.lineHeight}
                marginBlockEnd={4}
            >
                {resolvedActiveSection.notes_prompt ?? t("section.notesDefault", { ns: "audit" })}
            </Paragraph>
            <TextInput
                multiline
                value={localNote}
                onChangeText={handleNoteChange}
                editable={canEditInputs}
                onFocus={() => {
                    setIsNoteFocused(true);
                }}
                onBlur={() => {
                    setIsNoteFocused(false);
                    flushNoteToStore();
                    requestImmediateAuditSync("blur");
                }}
                placeholder={t("section.notesPlaceholder", { ns: "audit" })}
                placeholderTextColor={ds.colors.placeholderColor}
                style={{
                    minHeight: layout.isTablet && isNoteFocused ? 200 : 120,
                    borderRadius: ds.radii.md,
                    borderWidth: 1,
                    borderColor: ds.colors.border,
                    backgroundColor: ds.colors.input,
                    color: ds.colors.foreground,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    textAlignVertical: "top",
                }}
            />
        </YStack>
    );
    const answeredQuestionCount = questionRows.filter(({ question, selectedAnswers }) =>
        isInstrumentQuestionComplete(question, selectedAnswers),
    ).length;
    const isPrimaryActionDisabled = isSavingDraft || (!canEditInputs && nextSection === undefined);

    // Sticky footer: answers autosave on tap, so navigation reads as plain
    // Previous/Next instead of "save and ..." phrasing. A slim status line
    // carries the live answered counter and the jump back to the overview.
    const actionFooter = (
        <YStack
            bg={ds.colors.surface}
            borderTopWidth={1}
            borderTopColor={ds.colors.border}
            px={layout.screenPaddingHorizontal}
            pt="$2"
            gap="$2"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
            <XStack items="center" justify="space-between">
                <Text
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodySm.fontSize}
                >
                    {t("section.answeredCount", {
                        ns: "audit",
                        answered: answeredQuestionCount,
                        total: questionRows.length,
                    })}
                </Text>
                <AppButton
                    label={t("section.backToOverview", { ns: "audit" })}
                    variant="tertiary"
                    size="compact"
                    onPress={() => {
                        flushNoteToStore();
                        router.replace(buildSectionOverviewRoute(resolvedPlaceId, resolvedProjectId) as Href);
                    }}
                />
            </XStack>
            <XStack gap="$2" items="stretch">
                <AppButton
                    label={t("section.previousSection", { ns: "audit", defaultValue: "Previous" })}
                    variant="secondary"
                    disabled={previousSection === undefined}
                    iconLeft={
                        <ArrowLeft
                            size={16}
                            color={buttonForegroundColor("secondary", ds.colors, previousSection === undefined)}
                        />
                    }
                    flex={1}
                    onPress={() => {
                        if (previousSection === undefined) {
                            return;
                        }
                        flushNoteToStore();
                        router.replace(
                            buildSectionRoute(resolvedPlaceId, resolvedProjectId, previousSection.section_key) as Href,
                        );
                    }}
                />
                <AppButton
                    label={
                        isSavingDraft
                            ? t("section.uploadingShort", { ns: "audit" })
                            : nextSection === undefined
                              ? t("section.finalCommentsCta", { ns: "audit" })
                              : t("section.saveAndNext", { ns: "audit" })
                    }
                    variant="primary"
                    disabled={isPrimaryActionDisabled}
                    iconRight={
                        <ArrowRight
                            size={16}
                            color={buttonForegroundColor("primary", ds.colors, isPrimaryActionDisabled)}
                        />
                    }
                    flex={2}
                    onPress={() => {
                        void handlePrimaryAction();
                    }}
                />
            </XStack>
        </YStack>
    );

    return (
        <YStack flex={1} bg={ds.colors.background}>
            <ScrollView
                ref={scrollViewRef}
                onContentSizeChange={handleScreenshotContentSizeChange}
                contentInsetAdjustmentBehavior="automatic"
                automaticallyAdjustKeyboardInsets
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                style={{ flex: 1, backgroundColor: ds.colors.background }}
                contentContainerStyle={getResponsiveContentContainerStyle(layout, {
                    bottomPadding: 32,
                    gap: layout.sectionGap,
                    includeTopPadding: false,
                })}
            >
                <LoggedInAsNotice />
                {/* Long-form intro text is capped at a readable measure (G9). */}
                <YStack gap="$3" style={{ maxWidth: layout.readableMaxWidth }}>
                    <Text
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.headingBold}
                        fontSize={layout.isTablet ? ds.typography.displayLg.fontSize : ds.typography.displayMd.fontSize}
                        lineHeight={
                            layout.isTablet ? ds.typography.displayLg.lineHeight : ds.typography.displayMd.lineHeight
                        }
                    >
                        {`${activeSectionNumber}. ${resolvedActiveSection.title}`}
                    </Text>
                    <Paragraph
                        color={ds.colors.mutedForeground}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={ds.typography.bodyLg.fontSize}
                        lineHeight={ds.typography.bodyLg.lineHeight}
                    >
                        {sectionInstructionsPromptSegments.map((segment, index) => (
                            <Fragment key={`${resolvedActiveSection.section_key}-seg-${index.toString()}`}>
                                <Text
                                    fontFamily={segment.bold ? ds.fonts.bodyBold : ds.fonts.bodyRegular}
                                    lineHeight={
                                        segment.bold
                                            ? ds.typography.titleMd.lineHeight
                                            : ds.typography.titleSm.lineHeight
                                    }
                                    fontSize={
                                        layout.isTablet
                                            ? ds.typography.titleMd.fontSize
                                            : ds.typography.titleSm.fontSize
                                    }
                                    color={segment.bold ? ds.colors.primary : ds.colors.foreground}
                                >
                                    {segment.text}
                                </Text>
                            </Fragment>
                        ))}
                    </Paragraph>
                </YStack>

                {layout.isTablet &&
                !resolvedActiveSection.questions.some((question) => question.question_type === "checklist") ? (
                    <YStack gap="$3">
                        <SectionQuestionTable
                            rows={questionRows}
                            disabled={!canEditInputs}
                            onSelectAnswer={(questionKey, scaleKey, optionKey) => {
                                const question = questionByKey.get(questionKey);
                                if (question === undefined) {
                                    return;
                                }
                                handleSelectAnswer(question, questionKey, scaleKey, optionKey);
                            }}
                            onToggleMultipleOption={(questionKey, scaleKey, optionKey) => {
                                const question = questionByKey.get(questionKey);
                                if (question === undefined) {
                                    return;
                                }
                                handleToggleMultipleOption(question, questionKey, scaleKey, optionKey);
                            }}
                            onChangeAnswers={(questionKey, nextAnswers) => {
                                if (!canEditInputs) {
                                    return;
                                }
                                applyLocalQuestionAnswer(
                                    resolvedPairKey,
                                    resolvedActiveSection.section_key,
                                    questionKey,
                                    nextAnswers,
                                );
                            }}
                        />
                        {hasPendingLocalChanges ? (
                            <Paragraph
                                color={ds.colors.mutedForeground}
                                fontFamily={ds.fonts.bodyMedium}
                                fontSize={ds.typography.bodySm.fontSize}
                            >
                                {t("section.pendingSync", { ns: "audit" })}
                            </Paragraph>
                        ) : null}
                        {errorMessage === null ? null : (
                            <Paragraph
                                color={ds.colors.warning}
                                fontFamily={ds.fonts.bodyMedium}
                                fontSize={ds.typography.bodySm.fontSize}
                                lineHeight={ds.typography.bodySm.lineHeight}
                            >
                                {errorMessage}
                            </Paragraph>
                        )}
                        {notesPanel}
                    </YStack>
                ) : (
                    <YStack gap="$3">
                        <YStack gap="$3">
                            {questionRows.map(({ question, selectedAnswers }, index) => (
                                <QuestionCard
                                    key={question.question_key}
                                    question={question}
                                    questionIndex={index + 1}
                                    totalQuestions={questionRows.length}
                                    selectedAnswers={selectedAnswers}
                                    disabled={!canEditInputs}
                                    onChangeAnswers={(questionKey, nextAnswers) => {
                                        if (!canEditInputs) {
                                            return;
                                        }
                                        applyLocalQuestionAnswer(
                                            resolvedPairKey,
                                            resolvedActiveSection.section_key,
                                            questionKey,
                                            nextAnswers,
                                        );
                                    }}
                                />
                            ))}
                        </YStack>
                        {hasPendingLocalChanges ? (
                            <Paragraph
                                color={ds.colors.mutedForeground}
                                fontFamily={ds.fonts.bodyMedium}
                                fontSize={ds.typography.bodySm.fontSize}
                            >
                                {t("section.pendingSync", { ns: "audit" })}
                            </Paragraph>
                        ) : null}
                        {errorMessage === null ? null : (
                            <Paragraph
                                color={ds.colors.warning}
                                fontFamily={ds.fonts.bodyMedium}
                                fontSize={ds.typography.bodySm.fontSize}
                                lineHeight={ds.typography.bodySm.lineHeight}
                            >
                                {errorMessage}
                            </Paragraph>
                        )}
                        {notesPanel}
                    </YStack>
                )}
            </ScrollView>
            {actionFooter}
        </YStack>
    );
}

/**
 * Memoization-safe wrapper: returns visible sections without creating a new
 * array reference when the inputs haven't meaningfully changed.
 */
function getVisibleSectionsStable(
    instrument: PlayspaceInstrument,
    auditSession: Pick<AuditSession, "selected_execution_mode" | "sections"> | undefined,
): InstrumentSection[] {
    if (auditSession === undefined) {
        return EMPTY_SECTIONS;
    }
    const mode = auditSession.selected_execution_mode;
    if (!isExecutionMode(mode)) {
        return EMPTY_SECTIONS;
    }
    return getVisibleSections(
        instrument,
        mode,
        Object.fromEntries(
            Object.entries(auditSession.sections).map(([sectionKey, sectionState]) => [
                sectionKey,
                sectionState.responses,
            ]),
        ),
    );
}

const EMPTY_SECTIONS: InstrumentSection[] = [];

/**
 * Validate that a persisted mode string matches the supported execution modes.
 *
 * @param value Persisted execution mode value.
 * @returns True when the value is a supported execution mode.
 */
function isExecutionMode(value: string | null): value is ExecutionMode {
    return value === "audit" || value === "survey" || value === "both";
}

/** How long the "Preparing Section" wait may run before offering Retry/Back. */
const SECTION_PREPARING_TIMEOUT_MS = 12000;

/**
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
 * Convert raw instrument question keys into a human-readable audit label.
 */
function formatQuestionKey(questionKey: string): string {
    const sections = questionKey.slice(2).split("_"); // Remove "q_" prefix
    return `Q ${sections.map((section) => section.toUpperCase()).join(".")}`;
}

/**
 * Apply one option selection and clear gated follow-up answers when the
 * selected provision option does not allow them.
 *
 * @param currentAnswers Current scale answers for one question.
 * @param question Question definition with scale metadata.
 * @param scaleKey Scale being changed.
 * @param optionKey Selected option key.
 * @returns Next scale answer map for the question.
 */
function buildNextQuestionAnswers(
    currentAnswers: QuestionResponsePayload,
    question: { readonly scales: readonly QuestionScale[] },
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

    const provisionScale = question.scales.find((scale) => scale.key === "provision");
    const selectedOption = provisionScale?.options.find((option) => option.key === optionKey);
    if (selectedOption?.allows_follow_up_scales !== false) {
        return nextAnswers;
    }

    return { provision: optionKey };
}
