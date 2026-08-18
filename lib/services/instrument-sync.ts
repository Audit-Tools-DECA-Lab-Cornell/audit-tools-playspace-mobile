/**
 * Instrument synchronization service.
 *
 * Fetches the active instrument definition from the backend when online
 * and caches it in MMKV for offline use. Returns null when no instrument
 * is available (first launch offline before any sync).
 */

import * as Network from "expo-network";

import { getApiBaseUrl } from "lib/api-base-url";
import { getBundledInstrument } from "lib/audit/bundled-instrument";
import { compareInstrumentVersions, resolveActiveInstrumentSource } from "lib/audit/instrument-resolution";
import { createModuleLogger } from "lib/logger";
import { mmkvStorage } from "lib/storage/mmkv";
import { playspaceInstrumentSchema, type PlayspaceInstrument } from "lib/audit/types";

const log = createModuleLogger("instrument-sync");

const INSTRUMENT_CACHE_KEY = "playspace.instrument_cache";
const INSTRUMENT_CACHE_TIMESTAMP_KEY = "playspace.instrument_cache_ts";
const DEFAULT_INSTRUMENT_KEY = "pvua_v5_2";

/**
 * Fetch the active instrument definition from the backend API.
 *
 * @param instrumentKey Instrument identifier (default: pvua_v5_2).
 * @param lang Language code for the returned instrument (default: en).
 * @returns Parsed instrument payload or null on failure.
 */
export async function fetchInstrumentFromApi(
    instrumentKey: string = DEFAULT_INSTRUMENT_KEY,
    lang: string = "en",
): Promise<PlayspaceInstrument | null> {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/playspace/instruments/active/${encodeURIComponent(instrumentKey)}?lang=${encodeURIComponent(lang)}`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" },
        });

        if (!response.ok) {
            log.withMetadata({ status: response.status, url }).warn("instrument fetch returned non-OK status");
            return null;
        }

        const payload: unknown = await response.json();
        const parsed = playspaceInstrumentSchema.safeParse(payload);
        if (!parsed.success) {
            log.withMetadata({ error: parsed.error.message }).warn("instrument fetch returned unexpected shape");
            return null;
        }

        return parsed.data;
    } catch (error) {
        log.withError(error).warn("instrument fetch failed");
        return null;
    }
}

/**
 * Read the locally cached instrument from MMKV storage.
 *
 * @returns Cached instrument or null when no cache exists.
 */
export function getCachedInstrument(): PlayspaceInstrument | null {
    try {
        const raw = mmkvStorage.getString(INSTRUMENT_CACHE_KEY);
        if (raw === undefined) {
            return null;
        }
        const parsed = playspaceInstrumentSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
            mmkvStorage.remove(INSTRUMENT_CACHE_KEY);
            mmkvStorage.remove(INSTRUMENT_CACHE_TIMESTAMP_KEY);
            return null;
        }
        return parsed.data;
    } catch (error) {
        log.withError(error).warn("failed to read cached instrument");
        return null;
    }
}

/**
 * Read the timestamp of the last successful instrument sync.
 *
 * @returns ISO timestamp string or null.
 */
export function getCachedInstrumentTimestamp(): string | null {
    return mmkvStorage.getString(INSTRUMENT_CACHE_TIMESTAMP_KEY) ?? null;
}

/**
 * Write an instrument payload to MMKV cache.
 *
 * @param instrument Instrument payload to cache.
 */
function cacheInstrument(instrument: PlayspaceInstrument): void {
    try {
        mmkvStorage.set(INSTRUMENT_CACHE_KEY, JSON.stringify(instrument));
        mmkvStorage.set(INSTRUMENT_CACHE_TIMESTAMP_KEY, new Date().toISOString());
    } catch (error) {
        log.withError(error).warn("failed to cache instrument");
    }
}

/**
 * Log when the server's active instrument is older than the one this build ships.
 *
 * The server stays authoritative on purpose: answers are stored and scored
 * against its definition, so rendering the newer bundled copy would produce
 * submissions the backend rejects. But an older server instrument silently
 * drops whatever the newer one added - a scale the build expects to declare
 * `selection_mode: "multiple"` simply arrives without it and falls back to
 * single-select, with nothing in the UI to say why. Surfacing the skew is what
 * separates "the deployment is behind" from "the feature is broken".
 *
 * @param fetched Instrument payload just returned by the backend.
 */
function warnWhenServerInstrumentIsBehindBundle(fetched: PlayspaceInstrument): void {
    const bundled = getBundledInstrument();
    if (bundled === null) {
        return;
    }

    if (compareInstrumentVersions(fetched.instrument_version, bundled.instrument_version) >= 0) {
        return;
    }

    log.withMetadata({
        serverInstrumentVersion: fetched.instrument_version,
        bundledInstrumentVersion: bundled.instrument_version,
    }).warn(
        "server instrument is older than the bundled instrument; rendering the server version, " +
            "so features added after the server's version stay inactive",
    );
}

/**
 * Synchronize the instrument definition.
 *
 * When online, fetches the latest active instrument from the backend and
 * caches it locally. When offline, returns the cached version. Returns null
 * only on first launch when offline and no cache exists.
 *
 * @param instrumentKey Instrument identifier.
 * @param lang Language code.
 * @returns The best available instrument definition, or null.
 */
export async function syncInstrument(
    instrumentKey: string = DEFAULT_INSTRUMENT_KEY,
    lang: string = "en",
): Promise<PlayspaceInstrument | null> {
    const netState = await Network.getNetworkStateAsync();
    const isOnline = netState.isConnected !== false && netState.isInternetReachable !== false;

    if (isOnline) {
        const fetched = await fetchInstrumentFromApi(instrumentKey, lang);
        if (fetched !== null) {
            warnWhenServerInstrumentIsBehindBundle(fetched);
            cacheInstrument(fetched);
            log.info("instrument synced from API");
            return fetched;
        }
    }

    const cached = getCachedInstrument();
    const bundled = getBundledInstrument();
    const resolved = resolveActiveInstrumentSource({
        fetchedInstrument: null,
        cachedInstrument: cached,
        bundledInstrument: bundled,
    });

    if (resolved !== null) {
        if (cached === null || compareInstrumentVersions(resolved.instrument_version, cached.instrument_version) > 0) {
            cacheInstrument(resolved);
        }

        if (cached !== null && resolved.instrument_version === cached.instrument_version) {
            log.info("using cached instrument");
        } else if (bundled !== null && resolved.instrument_version === bundled.instrument_version) {
            log.info("using bundled fallback instrument");
        } else {
            log.info("using locally resolved instrument");
        }

        return resolved;
    }

    log.warn("no instrument available (offline, no cache, bundled validation failed)");
    return null;
}
