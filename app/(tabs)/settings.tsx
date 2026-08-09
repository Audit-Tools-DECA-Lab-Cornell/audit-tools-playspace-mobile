import type { IconProps } from "@tamagui/helpers-icon";
import {
    Accessibility,
    Check,
    ChevronDown,
    Eye,
    Globe,
    Info,
    LogOut,
    Monitor,
    Moon,
    Sun,
    Trash2,
    Type,
    User,
} from "@tamagui/lucide-icons-2";
import { useRouter } from "expo-router";
import { AppButton, buttonForegroundColor } from "components/ui/app-button";
import { ScreenHeader } from "components/ui/screen-header";
import { SkeletonBlock as PulsingSkeletonBlock } from "components/ui/skeleton";
import { fetchMyAccount, fetchMyAuditorProfile, type MyAccount, type MyAuditorProfile } from "lib/audit/profile-api";
import { getDesignSystem, type DesignSystemTheme } from "lib/design-system";
import { useLocalizedInstrument } from "lib/i18n/instrument-translations";
import { resolveFieldModePresentation } from "lib/preferences/field-mode";
import { getSettingsPageMaxWidth } from "lib/responsive";
import { getResponsiveContentContainerStyle, ResponsiveLayout, useResponsiveLayout } from "lib/responsive-layout";
import { useFabAwareBottomPadding } from "lib/responsive-insets";
import { useScreenshotScrollAutomation } from "lib/screenshot-automation";
import { useCallback, useEffect, useMemo, useRef, useState, type FC, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Switch, TextStyle, type DimensionValue } from "react-native";
import { useAuthStore } from "stores/auth-store";
import {
    resolveThemeMode,
    usePreferencesStore,
    type EditablePreferences,
    type LanguagePreference,
    type ThemeMode,
} from "stores/preferences-store";
import { Button, Paragraph, Separator, Slider, Text, XStack, YStack } from "tamagui";

const THEME_OPTIONS: readonly { key: ThemeMode; Icon: FC<IconProps> }[] = [
    { key: "system", Icon: Monitor },
    { key: "light", Icon: Sun },
    { key: "dark", Icon: Moon },
];

const LANGUAGE_OPTIONS: readonly {
    key: LanguagePreference;
    translationKey: "system" | "english" | "german" | "french" | "japanese" | "hindi";
}[] = [
    { key: "system", translationKey: "system" },
    { key: "en", translationKey: "english" },
    { key: "de", translationKey: "german" },
    { key: "fr", translationKey: "french" },
    { key: "ja", translationKey: "japanese" },
    { key: "hi", translationKey: "hindi" },
];

type ResolvedAppLanguage = Exclude<LanguagePreference, "system">;

/**
 * Resolve the active i18n language tag to one of the app's explicit language codes.
 *
 * @param languageTag Current i18n language tag.
 * @returns Supported concrete app language.
 */
function resolveAppLanguage(languageTag: string | undefined): ResolvedAppLanguage {
    const normalizedLanguage = typeof languageTag === "string" ? languageTag.toLowerCase() : "";

    if (normalizedLanguage.startsWith("de")) {
        return "de";
    }

    if (normalizedLanguage.startsWith("fr")) {
        return "fr";
    }

    if (normalizedLanguage.startsWith("ja")) {
        return "ja";
    }

    if (normalizedLanguage.startsWith("hi")) {
        return "hi";
    }

    return "en";
}

/**
 * Settings tab with read-only profile, appearance, accessibility, and about.
 *
 * Profile editing is deferred until the authentication and manager dashboard
 * flows are designed.
 */
