import { describe, expect, it } from "vitest";

import { PV_SCALE_KEYS, SCALE_ACCENT_COLORS, SCALE_ACCENT_COLORS_DARK } from "lib/audit/scale-colors";

/**
 * The four PV scale accents are a categorical palette: a reader tells Provision,
 * Variety, Challenge, and Sociability apart by hue alone in report legends, PDF
 * and Excel exports, and the in-app scale UI. Two accents that land on the same
 * hue silently make two different scales look like one.
 *
 * These colours carry no contrast pairing of their own here, so the property
 * worth locking is mutual separation rather than any single hex value.
 */

type Rgb = readonly [number, number, number];
type Lab = readonly [number, number, number];

function parseHex(hex: string): Rgb {
    const normalized = hex.replace("#", "").trim();
    return [
        Number.parseInt(normalized.slice(0, 2), 16),
        Number.parseInt(normalized.slice(2, 4), 16),
        Number.parseInt(normalized.slice(4, 6), 16),
    ] as const;
}

function toLab([red, green, blue]: Rgb): Lab {
    const linearize = (channel: number): number => {
        const scaled = channel / 255;
        return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    const linearRed = linearize(red);
    const linearGreen = linearize(green);
    const linearBlue = linearize(blue);

    const x = (linearRed * 0.4124 + linearGreen * 0.3576 + linearBlue * 0.1805) / 0.95047;
    const y = linearRed * 0.2126 + linearGreen * 0.7152 + linearBlue * 0.0722;
    const z = (linearRed * 0.0193 + linearGreen * 0.1192 + linearBlue * 0.9505) / 1.08883;

    const pivot = (value: number): number => (value > 0.008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116);
    const pivotX = pivot(x);
    const pivotY = pivot(y);
    const pivotZ = pivot(z);

    return [116 * pivotY - 16, 500 * (pivotX - pivotY), 200 * (pivotY - pivotZ)] as const;
}

/** CIE76 colour difference. Roughly: below ~10 reads as the same colour. */
function colorDistance(leftHex: string, rightHex: string): number {
    const left = toLab(parseHex(leftHex));
    const right = toLab(parseHex(rightHex));
    return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function minimumSeparation(palette: Record<string, string>): { distance: number; pair: string } {
    let closest = { distance: Number.POSITIVE_INFINITY, pair: "" };
    for (let leftIndex = 0; leftIndex < PV_SCALE_KEYS.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < PV_SCALE_KEYS.length; rightIndex += 1) {
            const leftKey = PV_SCALE_KEYS[leftIndex] as string;
            const rightKey = PV_SCALE_KEYS[rightIndex] as string;
            const distance = colorDistance(palette[leftKey] as string, palette[rightKey] as string);
            if (distance < closest.distance) {
                closest = { distance, pair: `${leftKey}/${rightKey}` };
            }
        }
    }
    return closest;
}

// Light accents sit at 36.7 and dark at 24.8 today, so 20 leaves room for a
// deliberate retune while still failing a collapse onto a neighbouring hue.
const MINIMUM_PERCEPTUAL_SEPARATION = 20;

describe("PV scale accent palette", () => {
    it("keeps every light-theme accent perceptually distinct", () => {
        const closest = minimumSeparation(SCALE_ACCENT_COLORS);

        expect(closest.pair, `closest light pair: ${closest.pair} at dE ${closest.distance.toFixed(1)}`).toBeTruthy();
        expect(closest.distance).toBeGreaterThanOrEqual(MINIMUM_PERCEPTUAL_SEPARATION);
    });

    it("keeps every dark-theme accent perceptually distinct", () => {
        // Dark accents are blended toward white, which compresses differences -
        // a light palette that only just passes can still collapse here.
        const closest = minimumSeparation(SCALE_ACCENT_COLORS_DARK);

        expect(closest.pair, `closest dark pair: ${closest.pair} at dE ${closest.distance.toFixed(1)}`).toBeTruthy();
        expect(closest.distance).toBeGreaterThanOrEqual(MINIMUM_PERCEPTUAL_SEPARATION);
    });

    it("keeps Variety and Challenge apart", () => {
        // Regression guard: Challenge was briefly retinted to #B45309, landing
        // 9.6 from Variety's #D2691E and making the two scales read as one.
        expect(colorDistance(SCALE_ACCENT_COLORS.variety, SCALE_ACCENT_COLORS.challenge)).toBeGreaterThanOrEqual(
            MINIMUM_PERCEPTUAL_SEPARATION,
        );
    });
});
