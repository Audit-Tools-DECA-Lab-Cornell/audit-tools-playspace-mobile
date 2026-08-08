import { t } from "i18next";
import { getApiBaseUrl } from "lib/api-base-url";
import {
    AuditDraftPatch,
    auditDraftPatchSchema,
    AuditDraftSave,
    auditDraftSaveSchema,
    AuditSession,
    auditSessionSchema,
    ExecutionMode,
    executionModeSchema,
} from "lib/audit/types";
import type { AuthSession } from "lib/auth/types";
import { z } from "zod";

/**
 * Default network request timeout in milliseconds. Applied to every
 * `requestJson` call unless the caller overrides it via `options.timeoutMs`.
 *
 * 20 seconds gives the server time to respond under poor connectivity while
 * still failing fast when the OS reports a connection that has no real path
 * to the internet (the common false-positive that causes indefinite hangs).
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

/**
 * Structured API error for COPA audit API requests.
 */
export class PlayspaceAuditApiError extends Error {
    readonly statusCode: number;
    readonly details: string | null;

    constructor(message: string, statusCode: number, details: string | null = null) {
        super(message);
        this.name = "PlayspaceAuditApiError";
        this.statusCode = statusCode;
        this.details = details;
    }
}

/**
 * Create or resume the active audit draft for a place.
 *
 * @param session Authenticated mobile session.
 * @param placeId UUID of the place being audited.
 * @param projectId UUID of the project under which the audit is being run.
 * @param executionMode Optional user-selected execution mode.
 * @returns Validated audit session payload.
 */
export async function createOrResumeAudit(
    session: AuthSession,
    placeId: string,
    projectId: string,
    executionMode?: ExecutionMode,
): Promise<AuditSession> {
    const payload = executionModeSchema.optional().safeParse(executionMode);
    if (!payload.success) {
        throw new PlayspaceAuditApiError(
            t("executionModeIsInvalid", "Execution mode is invalid."),
            400,
            payload.error.message,
        );
    }

    const responsePayload = await requestJson(
        session,
        `/playspace/places/${encodeURIComponent(placeId)}/audits/access`,
        {
            method: "POST",
            body: JSON.stringify({
                project_id: projectId,
                execution_mode: payload.data ?? null,
            }),
        },
    );
    return parsePayload(
        responsePayload,
        auditSessionSchema,
        t("auditSessionResponseShapeIsInvalid", "Audit session response shape is invalid."),
    );
}

/**
 * Fetch the latest server-side state for one audit.
 *
 * @param session Authenticated mobile session.
 * @param auditId UUID of the audit session.
 * @returns Validated audit session payload.
 */
export async function fetchAuditSession(session: AuthSession, auditId: string): Promise<AuditSession> {
    const payload = await requestJson(session, `/playspace/audits/${encodeURIComponent(auditId)}`, {
        method: "GET",
    });
    return parsePayload(payload, auditSessionSchema, "Audit session response shape is invalid.");
}

/**
 * Save a partial draft patch for the current audit.
 *
 * @param session Authenticated mobile session.
 * @param auditId UUID of the audit session.
 * @param patch Typed draft patch.
 * @returns Validated draft-save acknowledgement payload.
 */
export async function saveAuditDraft(
    session: AuthSession,
    auditId: string,
    patch: AuditDraftPatch,
): Promise<AuditDraftSave> {
    const parsedPatch = auditDraftPatchSchema.safeParse(patch);
    if (!parsedPatch.success) {
        throw new PlayspaceAuditApiError(
            t("draftPatchIsInvalid", "Draft patch is invalid."),
            400,
            parsedPatch.error.message,
        );
    }

    const payload = await requestJson(session, `/playspace/audits/${encodeURIComponent(auditId)}/draft`, {
        method: "PATCH",
        body: JSON.stringify(parsedPatch.data),
    });
    return parsePayload(payload, auditDraftSaveSchema, "Audit draft save response shape is invalid.");
}

/**
 * Submit the current audit and receive calculated scores.
 *
 * @param session Authenticated mobile session.
 * @param auditId UUID of the audit session.
 * @param expectedRevision Optional optimistic concurrency base revision.
 * @returns Validated submitted audit session payload.
 */
export async function submitAudit(
    session: AuthSession,
    auditId: string,
    expectedRevision?: number,
): Promise<AuditSession> {
    const payload = await requestJson(session, `/playspace/audits/${encodeURIComponent(auditId)}/submit`, {
        method: "POST",
        // The audit id is the idempotency key: a submit retried after an ambiguous
        // network failure returns the already-submitted session instead of a 409,
        // so the client never enters conflict recovery.
        body: JSON.stringify({
            idempotency_key: auditId,
            ...(expectedRevision === undefined ? {} : { expected_revision: expectedRevision }),
        }),
    });
    return parsePayload(payload, auditSessionSchema, "Audit session response shape is invalid.");
}

