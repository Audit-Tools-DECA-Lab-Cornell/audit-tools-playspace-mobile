import * as XLSX from "xlsx-js-style";

import { SCALE_ACCENT_COLORS, SCALE_SOFT_COLORS, hexToXlsxRgb, type PvScaleKey } from "lib/audit/scale-colors";
import {
    COMMENT_ROW_SENTINEL,
    SCALE_COLUMN_MAP,
    SCORE_ROW_KIND_COL,
    SCORE_ROW_SENTINEL,
    SECTION_NOTE_RESPONSE_SENTINEL,
    SECTION_NOTE_SENTINEL,
    type SpreadsheetRow,
    type WorkbookPayload,
    type WorkbookTable,
} from "./types";
import { sanitizeSheetName, stringifyCell } from "./format-utils";

type StyledCell = XLSX.CellObject & { s?: Record<string, unknown> };

const SCALE_SOFT_HEX: Record<PvScaleKey, string> = {
    provision: hexToXlsxRgb(SCALE_SOFT_COLORS.provision),
    variety: hexToXlsxRgb(SCALE_SOFT_COLORS.variety),
    sociability: hexToXlsxRgb(SCALE_SOFT_COLORS.sociability),
    challenge: hexToXlsxRgb(SCALE_SOFT_COLORS.challenge),
};

const SCALE_ACCENT_HEX: Record<PvScaleKey, string> = {
    provision: hexToXlsxRgb(SCALE_ACCENT_COLORS.provision),
    variety: hexToXlsxRgb(SCALE_ACCENT_COLORS.variety),
    sociability: hexToXlsxRgb(SCALE_ACCENT_COLORS.sociability),
    challenge: hexToXlsxRgb(SCALE_ACCENT_COLORS.challenge),
};

/** Converts CSS-style color strings to 6-character SheetJS hex strings. */
export function toSheetHex(colorValue: string): string {
    if (colorValue.startsWith("#")) {
        let hex = colorValue.replace("#", "").toUpperCase();
        if (hex.length === 3 || hex.length === 4) {
            hex = hex
                .split("")
                .map((char) => `${char}${char}`)
                .join("");
        }
        return hex.substring(0, 6);
    }

    const rgbMatch = colorValue.match(/rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*([.\d]+))?\)/iu);
    if (rgbMatch) {
        const r = parseInt(rgbMatch[1] as string, 10);
        const g = parseInt(rgbMatch[2] as string, 10);
        const b = parseInt(rgbMatch[3] as string, 10);
        const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4] as string) : 1;
        const blendedR = Math.round((1 - a) * 255 + a * r);
        const blendedG = Math.round((1 - a) * 255 + a * g);
        const blendedB = Math.round((1 - a) * 255 + a * b);
        const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0").toUpperCase();
        return `${toHex(blendedR)}${toHex(blendedG)}${toHex(blendedB)}`;
    }

    return colorValue
        .replace(/[^A-Fa-f0-9]/g, "")
        .toUpperCase()
        .substring(0, 6);
}

/** Estimates column widths from content, clamped for usable spreadsheets. */
export function calculateDynamicColumnWidths(rows: readonly SpreadsheetRow[]): { wch: number }[] {
    const minWidth = 12;
    const maxWidth = 60;
    const maxWidths: number[] = [];

    for (const row of rows) {
        for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
            const cellText = String(row[colIndex] ?? "");
            const longestLine = cellText.split("\n").reduce((max, line) => Math.max(max, line.length), 0);
            const estimatedWidth = longestLine + 2;

            if (maxWidths[colIndex] === undefined || estimatedWidth > maxWidths[colIndex]!) {
                maxWidths[colIndex] = Math.min(Math.max(estimatedWidth, minWidth), maxWidth);
            }
        }
    }

    return maxWidths.map((width) => ({ wch: width }));
}

