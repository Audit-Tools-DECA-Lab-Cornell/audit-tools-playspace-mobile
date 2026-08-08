import { requestAccountDeletion } from "lib/account/deletion-api";
import { purgeLocalAccountData } from "lib/account/purge";
import { unregisterAuditBackgroundTaskAsync } from "lib/audit/background-sync";
import { AuthApiError, changePassword, loginWithPassword, requestAccess, signupWithPassword } from "lib/auth/api";
import { clearAuthSession, readAuthSession, saveAuthSession } from "lib/auth/storage";
import { t } from "lib/i18n";
import { clearNotificationsCache } from "lib/storage/notification-cache";
import { usePlayspaceAuditStore } from "stores/audit-store";
import { create } from "zustand";

import type { AccessRequestPayload, AuthSession, LoginPayload, SignupPayload } from "lib/auth/types";
/**
 * Auth loading states used by route guards.
 */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

/**
 * Global auth store shape.
 */
export interface AuthStoreState {
    readonly status: AuthStatus;
    readonly session: AuthSession | null;
    readonly isSubmitting: boolean;
    readonly errorMessage: string | null;
    initialize: () => Promise<void>;
    login: (payload: LoginPayload) => Promise<void>;
    signup: (payload: SignupPayload) => Promise<void>;
    requestAccess: (payload: AccessRequestPayload) => Promise<void>;
    changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
    /**
     * Permanently delete the signed-in account, then erase what it left on this
     * device. Rejects without touching local state when the server refuses.
     */
    deleteAccount: (currentPassword: string) => Promise<void>;
    /** Patch the stored session's nextStep without requiring a full re-login. */
    updateNextStep: (nextStep: string) => Promise<void>;
    logout: () => Promise<void>;
    clearError: () => void;
}

/**
 * Global auth state store for session management and route gating.
 */
