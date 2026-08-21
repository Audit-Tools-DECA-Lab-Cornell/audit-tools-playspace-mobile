#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_SCHEME = "copa-mobile";
const DEFAULT_API_BASE_URL = "https://audit-tools-backend-zyde.onrender.com";
const DEFAULT_WAIT_MS = 20000;
const DEFAULT_LOGIN_WAIT_MS = 20000;
const DEFAULT_SCROLL_DELAY_MS = 450;
const DEFAULT_PLATFORM = "ios";
const DEFAULT_SIMULATOR = "booted";
const DEFAULT_ANDROID_DEVICE = "connected";
const FIRST_SECTION_FALLBACK = "section_1_playspace_character_community";

// Device commands must never hang the run. `am start -W` on a wedged emulator
// blocks for minutes before failing, so every device command gets a hard
// timeout and the run aborts once the device stops responding.
const DEVICE_COMMAND_TIMEOUT_MS = 60000;
const MAX_CONSECUTIVE_TARGET_FAILURES = 3;

const IOS_DEVICE_TYPES = ["iphone", "ipad"];
const ANDROID_DEVICE_TYPES = ["android-phone", "android-tablet"];
const TARGET_DEVICE_TYPES = [...IOS_DEVICE_TYPES, ...ANDROID_DEVICE_TYPES];

// Device-specific scroll positions. iPhone/iPad and their Android counterparts
// share offsets because the phone and tablet layouts expose the same amount of
// content at rest regardless of platform.
const IPHONE_EXECUTE_PLACE_SCROLL_Y = 170;
const IPHONE_SETTINGS_SCROLL_Y = 950;
const IPAD_PRE_AUDIT_SCROLL_Y = 250;

// Report detail is long on every device. The early frame is slightly above the
// old 700px shot to avoid repeated content; tail frames are first-pass values
// and should be tuned after a fresh capture run if the report content changes.
const REPORT_DETAIL_SCROLLS = {
    iphone: { early: 950, nearEnd: 20500, end: 22000 },
    ipad: { early: 850, end: 19000 },
    "android-phone": { early: 950, nearEnd: 20500, end: 22000 },
    "android-tablet": { early: 850, end: 19000 },
};

/**
 * Parse screenshot runner arguments.
 *
 * @param {readonly string[]} argv Raw CLI args.
 * @returns Parsed options.
 */
function parseArgs(argv) {
    const options = {
        apiBaseUrl: DEFAULT_API_BASE_URL,
        appearance: null, // null = auto (both light and dark)
        device: null, // null = auto-detect from booted simulator / connected device
        email: null,
        password: null,
        reset: true,
        scheme: DEFAULT_SCHEME,
        simulator: DEFAULT_SIMULATOR,
        waitMs: DEFAULT_WAIT_MS,
        loginWaitMs: DEFAULT_LOGIN_WAIT_MS,
        list: false,
        outputDir: null,
        platform: DEFAULT_PLATFORM,
        target: "all",
        androidDevice: DEFAULT_ANDROID_DEVICE,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
        if (arg === "--list") {
            options.list = true;
            continue;
        }
        if (arg === "--no-reset") {
            options.reset = false;
            continue;
        }

        const next = argv[index + 1];
        if (next === undefined || next.startsWith("--")) {
            throw new Error(`Missing value for ${arg}`);
        }

        if (arg === "--api-base-url") options.apiBaseUrl = stripTrailingSlash(next);
        else if (arg === "--appearance") options.appearance = next;
        else if (arg === "--device") options.device = next;
        else if (arg === "--email") options.email = next;
        else if (arg === "--password") options.password = next;
        else if (arg === "--platform") options.platform = next;
        else if (arg === "--scheme") options.scheme = next;
        else if (arg === "--simulator") options.simulator = next;
        else if (arg === "--android-device") options.androidDevice = next;
        else if (arg === "--wait-ms") options.waitMs = parsePositiveInteger(next, "--wait-ms");
        else if (arg === "--login-wait-ms")
            options.loginWaitMs = parsePositiveInteger(next, "--login-wait-ms");
        else if (arg === "--output-dir") options.outputDir = next;
        else if (arg === "--target") options.target = next;
        else throw new Error(`Unknown argument: ${arg}`);
        index += 1;
    }

    // Fall back to env vars when flags were not supplied. Unlike Expo, a plain
    // node script does not auto-load .env files, so load them here first.
    if (options.email === null || options.password === null) {
        loadEnvFiles();
    }
    if (options.email === null && typeof process.env.SCREENSHOT_EMAIL === "string") {
        options.email = process.env.SCREENSHOT_EMAIL.trim() || null;
    }
    if (options.password === null && typeof process.env.SCREENSHOT_PASSWORD === "string") {
        options.password = process.env.SCREENSHOT_PASSWORD || null;
    }

    if (!["ios", "android"].includes(options.platform)) {
        throw new Error('--platform must be "ios" or "android".');
    }
    if (options.device !== null && !TARGET_DEVICE_TYPES.includes(options.device)) {
        throw new Error('--device must be "iphone", "ipad", "android-phone", or "android-tablet".');
    }
    if (
        options.platform === "ios" &&
        options.device !== null &&
        !IOS_DEVICE_TYPES.includes(options.device)
    ) {
        throw new Error('--device must be "iphone" or "ipad" when --platform is ios.');
    }
    if (
        options.platform === "android" &&
        options.device !== null &&
        !ANDROID_DEVICE_TYPES.includes(options.device)
    ) {
        throw new Error(
            '--device must be "android-phone" or "android-tablet" when --platform is android.',
        );
    }
    if (options.platform === "android" && options.simulator !== DEFAULT_SIMULATOR) {
        throw new Error("--simulator is only supported for iOS. Use --android-device for Android.");
    }
    if (options.appearance !== null && !["light", "dark"].includes(options.appearance)) {
        throw new Error('--appearance must be "light" or "dark".');
    }

    return options;
}

