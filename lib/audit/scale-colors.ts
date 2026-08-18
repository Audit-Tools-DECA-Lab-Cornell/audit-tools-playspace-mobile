/**
 * Canonical PV scale colour palette - fixed product tokens, independent of
 * theme accent colours (slate, moss, terracotta, violet).
 *
 * Used by in-app scale UI, report views, PDF, and Excel exports.
 */

import type { ColorTokens } from "tamagui";

export const PV_SCALE_KEYS = ["provision", "variety", "challenge", "sociability"] as const;

export type PvScaleKey = (typeof PV_SCALE_KEYS)[number];

/** Canonical accent hex colours for each PV scale (aligned with web). */
export const SCALE_ACCENT_COLORS: Record<PvScaleKey, string> = {
    provision: "#566E3D",
    variety: "#D2691E",
    challenge: "#0C4767",
    sociability: "#754170",
};

/**
 * Soft fills are blended from each accent toward white so column backgrounds
 * and badge fills stay clearly lighter than accent text and borders.
 */
const SCALE_SOFT_BLEND_WEIGHT = 0.2;

export interface ScaleColorFields {
    readonly provision: ColorTokens;
    readonly provisionSoft: ColorTokens;
    readonly variety: ColorTokens;
    readonly varietySoft: ColorTokens;
    readonly challenge: ColorTokens;
    readonly challengeSoft: ColorTokens;
    readonly sociability: ColorTokens;
    readonly sociabilitySoft: ColorTokens;
    readonly playValue: ColorTokens;
    readonly usabilityConstruct: ColorTokens;
}

/**
 * Headline construct colours (Play Value / Usability) - a balanced teal/gold
 * pair, co-equal peers, distinct from the four scale colours and brand clay.
 */
export const CONSTRUCT_ACCENT_COLORS: Record<"playValue" | "usability", string> = {
    playValue: "#2E7D78",
    usability: "#C7972F",
};

function parseHexColor(hex: string): [number, number, number] {
    const normalized = hex.replace("#", "").trim();
    if (normalized.length !== 6) {
        throw new Error(`Expected 6-digit hex color, received "${hex}"`);
    }

    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);

    if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) {
        throw new Error(`Invalid hex color "${hex}"`);
    }

    return [red, green, blue];
}

function toHexByte(value: number): string {
    return Math.round(value).toString(16).padStart(2, "0");
}

function blendHexWithWhite(hex: string, accentWeight: number): string {
    const [red, green, blue] = parseHexColor(hex);
    const backgroundWeight = 1 - accentWeight;

    const blendedRed = 255 * backgroundWeight + red * accentWeight;
    const blendedGreen = 255 * backgroundWeight + green * accentWeight;
    const blendedBlue = 255 * backgroundWeight + blue * accentWeight;

    return `#${toHexByte(blendedRed)}${toHexByte(blendedGreen)}${toHexByte(blendedBlue)}`;
}

/** Canonical soft background hex colours for scale columns and badge fills. */
export const SCALE_SOFT_COLORS: Record<PvScaleKey, string> = {
    provision: blendHexWithWhite(SCALE_ACCENT_COLORS.provision, SCALE_SOFT_BLEND_WEIGHT),
    variety: blendHexWithWhite(SCALE_ACCENT_COLORS.variety, SCALE_SOFT_BLEND_WEIGHT),
    challenge: blendHexWithWhite(SCALE_ACCENT_COLORS.challenge, SCALE_SOFT_BLEND_WEIGHT),
    sociability: blendHexWithWhite(SCALE_ACCENT_COLORS.sociability, SCALE_SOFT_BLEND_WEIGHT),
};

/**
 * Dark-theme accents keep each scale's hue but lift lightness so accent text
 * and borders stay readable against dark surfaces. Exports (PDF/Excel/web)
 * always render on white and keep using the canonical light constants.
 */
const SCALE_DARK_ACCENT_BLEND_WEIGHT = 0.6;

