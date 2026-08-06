import { describe, expect, it } from "vitest";

import { BUNDLED_INSTRUMENT_VERSION, getBundledInstrument } from "lib/audit/bundled-instrument";

describe("bundled instrument offline fallback", () => {
    it("validates the English payload of the multi-locale bundle and returns an instrument", () => {
        const instrument = getBundledInstrument();
        // Regression guard: the asset is `{ "en": { ...instrument } }`, so a parse
        // of the wrapper object would fail and break the offline first-launch
        // fallback. The fallback must return a usable instrument.
        expect(instrument).not.toBeNull();
        expect(instrument?.instrument_key).toBe("pvua_v5_2");
        expect(instrument?.sections.length).toBeGreaterThan(0);
    });

    it("bundles the complete 5.32 Sociability multi-select instrument", () => {
        const instrument = getBundledInstrument();
        const sociabilityScales =
            instrument?.sections.flatMap((section) =>
                section.questions.flatMap((question) => question.scales.filter((scale) => scale.key === "sociability")),
            ) ?? [];

        expect(BUNDLED_INSTRUMENT_VERSION).toBe("5.32");
        expect(getBundledInstrument()?.instrument_version).toBe(BUNDLED_INSTRUMENT_VERSION);
        expect(sociabilityScales).toHaveLength(34);
        expect(sociabilityScales.every((scale) => scale.selection_mode === "multiple")).toBe(true);
        expect(
            sociabilityScales.every(
                (scale) => scale.options.map((option) => option.key).join(",") === "play_alone,small_group,large_group",
            ),
        ).toBe(true);
    });
});