function printHelp() {
    console.log(`Capture COPA mobile screenshots from booted iOS simulators or connected Android devices.

Usage:
  bun run screenshots:ios -- --email USER --password PASS
  bun run screenshots:ios -- --device iphone --appearance light --email USER --password PASS
  bun run screenshots:ios -- --device ipad --appearance dark --email USER --password PASS
  bun run screenshots:ios -- --list
  bun run screenshots:android -- --android-device connected --device android-tablet --email USER --password PASS

Options:
  --api-base-url URL   Backend used only to resolve place/report IDs. Default: ${DEFAULT_API_BASE_URL}
  --appearance VALUE   light or dark. Omit to capture both appearances in sequence. Default: both
  --android-device ID  Android device serial/model target, or connected. Default: connected
  --device VALUE       iphone, ipad, android-phone, or android-tablet. Default: one per available type
  --email VALUE        Screenshot auditor email (or set SCREENSHOT_EMAIL in .env.local / .env)
  --password VALUE     Screenshot auditor password (or set SCREENSHOT_PASSWORD in .env.local / .env)
  --login-wait-ms N    Extra wait after the first login target. Default: ${DEFAULT_LOGIN_WAIT_MS}
  --output-dir PATH    Output directory. Default: screenshots/<device>/<appearance>
  --platform VALUE     ios or android. Default: ${DEFAULT_PLATFORM}
  --scheme VALUE       App URL scheme. Default: ${DEFAULT_SCHEME}
  --simulator VALUE    iOS simctl device target. Default: booted
  --target VALUE       all, public, protected, or a comma-separated list of PNG names
  --wait-ms VALUE      Delay after each deep link before capture. Default: ${DEFAULT_WAIT_MS}
  --no-reset           Keep the existing app auth session between targets
`);
}

/**
 * Load credentials from local .env files into process.env.
 *
 * Values already present in the environment (shell-exported, or set by an
 * earlier file) win, so .env.local takes precedence over .env, and an
 * exported shell variable takes precedence over both.
 */
function loadEnvFiles() {
    if (typeof process.loadEnvFile !== "function") {
        return;
    }
    for (const file of [".env.local", ".env"]) {
        const existingEmail = process.env.SCREENSHOT_EMAIL;
        const existingPassword = process.env.SCREENSHOT_PASSWORD;
        try {
            process.loadEnvFile(path.resolve(file));
        } catch {
            continue;
        }
        // Restore any credential already resolved by a higher-priority source.
        if (typeof existingEmail === "string") {
            process.env.SCREENSHOT_EMAIL = existingEmail;
        }
        if (typeof existingPassword === "string") {
            process.env.SCREENSHOT_PASSWORD = existingPassword;
        }
    }
}

function parsePositiveInteger(value, label) {
    if (!/^\d+$/.test(value)) throw new Error(`${label} must be a positive integer.`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return parsed;
}

function stripTrailingSlash(value) {
    return value.replace(/\/$/, "");
}

/**
 * Classify a simulator name as "iphone" or "ipad", or null when it is neither
 * (e.g. Apple TV / Watch simulators).
 *
 * @param {string} name Simulator display name.
 * @returns {"iphone" | "ipad" | null} Device type.
 */
function classifyDeviceType(name) {
    const normalized = name.toLowerCase();
    if (normalized.includes("ipad")) return "ipad";
    if (normalized.includes("iphone")) return "iphone";
    return null;
}

/**
 * List all iPhone / iPad simulators known to simctl with their concrete UDIDs
 * and current boot state.
 *
 * @returns {Array<{ id: string, udid: string, name: string, platform: "ios", state: string, isBooted: boolean, deviceType: "iphone" | "ipad" }>}
 */
function listSimulators() {
    const result = spawnSync("xcrun", ["simctl", "list", "devices", "-j"], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
        return [];
    }
    try {
        const data = JSON.parse(result.stdout);
        const simulators = [];
        for (const runtimeDevices of Object.values(data.devices ?? {})) {
            for (const device of runtimeDevices) {
                const deviceType = classifyDeviceType(device.name ?? "");
                if (deviceType === null) {
                    continue;
                }
                simulators.push({
                    id: device.udid,
                    udid: device.udid,
                    name: device.name,
                    platform: "ios",
                    state: device.state,
                    isBooted: device.state === "Booted",
                    deviceType,
                });
            }
        }
        return simulators;
    } catch {
        return [];
    }
}

/**
 * List connected Android devices known to adb.
 *
 * @returns {Array<{ id: string, serial: string, name: string, platform: "android", state: string, isOnline: boolean, deviceType: "android-phone" | "android-tablet" }>}
 */
function listAndroidDevices() {
    const result = spawnSync("adb", ["devices", "-l"], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
        return [];
    }

    return result.stdout
        .split("\n")
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => parseAndroidDeviceLine(line))
        .filter((device) => device !== null);
}

function parseAndroidDeviceLine(line) {
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const state = parts[1] ?? "unknown";
    if (serial.length === 0) {
        return null;
    }

    const metadata = new Map();
    for (const part of parts.slice(2)) {
        const separatorIndex = part.indexOf(":");
        if (separatorIndex === -1) {
            continue;
        }
        metadata.set(part.slice(0, separatorIndex), part.slice(separatorIndex + 1));
    }

    const model = metadata.get("model") ?? serial;
    const name = model.replace(/_/g, " ");
    return {
        id: serial,
        serial,
        name,
        platform: "android",
        state,
        isOnline: state === "device",
        deviceType: classifyAndroidDeviceType(serial, model),
    };
}