function hexToRgbaString(hex: string, alpha: number): string {
    const [red, green, blue] = parseHexColor(hex);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Dark-theme construct colours for in-app UI (lightened for contrast). */
export const CONSTRUCT_ACCENT_COLORS_DARK: Record<"playValue" | "usability", string> = {
    playValue: blendHexWithWhite(CONSTRUCT_ACCENT_COLORS.playValue, SCALE_DARK_ACCENT_BLEND_WEIGHT),
    usability: blendHexWithWhite(CONSTRUCT_ACCENT_COLORS.usability, SCALE_DARK_ACCENT_BLEND_WEIGHT),
};

/** Dark-theme accent colours for in-app scale UI (lightened for contrast). */
export const SCALE_ACCENT_COLORS_DARK: Record<PvScaleKey, string> = {
    provision: blendHexWithWhite(SCALE_ACCENT_COLORS.provision, SCALE_DARK_ACCENT_BLEND_WEIGHT),
    variety: blendHexWithWhite(SCALE_ACCENT_COLORS.variety, SCALE_DARK_ACCENT_BLEND_WEIGHT),
    challenge: blendHexWithWhite(SCALE_ACCENT_COLORS.challenge, SCALE_DARK_ACCENT_BLEND_WEIGHT),
    sociability: blendHexWithWhite(SCALE_ACCENT_COLORS.sociability, SCALE_DARK_ACCENT_BLEND_WEIGHT),
};

/**
 * Dark-theme soft fills are translucent accent tints that composite over dark
 * surfaces, matching how the dark palette's other `*Soft` tokens behave.
 */
export const SCALE_SOFT_COLORS_DARK: Record<PvScaleKey, string> = {
    provision: hexToRgbaString(SCALE_ACCENT_COLORS.provision, 0.28),
    variety: hexToRgbaString(SCALE_ACCENT_COLORS.variety, 0.24),
    challenge: hexToRgbaString(SCALE_ACCENT_COLORS.challenge, 0.32),
    sociability: hexToRgbaString(SCALE_ACCENT_COLORS.sociability, 0.3),
};

/** Fixed accent and soft-fill hex values per PV scale. */
export const PV_SCALE_PALETTE: Record<PvScaleKey, { readonly accent: string; readonly soft: string }> = {
    provision: { accent: SCALE_ACCENT_COLORS.provision, soft: SCALE_SOFT_COLORS.provision },
    variety: { accent: SCALE_ACCENT_COLORS.variety, soft: SCALE_SOFT_COLORS.variety },
    challenge: { accent: SCALE_ACCENT_COLORS.challenge, soft: SCALE_SOFT_COLORS.challenge },
    sociability: { accent: SCALE_ACCENT_COLORS.sociability, soft: SCALE_SOFT_COLORS.sociability },
};

/**
 * Tamagui palette fields derived from the PV scale palette.
 *
 * In-app UI reads these through the active theme palette, so dark themes get
 * lifted accents and translucent soft fills while light themes keep the
 * canonical export colours.
 */
export function buildScaleColorFields(theme: "light" | "dark" = "light"): ScaleColorFields {
    const accents = theme === "dark" ? SCALE_ACCENT_COLORS_DARK : SCALE_ACCENT_COLORS;
    const softs = theme === "dark" ? SCALE_SOFT_COLORS_DARK : SCALE_SOFT_COLORS;
    const constructs = theme === "dark" ? CONSTRUCT_ACCENT_COLORS_DARK : CONSTRUCT_ACCENT_COLORS;
    return {
        provision: accents.provision as ColorTokens,
        provisionSoft: softs.provision as ColorTokens,
        variety: accents.variety as ColorTokens,
        varietySoft: softs.variety as ColorTokens,
        challenge: accents.challenge as ColorTokens,
        challengeSoft: softs.challenge as ColorTokens,
        sociability: accents.sociability as ColorTokens,
        sociabilitySoft: softs.sociability as ColorTokens,
        playValue: constructs.playValue as ColorTokens,
        usabilityConstruct: constructs.usability as ColorTokens,
    };
}

/** Converts `#RRGGBB` to an RGB tuple for PDF consumers. */
export function hexToRgb(hex: string): [number, number, number] {
    return parseHexColor(hex);
}

/** Strips `#` for XLSX `rgb` style fields. */
export function hexToXlsxRgb(hex: string): string {
    return hex.replace("#", "").trim().toUpperCase();
}