export default function SettingsScreen() {
    const layout = useResponsiveLayout();
    const listBottomPadding = useFabAwareBottomPadding();
    const router = useRouter();
    const { t, i18n } = useTranslation(["settings", "common"]);
    const instrument = useLocalizedInstrument();
    const session = useAuthStore((state) => state.session);
    const logout = useAuthStore((state) => state.logout);

    // Committed preferences live in the global store. The screen edits a local
    // draft so appearance and text-scale changes preview instantly here without
    // re-rendering the whole app; the draft is committed in one batch on save.
    const committedThemeMode = usePreferencesStore((state) => state.themeMode);
    const committedLanguage = usePreferencesStore((state) => state.languagePreference);
    const committedFontScale = usePreferencesStore((state) => state.fontScale);
    const committedHighContrast = usePreferencesStore((state) => state.highContrast);
    const committedDyslexicFont = usePreferencesStore((state) => state.dyslexicFont);
    const committedFieldMode = usePreferencesStore((state) => state.fieldMode);
    const applyPreferences = usePreferencesStore((state) => state.applyPreferences);

    const committedPreferences = useMemo<EditablePreferences>(
        () => ({
            themeMode: committedThemeMode,
            languagePreference: committedLanguage,
            fontScale: committedFontScale,
            highContrast: committedHighContrast,
            dyslexicFont: committedDyslexicFont,
            fieldMode: committedFieldMode,
        }),
        [
            committedThemeMode,
            committedLanguage,
            committedFontScale,
            committedHighContrast,
            committedDyslexicFont,
            committedFieldMode,
        ],
    );

    const [draft, setDraft] = useState<EditablePreferences>(committedPreferences);
    const [account, setAccount] = useState<MyAccount | null>(null);
    const [profile, setProfile] = useState<MyAuditorProfile | null>(null);

    const [isLoading, setIsLoading] = useState(true);
    const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
    const scrollViewRef = useRef<ScrollView | null>(null);

    // Re-seed the draft whenever committed values change (hydration, or the
    // store settling after a save) so the screen always opens in sync.
    useEffect(() => {
        setDraft(committedPreferences);
    }, [committedPreferences]);

    const isDirty = useMemo(() => !arePreferencesEqual(draft, committedPreferences), [draft, committedPreferences]);

    // Design tokens for THIS screen come from the draft, giving an instant local
    // preview of theme, contrast, dyslexic-font, and text-scale changes.
    const ds = useMemo(
        () =>
            getDesignSystem(resolveThemeMode(draft.themeMode), {
                fontScale: draft.fontScale,
                highContrast: draft.highContrast,
                dyslexicFont: draft.dyslexicFont,
                fieldMode: draft.fieldMode,
                isTablet: layout.isTablet,
            }),
        [draft, layout.isTablet],
    );

    const fieldModePresentation = useMemo(() => {
        return resolveFieldModePresentation({
            fieldMode: draft.fieldMode,
            fontScale: draft.fontScale,
            highContrast: draft.highContrast,
            theme: resolveThemeMode(draft.themeMode),
        });
    }, [draft]);

    const handleSavePreferences = useCallback(() => {
        applyPreferences(draft);
    }, [applyPreferences, draft]);

    const handleDiscardPreferences = useCallback(() => {
        setDraft(committedPreferences);
        setIsLanguageMenuOpen(false);
    }, [committedPreferences]);

    useEffect(() => {
        if (session === null) {
            setAccount(null);
            setProfile(null);
            setIsLoading(false);
            return;
        }

        let isSubscribed = true;

        setIsLoading(true);
        setAccount(null);
        setProfile(null);

        void Promise.allSettled([fetchMyAccount(session), fetchMyAuditorProfile(session)]).then((results) => {
            if (!isSubscribed) {
                return;
            }

            const [accountResult, profileResult] = results;

            setAccount(accountResult.status === "fulfilled" ? accountResult.value : null);
            setProfile(profileResult.status === "fulfilled" ? profileResult.value : null);
            setIsLoading(false);
        });

        return () => {
            isSubscribed = false;
        };
    }, [session]);

    const scrollSettingsToOffset = useCallback((offset: number) => {
        scrollViewRef.current?.scrollTo({ animated: false, x: 0, y: offset });
    }, []);

    useScreenshotScrollAutomation({
        contentReady: !isLoading,
        rerunKey: session?.user.id ?? "settings",
        scrollToOffset: scrollSettingsToOffset,
    });

    const userName = account?.name ?? session?.user.name ?? "-";
    const userEmail = account?.email ?? session?.user.email ?? "-";
    const accountType = session === null ? "-" : t("accountTypes.auditor", { ns: "common" });
    const activeLanguage = resolveAppLanguage(i18n.resolvedLanguage ?? i18n.language);

    const getActiveLanguageTranslationKey = (language: ResolvedAppLanguage): string => {
        const languageMap: Record<ResolvedAppLanguage, string> = {
            de: "language.german",
            fr: "language.french",
            ja: "language.japanese",
            hi: "language.hindi",
            en: "language.english",
        };
        return languageMap[language];
    };

    const getLanguageOptionLabel = (preference: LanguagePreference): string => {
        const matchingOption = LANGUAGE_OPTIONS.find((option) => option.key === preference);

        if (matchingOption === undefined) {
            return t("language.english", { ns: "settings" });
        }

        return t(`language.${matchingOption.translationKey}`, { ns: "settings" });
    };
    const selectedLanguageLabel = getLanguageOptionLabel(draft.languagePreference);
    const settingsPageMaxWidth = getSettingsPageMaxWidth({
        isTablet: layout.isTablet,
        contentMaxWidth: layout.contentMaxWidth,
        formMaxWidth: layout.formMaxWidth,
    });
    const appearanceCard = (
        <SettingsCard ds={ds} label={t("appearance.label", { ns: "settings" })} Icon={Sun} stretch={layout.isTablet}>
            <YStack gap="$1.5">
                <Text
                    color={ds.colors.foreground}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.titleMd.fontSize}
                >
                    {t("appearance.theme", { ns: "settings" })}
                </Text>
                <Paragraph
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodySm.fontSize}
                >
                    {t("appearance.themeDescription", { ns: "settings" })}
                </Paragraph>
            </YStack>
            <XStack gap="$2">
                {THEME_OPTIONS.map((option) => {
                    const isSelected = draft.themeMode === option.key;
                    const OptionIcon = option.Icon;
                    return (
                        <Button
                            flex={1}
                            key={option.key}
                            height={layout.isTablet ? 64 : 56}
                            rounded={ds.radii.md}
                            borderWidth={1}
                            borderColor={isSelected ? ds.colors.primary : ds.colors.border}
                            bg={isSelected ? ds.colors.primarySoft : ds.colors.input}
                            pressStyle={{ opacity: 0.92, scale: 0.985 }}
                            onPress={() => setDraft((current) => ({ ...current, themeMode: option.key }))}
                        >
                            <YStack items="center" gap="$1">
                                <OptionIcon
                                    size={18}
                                    color={isSelected ? ds.colors.primary : ds.colors.mutedForeground}
                                />
                                <Text
                                    color={isSelected ? ds.colors.primary : ds.colors.foreground}
                                    fontFamily={isSelected ? ds.fonts.bodyBold : ds.fonts.bodyMedium}
                                    fontSize={ds.typography.bodySm.fontSize}
                                >
                                    {t(`appearance.${option.key}`, { ns: "settings" })}
                                </Text>
                            </YStack>
                        </Button>
                    );
                })}
            </XStack>
        </SettingsCard>
    );
    const accessibilityCard = (
        <SettingsCard
            ds={ds}
            label={t("accessibility.label", { ns: "settings" })}
            Icon={Accessibility}
            stretch={layout.isTablet}
        >
            <YStack gap="$4">
                <XStack items="center" gap="$2">
                    <Type size={14} color={ds.colors.primary} />
                    <Text
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.bodyBold}
                        fontSize={ds.typography.bodyMd.fontSize}
                    >
                        {t("accessibility.fontScaleValue", {
                            ns: "settings",
                            value: fieldModePresentation.effectiveFontScale.toFixed(2),
                        })}
                    </Text>
                </XStack>
                <Slider
                    value={[draft.fontScale]}
                    min={0.85}
                    max={1.3}
                    step={0.05}
                    onValueChange={(values: number[]) => {
                        const nextValue = values[0];
                        if (typeof nextValue === "number") {
                            setDraft((current) => ({ ...current, fontScale: nextValue }));
                        }
                    }}
                >
                    <Slider.Track bg={ds.colors.border}>
                        <Slider.TrackActive bg={ds.colors.primary} />
                    </Slider.Track>
                    <Slider.Thumb index={0} size="$1" bg={ds.colors.primary} circular />
                </Slider>
                <Paragraph
                    color={ds.colors.mutedForeground}
                    fontFamily={ds.fonts.bodyMedium}
                    fontSize={ds.typography.bodySm.fontSize}
                >
                    {t("accessibility.fontScaleDescription", { ns: "settings" })}
                </Paragraph>
                {draft.fieldMode ? (
                    <Paragraph
                        color={ds.colors.mutedForeground}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={ds.typography.bodySm.fontSize}
                    >
                        {t("accessibility.fieldModeEffect", {
                            ns: "settings",
                            value: fieldModePresentation.effectiveFontScale.toFixed(2),
                        })}
                    </Paragraph>
                ) : null}
            </YStack>

            <Separator borderColor={ds.colors.border} />

            <ToggleRow
                ds={ds}
                label={t("accessibility.fieldMode", { ns: "settings" })}
                description={t("accessibility.fieldModeDescription", { ns: "settings" })}
                icon={Sun}
                isEnabled={draft.fieldMode}
                onToggle={() => setDraft((current) => ({ ...current, fieldMode: !current.fieldMode }))}
            />

            <Separator borderColor={ds.colors.border} />

            <ToggleRow
                ds={ds}
                label={t("accessibility.highContrast", { ns: "settings" })}
                description={t(
                    draft.fieldMode
                        ? "accessibility.highContrastManagedDescription"
                        : "accessibility.highContrastDescription",
                    { ns: "settings" },
                )}
                icon={Eye}
                isEnabled={draft.highContrast || draft.fieldMode}
                disabled={draft.fieldMode}
                onToggle={() => setDraft((current) => ({ ...current, highContrast: !current.highContrast }))}
            />

            <Separator borderColor={ds.colors.border} />

            <ToggleRow
                ds={ds}
                label={t("accessibility.dyslexicFont", { ns: "settings" })}
                description={t("accessibility.dyslexicFontDescription", { ns: "settings" })}
                icon={Type}
                isEnabled={draft.dyslexicFont}
                onToggle={() => setDraft((current) => ({ ...current, dyslexicFont: !current.dyslexicFont }))}
            />
        </SettingsCard>
    );

    if (isLoading) {
        return <SettingsSkeletonScreen ds={ds} />;
    }

    return (
        <YStack flex={1} bg={ds.colors.background}>
            <ScrollView
                ref={scrollViewRef}
                contentInsetAdjustmentBehavior="automatic"
                style={{ backgroundColor: ds.colors.background }}
                contentContainerStyle={getResponsiveContentContainerStyle(layout, {
                    // Reserve extra room for the save bar so the last card stays reachable.
                    bottomPadding: isDirty ? listBottomPadding + 76 : listBottomPadding,
                    gap: layout.isTablet ? 28 : 24,
                    maxWidth: settingsPageMaxWidth,
                })}
            >
                <ScreenHeader title={t("title", { ns: "settings" })} subtitle={t("subtitle", { ns: "settings" })} />

                {/* Profile Card (read-only) */}
                <SettingsCard ds={ds} label={t("profile.label", { ns: "settings" })} Icon={User}>
                    <ProfileRow ds={ds} label={t("profile.name", { ns: "settings" })} value={userName} />
                    <Separator borderColor={ds.colors.border} />
                    <ProfileRow ds={ds} label={t("profile.email", { ns: "settings" })} value={userEmail} />
                    {account?.organization != null ? (
                        <>
                            <Separator borderColor={ds.colors.border} />
                            <ProfileRow
                                ds={ds}
                                label={t("profile.organization", { ns: "settings" })}
                                value={account.organization}
                            />
                        </>
                    ) : null}
                    <Separator borderColor={ds.colors.border} />
                    <ProfileRow ds={ds} label={t("profile.accountType", { ns: "settings" })} value={accountType} />

                    {profile === null ? null : (
                        <>
                            <Separator borderColor={ds.colors.border} />
                            <ProfileRow
                                ds={ds}
                                label={t("profile.auditorCode", { ns: "settings" })}
                                value={profile.auditor_code}
                            />
                            {profile.role === null ? null : (
                                <>
                                    <Separator borderColor={ds.colors.border} />
                                    <ProfileRow
                                        ds={ds}
                                        label={t("profile.role", { ns: "settings" })}
                                        value={profile.role}
                                        textTransform="capitalize"
                                    />
                                </>
                            )}
                            {profile.country === null ? null : (
                                <>
                                    <Separator borderColor={ds.colors.border} />
                                    <ProfileRow
                                        ds={ds}
                                        label={t("profile.country", { ns: "settings" })}
                                        value={profile.country}
                                        textTransform="capitalize"
                                    />
                                </>
                            )}
                        </>
                    )}

                    <XStack gap="$2">
                        <AppButton
                            flex={1}
                            label={t("profile.editProfile", { ns: "settings" })}
                            variant="secondary"
                            onPress={() => {
                                router.push("/settings/edit-profile");
                            }}
                        />
                        <AppButton
                            flex={1}
                            label={t("profile.changePassword", { ns: "settings" })}
                            variant="secondary"
                            onPress={() => router.push("/settings/change-password")}
                        />
                    </XStack>
                </SettingsCard>

                {layout.isWideTablet ? (
                    <XStack gap="$3" items="stretch">
                        <YStack flex={1}>{accessibilityCard}</YStack>
                        <YStack flex={1}>{appearanceCard}</YStack>
                    </XStack>
                ) : (
                    <>
                        {appearanceCard}
                        {accessibilityCard}
                    </>
                )}

                {/* Language Card */}
                <SettingsCard ds={ds} label={t("language.label", { ns: "settings" })} Icon={Globe}>
                    <YStack gap="$1.5">
                        <Text
                            color={ds.colors.foreground}
                            fontFamily={ds.fonts.bodyBold}
                            fontSize={ds.typography.titleMd.fontSize}
                        >
                            {t("language.selection", { ns: "settings" })}
                        </Text>
                        <Paragraph
                            color={ds.colors.mutedForeground}
                            fontFamily={ds.fonts.bodyMedium}
                            fontSize={ds.typography.bodySm.fontSize}
                        >
                            {t("language.description", { ns: "settings" })}
                        </Paragraph>
                    </YStack>
                    <Button
                        width="100%"
                        height={layout.controlHeight}
                        rounded={ds.radii.md}
                        borderWidth={1}
                        borderColor={isLanguageMenuOpen ? ds.colors.primary : ds.colors.border}
                        bg={isLanguageMenuOpen ? ds.colors.primarySoft : ds.colors.input}
                        px="$3.5"
                        justify="space-between"
                        pressStyle={{ opacity: 0.92, scale: 0.985 }}
                        onPress={() => {
                            setIsLanguageMenuOpen((currentValue) => !currentValue);
                        }}
                    >
                        <Text
                            color={isLanguageMenuOpen ? ds.colors.primary : ds.colors.foreground}
                            fontFamily={isLanguageMenuOpen ? ds.fonts.bodyBold : ds.fonts.bodyMedium}
                            fontSize={ds.typography.bodySm.fontSize}
                        >
                            {selectedLanguageLabel}
                        </Text>
                        <ChevronDown
                            size={16}
                            color={isLanguageMenuOpen ? ds.colors.primary : ds.colors.mutedForeground}
                        />
                    </Button>

                    {isLanguageMenuOpen ? (
                        <YStack
                            width="100%"
                            rounded={ds.radii.md}
                            borderWidth={1}
                            borderColor={ds.colors.border}
                            bg={ds.colors.surface}
                            p="$1"
                            gap="$1"
                            style={{ boxShadow: ds.shadows.card }}
                        >
                            {LANGUAGE_OPTIONS.map((option) => {
                                const isSelected = draft.languagePreference === option.key;

                                return (
                                    <Button
                                        key={option.key}
                                        justify="space-between"
                                        height={layout.isTablet ? 50 : 46}
                                        rounded={ds.radii.md}
                                        borderWidth={1}
                                        borderColor={isSelected ? ds.colors.primary : "transparent"}
                                        bg={isSelected ? ds.colors.primarySoft : "transparent"}
                                        pressStyle={{ opacity: 0.92, scale: 0.985 }}
                                        onPress={() => {
                                            setDraft((current) => ({ ...current, languagePreference: option.key }));
                                            setIsLanguageMenuOpen(false);
                                        }}
                                    >
                                        <Text
                                            color={isSelected ? ds.colors.primary : ds.colors.foreground}
                                            fontFamily={isSelected ? ds.fonts.bodyBold : ds.fonts.bodyMedium}
                                            fontSize={ds.typography.bodyMd.fontSize}
                                        >
                                            {getLanguageOptionLabel(option.key)}
                                        </Text>
                                        {isSelected ? (
                                            <Check size={16} color={ds.colors.primary} />
                                        ) : (
                                            <YStack width={16} height={16} />
                                        )}
                                    </Button>
                                );
                            })}
                        </YStack>
                    ) : null}
                    <Paragraph
                        color={ds.colors.mutedForeground}
                        fontFamily={ds.fonts.bodyMedium}
                        fontSize={ds.typography.bodySm.fontSize}
                    >
                        {t("language.currentValue", {
                            ns: "settings",
                            value: t(getActiveLanguageTranslationKey(activeLanguage), {
                                ns: "settings",
                            }),
                        })}
                    </Paragraph>
                </SettingsCard>

                {/* About Card */}
                <SettingsCard ds={ds} label={t("about.label", { ns: "settings" })} Icon={Info}>
                    <ProfileRow
                        ds={ds}
                        label={t("about.instrument", { ns: "settings" })}
                        value={instrument?.instrument_name ?? "-"}
                    />
                    <Separator borderColor={ds.colors.border} />
                    <ProfileRow
                        ds={ds}
                        label={t("about.version", { ns: "settings" })}
                        value={`v${instrument?.instrument_version ?? "-"}`}
                    />
                    <Separator borderColor={ds.colors.border} />
                    <ProfileRow
                        ds={ds}
                        label={t("about.app", { ns: "settings" })}
                        value={t("about.appName", { ns: "settings" })}
                    />
                </SettingsCard>

                {/* Sign out lives at the very bottom: a destructive action ends
                    the page rather than sitting among profile fields. */}
                <AppButton
                    label={t("actions.signOut", { ns: "common" })}
                    variant="destructive"
                    iconLeft={<LogOut size={16} color={buttonForegroundColor("destructive", ds.colors)} />}
                    onPress={() => {
                        logout()
                            .then(() => {
                                router.replace("/(auth)/login");
                            })
                            .catch(() => undefined);
                    }}
                />

                {/* Deliberately the lightest control on the page. Deleting an
                    account is permanent and rarely wanted, so it stays findable
                    without competing with sign-out for a tired thumb. */}
                <Button
                    chromeless
                    height={layout.compactControlHeight}
                    rounded={ds.radii.md}
                    pressStyle={{ opacity: 0.92 }}
                    onPress={() => router.push("/settings/delete-account")}
                    accessibilityRole="button"
                    testID="delete-account-entry"
                >
                    <XStack items="center" justify="center" gap="$2">
                        <Trash2 size={15} color={ds.colors.danger} />
                        <Text
                            color={ds.colors.danger}
                            fontFamily={ds.fonts.bodySemiBold}
                            fontSize={ds.typography.bodySm.fontSize}
                        >
                            {t("deleteAccount.entry", { ns: "settings" })}
                        </Text>
                    </XStack>
                </Button>
            </ScrollView>

            {isDirty ? (
                <SettingsSaveBar
                    ds={ds}
                    layout={layout}
                    onSave={handleSavePreferences}
                    onDiscard={handleDiscardPreferences}
                    label={t("pendingChanges.label", { ns: "settings" })}
                    description={t("pendingChanges.description", { ns: "settings" })}
                    saveLabel={t("pendingChanges.save", { ns: "settings" })}
                    discardLabel={t("pendingChanges.discard", { ns: "settings" })}
                />
            ) : null}
        </YStack>
    );
}

