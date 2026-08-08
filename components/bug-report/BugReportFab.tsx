import { Bug, Camera, Check, X } from "@tamagui/lucide-icons-2";
import { useToastController } from "@tamagui/toast";
import { useGlobalSearchParams, useSegments } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { captureScreen, releaseCapture } from "react-native-view-shot";
import {
    Button,
    Input,
    Paragraph,
    ScrollView,
    Separator,
    Sheet,
    Spinner,
    Text,
    TextArea,
    XStack,
    YStack,
} from "tamagui";

import type { AuditSession } from "lib/audit/types";
import { matchKnownIssues } from "lib/bug-report/api";
import { type BugReportRouteContext, buildMobileBugReportContext, isDeviceOnline } from "lib/bug-report/context";
import { clearBugReportDraft, readBugReportDraft, saveBugReportDraft } from "lib/bug-report/draft-storage";
import { isBugReportingEnabled } from "lib/bug-report/feature";
import { flushPendingBugReports } from "lib/bug-report/flush";
import { createPendingBugReportId, enqueueBugReport, persistScreenshotForQueue } from "lib/bug-report/queue";
import { isScreenshotUploadConfigured } from "lib/bug-report/screenshot";
import type { BugReportSeverity, KnownIssueMatch } from "lib/bug-report/types";
import { useDesignSystem } from "lib/design-system";
import { logger } from "lib/logger";
import { GLOBAL_FAB_BOTTOM_OFFSET } from "lib/responsive-layout";
import { SkeletonCircle } from "components/ui/skeleton";
import { useAuthStore } from "stores/auth-store";
import { usePlayspaceAuditStore } from "stores/audit-store";

/**
 * Resolve the audit the reporter is currently in from the global route params
 * and the audit store, so project/place/submission references auto-populate with
 * no questions asked. The route's ``auditId`` (a PlayspaceSubmission id) wins;
 * otherwise the in-progress session for the route's ``placeId`` is used.
 */
function resolveAuditContext(
    sessionsByAuditId: Record<string, AuditSession>,
    routeParam: { placeId?: string | undefined; auditId?: string | undefined; projectId?: string | undefined },
): { projectId: string | undefined; placeId: string | undefined; submissionId: string | undefined } {
    const sessions = Object.values(sessionsByAuditId);
    const byAuditId = routeParam.auditId ? sessionsByAuditId[routeParam.auditId] : undefined;
    const byPlace = routeParam.placeId
        ? (sessions.find((s) => s.place_id === routeParam.placeId && s.status !== "SUBMITTED") ??
          sessions.find((s) => s.place_id === routeParam.placeId))
        : undefined;
    const matched = byAuditId ?? byPlace;

    return {
        projectId: matched?.project_id ?? routeParam.projectId,
        placeId: matched?.place_id ?? routeParam.placeId,
        submissionId: matched?.audit_id ?? routeParam.auditId,
    };
}

const SEVERITIES: readonly BugReportSeverity[] = ["blocking", "major", "minor"];

/** Dot color per severity, drawn from the active design-system palette. */
function severityColor(ds: ReturnType<typeof useDesignSystem>, severity: BugReportSeverity) {
    if (severity === "blocking") return ds.colors.danger;
    if (severity === "major") return ds.colors.warning;
    return ds.colors.info;
}

// Authenticated route groups where the report button is allowed to appear.
// Auth and onboarding screens are intentionally excluded.
const AUTHENTICATED_GROUPS = new Set(["(tabs)", "execute", "place", "report", "settings"]);

// Known-issue deflection timeout (ms). Short so the auditor is not kept
// waiting when the network is slow or unavailable.
const DEFLECTION_TIMEOUT_MS = 4_000;

/**
 * Floating "Report an issue" button mounted once in the root layout. It appears
 * on every authenticated screen (never on auth/onboarding) when developer mode
 * is enabled, and stays clear of the bottom tab bar and audit footer controls.
 *
 * Reporting works fully offline: every finished report (including its screenshot)
 * is stored on-device in the local queue first. If the device is online the
 * report is sent right away; if not, it stays queued and the auditor is prompted
 * to submit it the next time the app is opened with a connection (see
 * ``useBugReportFlushPrompt``). There is no background sync by design.
 */