function classifyAndroidDeviceType(serial, model) {
    const normalizedModel = model.toLowerCase();
    if (
        normalizedModel.includes("tablet") ||
        normalizedModel.includes("tab") ||
        normalizedModel.startsWith("sm-x")
    ) {
        return "android-tablet";
    }

    const size = readAndroidPhysicalSize(serial);
    const density = readAndroidDensity(serial);
    if (size !== null && density !== null) {
        const smallestWidthDp = (Math.min(size.width, size.height) * 160) / density;
        if (smallestWidthDp >= 600) {
            return "android-tablet";
        }
    }

    return "android-phone";
}

function readAndroidPhysicalSize(serial) {
    const result = spawnSync("adb", ["-s", serial, "shell", "wm", "size"], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
        return null;
    }
    const match = result.stdout.match(/Physical size:\s*(\d+)x(\d+)/);
    if (match === null) {
        return null;
    }
    return { width: Number(match[1]), height: Number(match[2]) };
}

function readAndroidDensity(serial) {
    const result = spawnSync("adb", ["-s", serial, "shell", "wm", "density"], {
        encoding: "utf8",
    });
    if (result.error || result.status !== 0) {
        return null;
    }
    const match = result.stdout.match(/Physical density:\s*(\d+)/);
    if (match === null) {
        return null;
    }
    return Number(match[1]);
}

/**
 * Resolve the concrete devices to capture.
 *
 * @param {ReturnType<typeof parseArgs>} options Parsed options.
 * @returns {Array<{ id: string, name: string, platform: "ios" | "android", deviceType: string }>} Target devices.
 */
function resolveTargetDevices(options) {
    if (options.platform === "android") {
        return resolveTargetAndroidDevices(options);
    }
    return resolveTargetSimulators(options);
}

/**
 * Resolve the concrete simulators to capture, as { id, udid, name, deviceType }.
 *
 * Resolving real UDIDs up front (instead of relying on simctl's ambiguous
 * "booted" alias) keeps every capture pinned to one device, so the output
 * folder always matches the pixels and a simulator booted mid-run is ignored.
 *
 * - `--simulator <udid|name>`: that exact device.
 * - `--device iphone|ipad`: the first booted simulator of that type.
 * - neither: every booted simulator (one per type), so booting an iPhone and an
 *   iPad and running once captures both.
 *
 * @param {ReturnType<typeof parseArgs>} options Parsed options.
 * @returns {ReturnType<typeof listSimulators>} Target simulators.
 */
function resolveTargetSimulators(options) {
    const simulators = listSimulators();

    if (options.simulator !== "booted") {
        const match = simulators.find(
            (simulator) =>
                simulator.udid === options.simulator || simulator.name === options.simulator,
        );
        if (match === undefined) {
            throw new Error(`No simulator matches --simulator "${options.simulator}".`);
        }
        if (!match.isBooted) {
            throw new Error(`Simulator "${match.name}" is not booted. Boot it first.`);
        }
        return [match];
    }

    const booted = simulators.filter((simulator) => simulator.isBooted);
    if (booted.length === 0) {
        throw new Error("No booted iOS simulator found. Boot an iPhone or iPad simulator first.");
    }

    if (options.device !== null) {
        const match = booted.find((simulator) => simulator.deviceType === options.device);
        if (match === undefined) {
            throw new Error(
                `No booted ${options.device} simulator found. Boot one or pass --simulator <udid>.`,
            );
        }
        return [match];
    }

    // No device filter: one capture per booted device type (iPhone and/or iPad).
    return firstDevicePerType(booted);
}

/**
 * Resolve the concrete Android devices to capture.
 *
 * @param {ReturnType<typeof parseArgs>} options Parsed options.
 * @returns {ReturnType<typeof listAndroidDevices>} Target Android devices.
 */
function resolveTargetAndroidDevices(options) {
    const devices = listAndroidDevices();
    if (devices.length === 0) {
        throw new Error(
            "No connected Android device found. Connect a device with USB debugging enabled.",
        );
    }

    const onlineDevices = devices.filter((device) => device.isOnline);
    if (onlineDevices.length === 0) {
        throw new Error("No online Android device found. Check `adb devices` for authorization.");
    }

    let candidates = onlineDevices;
    if (options.androidDevice !== DEFAULT_ANDROID_DEVICE) {
        const requested = options.androidDevice.toLowerCase();
        const match = onlineDevices.find(
            (device) =>
                device.serial === options.androidDevice || device.name.toLowerCase() === requested,
        );
        if (match === undefined) {
            throw new Error(
                `No online Android device matches --android-device "${options.androidDevice}".`,
            );
        }
        candidates = [match];
    }

    if (options.device !== null) {
        const match = candidates.find((device) => device.deviceType === options.device);
        if (match === undefined) {
            throw new Error(`No connected ${options.device} device matched the Android target.`);
        }
        return [match];
    }

    return firstDevicePerType(candidates);
}

/**
 * Raised when the target device stops responding mid-run (frozen emulator,
 * disconnected device). The run aborts instead of capturing stale frames.
 */
class DeviceUnresponsiveError extends Error {}

/**
 * Strip screenshot-account credentials from a message before it reaches the
 * console or manifest. Failed device commands echo the full bootstrap deep
 * link, which carries the email and password as query parameters.
 *
 * @param {string} message Raw error message.
 * @returns {string} Message with credential query values redacted.
 */