/**
 * Compare two editable preference sets for equality across every field.
 *
 * @returns True when both sets hold identical values.
 */
function arePreferencesEqual(left: EditablePreferences, right: EditablePreferences): boolean {
    return (
        left.themeMode === right.themeMode &&
        left.languagePreference === right.languagePreference &&
        left.fontScale === right.fontScale &&
        left.highContrast === right.highContrast &&
        left.dyslexicFont === right.dyslexicFont &&
        left.fieldMode === right.fieldMode
    );
}

interface SettingsSaveBarProps {
    readonly ds: DesignSystemTheme;
    readonly layout: ResponsiveLayout;
    readonly onSave: () => void;
    readonly onDiscard: () => void;
    readonly label: string;
    readonly description: string;
    readonly saveLabel: string;
    readonly discardLabel: string;
}

/**
 * Sticky action bar shown while the settings draft differs from the saved
 * preferences. Changes only apply app-wide once the user presses Save.
 */
function SettingsSaveBar({
    ds,
    layout,
    onSave,
    onDiscard,
    label,
    description,
    saveLabel,
    discardLabel,
}: SettingsSaveBarProps) {
    return (
        <YStack
            position="absolute"
            b={0}
            l={0}
            r={0}
            borderTopWidth={1}
            borderTopColor={ds.colors.border}
            bg={ds.colors.surface}
            px={layout.screenPaddingHorizontal}
            pt="$3"
            pb="$4"
            gap="$3"
            style={{ boxShadow: ds.shadows.card }}
        >
            <YStack
                width="100%"
                maxW={getSettingsPageMaxWidth({
                    isTablet: layout.isTablet,
                    contentMaxWidth: layout.contentMaxWidth,
                    formMaxWidth: layout.formMaxWidth,
                })}
                self="center"
                gap="$3"
            >
                <XStack items="center" justify="space-between" gap="$3">
                    <YStack flex={1} gap="$0.5">
                        <Text
                            color={ds.colors.foreground}
                            fontFamily={ds.fonts.bodyBold}
                            fontSize={ds.typography.bodyMd.fontSize}
                        >
                            {label}
                        </Text>
                        <Paragraph
                            color={ds.colors.mutedForeground}
                            fontFamily={ds.fonts.bodyMedium}
                            fontSize={ds.typography.bodySm.fontSize}
                            numberOfLines={2}
                        >
                            {description}
                        </Paragraph>
                    </YStack>
                </XStack>
                <XStack gap="$2">
                    <Button
                        flex={1}
                        height={layout.isTablet ? 50 : 46}
                        rounded={ds.radii.md}
                        borderWidth={1}
                        borderColor={ds.colors.border}
                        bg={ds.colors.surface}
                        pressStyle={{ opacity: 0.92, scale: 0.985 }}
                        onPress={onDiscard}
                    >
                        <Text
                            color={ds.colors.mutedForeground}
                            fontFamily={ds.fonts.bodyBold}
                            fontSize={ds.typography.labelLg.fontSize}
                        >
                            {discardLabel}
                        </Text>
                    </Button>
                    <Button
                        flex={2}
                        height={layout.isTablet ? 50 : 46}
                        rounded={ds.radii.md}
                        borderWidth={0}
                        bg={ds.colors.primary}
                        pressStyle={{ opacity: 0.92, scale: 0.985 }}
                        onPress={onSave}
                    >
                        <Text
                            color={ds.colors.primaryForeground}
                            fontFamily={ds.fonts.bodyBold}
                            fontSize={ds.typography.labelLg.fontSize}
                        >
                            {saveLabel}
                        </Text>
                    </Button>
                </XStack>
            </YStack>
        </YStack>
    );
}