/**
 * Record the auditor's intent to submit an audit (the submit-intent beacon).
 *
 * Sent when the auditor taps submit, ahead of and independently from the submit
 * request, so the server's never-arrived detector can email the auditor even if
 * the submission itself never completes. Best-effort - failures (e.g. offline)
 * are swallowed because the next reconnect drain re-sends it.
 *
 * @param session Authenticated mobile session.
 * @param auditId UUID of the audit the auditor intends to submit.
 * @param clientIntendedAt ISO timestamp the auditor tapped submit on-device.
 */
export async function recordSubmitIntentAsync(
    session: AuthSession,
    auditId: string,
    clientIntendedAt?: string,
): Promise<void> {
    try {
        await requestJson(session, `/playspace/audits/${encodeURIComponent(auditId)}/submit-intent`, {
            method: "POST",
            body: JSON.stringify(clientIntendedAt === undefined ? {} : { client_intended_at: clientIntendedAt }),
        });
    } catch {
        // Best-effort beacon; the reconnect drain re-sends and the server-side
        // never-arrived detector is the ultimate backstop.
    }
}

/**
 * Request the backend to notify the auditor that their offline-queued submit
 * could not be processed. Best-effort - silently ignored if the endpoint is not
 * yet implemented on the server.
 *
 * @param session Authenticated mobile session.
 * @param auditId UUID of the audit that failed to submit.
 */
export async function notifySubmitFailureAsync(session: AuthSession, auditId: string): Promise<void> {
    try {
        await requestJson(session, `/playspace/audits/${encodeURIComponent(auditId)}/notify-submit-failure`, {
            method: "POST",
            body: JSON.stringify({}),
        });
    } catch {
        // Best-effort; backend endpoint may not be implemented yet
    }
}

/**
 * Per-call options for `requestJson`.
 */
export interface RequestJsonOptions {
    /**
     * Request timeout in milliseconds. Defaults to `DEFAULT_REQUEST_TIMEOUT_MS`.
     * The underlying fetch is aborted (not just race-rejected) when the timeout
     * fires, releasing any held connections.
     */
    timeoutMs?: number;
}

/**
 * Execute an authenticated playspace API request and decode JSON.
 *
 * A timeout abort is always in effect. If the caller also passes `init.signal`,
 * both signals are honored: the fetch aborts when either the timeout fires or
 * the caller's signal fires, whichever comes first.
 *
 * @param session Authenticated mobile session.
 * @param path Backend path relative to the API root.
 * @param init Fetch request options. `init.signal` is honored alongside the
 *   built-in timeout signal.
 * @param options Per-call overrides. Pass `{ timeoutMs: N }` to use a timeout
 *   other than `DEFAULT_REQUEST_TIMEOUT_MS`.
 * @returns Parsed unknown JSON payload.
 */
export async function requestJson(
    session: AuthSession,
    path: string,
    init: RequestInit,
    options?: RequestJsonOptions,
): Promise<unknown> {
    const response = await performAuthenticatedRequest(session, path, init, options);

    try {
        return await response.json();
    } catch {
        throw new PlayspaceAuditApiError(
            t("playspaceAuditServiceReturnedInvalidJson", "COPA audit service returned invalid JSON."),
            500,
        );
    }
}

/**
 * Execute an authenticated playspace API request that returns no body.
 *
 * Same transport, timeout, and error semantics as `requestJson`, but the
 * response body is never read - the caller only cares that the request
 * succeeded. Use for endpoints that answer `204 No Content`, where parsing JSON
 * would fail on an empty body.
 *
 * @param session Authenticated mobile session.
 * @param path Backend path relative to the API root.
 * @param init Fetch request options.
 * @param options Per-call overrides such as `timeoutMs`.
 */
export async function requestNoContent(
    session: AuthSession,
    path: string,
    init: RequestInit,
    options?: RequestJsonOptions,
): Promise<void> {
    await performAuthenticatedRequest(session, path, init, options);
}

/**
 * Shared transport for authenticated playspace requests: applies the auth
 * headers, enforces the timeout, and converts transport and HTTP failures into
 * `PlayspaceAuditApiError`. Returns the raw successful response so callers
 * decide whether a body is expected.
 *
 * @param session Authenticated mobile session.
 * @param path Backend path relative to the API root.
 * @param init Fetch request options. `init.signal` is honored alongside the
 *   built-in timeout signal.
 * @param options Per-call overrides.
 * @returns The successful response, body unread.
 */
