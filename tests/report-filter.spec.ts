import { describe, expect, it } from "vitest";

import {
    applySelectionToAllDomains,
    buildQuestionLookup,
    clearDomainOverride,
    createDefaultReportFilter,
    getDomainConstructCoverage,
    getQuestionConstructKeys,
    isDefaultReportFilter,
    isSingleConstructSelection,
    pruneUnknownDomainOverrides,
    questionMatchesConstructSelection,
    resolveDomainConstructSelection,
    setDomainOverride,
    setOverallSelection,
} from "lib/audit/report-filter";
import { getQuestionDomainKeys } from "lib/audit/report-helpers";
import { playspaceInstrumentSchema, type ConstructKey, type InstrumentQuestion } from "lib/audit/types";

const PLAY_VALUE_ONLY = { playValue: true, usability: false };
const USABILITY_ONLY = { playValue: false, usability: true };
const BOTH = { playValue: true, usability: true };

function buildQuestion(
    questionKey: string,
    constructs: ConstructKey[],
    domains: string[],
    overrides: Partial<InstrumentQuestion> = {},
): InstrumentQuestion {
    return {
        question_key: questionKey,
        mode: "audit",
        constructs,
        domains,
        section_key: "section_test",
        prompt: `Prompt ${questionKey}`,
        question_type: "scaled",
        required: true,
        display_if: null,
        notes_prompt: null,
        options: [],
        scales: [],
        ...overrides,
    } as InstrumentQuestion;
}

/** Mirrors the instrument's checklist follow-ups, which carry no constructs of their own. */
function buildChecklistFollowUp(questionKey: string, parentQuestionKey: string): InstrumentQuestion {
    return buildQuestion(questionKey, [], [], {
        question_type: "checklist",
        display_if: {
            question_key: parentQuestionKey,
            response_key: "provision",
            any_of_option_keys: ["some"],
        },
    });
}

function buildInstrument(questions: InstrumentQuestion[]) {
    return playspaceInstrumentSchema.parse({
        instrument_key: "pvua-v-test",
        instrument_name: "PVUA",
        instrument_version: "5.2",
        current_sheet: "sheet-1",
        source_files: ["instrument.json"],
        preamble: [],
        execution_modes: [{ key: "audit", label: "Place Audit", description: null }],
        pre_audit_questions: [],
        scale_guidance: [],
        sections: [
            {
                section_key: "section_test",
                title: "Test Section",
                description: null,
                instruction: "Instruction",
                notes_prompt: null,
                questions,
            },
        ],
    });
}

describe("construct resolution and inheritance", () => {
    it("prefers a question's own constructs over inheritance", () => {
        const parent = buildQuestion("q_parent", ["play_value"], ["Seating"]);
        const child = buildQuestion("q_child", ["usability"], [], {
            display_if: {
                question_key: "q_parent",
                response_key: "provision",
                any_of_option_keys: ["some"],
            },
        });

        expect(getQuestionConstructKeys(child, { q_parent: parent, q_child: child })).toEqual(["usability"]);
    });

    it("inherits a single-construct parent for a checklist follow-up", () => {
        const parent = buildQuestion("q_14_1", ["play_value"], ["Loose Manufactured Parts & Equipment"]);
        const child = buildChecklistFollowUp("q_14_1_1", "q_14_1");

        expect(getQuestionConstructKeys(child, { q_14_1: parent, q_14_1_1: child })).toEqual(["play_value"]);
    });

    it("inherits a dual-construct parent for a checklist follow-up", () => {
        const parent = buildQuestion("q_16_1", ["play_value", "usability"], ["Seating"]);
        const child = buildChecklistFollowUp("q_16_1_1", "q_16_1");

        expect(getQuestionConstructKeys(child, { q_16_1: parent, q_16_1_1: child })).toEqual([
            "play_value",
            "usability",
        ]);
    });

    it("resolves no constructs for a construct-less question with no parent", () => {
        const orphan = buildQuestion("q_orphan", [], ["Seating"]);
        expect(getQuestionConstructKeys(orphan, { q_orphan: orphan })).toEqual([]);
    });

    it("stops on a self-referencing parent", () => {
        const looping = buildQuestion("q_loop", [], [], {
            display_if: {
                question_key: "q_loop",
                response_key: "provision",
                any_of_option_keys: ["some"],
            },
        });
        expect(getQuestionConstructKeys(looping, { q_loop: looping })).toEqual([]);
    });

    it("stops on a two-question cycle", () => {
        const first = buildQuestion("q_a", [], [], {
            display_if: { question_key: "q_b", response_key: "provision", any_of_option_keys: ["some"] },
        });
        const second = buildQuestion("q_b", [], [], {
            display_if: { question_key: "q_a", response_key: "provision", any_of_option_keys: ["some"] },
        });
        expect(getQuestionConstructKeys(first, { q_a: first, q_b: second })).toEqual([]);
    });
});