interface SettingsSkeletonScreenProps {
    readonly ds: DesignSystemTheme;
}

/**
 * Skeleton version of the settings screen shown while profile data loads.
 */
function SettingsSkeletonScreen({ ds }: SettingsSkeletonScreenProps) {
    const layout = useResponsiveLayout();
    const skeletonBottomPadding = useFabAwareBottomPadding();
    return (
        <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            style={{ backgroundColor: ds.colors.background }}
            contentContainerStyle={getResponsiveContentContainerStyle(layout, {
                bottomPadding: skeletonBottomPadding,
                gap: layout.isTablet ? 32 : 24,
                maxWidth: getSettingsPageMaxWidth({
                    isTablet: layout.isTablet,
                    contentMaxWidth: layout.contentMaxWidth,
                    formMaxWidth: layout.formMaxWidth,
                }),
            })}
        >
            <YStack gap="$3">
                <SkeletonBlock ds={ds} width="36%" height={layout.isTablet ? 52 : 28} rounded={ds.radii.sm} />
                <SkeletonBlock ds={ds} width="68%" height={layout.isTablet ? 28 : 18} rounded={ds.radii.sm} />
            </YStack>

            <SettingsCardSkeleton ds={ds}>
                <ProfileSkeletonRow ds={ds} labelWidth="26%" valueWidth="38%" layout={layout} />
                <Separator borderColor={ds.colors.border} />
                <ProfileSkeletonRow ds={ds} labelWidth="26%" valueWidth="52%" layout={layout} />
                <Separator borderColor={ds.colors.border} />
                <ProfileSkeletonRow ds={ds} labelWidth="26%" valueWidth="34%" layout={layout} />
                <Separator borderColor={ds.colors.border} />
                <ProfileSkeletonRow ds={ds} labelWidth="26%" valueWidth="38%" layout={layout} />
                <SkeletonBlock ds={ds} width="70%" height={layout.isTablet ? 28 : 18} rounded={ds.radii.sm} />
                <SkeletonBlock ds={ds} width="100%" height={layout.isTablet ? 64 : 48} />
            </SettingsCardSkeleton>

            {layout.isWideTablet ? (
                <XStack gap="$3" items="stretch">
                    <YStack flex={1}>
                        <SettingsCardSkeleton ds={ds} stretch>
                            <YStack gap="$3.5">
                                <SkeletonBlock ds={ds} width="52%" height={36} rounded={ds.radii.sm} />
                                <SkeletonBlock ds={ds} width="72%" height={36} rounded={ds.radii.sm} />
                            </YStack>
                            <XStack gap="$2">
                                <SkeletonBlock ds={ds} flex={1} height={72} />
                                <SkeletonBlock ds={ds} flex={1} height={72} />
                            </XStack>
                        </SettingsCardSkeleton>
                    </YStack>
                    <YStack flex={1}>
                        <SettingsCardSkeleton ds={ds} stretch>
                            <YStack gap="$3.5">
                                <SkeletonBlock ds={ds} width="52%" height={48} rounded={ds.radii.sm} />
                                <SkeletonBlock ds={ds} width="96%" height={36} rounded={ds.radii.sm} />
                            </YStack>
                            <SkeletonBlock ds={ds} width="100%" height={96} />
                            <SkeletonBlock ds={ds} width="100%" height={72} />
                            <SkeletonBlock ds={ds} width="100%" height={72} />
                        </SettingsCardSkeleton>
                    </YStack>
                </XStack>
            ) : (
                <>
                    <SettingsCardSkeleton ds={ds}>
                        <YStack gap="$3">
                            <SkeletonBlock ds={ds} width="34%" height={28} rounded={ds.radii.sm} />
                            <SkeletonBlock ds={ds} width="72%" height={28} rounded={ds.radii.sm} />
                        </YStack>
                        <XStack gap="$2">
                            <SkeletonBlock ds={ds} flex={1} height={56} />
                            <SkeletonBlock ds={ds} flex={1} height={56} />
                            <SkeletonBlock ds={ds} flex={1} height={56} />
                        </XStack>
                    </SettingsCardSkeleton>

                    <SettingsCardSkeleton ds={ds}>
                        <YStack gap="$3">
                            <SkeletonBlock ds={ds} width="34%" height={28} rounded={ds.radii.sm} />
                            <SkeletonBlock ds={ds} width="72%" height={28} rounded={ds.radii.sm} />
                        </YStack>
                        <SkeletonBlock ds={ds} width="100%" height={52} />
                    </SettingsCardSkeleton>
                </>
            )}
        </ScrollView>
    );
}