function redactCredentials(message) {
    return message.replace(/(email|password)=[^&'"\s]*/gi, "$1=REDACTED");
}

function firstDevicePerType(devices) {
    const byType = new Map();
    for (const device of devices) {
        if (!byType.has(device.deviceType)) {
            byType.set(device.deviceType, device);
        }
    }
    return [...byType.values()];
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const sectionKey = await readFirstSectionKey();
    const discovery = await discoverBackendData(options);

    if (options.list) {
        const defaultDeviceTypes =
            options.platform === "android" ? ANDROID_DEVICE_TYPES : IOS_DEVICE_TYPES;
        const deviceTypes = options.device !== null ? [options.device] : defaultDeviceTypes;
        for (const deviceType of deviceTypes) {
            const targets = selectTargets(
                buildTargets(discovery, sectionKey, deviceType),
                options.target,
            );
            printTargetList(deviceType, targets);
        }
        return;
    }

    ensurePlatformToolAvailable(options.platform);

    // Resolve which appearances to capture. When omitted, capture both.
    const appearances = options.appearance !== null ? [options.appearance] : ["light", "dark"];

    // Resolve concrete devices up front so every capture is pinned to one
    // device for the whole run.
    const devices = resolveTargetDevices(options);

    if (options.outputDir !== null && devices.length * appearances.length > 1) {
        throw new Error(
            "--output-dir cannot be combined with multiple devices or appearances. Narrow with --device and --appearance.",
        );
    }

    console.log(
        `Capturing on: ${devices.map((device) => `${device.deviceType} (${device.name})`).join(", ")}`,
    );

    let anyFailures = false;

    for (const device of devices) {
        for (const appearance of appearances) {
            const targets = selectTargets(
                buildTargets(discovery, sectionKey, device.deviceType),
                options.target,
            );
            if (targets.length === 0) {
                console.warn(
                    `No targets matched --target "${options.target}" for ${device.deviceType}; skipping.`,
                );
                continue;
            }
            const { failed, deviceUnresponsive } = await captureDeviceRun({
                options,
                device,
                appearance,
                targets,
            });
            if (failed) {
                anyFailures = true;
            }
            if (deviceUnresponsive) {
                console.error(
                    `${device.deviceType} (${device.name}) stopped responding; skipping its remaining appearances. Cold-boot the device and rerun.`,
                );
                break;
            }
        }
    }

    if (anyFailures) {
        process.exitCode = 1;
    }
}

function printTargetList(deviceType, targets) {
    console.log(`\n# ${deviceType}`);
    if (targets.length === 0) {
        console.log("No targets matched.");
        return;
    }
    for (const target of targets) {
        const access = target.skipLogin ? "public" : "protected";
        const route = target.route.length > 0 ? target.route : "(unresolved dynamic route)";
        console.log(`${target.file}\t${route}\t${access}`);
    }
}

/**
 * Capture every target for one concrete device + appearance, writing the PNGs
 * and a manifest. Returns true when any target failed.
 *
 * @param {object} input Capture input.
 * @param {ReturnType<typeof parseArgs>} input.options Parsed options.
 * @param {ReturnType<typeof resolveTargetDevices>[number]} input.device Target device.
 * @param {"light" | "dark"} input.appearance Device appearance.
 * @param {readonly object[]} input.targets Screenshot targets.
 * @returns {Promise<{ failed: boolean, deviceUnresponsive: boolean }>} Run outcome.
 */
async function captureDeviceRun({ options, device, appearance, targets }) {
    const outputDir = path.resolve(
        options.outputDir ?? path.join("screenshots", device.deviceType, appearance),
    );
    await mkdir(outputDir, { recursive: true });

    console.log(`\n=== ${device.deviceType} / ${appearance} (${device.name}) ===`);
    setDeviceAppearance(device, appearance);

    const manifest = {
        generated_at: new Date().toISOString(),
        platform: device.platform,
        device: device.deviceType,
        device_name: device.name,
        device_id: device.id,
        appearance,
        api_base_url: options.apiBaseUrl,
        output_directory: outputDir,
        total_targets: targets.length,
        success_count: 0,
        failure_count: 0,
        successes: [],
        failures: [],
    };

    // Reset and login happens at most once per run - on the first protected
    // target - so all subsequent screens reuse the cached session and do not
    // each pay a full logout→login round-trip.
    let hasResetThisRun = false;

    // A wedged device keeps returning the last rendered frame, so a capture
    // that "succeeds" can still be stale. Track the previous frame hash to
    // catch a frozen display, the device clock to catch a frozen guest OS,
    // and consecutive failures to stop hammering a device that is gone.
    let previousFrameHash = null;
    let consecutiveFailures = 0;
    let deviceUnresponsive = false;
    const clockCheck = createDeviceClockCheck(device);

    for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        try {
            if (target.requiresAuth && (options.email === null || options.password === null)) {
                throw new Error("Protected target requires --email and --password.");
            }
            if (target.skipReason) {
                throw new Error(target.skipReason);
            }

            const shouldReset = options.reset && !hasResetThisRun && !target.skipLogin;
            if (shouldReset) {
                hasResetThisRun = true;
            }

            const outputPath = path.join(outputDir, target.file);
            const url = buildBootstrapUrl(target, options, shouldReset);
            // Per-target extra settle time (e.g. section deep links that need
            // ensurePlaceAudit to resolve first).
            const waitMs = (shouldReset ? options.loginWaitMs : options.waitMs) + (target.extraWaitMs ?? 0);

            console.log(`Opening ${target.route}${shouldReset ? " (reset + login)" : ""}`);
            openDeviceUrl(device, url);
            clockCheck.begin();
            await sleep(waitMs);
            clockCheck.assertAdvanced(waitMs);
            captureDeviceScreenshot(device, outputPath);

            const frameHash = createHash("sha256").update(readFileSync(outputPath)).digest("hex");
            if (previousFrameHash !== null && frameHash === previousFrameHash) {
                throw new DeviceUnresponsiveError(
                    "Captured frame is byte-identical to the previous target; the device display appears frozen.",
                );
            }
            previousFrameHash = frameHash;

            manifest.successes.push({
                file: target.file,
                route: target.route,
                output_file: path.relative(process.cwd(), outputPath),
            });
            manifest.success_count += 1;
            consecutiveFailures = 0;
        } catch (error) {
            const message = redactCredentials(
                error instanceof Error ? error.message : String(error),
            );
            console.error(`Failed ${target.file}: ${message}`);
            manifest.failures.push({ file: target.file, route: target.route, message });
            manifest.failure_count += 1;
            consecutiveFailures += 1;

            const failedTooOften = consecutiveFailures >= MAX_CONSECUTIVE_TARGET_FAILURES;
            if (error instanceof DeviceUnresponsiveError || failedTooOften) {
                deviceUnresponsive = true;
                const abortReason =
                    error instanceof DeviceUnresponsiveError
                        ? message
                        : `${consecutiveFailures} consecutive targets failed; the device appears unresponsive.`;
                manifest.abort_reason = abortReason;
                for (const remaining of targets.slice(index + 1)) {
                    manifest.failures.push({
                        file: remaining.file,
                        route: remaining.route,
                        message: `Skipped: run aborted (${abortReason})`,
                    });
                    manifest.failure_count += 1;
                }
                console.error(`Aborting ${device.deviceType}/${appearance} run: ${abortReason}`);
                break;
            }
        }
    }

    await writeFile(
        path.join(outputDir, "manifest.json"),
        `${JSON.stringify(manifest, null, "\t")}\n`,
    );

    return { failed: manifest.failure_count > 0, deviceUnresponsive };
}

/**
 * Build a per-run device clock checker that detects a frozen guest OS.
 *
 * A dying emulator can keep serving adb screencaps of the last rendered frame
 * while its guest clock stands still, so every capture "succeeds" with stale
 * pixels. Comparing how far the device clock advanced against the host-side
 * wait exposes that state. When the first probe fails the checker disables
 * itself (the device may not support the probe); once a probe has succeeded,
 * a later probe failure means the device stopped responding.
 *
 * @param {ReturnType<typeof resolveTargetDevices>[number]} device Target device.
 * @returns {{ begin: () => void, assertAdvanced: (waitMs: number) => void }} Checker.
 */
function createDeviceClockCheck(device) {
    let supported = null;
    let epochAtBegin = null;

    const probe = () => {
        const [command, args] =
            device.platform === "ios"
                ? ["xcrun", ["simctl", "spawn", device.id, "date", "+%s"]]
                : ["adb", ["-s", device.id, "shell", "date", "+%s"]];
        const result = spawnSync(command, args, {
            encoding: "utf8",
            timeout: DEVICE_COMMAND_TIMEOUT_MS,
        });
        if (result.error || result.status !== 0) {
            return null;
        }
        const parsed = Number(result.stdout.trim());
        return Number.isSafeInteger(parsed) ? parsed : null;
    };

    return {
        begin() {
            if (supported === false) {
                return;
            }
            epochAtBegin = probe();
            if (supported === null) {
                supported = epochAtBegin !== null;
                if (!supported) {
                    console.warn(
                        `Device clock probe unavailable on ${device.name}; frozen-device detection is limited to frame comparison.`,
                    );
                }
                return;
            }
            if (epochAtBegin === null) {
                throw new DeviceUnresponsiveError(
                    "Device clock probe stopped responding; the device appears unresponsive.",
                );
            }
        },
        assertAdvanced(waitMs) {
            if (supported !== true || epochAtBegin === null) {
                return;
            }
            const epochNow = probe();
            if (epochNow === null) {
                throw new DeviceUnresponsiveError(
                    "Device clock probe stopped responding; the device appears unresponsive.",
                );
            }
            const advancedMs = (epochNow - epochAtBegin) * 1000;
            if (advancedMs < waitMs / 2) {
                throw new DeviceUnresponsiveError(
                    `Device clock advanced only ${Math.round(advancedMs / 1000)}s during a ${Math.round(waitMs / 1000)}s wait; the device appears frozen.`,
                );
            }
        },
    };
}

async function readFirstSectionKey() {
    try {
        const raw = await readFile(path.join("assets", "bundled-instrument.json"), "utf8");
        const parsed = JSON.parse(raw);
        const sections = parsed?.en?.sections;
        const firstSectionKey = Array.isArray(sections) ? sections[0]?.section_key : null;
        return typeof firstSectionKey === "string" && firstSectionKey.length > 0
            ? firstSectionKey
            : FIRST_SECTION_FALLBACK;
    } catch {
        return FIRST_SECTION_FALLBACK;
    }
}

async function discoverBackendData(options) {
    if (options.email === null || options.password === null) {
        return { firstPlace: null, reportPlace: null };
    }

    try {
        const loginResponse = await fetch(`${options.apiBaseUrl}/playspace/auth/login`, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ email: options.email, password: options.password }),
        });
        if (!loginResponse.ok) throw new Error(`login failed (${loginResponse.status})`);
        const loginPayload = await loginResponse.json();
        const token = loginPayload.access_token;
        if (typeof token !== "string" || token.length === 0) {
            throw new Error("login response did not include access_token");
        }

        const placesResponse = await fetch(
            `${options.apiBaseUrl}/playspace/auditor/me/places?page=1&page_size=100`,
            {
                headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
            },
        );
        if (!placesResponse.ok) throw new Error(`places lookup failed (${placesResponse.status})`);
        const placesPayload = await placesResponse.json();
        const places = Array.isArray(placesPayload.items) ? placesPayload.items : [];
        return {
            firstPlace: places[0] ?? null,
            reportPlace: selectReportPlace(places),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Backend data discovery unavailable: ${message}`);
        return { firstPlace: null, reportPlace: null };
    }
}

/**
 * Choose the place whose audit backs the report-detail screenshots.
 *
 * A submitted (completed) audit is preferred so the report screens show a real
 * finished report. When no place has been submitted yet, fall back to an
 * in-progress audit so the screens still have content; when no audit exists at
 * all, return null so the report targets are skipped instead of opening an
 * empty report screen.
 *
 * @param {readonly object[]} places Auditor places from the assigned-places API.
 * @returns {object | null} The chosen report place, or null when none qualifies.
 */
function selectReportPlace(places) {
    const auditedPlaces = places.filter(
        (place) => typeof place.audit_id === "string" && place.audit_id.length > 0,
    );

    const submittedPlace = auditedPlaces.find(isSubmittedAuditPlace);
    if (submittedPlace !== undefined) {
        return submittedPlace;
    }

    const inProgressPlace = auditedPlaces.find((place) => !isSubmittedAuditPlace(place));
    if (inProgressPlace !== undefined) {
        const label = inProgressPlace.place_name ?? inProgressPlace.place_id;
        console.warn(
            `No submitted audit found; report-detail screenshots will use the in-progress audit for "${label}".`,
        );
        return inProgressPlace;
    }

    return null;
}

/**
 * A place counts as submitted when its audit carries a submission timestamp,
 * matching how the in-app reports list defines a submitted report.
 *
 * @param {object} place Auditor place from the assigned-places API.
 * @returns {boolean} True when the place's audit has been submitted.
 */
function isSubmittedAuditPlace(place) {
    return typeof place.submitted_at === "string" && place.submitted_at.length > 0;
}

function buildTargets(discovery, sectionKey, deviceType) {
    if (deviceType === "iphone" || deviceType === "android-phone") {
        return buildPhoneTargets(discovery, sectionKey, deviceType);
    }
    if (deviceType === "ipad" || deviceType === "android-tablet") {
        return buildTabletTargets(discovery, sectionKey, deviceType);
    }
    throw new Error(`Unknown device type: ${deviceType}`);
}

function buildPhoneTargets(discovery, sectionKey, deviceType = "iphone") {
    const routes = buildDynamicRoutes(discovery, sectionKey);
    const targets = [
        publicTarget("01-login.png", "/(auth)/login", "Login screen"),
        publicTarget("02-signup.png", "/(auth)/signup", "Signup screen"),
        protectedTarget("03-home.png", "/", "Home top"),
        protectedTarget("04-home-queue.png", withScreenshotScroll("/", 780), "Home queue scroll"),
        protectedTarget("05-places.png", "/places", "Places list top"),
        dynamicPlaceTarget("06-place-detail.png", routes.placeDetail, "Place detail"),
        protectedTarget("07-execute.png", "/execute", "Execute list top"),
        dynamicPlaceTarget(
            "08-execute-place.png",
            withScreenshotScroll(routes.executePlace, IPHONE_EXECUTE_PLACE_SCROLL_Y),
            "Execute place merged frame; replaces old 08/09/10 using roughly one-quarter of old 09 scroll",
        ),
        dynamicPlaceTarget(
            "09-execute-pre-audit.png",
            routes.preAudit,
            "Pre-audit top only; old scrolled variants removed",
        ),
        {
            ...dynamicPlaceTarget(
                "10-execute-section.png",
                routes.section,
                "Execute section top; extra settle time so ensurePlaceAudit resolves after the warm-up target",
            ),
            extraWaitMs: 4000,
        },
        dynamicPlaceTarget(
            "11-execute-section-questions.png",
            withScreenshotScroll(routes.section, 780),
            "Execute section questions",
        ),
        dynamicPlaceTarget(
            "12-execute-section-notes.png",
            withScreenshotScroll(routes.section, 4000),
            "Execute section notes",
        ),
        protectedTarget("13-reports.png", "/reports", "Reports list top; old list/preview scrolls removed"),
        protectedTarget("14-reports-list.png", withScreenshotScroll("/reports", 700), "Reports list"),
        ...buildReportDetailTargets(deviceType, "15", routes.reportDetail),
        protectedTarget("19-settings.png", "/settings", "Settings top"),
        protectedTarget(
            "20-settings-scrolled.png",
            withScreenshotScroll("/settings", IPHONE_SETTINGS_SCROLL_Y),
            "Settings scrolled frame",
        ),
        dynamicPlaceTarget("21-execute-overview.png", routes.overview, "Execute section overview"),
        dynamicPlaceTarget("22-execute-space-audit.png", routes.spaceAudit, "Execute space-audit setup"),
        dynamicPlaceTarget("23-execute-final-comments.png", routes.finalComments, "Execute final comments"),
    ];
    return assertUniqueTargetFiles(deviceType, targets);
}

function buildTabletTargets(discovery, sectionKey, deviceType = "ipad") {
    const routes = buildDynamicRoutes(discovery, sectionKey);
    const targets = [
        publicTarget("01-login.png", "/(auth)/login", "Login screen"),
        publicTarget("02-signup.png", "/(auth)/signup", "Signup screen"),
        protectedTarget("03-home.png", "/", "Home top; old home queue removed because tablet top frame fits it"),
        protectedTarget("04-places.png", "/places", "Places list top"),
        dynamicPlaceTarget("05-place-detail.png", routes.placeDetail, "Place detail"),
        protectedTarget("06-execute.png", "/execute", "Execute list top"),
        dynamicPlaceTarget(
            "07-execute-place.png",
            routes.executePlace,
            "Execute place top; old section/footer scrolls removed",
        ),
        dynamicPlaceTarget(
            "08-execute-pre-audit.png",
            withScreenshotScroll(routes.preAudit, IPAD_PRE_AUDIT_SCROLL_Y),
            "Single pre-audit frame with slight scroll to merge old top/questions coverage",
        ),
        {
            ...dynamicPlaceTarget(
                "09-execute-section.png",
                routes.section,
                "Execute section top; extra settle time so ensurePlaceAudit resolves after the warm-up target",
            ),
            extraWaitMs: 4000,
        },
        dynamicPlaceTarget(
            "10-execute-section-notes.png",
            withScreenshotScroll(routes.section, 4000),
            "Execute section notes only",
        ),
        protectedTarget("11-reports.png", "/reports", "Reports list top; old list/preview scrolls removed"),
        ...buildReportDetailTargets(deviceType, "12", routes.reportDetail),
        protectedTarget("15-settings.png", "/settings", "Settings top"),
        protectedTarget(
            "16-settings-about.png",
            withScreenshotScroll("/settings", 1250),
            "Settings about; old preferences shot removed",
        ),
        dynamicPlaceTarget("17-execute-overview.png", routes.overview, "Execute section overview"),
        dynamicPlaceTarget("18-execute-space-audit.png", routes.spaceAudit, "Execute space-audit setup"),
        dynamicPlaceTarget("19-execute-final-comments.png", routes.finalComments, "Execute final comments"),
    ];
    return assertUniqueTargetFiles(deviceType, targets);
}

function buildDynamicRoutes(discovery, sectionKey) {
    const place = discovery.firstPlace;
    const reportPlace = discovery.reportPlace;
    const routes = {
        placeDetail: null,
        executePlace: null,
        preAudit: null,
        spaceAudit: null,
        overview: null,
        finalComments: null,
        section: null,
        reportDetail: null,
    };

    if (isResolvedPlace(place)) {
        routes.placeDetail = `/place/${encodeURIComponent(place.place_id)}?projectId=${encodeURIComponent(place.project_id)}`;
        routes.executePlace = `/execute/${encodeURIComponent(place.place_id)}?projectId=${encodeURIComponent(place.project_id)}`;
        routes.preAudit = `/execute/${encodeURIComponent(place.place_id)}/pre-audit?projectId=${encodeURIComponent(place.project_id)}`;
        routes.spaceAudit = `/execute/${encodeURIComponent(place.place_id)}/space-audit?projectId=${encodeURIComponent(place.project_id)}`;
        routes.overview = `/execute/${encodeURIComponent(place.place_id)}/overview?projectId=${encodeURIComponent(place.project_id)}`;
        routes.finalComments = `/execute/${encodeURIComponent(place.place_id)}/final-comments?projectId=${encodeURIComponent(place.project_id)}`;
        routes.section = `/execute/${encodeURIComponent(place.place_id)}/section/${encodeURIComponent(sectionKey)}?projectId=${encodeURIComponent(place.project_id)}`;
    }

    if (isResolvedReportPlace(reportPlace)) {
        routes.reportDetail = `/report/${encodeURIComponent(reportPlace.audit_id)}`;
    }

    return routes;
}

function buildReportDetailTargets(deviceType, startNumber, reportRoute) {
    const base = Number(startNumber);
    const scrolls = REPORT_DETAIL_SCROLLS[deviceType];
    const isPhone = deviceType === "iphone" || deviceType === "android-phone";
    const targets = [
        dynamicReportTarget(`${pad2(base)}-report-detail-top.png`, reportRoute, "Report detail top"),
        dynamicReportTarget(
            `${pad2(base + 1)}-report-detail-early.png`,
            withScreenshotScroll(reportRoute, scrolls.early),
            "Report detail early scroll; slightly less than old 700px shot",
        ),
    ];
    if (isPhone) {
        targets.push(
            dynamicReportTarget(
                `${pad2(base + 2)}-report-detail-near-end.png`,
                withScreenshotScroll(reportRoute, scrolls.nearEnd),
                "Report detail near-end frame; tune after capture if needed",
            ),
        );
        targets.push(
            dynamicReportTarget(
                `${pad2(base + 3)}-report-detail-end.png`,
                withScreenshotScroll(reportRoute, scrolls.end),
                "Report detail end frame; tune after capture if needed",
            ),
        );
    } else {
        targets.push(
            dynamicReportTarget(
                `${pad2(base + 2)}-report-detail-end.png`,
                withScreenshotScroll(reportRoute, scrolls.end),
                "Report detail end frame; tune after capture if needed",
            ),
        );
    }
    return targets;
}

function publicTarget(file, route, note) {
    return { file, route, skipLogin: true, note };
}

function protectedTarget(file, route, note) {
    return { file, route, requiresAuth: true, note };
}

function dynamicPlaceTarget(file, route, note) {
    return route === null
        ? unresolved(file, "No assigned place was returned by the assigned places API.", note)
        : protectedTarget(file, route, note);
}

function dynamicReportTarget(file, route, note) {
    return route === null
        ? unresolved(
              file,
              "No submitted audit with audit_id was returned by the assigned places API.",
              note,
          )
        : protectedTarget(file, route, note);
}

function unresolved(file, reason = "No assigned place was returned by the assigned places API.", note = "") {
    return { file, route: "", requiresAuth: true, skipReason: reason, note };
}

function withScreenshotScroll(route, scrollY, scrollDelayMs = null) {
    if (route === null) {
        return null;
    }
    const delimiter = route.includes("?") ? "&" : "?";
    let nextRoute = `${route}${delimiter}__screenshotScrollY=${encodeURIComponent(String(scrollY))}`;
    if (scrollDelayMs !== null) {
        nextRoute += `&__screenshotScrollDelayMs=${encodeURIComponent(String(scrollDelayMs))}`;
    }
    return nextRoute;
}

function pad2(value) {
    return String(value).padStart(2, "0");
}

function assertUniqueTargetFiles(deviceType, targets) {
    const seen = new Set();
    for (const target of targets) {
        if (seen.has(target.file)) {
            throw new Error(`Duplicate screenshot target filename for ${deviceType}: ${target.file}`);
        }
        seen.add(target.file);
    }
    return targets;
}

function isResolvedPlace(value) {
    return (
        value !== null && typeof value.place_id === "string" && typeof value.project_id === "string"
    );
}

function isResolvedReportPlace(value) {
    return isResolvedPlace(value) && typeof value.audit_id === "string" && value.audit_id.length > 0;
}

function selectTargets(targets, targetFilter) {
    if (targetFilter === "all") return targets;
    if (targetFilter === "public") return targets.filter((target) => target.skipLogin);
    if (targetFilter === "protected") return targets.filter((target) => !target.skipLogin);

    const requested = new Set(
        targetFilter
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
    );
    return targets.filter((target) => requested.has(target.file));
}

function buildBootstrapUrl(target, options, shouldReset) {
    const url = new URL(`${options.scheme}://__screenshot-bootstrap`);
    const normalizedTarget = extractScreenshotAutomationParams(target.route);

    url.searchParams.set("target", normalizedTarget.route);
    url.searchParams.set("reset", shouldReset ? "1" : "0");
    if (normalizedTarget.scrollY !== null) {
        url.searchParams.set("__screenshotScrollY", normalizedTarget.scrollY);
    }
    url.searchParams.set(
        "__screenshotScrollDelayMs",
        normalizedTarget.scrollDelayMs ?? String(DEFAULT_SCROLL_DELAY_MS),
    );
    if (target.skipLogin) {
        url.searchParams.set("skipLogin", "1");
    } else {
        url.searchParams.set("email", options.email ?? "");
        url.searchParams.set("password", options.password ?? "");
    }
    return url.toString();
}

