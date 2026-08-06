import { describe, expect, it } from "vitest";

import { isMultipleSelectionScale, readMultipleScaleSelection, toggleMultipleScaleOption } from "lib/audit/sociability";
import { isInstrumentQuestionComplete } from "lib/audit/selectors";
import type { InstrumentQuestion, QuestionResponsePayload, QuestionScale } from "lib/audit/types";

import { buildSociabilityInstrument } from "./support/sociability-fixtures";

function question(selectionMode: "single" | "multiple" = "multiple"): InstrumentQuestion {
    const value = buildSociabilityInstrument(selectionMode).sections[0]?.questions[0];
    if (value === undefined) {
        throw new Error("Expected fixture question.");
    }
    return value;
}

function sociabilityScale(selectionMode: "single" | "multiple" = "multiple"): QuestionScale {
    const scale = question(selectionMode).scales.find((candidate) => candidate.key === "sociability");
    if (scale === undefined) {
        throw new Error("Expected a Sociability scale in the fixture.");
    }
    return scale;
}

describe("Sociability multi-select answering", () => {
    it("switches to checkbox behaviour only on an explicit multiple selection_mode", () => {
        expect(isMultipleSelectionScale(sociabilityScale("multiple"))).toBe(true);
        expect(isMultipleSelectionScale(sociabilityScale("single"))).toBe(false);
        expect(isMultipleSelectionScale({ selection_mode: "single" })).toBe(false);
    });

    it("builds one, two, and three selections in instrument option order", () => {
        const scale = sociabilityScale();
        let answers: QuestionResponsePayload = { provision: "some" };

        answers = toggleMultipleScaleOption(answers, scale, "large_group");
        expect(answers.sociability).toEqual(["large_group"]);

        answers = toggleMultipleScaleOption(answers, scale, "play_alone");
        expect(answers.sociability).toEqual(["play_alone", "large_group"]);

        answers = toggleMultipleScaleOption(answers, scale, "small_group");
        expect(answers.sociability).toEqual(["play_alone", "small_group", "large_group"]);
        expect(answers.provision).toBe("some");
    });

    it("removes the key when the last selection is cleared so sync never sends an empty array", () => {
        const scale = sociabilityScale();
        const selected = toggleMultipleScaleOption({ provision: "some" }, scale, "small_group");

        const cleared = toggleMultipleScaleOption(selected, scale, "small_group");

        expect("sociability" in cleared).toBe(false);
        expect(cleared.provision).toBe("some");
    });

    it("reads stored selections back in instrument order and ignores stray values", () => {
        const scale = sociabilityScale();

        expect(readMultipleScaleSelection({ sociability: ["large_group", "play_alone"] }, scale)).toEqual([
            "play_alone",
            "large_group",
        ]);
        expect(readMultipleScaleSelection({ sociability: ["unknown_key"] }, scale)).toEqual([]);
        expect(readMultipleScaleSelection({ sociability: "play_alone" }, scale)).toEqual([]);
        expect(readMultipleScaleSelection({}, scale)).toEqual([]);
    });

    it("treats a visible multiple Sociability question as answered only with at least one selection", () => {
        const target = question("multiple");

        expect(isInstrumentQuestionComplete(target, { provision: "some" })).toBe(false);
        expect(isInstrumentQuestionComplete(target, { provision: "some", sociability: [] })).toBe(false);
        expect(isInstrumentQuestionComplete(target, { provision: "some", sociability: ["play_alone"] })).toBe(true);
        expect(
            isInstrumentQuestionComplete(target, {
                provision: "some",
                sociability: ["play_alone", "small_group", "large_group"],
            }),
        ).toBe(true);
    });

    it("keeps arrays intact through a save-reload round trip", () => {
        const scale = sociabilityScale();
        const answers = toggleMultipleScaleOption(
            toggleMultipleScaleOption({ provision: "some" }, scale, "play_alone"),
            scale,
            "large_group",
        );

        // MMKV and the draft PATCH both round-trip through JSON.
        const reloaded = JSON.parse(JSON.stringify(answers)) as QuestionResponsePayload;

        expect(readMultipleScaleSelection(reloaded, scale)).toEqual(["play_alone", "large_group"]);
        expect(isInstrumentQuestionComplete(question("multiple"), reloaded)).toBe(true);
    });
});