interface SettingsCardSkeletonProps {
    readonly ds: DesignSystemTheme;
    readonly children: ReactNode;
    readonly stretch?: boolean;
}

/**
 * Placeholder card wrapper that mirrors the spacing of a real settings card.
 */
function SettingsCardSkeleton({ ds, children, stretch = false }: SettingsCardSkeletonProps) {
    const layout = useResponsiveLayout();
    return (
        <YStack
            flex={stretch ? 1 : undefined}
            rounded={ds.radii.lg}
            borderWidth={1}
            borderColor={ds.colors.border}
            bg={ds.colors.surface}
            p={layout.cardPadding}
            gap="$4"
            style={{ boxShadow: ds.shadows.card }}
        >
            {children}
        </YStack>
    );
}

interface SkeletonBlockProps {
    readonly ds: DesignSystemTheme;
    readonly height: number;
    readonly width?: DimensionValue;
    readonly flex?: number;
    readonly rounded?: number;
}

/**
 * Small reusable placeholder block used across the loading skeleton.
 * Delegates to the shared pulsing skeleton primitive (G2/G10).
 */
function SkeletonBlock({ height, width, flex, rounded }: SkeletonBlockProps) {
    return <PulsingSkeletonBlock height={height} width={width} flex={flex} rounded={rounded} />;
}

