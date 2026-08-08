import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "lib/auth/types";
import type { Notification } from "lib/notifications/api";
import {
    NOTIFICATION_POLL_BASE_INTERVAL_MS,
    NOTIFICATION_POLL_JITTER_MAX_MS,
    computeNotificationPollIntervalMs,
} from "lib/notifications/polling";
import type { AuthStoreState } from "stores/auth-store";
import { useNotificationsStore } from "stores/notifications-store";

const mocks = vi.hoisted(() => {
    const cacheData: Notification[] = [];
    return {
        cacheData,
        getNotifications: vi.fn(),
        getUnreadCount: vi.fn(),
        markNotificationAsRead: vi.fn(),
        markAllNotificationsAsRead: vi.fn(),
        authGetState: vi.fn(),
        loadNotificationsCache: vi.fn(async (): Promise<Notification[]> => [...cacheData]),
        saveNotificationsCache: vi.fn(async (list: Notification[]) => {
            cacheData.length = 0;
            cacheData.push(...list);
        }),
        clearNotificationsCache: vi.fn(async () => {
            cacheData.length = 0;
        }),
        resetCacheData: (): void => {
            cacheData.length = 0;
        },
        loadPlaces: vi.fn().mockResolvedValue(undefined),
        loadDashboardSummary: vi.fn().mockResolvedValue(undefined),
        refreshCachedAuditSessions: vi.fn().mockResolvedValue(undefined),
    };
});

vi.mock("lib/notifications/api", () => ({
    getNotifications: mocks.getNotifications,
    getUnreadCount: mocks.getUnreadCount,
    markNotificationAsRead: mocks.markNotificationAsRead,
    markAllNotificationsAsRead: mocks.markAllNotificationsAsRead,
}));

vi.mock("stores/places-store", () => ({
    usePlacesStore: Object.assign(vi.fn(), {
        getState: () => ({
            loadPlaces: mocks.loadPlaces,
            loadDashboardSummary: mocks.loadDashboardSummary,
            clearError: vi.fn(),
            places: [],
        }),
    }),
}));

vi.mock("stores/audit-store", () => ({
    usePlayspaceAuditStore: Object.assign(vi.fn(), {
        getState: () => ({
            refreshCachedAuditSessions: mocks.refreshCachedAuditSessions,
        }),
    }),
}));

vi.mock("lib/storage/notification-cache", () => ({
    loadNotificationsCache: mocks.loadNotificationsCache,
    saveNotificationsCache: mocks.saveNotificationsCache,
    clearNotificationsCache: mocks.clearNotificationsCache,
}));

vi.mock("stores/auth-store", () => ({
    useAuthStore: Object.assign(vi.fn(), {
        getState: mocks.authGetState,
    }),
}));

/**
 * Builds a valid auth session for mocked authenticated flows.
 */
function createMockSession(): AuthSession {
    return {
        accessToken: "test-access-token",
        tokenType: "bearer",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        user: {
            id: "00000000-0000-4000-8000-000000000001",
            email: "auditor@example.com",
            name: "Test Auditor",
            accountType: "AUDITOR",
            approved: true,
            profileCompleted: true,
            nextStep: "DASHBOARD",
            organization: null,
        },
    };
}

/**
 * Returns a complete auth snapshot for `useAuthStore.getState()` mocks.
 */
function createAuthenticatedAuthState(): AuthStoreState {
    return {
        status: "authenticated",
        session: createMockSession(),
        isSubmitting: false,
        errorMessage: null,
        initialize: vi.fn(),
        login: vi.fn(),
        signup: vi.fn(),
        requestAccess: vi.fn(),
        changePassword: vi.fn(),
        deleteAccount: vi.fn(),
        updateNextStep: vi.fn(),
        logout: vi.fn(),
        clearError: vi.fn(),
    };
}

/**
 * Returns an unauthenticated auth snapshot.
 */
function createUnauthenticatedAuthState(): AuthStoreState {
    return {
        status: "unauthenticated",
        session: null,
        isSubmitting: false,
        errorMessage: null,
        initialize: vi.fn(),
        login: vi.fn(),
        signup: vi.fn(),
        requestAccess: vi.fn(),
        changePassword: vi.fn(),
        deleteAccount: vi.fn(),
        updateNextStep: vi.fn(),
        logout: vi.fn(),
        clearError: vi.fn(),
    };
}

/**
 * Builds a notification row matching `notificationSchema` in `lib/notifications/api`.
 */
function createMockNotification(id: string, isRead: boolean): Notification {
    return {
        id,
        message: "Test notification message",
        notification_type: "ASSIGNMENT_CREATED",
        is_read: isRead,
        related_entity_type: "assignment",
        related_entity_id: "22222222-2222-4222-8222-222222222222",
        created_at: "2024-06-01T12:00:00.000Z",
    };
}