export const useAuthStore = create<AuthStoreState>((set, get) => ({
    status: "loading",
    session: null,
    isSubmitting: false,
    errorMessage: null,

    initialize: async () => {
        const currentStatus = get().status;
        if (currentStatus !== "loading") {
            return;
        }

        try {
            const persistedSession = await readAuthSession();
            if (
                persistedSession === null ||
                isSessionExpired(persistedSession) ||
                persistedSession.user.accountType !== "AUDITOR"
            ) {
                if (persistedSession !== null) {
                    await clearAuthSession();
                }

                set(() => ({
                    session: null,
                    status: "unauthenticated",
                }));
                return;
            }

            set(() => ({
                session: persistedSession,
                status: "authenticated",
            }));
        } catch {
            set(() => ({
                session: null,
                status: "unauthenticated",
            }));
        }
    },

    login: async (payload: LoginPayload) => {
        set(() => ({
            isSubmitting: true,
            errorMessage: null,
        }));

        try {
            const session = await loginWithPassword(payload);
            await saveAuthSession(session);

            set(() => ({
                session,
                status: "authenticated",
                isSubmitting: false,
                errorMessage: null,
            }));
        } catch (error) {
            const message = toAuthErrorMessage(error);

            set(() => ({
                session: null,
                status: "unauthenticated",
                isSubmitting: false,
                errorMessage: message,
            }));

            throw error;
        }
    },

    signup: async (payload: SignupPayload) => {
        set(() => ({
            isSubmitting: true,
            errorMessage: null,
        }));

        try {
            const session = await signupWithPassword(payload);
            await saveAuthSession(session);

            set(() => ({
                session,
                status: "authenticated",
                isSubmitting: false,
                errorMessage: null,
            }));
        } catch (error) {
            const message = toAuthErrorMessage(error);

            set(() => ({
                session: null,
                status: "unauthenticated",
                isSubmitting: false,
                errorMessage: message,
            }));

            throw error;
        }
    },

    requestAccess: async (payload: AccessRequestPayload) => {
        set(() => ({
            isSubmitting: true,
            errorMessage: null,
        }));

        try {
            await requestAccess(payload);

            set(() => ({
                isSubmitting: false,
                errorMessage: null,
            }));
        } catch (error) {
            const message = toAuthErrorMessage(error);

            set(() => ({
                isSubmitting: false,
                errorMessage: message,
            }));

            throw error;
        }
    },

    changePassword: async (currentPassword: string, newPassword: string) => {
        const session = useAuthStore.getState().session;

        set(() => ({
            isSubmitting: true,
            errorMessage: null,
        }));

        try {
            if (session === null) {
                throw new Error("Not authenticated.");
            }
            await changePassword(session, currentPassword, newPassword);

            set(() => ({
                isSubmitting: false,
                errorMessage: null,
            }));
        } catch (error) {
            const message = toAuthErrorMessage(error);

            set(() => ({
                isSubmitting: false,
                errorMessage: message,
            }));

            throw error;
        }
    },

    deleteAccount: async (currentPassword: string) => {
        const session = get().session;
        if (session === null) {
            throw new Error("Not authenticated.");
        }

        set(() => ({
            isSubmitting: true,
            errorMessage: null,
        }));

        try {
            // Nothing local is touched until the server confirms the deletion.
            // A rejected or unreachable request leaves the session, the audit
            // snapshot, and every queued submission exactly as they were.
            await requestAccountDeletion(session, currentPassword);
        } catch (error) {
            set(() => ({
                isSubmitting: false,
                errorMessage: toAuthErrorMessage(error),
            }));
            throw error;
        }

        // The account no longer exists: the local copy of its work has nowhere
        // left to sync, so it is erased rather than preserved as sign-out does.
        await purgeLocalAccountData(session.user.id);

        set(() => ({
            session: null,
            status: "unauthenticated",
            isSubmitting: false,
            errorMessage: null,
        }));
    },

    updateNextStep: async (nextStep: string) => {
        const currentSession = get().session;
        if (currentSession === null) {
            return;
        }

        const updatedSession: AuthSession = {
            ...currentSession,
            user: { ...currentSession.user, nextStep },
        };

        await saveAuthSession(updatedSession);
        set(() => ({ session: updatedSession }));
    },

    logout: async () => {
        const currentSession = get().session;
        if (currentSession !== null) {
            const auditStore = usePlayspaceAuditStore.getState();
            if (auditStore.hasUnsyncedAuditWork(currentSession.user.id)) {
                // Sign-out must never delete audit work the server has not
                // acknowledged; the persisted snapshot stays on-device and
                // resumes syncing on the next sign-in to this account.
                await auditStore.detachStoredState();
            } else {
                await auditStore.clearStoredState(currentSession.user.id);
            }
        }
        await unregisterAuditBackgroundTaskAsync().catch(() => undefined);
        await clearNotificationsCache();
        await clearAuthSession();
        set(() => ({
            session: null,
            status: "unauthenticated",
            isSubmitting: false,
            errorMessage: null,
        }));
    },

    clearError: () => {
        set(() => ({
            errorMessage: null,
        }));
    },
}));

/**
 * Determine whether a session should be treated as expired.
 *
 * @param session Auth session to inspect.
 * @returns True when expired or invalid timestamp.
 */
function isSessionExpired(session: AuthSession): boolean {
    const expiresAtTimestamp = Date.parse(session.expiresAt);
    if (Number.isNaN(expiresAtTimestamp)) {
        return true;
    }

    return expiresAtTimestamp <= Date.now();
}

/**
 * Convert unknown auth error values to a user-facing message.
 *
 * @param error Unknown error value.
 * @returns Readable error message.
 */
function toAuthErrorMessage(error: unknown): string {
    if (error instanceof AuthApiError) {
        if (error.details !== null && error.details.trim().length > 0) {
            return error.details;
        }

        if (error.statusCode === 0) {
            return t("auth:errors.serviceUnavailable", { ns: "auth" });
        }

        if (error.statusCode === 403) {
            return t("auth:errors.assignedParticipantOnly", { ns: "auth" });
        }

        return t("auth:errors.authFailed", { ns: "auth" });
    }

    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }

    return t("auth:errors.unexpected", { ns: "auth" });
}