interface ProfileSkeletonRowProps {
    readonly ds: DesignSystemTheme;
    readonly labelWidth: DimensionValue;
    readonly valueWidth: DimensionValue;
    readonly layout: ResponsiveLayout;
}

/**
 * Placeholder row matching the read-only profile and about sections.
 */
function ProfileSkeletonRow({ ds, labelWidth, valueWidth, layout }: ProfileSkeletonRowProps) {
    return (
        <XStack justify="space-between" items="center" py="$3.5">
            <SkeletonBlock ds={ds} width={labelWidth} height={layout.isTablet ? 28 : 18} rounded={ds.radii.sm} />
            <SkeletonBlock ds={ds} width={valueWidth} height={layout.isTablet ? 28 : 18} rounded={ds.radii.sm} />
        </XStack>
    );
}

interface SettingsCardProps {
    readonly ds: DesignSystemTheme;
    readonly label: string;
    readonly Icon: FC<IconProps>;
    readonly children: ReactNode;
    readonly stretch?: boolean;
}

/**
 * Reusable settings section card with a header label and icon.
 */
function SettingsCard({ ds, label, Icon, children, stretch = false }: SettingsCardProps) {
    const layout = useResponsiveLayout();
    return (
        <YStack
            flex={stretch ? 1 : undefined}
            rounded={ds.radii.lg}
            borderWidth={1}
            borderColor={ds.colors.border}
            bg={ds.colors.surface}
            p={layout.cardPadding}
            gap="$3"
            style={{ boxShadow: ds.shadows.card }}
        >
            <XStack items="center" gap="$2">
                <Icon size={16} color={ds.colors.primary} />
                <Text
                    color={ds.colors.primary}
                    fontFamily={ds.fonts.bodyBold}
                    fontSize={ds.typography.labelMd.fontSize}
                    textTransform="uppercase"
                    letterSpacing={1.2}
                >
                    {label}
                </Text>
            </XStack>
            {children}
        </YStack>
    );
}