/** Applies web-audit-style cell styling and row heights to a worksheet in-place. */
export function styleWorkbookSheet(sheet: XLSX.WorkSheet, table: WorkbookTable): void {
    const ref = sheet["!ref"];
    if (typeof ref !== "string" || ref.length === 0) {
        return;
    }

    const range = XLSX.utils.decode_range(ref);
    const headerFill = { patternType: "solid", fgColor: { rgb: "1F2937" } } as const;
    const sectionFill = { patternType: "solid", fgColor: { rgb: "E2E8F0" } } as const;
    const altRowFill = { patternType: "solid", fgColor: { rgb: "F8FAFC" } } as const;
    const noFill = { patternType: "none" } as const;
    const scoreLabelFill = { patternType: "solid", fgColor: { rgb: "333F55" } } as const;
    const scorePvUFill = { patternType: "solid", fgColor: { rgb: "F1F5F9" } } as const;
    const heavyBorder = { style: "medium", color: { rgb: "94A3B8" } } as const;
    const lightBorder = { style: "thin", color: { rgb: "E2E8F0" } } as const;
    const noBorder = { style: "thin", color: { rgb: "E2E8F0" } } as const;
    const isResponsesTable = table.name === "Responses";
    const merges: XLSX.Range[] = [];

    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
        const row = table.rows[rowIndex];
        if (row === undefined) continue;

        const isHeaderRow = rowIndex === 0;
        const isScoreRow = row[2] === SCORE_ROW_SENTINEL;
        const isCommentRow = row[1] === COMMENT_ROW_SENTINEL;
        const isSectionNoteRow = row[1] === SECTION_NOTE_SENTINEL;
        const isSectionNoteResponseRow = row[1] === SECTION_NOTE_RESPONSE_SENTINEL;
        const isSectionHeaderRow =
            !isHeaderRow && typeof row[0] === "string" && /^\d+$/u.test(row[0]) && row[1] === "" && row[2] === "";
        const isEvenRow = rowIndex % 2 === 0;

        if (isSectionNoteRow || isSectionNoteResponseRow) {
            merges.push({ s: { r: rowIndex, c: range.s.c }, e: { r: rowIndex, c: range.e.c } });
        }

        const scoreKind = isScoreRow ? String(row[SCORE_ROW_KIND_COL] ?? "") : "";

        for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
            const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
            const cell = sheet[address] as StyledCell | undefined;
            if (cell === undefined) continue;

            const scaleKey = SCALE_COLUMN_MAP[colIndex];
            const isScaleCol = scaleKey !== undefined;
            const responseHeader = String(table.rows[0]?.[colIndex] ?? "");
            const isPvUCol = responseHeader === "PV Score" || responseHeader === "U Score";

            const baseStyle = {
                alignment: {
                    vertical: "top" as const,
                    wrapText: true,
                    horizontal: (colIndex >= 7 ? "right" : "left") as "right" | "left",
                },
                font: { name: "Arial", sz: 10, color: { rgb: "334155" } },
                border: { bottom: lightBorder, right: noBorder },
            };

            if (isHeaderRow) {
                if (isResponsesTable && isScaleCol && scaleKey !== undefined) {
                    cell.s = {
                        ...baseStyle,
                        fill: { patternType: "solid", fgColor: { rgb: SCALE_SOFT_HEX[scaleKey] } },
                        font: { ...baseStyle.font, bold: true, sz: 11, color: { rgb: SCALE_ACCENT_HEX[scaleKey] } },
                        alignment: { ...baseStyle.alignment, horizontal: "center", vertical: "center" },
                        border: { bottom: heavyBorder, right: noBorder },
                    };
                } else {
                    cell.s = {
                        ...baseStyle,
                        fill: headerFill,
                        font: { ...baseStyle.font, bold: true, sz: 11, color: { rgb: "FFFFFF" } },
                        alignment: { ...baseStyle.alignment, horizontal: "center", vertical: "center" },
                        border: { bottom: heavyBorder, right: noBorder },
                    };
                }
            } else if (isSectionHeaderRow) {
                cell.s = {
                    ...baseStyle,
                    fill: sectionFill,
                    font: { ...baseStyle.font, bold: true, color: { rgb: "0F172A" } },
                    border: { top: heavyBorder, bottom: heavyBorder, right: noBorder },
                };
            } else if (isCommentRow) {
                cell.s = {
                    ...baseStyle,
                    fill: sectionFill,
                    font: { ...baseStyle.font, italic: true, color: { rgb: "475569" } },
                    border: { bottom: lightBorder, right: noBorder },
                };
            } else if (isSectionNoteRow) {
                cell.s = {
                    ...baseStyle,
                    fill: sectionFill,
                    font: { ...baseStyle.font, bold: true, color: { rgb: "0F172A" } },
                    alignment: { ...baseStyle.alignment, wrapText: true, horizontal: "left" },
                    border: { top: lightBorder, bottom: noBorder, right: noBorder },
                };
            } else if (isSectionNoteResponseRow) {
                cell.s = {
                    ...baseStyle,
                    fill: sectionFill,
                    font: { ...baseStyle.font, color: { rgb: "475569" } },
                    alignment: { ...baseStyle.alignment, wrapText: true, horizontal: "left" },
                    border: { top: noBorder, bottom: lightBorder, right: noBorder },
                };
            } else if (isScoreRow) {
                const isTotal = scoreKind === "Raw Scores";
                const isPercentage = scoreKind === "Final Percentage";
                const rowBorder = (fillRgb: string) => ({
                    bottom: isTotal ? heavyBorder : { style: "thin" as const, color: { rgb: fillRgb } },
                    top: { style: "thin" as const, color: { rgb: fillRgb } },
                    left: { style: "thin" as const, color: { rgb: fillRgb } },
                    right: { style: "thin" as const, color: { rgb: fillRgb } },
                });

                if (isResponsesTable && isScaleCol && scaleKey !== undefined) {
                    const fillRgb = SCALE_SOFT_HEX[scaleKey];
                    cell.s = {
                        ...baseStyle,
                        fill: { patternType: "solid", fgColor: { rgb: fillRgb } },
                        font: {
                            ...baseStyle.font,
                            bold: isTotal,
                            italic: isPercentage,
                            color: { rgb: SCALE_ACCENT_HEX[scaleKey] },
                        },
                        alignment: { ...baseStyle.alignment, horizontal: "center" },
                        border: rowBorder(fillRgb),
                    };
                } else if (isResponsesTable && isPvUCol) {
                    const fillRgb = "F1F5F9";
                    cell.s = {
                        ...baseStyle,
                        fill: scorePvUFill,
                        font: {
                            ...baseStyle.font,
                            bold: isTotal,
                            italic: isPercentage,
                            color: { rgb: "1E293B" },
                        },
                        alignment: { ...baseStyle.alignment, horizontal: "right" },
                        border: rowBorder(fillRgb),
                    };
                } else {
                    const fillRgb = "333F55";
                    cell.s = {
                        ...baseStyle,
                        fill: scoreLabelFill,
                        font: {
                            ...baseStyle.font,
                            bold: isTotal,
                            italic: isPercentage,
                            color: { rgb: "FFFFFF" },
                        },
                        border: rowBorder(fillRgb),
                    };
                }
            } else {
                const bodyFill = isEvenRow ? altRowFill : noFill;

                if (isResponsesTable && isScaleCol && scaleKey !== undefined) {
                    cell.s = {
                        ...baseStyle,
                        fill: { patternType: "solid", fgColor: { rgb: SCALE_SOFT_HEX[scaleKey] } },
                        font: { ...baseStyle.font, color: { rgb: SCALE_ACCENT_HEX[scaleKey] } },
                        alignment: { ...baseStyle.alignment, horizontal: "center" },
                        border: { bottom: lightBorder, right: noBorder },
                    };
                } else if (isResponsesTable && isPvUCol) {
                    cell.s = {
                        ...baseStyle,
                        fill: scoreLabelFill,
                        font: { ...baseStyle.font, bold: true, color: { rgb: "FFFFFF" } },
                        alignment: { ...baseStyle.alignment, horizontal: "right" },
                        border: { bottom: lightBorder, right: noBorder },
                    };
                } else {
                    cell.s = { ...baseStyle, fill: bodyFill };
                }
            }
        }
    }

    if (merges.length > 0) {
        const existing = sheet["!merges"] ?? [];
        sheet["!merges"] = [...existing, ...merges];
    }

    sheet["!rows"] = table.rows.map((row, rowIndex) => {
        const isHeaderRow = rowIndex === 0;
        const isScoreRow = row[2] === SCORE_ROW_SENTINEL;
        const isCommentRow = row[1] === COMMENT_ROW_SENTINEL;
        const isSectionNoteRow = row[1] === SECTION_NOTE_SENTINEL;
        const isSectionNoteResponseRow = row[1] === SECTION_NOTE_RESPONSE_SENTINEL;
        const isSectionHeaderRow =
            !isHeaderRow && typeof row[0] === "string" && /^\d+$/u.test(row[0]) && row[1] === "" && row[2] === "";

        let maxLines = 1;
        for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
            const cellText = String(row[colIndex] ?? "");
            const colWidth = (sheet["!cols"]?.[colIndex] as { wch?: number } | undefined)?.wch ?? 20;
            const explicitLines = cellText.split("\n").length;
            const wrappedLines = Math.max(1, Math.ceil(cellText.length / colWidth));
            maxLines = Math.max(maxLines, explicitLines, wrappedLines);
        }

        const calculatedHeight = maxLines * 14 + 8;
        if (isHeaderRow) return { hpt: Math.max(28, calculatedHeight) };
        if (isSectionHeaderRow) return { hpt: Math.max(26, calculatedHeight) };
        if (isSectionNoteRow) return { hpt: 22 };
        if (isSectionNoteResponseRow) return { hpt: 22 };
        if (isScoreRow) return { hpt: Math.max(22, calculatedHeight) };
        if (isCommentRow) return { hpt: Math.max(20, calculatedHeight) };
        return { hpt: Math.max(20, calculatedHeight) };
    });
}

