# Driving COPA on Simulator / Emulator via MCP

How to run and interactively drive this app on an **iOS Simulator** or **Android
emulator** through the two device-automation MCP servers wired into the
workspace. This is what lets an assistant (or an automated flow) install, launch,
screenshot, and tap through the app for smoke tests and visual checks — without a
human touching the device.

---

## The two MCP servers

Both are configured in `~/.claude.json` under the `StudentJob.nosync` project
(`mcpServers`), so they are available from any session rooted at the workspace.

| Server name     | Package                         | Platforms          | Runs `simctl`/`adb`? |
| --------------- | ------------------------------- | ------------------ | -------------------- |
| `ios-simulator` | `ios-simulator-mcp`             | iOS Simulator only | iOS (`simctl`/`idb`) |
| `mobile`        | `@mobilenext/mobile-mcp@latest` | **iOS + Android**  | both (`idb` + `adb`) |

- **`ios-simulator`** tools: `open_simulator`, `get_booted_sim_id`,
  `install_app`, `launch_app`, `screenshot`, `record_video`, `ui_tap`,
  `ui_type`, `ui_swipe`, `ui_describe_all`, `ui_find_element`, `ui_view`.
  Coordinates for the `ui_*` tools are in **points** (iPad Pro 13" = 1032×1376),
  not screenshot pixels — read an element's `frame` with `ui_find_element` and
  tap its center.
- **`mobile`** (mobile-mcp, v0.0.62 — 23 tools): `mobile_list_available_devices`,
  `mobile_list_apps`, `mobile_launch_app`, `mobile_terminate_app`,
  `mobile_install_app`, `mobile_take_screenshot`, `mobile_save_screenshot`,
  `mobile_list_elements_on_screen`, `mobile_click_on_screen_at_coordinates`,
  `mobile_double_tap_on_screen`, `mobile_long_press_on_screen_at_coordinates`,
  `mobile_swipe_on_screen`, `mobile_type_keys`, `mobile_press_button`,
  `mobile_open_url`, `mobile_get_screen_size`, `mobile_set_orientation`,
  `mobile_get_orientation`, `mobile_start_screen_recording`,
  `mobile_stop_screen_recording`, `mobile_list_crashes`, `mobile_get_crash`.
  Use `mobile-mcp` for Android; either server works for iOS.

> **Newly added servers need a session restart.** MCP servers are enumerated when
> a session starts. If you add or edit one in `~/.claude.json` mid-session, its
> tools will not appear until you start a new session.

---

## App identifiers (COPA)

| Field              | Value                                                |
| ------------------ | ---------------------------------------------------- |
| iOS bundle id      | `com.pratyush.sudhakar.audit-tools-playspace-mobile` |
| Android package    | `com.pratyush.sudhakar.audittoolsplayspacemobile`    |
| Expo scheme        | `copa-mobile`                                        |
| Slug               | `audit-tools-playspace-mobile`                       |
| Dev-server (Metro) | `bunx expo start` (default port `8081`)              |

---

## Critical constraint: the command sandbox cannot build or serve

The assistant's shell runs in a sandbox that **blocks the host build toolchain**.
Verified failure modes:

- `xcodebuild` / `expo run:ios` → `XCBBuildService` gets `Operation not permitted`
  writing DerivedData (any path). No native iOS build from the sandbox.
- `simctl` and `adb` from the shell → cannot reach `CoreSimulatorService`, and
  `adb` cannot start its daemon (`ADB server didn't ACK`) because binding a
  listening socket returns `EPERM`.
- **Metro** (`expo start`) → cannot bind a port (same `EPERM`); it misreports the
  free port as "8081 is being used" and skips the dev server.

**The MCP servers themselves run _outside_ that sandbox**, so `install_app`,
`launch_app`, `screenshot`, `adb`, etc. all work through them. The division of
labor is therefore fixed:

> **You (in a normal terminal) build the app and run Metro.
> The MCP drives the device.**

For a Debug **dev-client** build, the native binary is only a shell — all the JS
(screens, stores, components) is served live by Metro. So an existing installed
`.app`/`.apk` + a fresh Metro renders the **current** source without rebuilding.

---

## iOS workflow (`ios-simulator` or `mobile`)

1. **Boot a simulator.** `open_simulator` (ios-simulator) opens Simulator.app and
   boots the default device; `get_booted_sim_id` returns its UDID. To pick a
   different device, boot it in Simulator.app first (`simctl boot` is sandboxed).
2. **Install a build.** A Debug simulator build lives at
   `ios/build/**/Debug-iphonesimulator/COPA.app` or under
   `~/Library/Developer/Xcode/DerivedData/COPA-*/Build/Products/Debug-iphonesimulator/COPA.app`.
   `install_app { app_path, udid }`.
3. **Start Metro in your own terminal:** `cd playspace/copa-mobile && bunx expo start`.
4. **Launch:** `launch_app { bundle_id: "com.pratyush.sudhakar.audit-tools-playspace-mobile" }`.
5. On the Expo dev-launcher, `ui_find_element` for the recent server row
   (`COPA, http://<host>:8081`) and `ui_tap` its center → the app bundles and
   renders. `screenshot` to verify.

Login requires a reachable backend. The app defaults to `http://127.0.0.1:8000`;
without it the login screen shows "Authentication failed" (on-screen dev hint:
`DemoPass123!`). **If the local backend isn't running, point the app at
production** by starting Metro with the base URL overridden:

```bash
EXPO_PUBLIC_API_BASE_URL="https://audit-tools-backend-zyde.onrender.com" bunx expo start
```

(One shared backend serves both products; Playspace clients use its `/playspace/*`
namespace. The app appends the namespace, so set only the base URL. Note Render
free instances cold-start, so the first request after idle can take ~30–60s.)

---

## Android workflow (`mobile` / mobile-mcp)

Prereqs: `adb` at `~/Library/Android/sdk/platform-tools/adb` and an AVD. Available
AVDs on this machine include `Pixel_9`, `Pixel_9_Pro`, `Pixel_9_Pro_Fold`,
`Pixel_Tablet`, `Samsung_S5e_Tab`.

1. **Boot an emulator in your own terminal** (the emulator + adb can't run in the
   sandbox):
    ```bash
    ~/Library/Android/sdk/emulator/emulator @Pixel_9 &
    ~/Library/Android/sdk/platform-tools/adb wait-for-device
    ```
2. **Confirm the device is visible to the MCP:** `mobile_list_available_devices`.
3. **Install a build** (Debug apk from `android/app/build/outputs/apk/debug/` or an
   EAS build): `mobile_install_app { device, path }` — or install via `adb install`
   in your terminal.
4. **Start Metro:** `cd playspace/copa-mobile && bunx expo start` (press `a`, or
   let the dev-client connect).
5. **Launch:** `mobile_launch_app { device, packageName: "com.pratyush.sudhakar.audittoolsplayspacemobile" }`.
6. Drive it: `mobile_take_screenshot`, `mobile_list_elements_on_screen` (returns
   text/accessibility labels + coordinates — prefer this over raw pixel guessing),
   `mobile_click_on_screen_at_coordinates`, `mobile_type_keys`,
   `mobile_swipe_on_screen`, `mobile_press_button` (e.g. `BACK`, `HOME`).

---

## Verification status (2026-07-16)

- `ios-simulator` MCP: **verified end-to-end** — booted iPad Pro 13", installed
  and launched COPA, tapped the Metro server via `ui_find_element`/`ui_tap`, and
  the live login screen rendered from Metro.
- `mobile` (mobile-mcp): **server verified functional** (v0.0.62, 23 tools respond
  over the MCP protocol) and the Android environment is ready (adb + 5 AVDs). A
  live emulator drive is pending a session restart (server was added after this
  session started).

## Related

- `IOS_BUILD_TROUBLESHOOTING.md` — native iOS build fixes
- `ANDROID_BUILD_TROUBLESHOOTING.md` — native Android build fixes
