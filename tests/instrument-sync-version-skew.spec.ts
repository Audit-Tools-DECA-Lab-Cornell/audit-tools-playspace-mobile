import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUNDLED_INSTRUMENT_VERSION } from "lib/audit/bundled-instrument";
import { playspaceInstrumentSchema } from "lib/audit/types";

/**
 * A backend serving an instrument older than the one the build ships is not a
 * client bug and not a crash - it just quietly renders fewer features, because
 * anything the newer version added arrives absent and falls back to its default
 * (a multi-select scale without `selection_mode` becomes single-select). That is
 * exactly how a stale deployment hides behind a correct app, so the sync has to
 * say something when it happens.
 */

const warnings = vi.hoisted(() => [] as { readonly metadata: Record<string, unknown>; readonly message: string }[]);
const mmkvData = vi.hoisted(() => new Map<string, string>());

vi.mock("react-native-mmkv", () => ({
    createMMKV: () => ({
        getString: (key: string) => mmkvData.get(key),
        set: (key: string, value: string) => {
            mmkvData.set(key, value);
        },
        remove: (key: string) => {
            mmkvData.delete(key);
        },
        getAllKeys: () => [...mmkvData.keys()],
    }),
}));

vi.mock("expo-network", () => ({
    getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
}));

vi.mock("lib/api-base-url", () => ({
    getApiBaseUrl: () => "http://127.0.0.1:8000",
}));

vi.mock("lib/logger", () => {
    const withMetadata = (metadata: Record<string, unknown>) => ({
        warn: (message: string) => {
            warnings.push({ metadata, message });
        },
        info: () => {},
        debug: () => {},
        error: () => {},
    });
    return {
        createModuleLogger: () => ({
            info: () => {},
            debug: () => {},
            error: () => {},
            warn: (message: string) => {
                warnings.push({ metadata: {}, message });
            },
            withMetadata,
            withError: () => withMetadata({}),
        }),
    };
});

const { syncInstrument } = await import("lib/services/instrument-sync");

/** Build a minimal valid instrument payload stamped with the given version. */
function buildServerInstrument(instrumentVersion: string): unknown {
    return playspaceInstrumentSchema.parse({
        instrument_key: "pvua_v5_2",
        instrument_name: "COPA",
        instrument_version: instrumentVersion,
        current_sheet: `COPA ${instrumentVersion}`,
        source_files: [],
        preamble: [],
        execution_modes: [{ key: "audit", label: "Place Audit", description: null }],
        pre_audit_questions: [],
        scale_guidance: [],
        sections: [],
        legal_documents: [],
    });
}

function stubServerVersion(instrumentVersion: string): void {
    vi.stubGlobal("fetch", async () => ({
        ok: true,
        status: 200,
        json: async () => buildServerInstrument(instrumentVersion),
    }));
}

function skewWarnings(): typeof warnings {
    return warnings.filter((entry) => entry.message.includes("older than the bundled instrument"));
}

describe("instrument sync version skew", () => {
    beforeEach(() => {
        warnings.length = 0;
        mmkvData.clear();
        vi.unstubAllGlobals();
    });

    it("warns and still returns the server version when the backend is behind the bundle", async () => {
        // 5.31 is the last version that predates the Sociability multi-select
        // contract, so this is the exact shape of the production skew.
        stubServerVersion("5.31");

        const resolved = await syncInstrument();

        expect(resolved?.instrument_version).toBe("5.31");
        const skew = skewWarnings();
        expect(skew).toHaveLength(1);
        expect(skew[0]?.metadata).toMatchObject({
            serverInstrumentVersion: "5.31",
            bundledInstrumentVersion: BUNDLED_INSTRUMENT_VERSION,
        });
    });

    it("stays quiet when the server matches the bundled version", async () => {
        stubServerVersion(BUNDLED_INSTRUMENT_VERSION);

        const resolved = await syncInstrument();

        expect(resolved?.instrument_version).toBe(BUNDLED_INSTRUMENT_VERSION);
        expect(skewWarnings()).toHaveLength(0);
    });

    it("stays quiet when the server is ahead of the bundle", async () => {
        // A server newer than the build is the normal state right after a
        // backend deploy and must not be reported as a problem.
        stubServerVersion("5.99");

        const resolved = await syncInstrument();

        expect(resolved?.instrument_version).toBe("5.99");
        expect(skewWarnings()).toHaveLength(0);
    });
});