async function performAuthenticatedRequest(
    session: AuthSession,
    path: string,
    init: RequestInit,
    options?: RequestJsonOptions,
): Promise<Response> {
    const baseUrl = getApiBaseUrl();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    // Create a local AbortController that fires on timeout.
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => {
        timeoutController.abort();
    }, timeoutMs);

    // Resolve the effective signal: if the caller supplied a signal, honor both.
    // AbortSignal.any() is declared in TypeScript's lib.dom.d.ts but is not
    // implemented by the abort-controller v3 polyfill that Hermes / RN 0.83
    // ships. Guard with a runtime typeof check and fall back to a manual
    // listener when it is absent.
    let effectiveSignal: AbortSignal;
    const callerSignal = init.signal instanceof AbortSignal ? init.signal : undefined;

    if (callerSignal === undefined) {
        effectiveSignal = timeoutController.signal;
    } else if (typeof AbortSignal.any === "function") {
        effectiveSignal = AbortSignal.any([timeoutController.signal, callerSignal]);
    } else {
        // Polyfill path: wire the caller's signal so it also aborts the
        // timeout controller, then use that single controller's signal.
        callerSignal.addEventListener("abort", () => {
            timeoutController.abort();
        });
        effectiveSignal = timeoutController.signal;
    }

    let response: Response;

    try {
        response = await fetch(`${baseUrl}${path}`, {
            ...init,
            signal: effectiveSignal,
            headers: {
                ...buildAuthenticatedHeaders(session),
                ...toHeaderRecord(init.headers),
            },
        });
    } catch (error) {
        // Treat an abort (timeout or caller cancellation) as a transient network
        // failure so catch blocks in submit paths derive a blocked/offline state
        // rather than a validation or auth error.
        const message = error instanceof Error ? error.message : t("networkRequestFailed", "Network request failed.");
        throw new PlayspaceAuditApiError(
            t("unableToReachPlayspaceAuditService", "Unable to reach COPA audit service."),
            0,
            message,
        );
    } finally {
        clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
        const details = await readErrorDetails(response);
        throw new PlayspaceAuditApiError(
            t("playspaceAuditRequestFailed", "COPA audit request failed."),
            response.status,
            details,
        );
    }

    return response;
}

/**
 * Build the auth headers expected by the COPA audit backend.
 *
 * @param session Authenticated mobile session.
 * @returns Stable headers for the COPA audit backend.
 */
function buildAuthenticatedHeaders(session: AuthSession): Record<string, string> {
    return {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `${session.tokenType} ${session.accessToken}`,
    };
}

/**
 * Normalize possibly mixed header inputs into a plain string record.
 *
 * @param headers Optional request headers.
 * @returns Plain string header object.
 */
function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> {
    if (headers === undefined) {
        return {};
    }

    const normalizedHeaders = new Headers(headers);
    const nextHeaders: Record<string, string> = {};
    for (const [headerKey, headerValue] of normalizedHeaders.entries()) {
        nextHeaders[headerKey] = headerValue;
    }
    return nextHeaders;
}

/**
 * Read a backend error payload safely.
 *
 * @param response Failed fetch response.
 * @returns Readable detail message when present.
 */
async function readErrorDetails(response: Response): Promise<string | null> {
    const contentType = response.headers.get("content-type") ?? "";
    const isJsonResponse = contentType.includes("application/json");
    if (!isJsonResponse) {
        return response.statusText || null;
    }

    try {
        const payload: unknown = await response.json();
        if (!isRecord(payload)) {
            return response.statusText || null;
        }

        if (typeof payload.detail === "string") {
            return payload.detail;
        }
        if (typeof payload.message === "string") {
            return payload.message;
        }
    } catch {
        return response.statusText || null;
    }

    return response.statusText || null;
}

/**
 * Parse a backend payload against a provided schema.
 *
 * @param payload Unknown backend payload.
 * @param schema Runtime validation schema.
 * @param message Error message when validation fails.
 * @returns Parsed schema output.
 */
export function parsePayload<TValue>(payload: unknown, schema: z.ZodType<TValue>, message: string): TValue {
    const parsedPayload = schema.safeParse(payload);
    if (!parsedPayload.success) {
        throw new PlayspaceAuditApiError(message, 500, parsedPayload.error.message);
    }

    return parsedPayload.data;
}

/**
 * Check that a value is a non-null object map.
 *
 * @param value Unknown value.
 * @returns True when the value is a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