describe("inclusion rule", () => {
    it("excludes a play-value question from a usability-only report", () => {
        expect(questionMatchesConstructSelection(["play_value"], USABILITY_ONLY)).toBe(false);
        expect(questionMatchesConstructSelection(["play_value"], PLAY_VALUE_ONLY)).toBe(true);
    });

    it("excludes a usability question from a play-value-only report", () => {
        expect(questionMatchesConstructSelection(["usability"], PLAY_VALUE_ONLY)).toBe(false);
        expect(questionMatchesConstructSelection(["usability"], USABILITY_ONLY)).toBe(true);
    });

    it("keeps a dual-construct question under either single-construct filter", () => {
        const dual: ConstructKey[] = ["play_value", "usability"];
        expect(questionMatchesConstructSelection(dual, PLAY_VALUE_ONLY)).toBe(true);
        expect(questionMatchesConstructSelection(dual, USABILITY_ONLY)).toBe(true);
    });

    it("never drops an unresolvable construct-less question", () => {
        expect(questionMatchesConstructSelection([], PLAY_VALUE_ONLY)).toBe(true);
        expect(questionMatchesConstructSelection([], USABILITY_ONLY)).toBe(true);
    });

    it("includes every question when both constructs are enabled", () => {
        const cases: ConstructKey[][] = [["play_value"], ["usability"], ["play_value", "usability"], []];
        cases.forEach((constructKeys) => {
            expect(questionMatchesConstructSelection(constructKeys, BOTH)).toBe(true);
        });
    });
});