describe("notifications polling (TASK-012)", () => {
    it("uses a 30s base with jitter capped at 5s", () => {
        expect(NOTIFICATION_POLL_BASE_INTERVAL_MS).toBe(30000);
        expect(NOTIFICATION_POLL_JITTER_MAX_MS).toBe(5000);
    });

    it("computes interval in the 30s–35s range based on Math.random", () => {
        const spy = vi.spyOn(Math, "random").mockReturnValue(0);
        expect(computeNotificationPollIntervalMs()).toBe(30000);
        spy.mockReturnValue(1);
        expect(computeNotificationPollIntervalMs()).toBe(35000);
        spy.mockRestore();
    });

    it("produces different intervals when random differs between calls", () => {
        const spy = vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.5);
        const first = computeNotificationPollIntervalMs();
        const second = computeNotificationPollIntervalMs();
        expect(second).toBeGreaterThan(first);
        spy.mockRestore();
    });
});

describe("notifications store", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resetCacheData();
        mocks.getNotifications.mockResolvedValue([]);
        mocks.getUnreadCount.mockResolvedValue(0);
        mocks.markNotificationAsRead.mockResolvedValue(undefined);
        mocks.markAllNotificationsAsRead.mockResolvedValue(0);
        mocks.authGetState.mockReturnValue(createAuthenticatedAuthState());
        useNotificationsStore.setState({
            notifications: [],
            unreadCount: 0,
            isLoading: false,
            error: null,
            panelOpen: false,
        });
    });

    it("fetchNotifications loads rows from the API and persists cache", async () => {
        const rows = [
            createMockNotification("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", true),
            createMockNotification("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", true),
        ];
        mocks.getNotifications.mockResolvedValue(rows);

        await useNotificationsStore.getState().fetchNotifications();

        const state = useNotificationsStore.getState();
        expect(state.notifications).toHaveLength(2);
        expect(state.unreadCount).toBe(0);
        expect(state.isLoading).toBe(false);
        expect(state.error).toBeNull();
        expect(mocks.saveNotificationsCache).toHaveBeenCalledWith(rows);
        expect(mocks.loadPlaces).not.toHaveBeenCalled();
    });

    it("fetchNotifications sets an error when signed out", async () => {
        mocks.authGetState.mockReturnValue(createUnauthenticatedAuthState());

        await useNotificationsStore.getState().fetchNotifications();

        const state = useNotificationsStore.getState();
        expect(state.error).toBe("Not signed in");
        expect(state.isLoading).toBe(false);
    });

    it("markAsRead applies optimistic read state then confirms with the API", async () => {
        const row = createMockNotification("cccccccc-cccc-4ccc-8ccc-cccccccccccc", false);
        useNotificationsStore.setState({
            notifications: [row],
            unreadCount: 1,
        });

        await useNotificationsStore.getState().markAsRead(row.id);

        const state = useNotificationsStore.getState();
        expect(state.notifications[0]?.is_read).toBe(true);
        expect(state.unreadCount).toBe(0);
        expect(mocks.markNotificationAsRead).toHaveBeenCalledTimes(1);
        expect(mocks.markNotificationAsRead.mock.calls[0]?.[1]).toBe(row.id);
    });

    it("markAsRead rolls back when the API rejects", async () => {
        const row = createMockNotification("dddddddd-dddd-4ddd-8ddd-dddddddddddd", false);
        useNotificationsStore.setState({
            notifications: [row],
            unreadCount: 1,
        });
        mocks.markNotificationAsRead.mockRejectedValue(new Error("network"));

        await useNotificationsStore.getState().markAsRead(row.id);

        const state = useNotificationsStore.getState();
        expect(state.notifications[0]?.is_read).toBe(false);
        expect(state.unreadCount).toBe(1);
        expect(state.error).toBe("Failed to mark notification as read");
    });

    it("markAllAsRead marks every row read and uses the API count", async () => {
        useNotificationsStore.setState({
            notifications: [
                createMockNotification("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", false),
                createMockNotification("ffffffff-ffff-4fff-8fff-ffffffffffff", false),
            ],
            unreadCount: 2,
        });
        mocks.markAllNotificationsAsRead.mockResolvedValue(2);

        await useNotificationsStore.getState().markAllAsRead();

        const state = useNotificationsStore.getState();
        expect(state.notifications.every((n) => n.is_read)).toBe(true);
        expect(state.unreadCount).toBe(0);
    });

    it("markAllAsRead rolls back when the API rejects", async () => {
        const rows = [
            createMockNotification("11111111-1111-4111-8111-111111111111", false),
            createMockNotification("22222222-2222-4222-8222-222222222222", false),
        ];
        useNotificationsStore.setState({
            notifications: rows,
            unreadCount: 2,
        });
        mocks.markAllNotificationsAsRead.mockRejectedValue(new Error("server"));

        await useNotificationsStore.getState().markAllAsRead();

        const state = useNotificationsStore.getState();
        expect(state.notifications[0]?.is_read).toBe(false);
        expect(state.unreadCount).toBe(2);
        expect(state.error).toBe("Failed to mark all notifications as read");
    });

    it("fetchNotifications reloads places and cached audits when unread count increases from network", async () => {
        useNotificationsStore.setState({ notifications: [], unreadCount: 0 });
        const rows = [createMockNotification("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", false)];
        mocks.getNotifications.mockResolvedValue(rows);

        await useNotificationsStore.getState().fetchNotifications();

        expect(useNotificationsStore.getState().unreadCount).toBe(1);
        expect(mocks.loadPlaces).toHaveBeenCalledTimes(1);
        const sessionForRefresh = mocks.loadPlaces.mock.calls[0]?.[0];
        expect(mocks.loadDashboardSummary).toHaveBeenCalledTimes(1);
        expect(mocks.loadDashboardSummary.mock.calls[0]?.[0]).toBe(sessionForRefresh);
        expect(mocks.refreshCachedAuditSessions).toHaveBeenCalledWith(sessionForRefresh);
    });

    it("refreshUnreadCount updates the count and skips assignment refresh when it does not increase", async () => {
        useNotificationsStore.setState({ unreadCount: 7 });
        mocks.getUnreadCount.mockResolvedValue(7);

        await useNotificationsStore.getState().refreshUnreadCount();

        expect(useNotificationsStore.getState().unreadCount).toBe(7);
        expect(mocks.loadPlaces).not.toHaveBeenCalled();
        expect(mocks.loadDashboardSummary).not.toHaveBeenCalled();
        expect(mocks.refreshCachedAuditSessions).not.toHaveBeenCalled();
    });

    it("refreshUnreadCount reloads places and cached audits when unread count increases", async () => {
        mocks.getUnreadCount.mockResolvedValue(3);

        await useNotificationsStore.getState().refreshUnreadCount();

        expect(useNotificationsStore.getState().unreadCount).toBe(3);
        expect(mocks.loadPlaces).toHaveBeenCalledTimes(1);
        const sessionForRefresh = mocks.loadPlaces.mock.calls[0]?.[0];
        expect(mocks.loadDashboardSummary).toHaveBeenCalledTimes(1);
        expect(mocks.loadDashboardSummary.mock.calls[0]?.[0]).toBe(sessionForRefresh);
        expect(mocks.refreshCachedAuditSessions).toHaveBeenCalledWith(sessionForRefresh);
    });

    it("refreshUnreadCount is a no-op when signed out", async () => {
        mocks.authGetState.mockReturnValue(createUnauthenticatedAuthState());

        await useNotificationsStore.getState().refreshUnreadCount();

        expect(mocks.getUnreadCount).not.toHaveBeenCalled();
    });

    it("open and close panel only toggle panelOpen", () => {
        useNotificationsStore.getState().openNotificationsPanel();
        expect(useNotificationsStore.getState().panelOpen).toBe(true);
        useNotificationsStore.getState().closeNotificationsPanel();
        expect(useNotificationsStore.getState().panelOpen).toBe(false);
    });

    it("clearError resets the error field", () => {
        useNotificationsStore.setState({ error: "x" });
        useNotificationsStore.getState().clearError();
        expect(useNotificationsStore.getState().error).toBeNull();
    });

    it("keeps cached notifications visible when the API fails after cache hydration", async () => {
        const cached = [createMockNotification("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", false)];
        mocks.loadNotificationsCache.mockResolvedValueOnce(cached);
        mocks.getNotifications.mockRejectedValue(new Error("offline"));

        await useNotificationsStore.getState().fetchNotifications();

        const state = useNotificationsStore.getState();
        expect(state.notifications).toHaveLength(1);
        expect(state.error).toBeNull();
        expect(state.isLoading).toBe(false);
    });

    it("surfaces an error when fetch fails and there is no cache", async () => {
        mocks.getNotifications.mockRejectedValue(new Error("offline"));

        await useNotificationsStore.getState().fetchNotifications();

        const state = useNotificationsStore.getState();
        expect(state.notifications).toHaveLength(0);
        expect(state.error).toBe("offline");
    });

    it("clearNotificationsCache helper clears the in-memory mock cache", async () => {
        mocks.cacheData.push(createMockNotification("99999999-9999-4999-8999-999999999999", false));
        await mocks.clearNotificationsCache();
        const after = await mocks.loadNotificationsCache();
        expect(after).toHaveLength(0);
    });
});
