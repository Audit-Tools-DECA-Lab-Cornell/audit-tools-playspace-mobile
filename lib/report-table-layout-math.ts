/**
 * Report scores read as three independent groups, never one eight-column table:
 * the scored scales, the Sociability opportunities, and the two headline constructs.
 */
const LEFT_COLUMN_COUNT = 3; // provision, variety, challenge
const SOCIABILITY_COLUMN_COUNT = 3; // play alone, small group, larger group
const RIGHT_COLUMN_COUNT = 2; // play_value, usability

/** Former fixed phone sizes - only proportions matter; widths scale to the content track. */
const NOMINAL_PHONE = { label: 160, leftData: 72, rightData: 108 } as const;
/** Former fixed tablet sizes - proportions preserved on wide slates. */
const NOMINAL_TABLET = { label: 130, leftData: 155, rightData: 130 } as const;

function nominalJoinedTotal(nominal: { label: number; leftData: number; rightData: number }): number {
    return nominal.label + nominal.leftData * LEFT_COLUMN_COUNT + nominal.rightData * RIGHT_COLUMN_COUNT;
}

/**
 * Derive integer column widths from the available content width by scaling
 * nominal label and data proportions, then absorbing rounding in the label column
 * so the joined table width matches `track` exactly.
 */
function layoutFromContentTrack(
    track: number,
    nominal: { label: number; leftData: number; rightData: number },
): { labelColWidth: number; leftDataColWidth: number; rightDataColWidth: number } {
    const totalNominal = nominalJoinedTotal(nominal);
    if (track <= 0 || totalNominal <= 0) {
        return {
            labelColWidth: nominal.label,
            leftDataColWidth: nominal.leftData,
            rightDataColWidth: nominal.rightData,
        };
    }

    let labelColWidth = Math.round((nominal.label / totalNominal) * track);
    let leftDataColWidth = Math.round((nominal.leftData / totalNominal) * track);
    let rightDataColWidth = Math.round((nominal.rightData / totalNominal) * track);

    labelColWidth = Math.max(32, labelColWidth);
    leftDataColWidth = Math.max(28, leftDataColWidth);
    rightDataColWidth = Math.max(28, rightDataColWidth);

    const drift =
        track - (labelColWidth + leftDataColWidth * LEFT_COLUMN_COUNT + rightDataColWidth * RIGHT_COLUMN_COUNT);
    labelColWidth += drift;

    return { labelColWidth, leftDataColWidth, rightDataColWidth };
}

/**
 * Phone layout: the UI shows **two** score tables (scale group, then construct group), not
 * a joined table. Scale the **scale** table to the full `track` width, then divide the leftover
 * width evenly between the construct columns so every group ends up exactly `track` wide:
 * `label + 3×L` = `label + 2×R` = `track`.
 */
function layoutPhoneSubTablesToTrack(
    track: number,
    nominal: { label: number; leftData: number; rightData: number },
): { labelColWidth: number; leftDataColWidth: number; rightDataColWidth: number } {
    const scaleTotalNom = nominal.label + nominal.leftData * LEFT_COLUMN_COUNT;
    if (track <= 0 || scaleTotalNom <= 0) {
        return {
            labelColWidth: Math.max(32, nominal.label),
            leftDataColWidth: Math.max(28, nominal.leftData),
            rightDataColWidth: Math.max(28, nominal.rightData),
        };
    }

    let labelColWidth = Math.round((nominal.label / scaleTotalNom) * track);
    let leftDataColWidth = Math.round((nominal.leftData / scaleTotalNom) * track);
    labelColWidth = Math.max(32, labelColWidth);
    leftDataColWidth = Math.max(28, leftDataColWidth);
    const drift = track - (labelColWidth + leftDataColWidth * LEFT_COLUMN_COUNT);
    labelColWidth += drift;
    // Derived from the leftover width rather than a fixed multiple of the scale column, so the
    // construct group stays exactly as wide as the track whatever the scale column count is.
    const rightDataColWidth = Math.max(28, Math.floor((track - labelColWidth) / RIGHT_COLUMN_COUNT));
    return { labelColWidth, leftDataColWidth, rightDataColWidth };
}

export interface ReportScoreTableLayout {
    readonly labelColWidth: number;
    readonly leftDataColWidth: number;
    readonly rightDataColWidth: number;
    readonly leftTableWidth: number;
    readonly sociabilityTableWidth: number;
    readonly rightTableWidth: number;
}
/**
 * Width of one Sociability data column for a given number of Sociability columns.
 *
 * Divides the group's fixed footprint by the columns actually shown, so the group stays the same
 * width whether it lists the three opportunities or the single legacy aggregate. A `5.31` report
 * therefore never renders one stranded narrow column beside the full-width scale group.
 *
 * @param layout Resolved label and Sociability group widths.
 * @param columnCount Number of Sociability columns being rendered.
 * @returns Width for one Sociability data column.
 */
export function getSociabilityDataColumnWidth(
    layout: Pick<ReportScoreTableLayout, "labelColWidth" | "sociabilityTableWidth">,
    columnCount: number,
): number {
    if (columnCount <= 0) {
        return 0;
    }
    return Math.floor((layout.sociabilityTableWidth - layout.labelColWidth) / columnCount);
}

/**
 * Resolve every column and group width for one content-track width.
 *
 * Kept separate from the hook so the width arithmetic can be exercised directly at real device
 * widths - a column-count change here silently reshapes every score table and bar chart.
 *
 * @param track Usable content width in points.
 * @param isTablet Whether the tablet proportions apply.
 * @returns Column widths plus the width of each of the three score groups.
 */
export function resolveReportScoreTableLayout(track: number, isTablet: boolean): ReportScoreTableLayout {
    if (isTablet) {
        const { labelColWidth, leftDataColWidth, rightDataColWidth } = layoutFromContentTrack(track, NOMINAL_TABLET);

        return {
            labelColWidth,
            leftDataColWidth,
            rightDataColWidth,
            leftTableWidth: labelColWidth + leftDataColWidth * LEFT_COLUMN_COUNT,
            sociabilityTableWidth: labelColWidth + leftDataColWidth * SOCIABILITY_COLUMN_COUNT,
            rightTableWidth: labelColWidth + rightDataColWidth * RIGHT_COLUMN_COUNT,
        };
    }

    const { labelColWidth, leftDataColWidth, rightDataColWidth } = layoutPhoneSubTablesToTrack(track, NOMINAL_PHONE);
    // Each sub-table spans the full content track.
    return {
        labelColWidth,
        leftDataColWidth,
        rightDataColWidth,
        leftTableWidth: track,
        sociabilityTableWidth: track,
        rightTableWidth: track,
    };
}