describe("filter state", () => {
    it("excludes nothing by default", () => {
        const filter = createDefaultReportFilter();
        expect(filter.overall).toEqual(BOTH);
        expect(filter.domainOverrides).toEqual({});
        expect(isDefaultReportFilter(filter)).toBe(true);
    });

    it("treats a narrowed report-level selection as non-default", () => {
        expect(isDefaultReportFilter(setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY))).toBe(false);
    });

    it("treats a narrowed domain override as non-default", () => {
        const filter = setDomainOverride(createDefaultReportFilter(), "seating", USABILITY_ONLY);
        expect(filter.overall).toEqual(BOTH);
        expect(isDefaultReportFilter(filter)).toBe(false);
    });

    it("treats an override that narrows nothing as still default", () => {
        expect(isDefaultReportFilter(setDomainOverride(createDefaultReportFilter(), "seating", BOTH))).toBe(true);
    });

    it("rejects disabling both constructs", () => {
        const filter = createDefaultReportFilter();
        const none = { playValue: false, usability: false };
        expect(setOverallSelection(filter, none)).toBe(filter);
        expect(setDomainOverride(filter, "seating", none)).toBe(filter);
    });

    it("inherits the report-level selection until a domain is overridden", () => {
        const filter = setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY);
        expect(resolveDomainConstructSelection(filter, "seating")).toEqual(PLAY_VALUE_ONLY);

        const overridden = setDomainOverride(filter, "seating", USABILITY_ONLY);
        expect(resolveDomainConstructSelection(overridden, "seating")).toEqual(USABILITY_ONLY);
        expect(resolveDomainConstructSelection(overridden, "pathways")).toEqual(PLAY_VALUE_ONLY);
    });

    it("returns a domain to inheritance when its override is cleared", () => {
        const filter = setDomainOverride(
            setOverallSelection(createDefaultReportFilter(), PLAY_VALUE_ONLY),
            "seating",
            USABILITY_ONLY,
        );
        const cleared = clearDomainOverride(filter, "seating");
        expect(cleared.domainOverrides).toEqual({});
        expect(resolveDomainConstructSelection(cleared, "seating")).toEqual(PLAY_VALUE_ONLY);
    });

    it("drops every override when applying the report selection to all domains", () => {
        const filter = setDomainOverride(
            setDomainOverride(createDefaultReportFilter(), "seating", USABILITY_ONLY),
            "pathways",
            PLAY_VALUE_ONLY,
        );
        expect(applySelectionToAllDomains(filter).domainOverrides).toEqual({});
    });

    it("prunes overrides for domains the report does not contain", () => {
        const filter = setDomainOverride(
            setDomainOverride(createDefaultReportFilter(), "seating", USABILITY_ONLY),
            "retired_domain",
            PLAY_VALUE_ONLY,
        );
        expect(Object.keys(pruneUnknownDomainOverrides(filter, ["seating", "pathways"]).domainOverrides)).toEqual([
            "seating",
        ]);
    });

    it("returns the same filter when every override is still present", () => {
        const filter = setDomainOverride(createDefaultReportFilter(), "seating", USABILITY_ONLY);
        expect(pruneUnknownDomainOverrides(filter, ["seating"])).toBe(filter);
    });

    it("detects a single-construct selection for the scope label", () => {
        expect(isSingleConstructSelection(PLAY_VALUE_ONLY)).toBe(true);
        expect(isSingleConstructSelection(BOTH)).toBe(false);
    });
});

describe("domain construct coverage", () => {
    it("reports a single-construct domain as such", () => {
        const instrument = buildInstrument([
            buildQuestion("q_1", ["usability"], ["Amenities"]),
            buildQuestion("q_2", ["usability"], ["Amenities"]),
        ]);
        expect(getDomainConstructCoverage(instrument, getQuestionDomainKeys).amenities).toEqual({
            playValue: false,
            usability: true,
        });
    });

    it("reports a mixed domain as carrying both constructs", () => {
        const instrument = buildInstrument([
            buildQuestion("q_1", ["play_value"], ["Pathways"]),
            buildQuestion("q_2", ["usability"], ["Pathways"]),
        ]);
        expect(getDomainConstructCoverage(instrument, getQuestionDomainKeys).pathways).toEqual({
            playValue: true,
            usability: true,
        });
    });

    it("counts an inherited checklist follow-up toward its parent's construct", () => {
        const instrument = buildInstrument([
            buildQuestion("q_14_1", ["play_value"], ["Loose Manufactured Parts & Equipment"]),
            buildChecklistFollowUp("q_14_1_1", "q_14_1"),
        ]);
        const coverage = getDomainConstructCoverage(instrument, getQuestionDomainKeys);
        expect(coverage["loose_manufactured_parts_&_equipment"]).toEqual({
            playValue: true,
            usability: false,
        });
    });

    it("covers every question in the lookup", () => {
        const instrument = buildInstrument([
            buildQuestion("q_1", ["play_value"], ["Seating"]),
            buildQuestion("q_2", ["usability"], ["Seating"]),
        ]);
        expect(Object.keys(buildQuestionLookup(instrument)).sort()).toEqual(["q_1", "q_2"]);
    });
});
