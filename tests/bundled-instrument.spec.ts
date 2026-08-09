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

    it("bundles the active 5.33 instrument with manager-requested scoring updates", () => {
        const instrument = getBundledInstrument();
        const questions = new Map(
            instrument?.sections.flatMap((section) =>
                section.questions.map((question) => [question.question_key, question] as const),
            ) ?? [],
        );
        const sociabilityScales =
            instrument?.sections.flatMap((section) =>
                section.questions.flatMap((question) => question.scales.filter((scale) => scale.key === "sociability")),
            ) ?? [];

        expect(BUNDLED_INSTRUMENT_VERSION).toBe("5.33");
        expect(getBundledInstrument()?.instrument_version).toBe(BUNDLED_INSTRUMENT_VERSION);
        expect(sociabilityScales).toHaveLength(33);
        expect(sociabilityScales.every((scale) => scale.selection_mode === "multiple")).toBe(true);
        expect(
            sociabilityScales.every(
                (scale) => scale.options.map((option) => option.key).join(",") === "play_alone,small_group,large_group",
            ),
        ).toBe(true);
        expect(questions.has("q_6_3")).toBe(false);
        expect(questions.has("q_7_2")).toBe(false);
        expect(questions.has("q_19_6")).toBe(false);
        expect(questions.get("q_1_5")?.constructs).toEqual(["usability"]);
        expect(questions.get("q_8_1")?.constructs).toEqual(["usability"]);
        expect(questions.get("q_14_4")?.scales.map((scale) => scale.key)).toEqual(["provision", "variety"]);
        expect(questions.get("q_14_5")?.scales[0]?.options.map((option) => option.key)).toEqual([
            "never",
            "sometimes",
            "always",
        ]);
    });
});