interface ProfileRowProps {
    readonly ds: DesignSystemTheme;
    readonly label: string;
    readonly value: string;
    readonly textTransform?: TextStyle["textTransform"];
}

/**
 * Compact label/value row for read-only profile display.
 */
function ProfileRow({ ds, label, value, textTransform }: ProfileRowProps) {
    return (
        <XStack justify="space-between" items="flex-start" gap="$3" py="$1.5">
            <Text
                color={ds.colors.mutedForeground}
                fontFamily={ds.fonts.bodyMedium}
                fontSize={ds.typography.bodyMd.fontSize}
                shrink={0}
            >
                {label}
            </Text>
            <Text
                selectable
                color={ds.colors.foreground}
                fontFamily={ds.fonts.bodySemiBold}
                fontSize={ds.typography.bodyMd.fontSize}
                lineHeight={ds.typography.bodyMd.lineHeight}
                flex={1}
                textTransform={textTransform}
                style={{ textAlign: "right" }}
            >
                {value}
            </Text>
        </XStack>
    );
}

interface ToggleRowProps {
    readonly ds: DesignSystemTheme;
    readonly label: string;
    readonly description: string;
    readonly icon: FC<IconProps>;
    readonly isEnabled: boolean;
    readonly onToggle: () => void;
    /** When another setting manages this one (e.g. Field Mode forces High Contrast). */
    readonly disabled?: boolean;
}