/** Serialize spreadsheet rows into RFC-4180-style CSV text. */
export function buildCsvText(rows: readonly SpreadsheetRow[]): string {
    return rows
        .map((row) =>
            row
                .map((cell) => {
                    const text = stringifyCell(cell);
                    const escapedText = text.replaceAll('"', '""');
                    return `"${escapedText}"`;
                })
                .join(","),
        )
        .join("\n");
}

/** Serialize every workbook table into one CSV document, separated by blank rows. */
export function buildWorkbookCsvText(workbook: WorkbookPayload): string {
    const rows: SpreadsheetRow[] = workbook.tables.flatMap((table, tableIndex) => {
        const tableSeparatorRows: SpreadsheetRow[] = tableIndex > 0 ? [[], []] : [];
        return [...tableSeparatorRows, [table.title], [], ...table.rows];
    });
    return buildCsvText(rows);
}

/** Build a styled XLSX workbook as a base64 payload for Expo FileSystem writes. */
export function buildXlsxWorkbookBase64(workbook: WorkbookPayload): string {
    const excelWorkbook = XLSX.utils.book_new();

    for (const table of workbook.tables) {
        const sheet = XLSX.utils.aoa_to_sheet(table.rows.map((row) => [...row]));
        sheet["!cols"] = table.columnWidths
            ? table.columnWidths.map((width) => ({ wch: width }))
            : calculateDynamicColumnWidths(table.rows);
        styleWorkbookSheet(sheet, table);
        XLSX.utils.book_append_sheet(excelWorkbook, sheet, sanitizeSheetName(table.name));
    }

    return XLSX.write(excelWorkbook, {
        type: "base64",
        bookType: "xlsx",
        cellStyles: true,
    });
}
