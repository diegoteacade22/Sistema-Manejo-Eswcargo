export const PACKING_LIST_TYPOGRAPHY_ADJUSTMENT_PX = 2;

const adjusted = (basePx: number) => basePx + PACKING_LIST_TYPOGRAPHY_ADJUSTMENT_PX;

export const PACKING_LIST_TYPOGRAPHY = {
    ui: {
        brandPx: adjusted(48),
        brandMetaPx: adjusted(18),
        addressPx: adjusted(12),
        documentTitlePx: adjusted(24),
        documentNumberPx: adjusted(18),
        segmentNoticePx: adjusted(12),
        sectionTitlePx: adjusted(14),
        detailPx: adjusted(14),
        contentTitlePx: adjusted(12),
        itemHeaderPx: adjusted(14),
        itemDetailPx: adjusted(14),
        itemRatioPx: adjusted(16),
        summaryTitlePx: adjusted(12),
        summaryWeightPx: adjusted(16),
        summaryAmountPx: adjusted(18),
        remarksTitlePx: adjusted(14),
        remarksCopyPx: adjusted(14),
        footerPx: adjusted(12),
        footerLinksPx: adjusted(10),
    },
    browserPrint: {
        brandMetaPx: adjusted(16),
        documentTitlePx: adjusted(20),
        documentNumberPx: adjusted(16),
        remarksTitlePx: adjusted(12),
    },
    pdf: {
        brandPx: adjusted(28),
        brandMetaPx: adjusted(11),
        documentTitlePx: adjusted(24),
        documentNumberPx: adjusted(18),
        metadataPx: adjusted(13),
        itemHeaderPx: adjusted(11),
        itemDetailPx: adjusted(16),
        itemColorPx: adjusted(11),
        totalPcsPx: adjusted(16),
        totalLabelPx: adjusted(11),
        shippingLabelPx: adjusted(12),
        shippingRoutePx: adjusted(14),
        shippingAmountPx: adjusted(22),
        footerPx: adjusted(11),
    },
} as const;