function extractScreenshotAutomationParams(route) {
    const queryStartIndex = route.indexOf("?");
    if (queryStartIndex === -1) {
        return { route, scrollY: null, scrollDelayMs: null };
    }

    const pathname = route.slice(0, queryStartIndex);
    const queryString = route.slice(queryStartIndex + 1);
    const params = new URLSearchParams(queryString);
    const scrollY = params.get("__screenshotScrollY");
    const scrollDelayMs = params.get("__screenshotScrollDelayMs");

    params.delete("__screenshotScrollY");
    params.delete("__screenshotScrollDelayMs");

    const remainingQuery = params.toString();
    return {
        route: remainingQuery.length > 0 ? `${pathname}?${remainingQuery}` : pathname,
        scrollY,
        scrollDelayMs,
    };
}

function ensurePlatformToolAvailable(platform) {
    if (platform === "android") {
        ensureAdbAvailable();
        return;
    }
    ensureXcrunAvailable();
}

function ensureXcrunAvailable() {
    const result = spawnSync("xcrun", ["simctl", "help"], { stdio: "ignore" });
    if (result.error || result.status !== 0) {
        throw new Error(
            "xcrun simctl is unavailable. Install Xcode command-line tools and boot an iOS simulator.",
        );
    }
}

function ensureAdbAvailable() {
    const result = spawnSync("adb", ["version"], { stdio: "ignore" });
    if (result.error || result.status !== 0) {
        throw new Error(
            "adb is unavailable. Install Android platform-tools and enable USB debugging.",
        );
    }
}

