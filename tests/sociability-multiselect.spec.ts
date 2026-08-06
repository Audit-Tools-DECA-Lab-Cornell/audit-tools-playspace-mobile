import { describe, expect, it } from "vitest";

import { addScoreTotals, calculateQuestionScores, createEmptyScoreTotals } from "lib/audit/score-helpers";
import { isInstrumentQuestionComplete } from "lib/audit/selectors";
import { auditScoreTotalsSchema, playspaceInstrumentSchema, type InstrumentQuestion } from "lib/audit/types";

import { buildSociabilityInstrument } from "./support/sociability-fixtures";

function question(selectionMode: "single" | "multiple" = "multiple"): InstrumentQuestion {
    const value = buildSociabilityInstrument(selectionMode).sections[0]?.questions[0];
    if (value === undefined) {
        throw new Error("Expected fixture question.");
    }
    return value;
}

describe("Sociability multi-select contract", () => {
    it("defaults missing selection_mode to single and preserves explicit multiple", () => {
        const legacy = buildSociabilityInstrument("single");
        const rawLegacy = JSON.parse(JSON.stringify(legacy)) as Record<string, unknown>;
        const sections = rawLegacy.sections as { questions: { scales: Record<string, unknown>[] }[] }[];
        const sociabilityScale = sections[0]?.questions[0]?.scales[1];
        delete sociabilityScale?.selection_mode;

        const parsedLegacy = playspaceInstrumentSchema.parse(rawLegacy);
        expect(parsedLegacy.sections[0]?.questions[0]?.scales[1]?.selection_mode).toBe("single");
        expect(question("multiple").scales[1]?.selection_mode).toBe("multiple");
    });

    it("parses the nullable versioned breakdown returned by the backend", () => {
        const parsed = auditScoreTotalsSchema.parse({
            ...createEmptyScoreTotals(),
            sociability_total: 2,
            sociability_total_max: 3,
            sociability_breakdown: {
                model: "multi_select_v1",
                play_alone: { total: 1, max: 1 },
                small_group: { total: 0, max: 1 },
                large_group: { total: 1, max: 1 },
                captured_question_count: 1,
                eligible_question_count: 1,
            },
        });

        expect(parsed.sociability_breakdown?.large_group.total).toBe(1);
        expect(auditScoreTotalsSchema.parse(createEmptyScoreTotals()).sociability_breakdown).toBeNull();
    });
});

describe("Sociability multi-select completion and local scoring", () => {
    it.each([
        [["play_alone"], 1],
        [["play_alone", "small_group"], 2],
        [["play_alone", "small_group", "large_group"], 3],
    ] as const)("scores %j as %i equal-weight points", (selectedKeys, expectedTotal) => {
        const targetQuestion = question();
        const answers = { provision: "some", sociability: [...selectedKeys] };
        const scores = calculateQuestionScores(targetQuestion, answers);

        expect(isInstrumentQuestionComplete(targetQuestion, answers)).toBe(true);
        expect(scores.sociability_total).toBe(expectedTotal);
        expect(scores.sociability_total_max).toBe(3);
        expect(scores.sociability_breakdown?.captured_question_count).toBe(1);
        expect(scores.sociability_breakdown?.large_group.total).toBe(
            selectedKeys.some((selectedKey) => selectedKey === "large_group") ? 1 : 0,
        );
    });

    it("requires a non-empty canonical string array for explicit multiple scales", () => {
        const targetQuestion = question();

        expect(isInstrumentQuestionComplete(targetQuestion, { provision: "some", sociability: "play_alone" })).toBe(
            false,
        );
        expect(isInstrumentQuestionComplete(targetQuestion, { provision: "some", sociability: [] })).toBe(false);
        expect(() => calculateQuestionScores(targetQuestion, { provision: "some", sociability: "play_alone" })).toThrow(
            "must be a list",
        );
        expect(() =>
            calculateQuestionScores(targetQuestion, {
                provision: "some",
                sociability: ["play_alone", "play_alone"],
            }),
        ).toThrow("duplicate keys");
    });

    it("preserves legacy scalar scoring when selection_mode is single", () => {
        const scores = calculateQuestionScores(question("single"), {
            provision: "some",
            sociability: "more_than_two",
        });

        expect(scores.sociability_total).toBe(2);
        expect(scores.sociability_total_max).toBe(2);
        expect(scores.sociability_breakdown).toBeNull();
    });

    it("preserves provision no, not-applicable, and unsure denominator gates", () => {
        const targetQuestion = question();
        const no = calculateQuestionScores(targetQuestion, { provision: "no" });
        const notApplicable = calculateQuestionScores(targetQuestion, { provision: "not_applicable" });
        const canonicalUnsure = calculateQuestionScores(targetQuestion, { provision: "unsure" });
        const unsureAsZero = calculateQuestionScores(targetQuestion, { provision: "unsure" }, "unsure_as_zero");
        const unsureAsMax = calculateQuestionScores(targetQuestion, { provision: "unsure" }, "unsure_as_max");

        expect(no.sociability_total_max).toBe(0);
        expect(no.sociability_breakdown?.eligible_question_count).toBe(0);
        expect(notApplicable.sociability_total_max).toBe(0);
        expect(canonicalUnsure.sociability_total_max).toBe(0);
        expect(unsureAsZero.sociability_total_max).toBe(3);
        expect(unsureAsZero.sociability_breakdown?.play_alone).toEqual({ total: 0, max: 1 });
        expect(unsureAsMax.sociability_total).toBe(3);
        expect(unsureAsMax.sociability_breakdown?.large_group).toEqual({ total: 1, max: 1 });
    });

    it("aggregates breakdowns without aliasing one-sided mixed-version data", () => {
        const legacyTotals = calculateQuestionScores(question("single"), {
            provision: "some",
            sociability: "a_pair",
        });
        const multipleTotals = calculateQuestionScores(question("multiple"), {
            provision: "some",
            sociability: ["play_alone", "large_group"],
        });

        const combined = addScoreTotals(legacyTotals, multipleTotals);
        expect(combined.sociability_total).toBe(3);
        expect(combined.sociability_breakdown?.captured_question_count).toBe(1);
        expect(combined.sociability_breakdown?.play_alone.total).toBe(1);
        expect(combined.sociability_breakdown).not.toBe(multipleTotals.sociability_breakdown);
    });
});