/**
 * Toggle switch row for boolean accessibility preferences. Uses the platform
 * `Switch` so the on/off state and semantics are unambiguous to sighted and
 * screen-reader users alike.
 */
function ToggleRow({
    ds,
    label,
    description,
    icon: ToggleIcon,
    isEnabled,
    onToggle,
    disabled = false,
}: ToggleRowProps) {
    return (
        <YStack gap="$1.5" opacity={disabled ? 0.6 : 1}>
            <XStack justify="space-between" items="center" gap="$3">
                <XStack items="center" gap="$2" flex={1}>
                    <ToggleIcon size={16} color={ds.colors.primary} />
                    <Text
                        color={ds.colors.foreground}
                        fontFamily={ds.fonts.bodySemiBold}
                        fontSize={ds.typography.bodyMd.fontSize}
                        flex={1}
                    >
                        {label}
                    </Text>
                </XStack>
                <Switch
                    value={isEnabled}
                    onValueChange={onToggle}
                    disabled={disabled}
                    accessibilityLabel={label}
                    trackColor={{ false: ds.colors.mutedSurface, true: ds.colors.primary }}
                    thumbColor={ds.colors.primaryForeground}
                    ios_backgroundColor={ds.colors.mutedSurface}
                />
            </XStack>
            <Paragraph
                color={ds.colors.mutedForeground}
                fontFamily={ds.fonts.bodyMedium}
                fontSize={ds.typography.bodySm.fontSize}
            >
                {description}
            </Paragraph>
        </YStack>
    );
}