/**
 * Switch the device into the requested light/dark appearance.
 *
 * iOS uses simctl's UI override. Android uses the UI-mode service to toggle
 * night mode; if that command is unavailable the run continues with the
 * device's current theme rather than failing the whole capture.
 *
 * @param {ReturnType<typeof resolveTargetDevices>[number]} device Target device.
 * @param {"light" | "dark"} appearance Requested appearance.
 */
function setDeviceAppearance(device, appearance) {
    if (device.platform === "ios") {
        run("xcrun", ["simctl", "ui", device.id, "appearance", appearance]);
        return;
    }

    const mode = appearance === "dark" ? "yes" : "no";
    const result = spawnSync("adb", ["-s", device.id, "shell", "cmd", "uimode", "night", mode], {
        encoding: "utf8",
        timeout: DEVICE_COMMAND_TIMEOUT_MS,
    });
    if (result.error || result.status !== 0) {
        console.warn(
            `Unable to set Android ${appearance} appearance automatically; continuing with current device theme.`,
        );
    }
}

function openDeviceUrl(device, url) {
    if (device.platform === "ios") {
        run("xcrun", ["simctl", "openurl", device.id, url]);
        return;
    }

    const escapedUrl = url.replace(/'/g, `'\\''`);

    run("adb", [
        "-s",
        device.id,
        "shell",
        `am start -W -a android.intent.action.VIEW -d '${escapedUrl}'`,
    ]);
}

/**
 * Capture a screenshot to the target path.
 *
 * iOS captures via simctl into the system temp dir first and copies into place
 * with Node, because CoreSimulator cannot write to TCC-protected folders like
 * ~/Desktop, ~/Documents, or ~/Downloads. Android streams the PNG straight off
 * the device with `adb exec-out screencap -p`.
 *
 * @param {ReturnType<typeof resolveTargetDevices>[number]} device Target device.
 * @param {string} outputPath Final PNG path.
 */
function captureDeviceScreenshot(device, outputPath) {
    if (device.platform === "ios") {
        const tempPath = path.join(os.tmpdir(), `copa-screenshot-${randomUUID()}.png`);
        try {
            run("xcrun", ["simctl", "io", device.id, "screenshot", tempPath]);
            copyFileSync(tempPath, outputPath);
            console.log("Screenshot copied to", outputPath);
        } finally {
            rmSync(tempPath, { force: true });
        }
        return;
    }

    const result = spawnSync("adb", ["-s", device.id, "exec-out", "screencap", "-p"], {
        encoding: "buffer",
        maxBuffer: 50 * 1024 * 1024,
        timeout: DEVICE_COMMAND_TIMEOUT_MS,
    });
    if (result.error || result.status !== 0) {
        throw new Error(`adb screencap failed for ${device.name}.`);
    }
    writeFileSync(outputPath, result.stdout);
    console.log("Screenshot copied to", outputPath);
}

function run(command, args) {
    execFileSync(command, args, { stdio: "inherit", timeout: DEVICE_COMMAND_TIMEOUT_MS });
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