export function BugReportFab() {
    const ds = useDesignSystem();
    const insets = useSafeAreaInsets();
    const { t } = useTranslation(["bugReport", "common"]);
    const toast = useToastController();
    const segments = useSegments();
    const params = useGlobalSearchParams<{ placeId?: string; auditId?: string; projectId?: string }>();
    const session = useAuthStore((state) => state.session);
    const sessionsByAuditId = usePlayspaceAuditStore((state) => state.sessionsByAuditId);

    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [severity, setSeverity] = useState<BugReportSeverity>("major");
    // Local file URI of the captured screen. The image is kept on-device and only
    // uploaded to Cloudinary when the queued report is flushed, so it survives
    // offline. ``null`` means no screenshot is attached.
    const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
    const [isAttaching, setIsAttaching] = useState(false);
    const [matches, setMatches] = useState<KnownIssueMatch[]>([]);
    const [hasCheckedMatches, setHasCheckedMatches] = useState(false);
    // True only during the brief deflection network check; the sheet closes
    // immediately after queuing so this never covers the actual send.
    const [isCheckingMatches, setIsCheckingMatches] = useState(false);

    /** Release the temporary capture file backing the current screenshot. */
    const releaseScreenshot = useCallback(() => {
        setScreenshotUri((current) => {
            if (current) {
                releaseCapture(current);
            }
            return null;
        });
    }, []);

    const captureAndAttachScreenshot = useCallback(async () => {
        if (!isScreenshotUploadConfigured()) {
            setOpen(true);
            return;
        }

        setIsAttaching(true);
        try {
            // Capture the underlying screen BEFORE the report sheet opens, so the
            // screenshot shows what the reporter was looking at, not the form. The
            // upload is deferred to submit/flush time so capture works offline.
            const capturedUri = await captureScreen({
                format: "png",
                quality: 1,
                result: "tmpfile",
            });
            setOpen(true);
            setScreenshotUri(capturedUri);
        } catch (error) {
            // A screenshot is optional; never block the report on a capture failure.
            logger.error(
                "Failed to capture bug-report screenshot",
                error instanceof Error ? error.message : String(error),
            );
            setOpen(true);
            toast.show(t("screenshot.failed"));
        } finally {
            setIsAttaching(false);
        }
    }, [t, toast]);

    const handleOpenReport = useCallback(() => {
        setMatches([]);
        setHasCheckedMatches(false);
        releaseScreenshot();
        void captureAndAttachScreenshot();
    }, [captureAndAttachScreenshot, releaseScreenshot]);

    /** Close the sheet, discarding any not-yet-queued screenshot capture. */
    const handleSheetOpenChange = useCallback(
        (next: boolean) => {
            if (!next) {
                releaseScreenshot();
            }
            setOpen(next);
        },
        [releaseScreenshot],
    );

    const accountId = session?.user.id ?? null;

    // Restore this account's locally-saved draft when the sheet opens. A draft
    // left by another auditor on a shared device is never restored here.
    useEffect(() => {
        if (!open) return;
        if (accountId === null) return;
        const draft = readBugReportDraft(accountId);
        if (draft) {
            setTitle(draft.title);
            setDescription(draft.description);
            setSeverity(draft.severity);
        }
    }, [open, accountId]);

    // Persist the draft as the reporter types so it survives going offline.
    useEffect(() => {
        if (!open) return;
        if (accountId === null) return;
        if (title.length === 0 && description.length === 0) return;
        saveBugReportDraft({ title, description, severity, accountId });
    }, [open, title, description, severity, accountId]);

    const segment0 = String(segments[0] ?? "");
    const isVisible = isBugReportingEnabled() && session !== null && AUTHENTICATED_GROUPS.has(segment0);

    const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !isCheckingMatches && !isAttaching;

    const resetForm = useCallback(() => {
        setMatches([]);
        setHasCheckedMatches(false);
        setIsCheckingMatches(false);
    }, []);

    const handleSubmit = useCallback(async () => {
        if (!canSubmit || session === null) return;

        // Deflection: attempt once before the first real submit. No online gate -
        // the request times out quickly (DEFLECTION_TIMEOUT_MS) on a bad link and
        // falls through to queuing automatically, so the sheet never hangs.
        if (!hasCheckedMatches) {
            setIsCheckingMatches(true);
            try {
                const found = await matchKnownIssues(session, `${title} ${description}`, {
                    timeoutMs: DEFLECTION_TIMEOUT_MS,
                });
                setHasCheckedMatches(true);
                if (found.length > 0) {
                    setMatches(found);
                    setIsCheckingMatches(false);
                    return;
                }
            } catch {
                // Timeout or network error: fall through to queuing without deflection.
                setHasCheckedMatches(true);
            }
            setIsCheckingMatches(false);
        }

        // Auto-populate the audit context from navigation + the audit store.
        const resolved = resolveAuditContext(sessionsByAuditId, {
            placeId: typeof params.placeId === "string" ? params.placeId : undefined,
            auditId: typeof params.auditId === "string" ? params.auditId : undefined,
            projectId: typeof params.projectId === "string" ? params.projectId : undefined,
        });
        const routeContext: BugReportRouteContext = { route: segments.join("/") };
        if (resolved.projectId) routeContext.projectId = resolved.projectId;
        if (resolved.placeId) routeContext.placeId = resolved.placeId;
        if (resolved.submissionId) routeContext.submissionId = resolved.submissionId;

        const context = await buildMobileBugReportContext(routeContext);

        // Persist the screenshot into durable storage and enqueue the report
        // BEFORE releasing the captured image or closing the sheet, so neither
        // can be lost if the app is backgrounded mid-submit.
        const reportId = createPendingBugReportId();
        const screenshotLocalUri = screenshotUri ? persistScreenshotForQueue(screenshotUri, reportId) : undefined;
        enqueueBugReport({
            id: reportId,
            createdAt: new Date().toISOString(),
            title: title.trim(),
            description: description.trim(),
            severity,
            context,
            ...(accountId ? { accountId } : {}),
            ...(context.project_id ? { projectId: context.project_id } : {}),
            ...(context.place_id ? { placeId: context.place_id } : {}),
            ...(context.playspace_submission_id ? { submissionId: context.playspace_submission_id } : {}),
            ...(screenshotLocalUri ? { screenshotLocalUri } : {}),
        });
        clearBugReportDraft();

        // Release the temporary capture file now that a durable copy exists.
        releaseScreenshot();

        // Close the sheet immediately - the auditor is not kept waiting while
        // the send happens.
        setTitle("");
        setDescription("");
        setSeverity("major");
        resetForm();
        setOpen(false);

        // Best-effort connectivity check for toast wording only. The flush
        // proceeds regardless (single-flight; deduplicates concurrent callers).
        const online = await isDeviceOnline();
        if (online) {
            toast.show(t("queue.savedForLater"));
        } else {
            toast.show(t("queue.savedOffline"));
        }

        // Drain the queue in the background. Errors are swallowed here; the
        // report is already queued and will be retried on the next flush prompt.
        void flushPendingBugReports(session);
    }, [
        accountId,
        canSubmit,
        description,
        hasCheckedMatches,
        params.auditId,
        params.placeId,
        params.projectId,
        releaseScreenshot,
        resetForm,
        screenshotUri,
        segments,
        session,
        sessionsByAuditId,
        severity,
        t,
        title,
        toast,
    ]);

    const submitLabel = useMemo(
        () => (hasCheckedMatches && matches.length > 0 ? t("submitAnyway") : t("submit")),
        [hasCheckedMatches, matches.length, t],
    );

    if (!isVisible) {
        return null;
    }

    return (
        <>
            <YStack position="absolute" r="$4" b={insets.bottom + GLOBAL_FAB_BOTTOM_OFFSET} z={50}>
                <Button
                    size="$4"
                    circular
                    bg={ds.colors.primary}
                    icon={<Bug size={20} color={ds.colors.background} />}
                    onPress={handleOpenReport}
                    accessibilityLabel={t("launch")}
                />
            </YStack>
            <Sheet
                modal
                open={open}
                onOpenChange={handleSheetOpenChange}
                snapPoints={[90]}
                snapPointsMode="percent"
                dismissOnSnapToBottom
                zIndex={100_000}
            >
                <Sheet.Overlay opacity={0.5} />
                <Sheet.Frame bg={ds.colors.surface} p="$4" gap="$3">
                    <Sheet.Handle bg={ds.colors.border} />
                    <ScrollView showsVerticalScrollIndicator={false}>
                        <YStack gap="$4" pb={insets.bottom + 16}>
                            <XStack gap="$3" items="center">
                                <YStack
                                    width={40}
                                    height={40}
                                    rounded="$10"
                                    bg={ds.colors.primarySoft}
                                    items="center"
                                    justify="center"
                                >
                                    <Bug size={20} color={ds.colors.primary} />
                                </YStack>
                                <YStack flex={1} gap="$1">
                                    <Text fontSize="$7" fontWeight="700" color={ds.colors.foreground}>
                                        {t("title")}
                                    </Text>
                                    <Paragraph size="$2" color={ds.colors.mutedForeground}>
                                        {t("subtitle")}
                                    </Paragraph>
                                </YStack>
                            </XStack>

                            <Separator borderColor={ds.colors.border} />

                            <YStack gap="$1.5">
                                <Text color={ds.colors.foreground}>{t("fields.title")}</Text>
                                <Input
                                    value={title}
                                    maxLength={200}
                                    placeholder={t("placeholders.title")}
                                    onChangeText={setTitle}
                                />
                            </YStack>

                            <YStack gap="$1.5">
                                <Text color={ds.colors.foreground}>{t("fields.description")}</Text>
                                <TextArea
                                    value={description}
                                    maxLength={5000}
                                    numberOfLines={5}
                                    placeholder={t("placeholders.description")}
                                    onChangeText={setDescription}
                                />
                            </YStack>

                            <YStack gap="$1.5">
                                <Text color={ds.colors.foreground}>{t("fields.severity")}</Text>
                                <XStack gap="$2">
                                    {SEVERITIES.map((value) => {
                                        const selected = severity === value;
                                        return (
                                            <Button
                                                key={value}
                                                flex={1}
                                                height={48}
                                                rounded="$4"
                                                borderWidth={1}
                                                borderColor={selected ? ds.colors.primary : ds.colors.border}
                                                bg={selected ? ds.colors.primarySoft : ds.colors.surface}
                                                onPress={() => setSeverity(value)}
                                                pressStyle={{ opacity: 0.7 }}
                                                accessibilityLabel={t(`severity.${value}`)}
                                            >
                                                <XStack gap="$2" items="center">
                                                    <YStack
                                                        width={8}
                                                        height={8}
                                                        rounded="$10"
                                                        bg={severityColor(ds, value)}
                                                    />
                                                    <Text
                                                        fontSize="$3"
                                                        fontWeight={selected ? "700" : "500"}
                                                        color={selected ? ds.colors.primary : ds.colors.foreground}
                                                    >
                                                        {t(`severity.${value}`)}
                                                    </Text>
                                                </XStack>
                                            </Button>
                                        );
                                    })}
                                </XStack>
                            </YStack>

                            {isScreenshotUploadConfigured() ? (
                                <YStack gap="$2">
                                    <XStack justify="space-between" items="center" px="$1">
                                        <Text color={ds.colors.foreground}>{t("fields.screenshot")}</Text>
                                        {screenshotUri ? (
                                            <XStack gap="$1.5" items="center" flex={1} justify="flex-end" pl="$2">
                                                <Check size={14} color={ds.colors.success} />
                                                <Text
                                                    fontSize="$2"
                                                    color={ds.colors.success}
                                                    flex={1}
                                                    numberOfLines={2}
                                                    style={{ flexShrink: 1 }}
                                                >
                                                    {t("screenshot.attached")}
                                                </Text>
                                            </XStack>
                                        ) : null}
                                    </XStack>

                                    {isAttaching ? (
                                        <XStack
                                            height={64}
                                            rounded="$4"
                                            borderWidth={1}
                                            borderColor={ds.colors.border}
                                            bg={ds.colors.surfaceMuted}
                                            items="center"
                                            justify="center"
                                            gap="$2"
                                            px="$3"
                                        >
                                            <SkeletonCircle size={18} />
                                            <Text
                                                fontSize="$2"
                                                color={ds.colors.mutedForeground}
                                                flex={1}
                                                numberOfLines={2}
                                                style={{ flexShrink: 1 }}
                                            >
                                                {t("screenshot.attaching")}
                                            </Text>
                                        </XStack>
                                    ) : screenshotUri ? (
                                        <YStack
                                            rounded="$4"
                                            overflow="hidden"
                                            borderWidth={1}
                                            borderColor={ds.colors.border}
                                        >
                                            <Image
                                                source={{ uri: screenshotUri }}
                                                style={{ width: "100%", height: 180 }}
                                                resizeMode="cover"
                                            />
                                            <Button
                                                position="absolute"
                                                t="$2"
                                                r="$2"
                                                size="$2"
                                                circular
                                                bg="rgba(0,0,0,0.55)"
                                                icon={<X size={16} color="#fff" />}
                                                onPress={releaseScreenshot}
                                                accessibilityLabel={t("screenshot.remove")}
                                            />
                                        </YStack>
                                    ) : (
                                        <XStack
                                            height={64}
                                            rounded="$4"
                                            borderWidth={1}
                                            borderColor={ds.colors.border}
                                            bg={ds.colors.surfaceMuted}
                                            items="center"
                                            justify="center"
                                            gap="$2"
                                            px="$3"
                                        >
                                            <Camera size={16} color={ds.colors.mutedForeground} />
                                            <Text
                                                fontSize="$2"
                                                color={ds.colors.mutedForeground}
                                                flex={1}
                                                numberOfLines={2}
                                                style={{ flexShrink: 1 }}
                                            >
                                                {t("screenshot.unavailable")}
                                            </Text>
                                        </XStack>
                                    )}
                                    <Paragraph fontSize="$1" color={ds.colors.mutedForeground}>
                                        {t("screenshot.privacyNote")}
                                    </Paragraph>
                                </YStack>
                            ) : null}

                            {matches.length > 0 ? (
                                <YStack gap="$2" borderColor={ds.colors.border} borderWidth={1} rounded="$4" p="$3">
                                    <Text fontWeight="600" color={ds.colors.foreground}>
                                        {t("matches.heading")}
                                    </Text>
                                    {matches.map((match) => (
                                        <YStack key={match.id} gap="$1">
                                            <Text fontWeight="600" color={ds.colors.foreground}>
                                                {match.title}
                                            </Text>
                                            <Paragraph color={ds.colors.mutedForeground}>{match.symptoms}</Paragraph>
                                            {match.workaround ? (
                                                <Paragraph color={ds.colors.foreground}>
                                                    {t("matches.workaroundLabel")}: {match.workaround}
                                                </Paragraph>
                                            ) : null}
                                            <Separator borderColor={ds.colors.border} mb="$1" />
                                        </YStack>
                                    ))}
                                </YStack>
                            ) : null}

                            <YStack gap="$2" mt="$2">
                                <Button
                                    testID="bug-report-submit"
                                    height={50}
                                    rounded="$4"
                                    disabled={!canSubmit}
                                    opacity={canSubmit ? 1 : 0.5}
                                    bg={ds.colors.primary}
                                    onPress={handleSubmit}
                                    pressStyle={{ opacity: 0.85 }}
                                >
                                    {isCheckingMatches ? (
                                        <XStack gap="$2" items="center">
                                            <Spinner size="small" color={ds.colors.background} />
                                            <Text color={ds.colors.background} fontWeight="700">
                                                {t("sending")}
                                            </Text>
                                        </XStack>
                                    ) : (
                                        <Text color={ds.colors.background} fontWeight="700">
                                            {submitLabel}
                                        </Text>
                                    )}
                                </Button>
                                <Button height={44} chromeless onPress={() => handleSheetOpenChange(false)}>
                                    <Text color={ds.colors.mutedForeground}>{t("cancel")}</Text>
                                </Button>
                            </YStack>
                        </YStack>
                    </ScrollView>
                </Sheet.Frame>
            </Sheet>
        </>
    );
}
