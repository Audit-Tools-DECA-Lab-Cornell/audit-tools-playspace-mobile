import { useMemo } from "react";
import { getContentTrackInnerWidth, useResponsiveLayout } from "lib/responsive-layout";

import { type ReportScoreTableLayout, resolveReportScoreTableLayout } from "lib/report-table-layout-math";

export { getSociabilityDataColumnWidth, resolveReportScoreTableLayout } from "lib/report-table-layout-math";
export type { ReportScoreTableLayout } from "lib/report-table-layout-math";

/**
 * Report score table / bar column widths derived from the same **content track**
 * as `getResponsiveContentContainerStyle` (viewport minus padding, capped by
 * `contentMaxWidth`).
 *
 * - **Tablet:** three groups side by side; columns are scaled from the full joined nominal.
 * - **Phone:** three stacked tables; each sub-table is scaled to the **full** `track` width, so
 *   they share one label column and every group ends up the same width.
 */
export function useReportScoreTableLayout(): ReportScoreTableLayout {
    const layout = useResponsiveLayout();

    return useMemo<ReportScoreTableLayout>(
        () => resolveReportScoreTableLayout(getContentTrackInnerWidth(layout), layout.isTablet),
        [layout],
    );
}
