// ============================================================
//  DANH MỤC LOẠI ĐẤT — Theo Thông tư 08/2024/TT-BTNMT
//  Phụ lục V: Quy định màu sắc trên bản đồ hiện trạng sử dụng đất
//  Có hiệu lực từ 01/07/2025
// ============================================================

(function () {
    'use strict';

    // === I. NHÓM ĐẤT NÔNG NGHIỆP (NNP) ===
    // === II. NHÓM ĐẤT PHI NÔNG NGHIỆP (PNN) ===
    // === III. NHÓM ĐẤT CHƯA SỬ DỤNG (CSD) ===

    var LAND_TYPES = [
        // ─── I. NHÓM ĐẤT NÔNG NGHIỆP ───────────────────────────
        { code: 'NNP', name: 'Đất nông nghiệp',                  rgb: [255, 255, 100], group: 'NNP' },
        { code: 'CHN', name: 'Đất trồng cây hằng năm',           rgb: [255, 252, 120], group: 'NNP' },
        { code: 'LUA', name: 'Đất trồng lúa',                    rgb: [255, 252, 130], group: 'NNP' },
        { code: 'LUC', name: 'Đất chuyên trồng lúa nước',        rgb: [255, 252, 140], group: 'NNP' },
        { code: 'LUK', name: 'Đất trồng lúa còn lại',            rgb: [255, 252, 150], group: 'NNP' },
        { code: 'HNK', name: 'Đất trồng cây hằng năm khác',      rgb: [255, 240, 180], group: 'NNP' },
        { code: 'CLN', name: 'Đất trồng cây lâu năm',            rgb: [255, 210, 160], group: 'NNP' },
        { code: 'LNP', name: 'Đất lâm nghiệp',                   rgb: [170, 255,  50], group: 'NNP' },
        { code: 'RDD', name: 'Đất rừng đặc dụng',                rgb: [110, 255, 100], group: 'NNP' },
        { code: 'RPH', name: 'Đất rừng phòng hộ',                rgb: [190, 255,  30], group: 'NNP' },
        { code: 'RSX', name: 'Đất rừng sản xuất',                rgb: [180, 255, 180], group: 'NNP' },
        { code: 'NTS', name: 'Đất nuôi trồng thủy sản',          rgb: [170, 255, 255], group: 'NNP' },
        { code: 'CNT', name: 'Đất chăn nuôi tập trung',          rgb: [230, 230, 130], group: 'NNP' },
        { code: 'LMU', name: 'Đất làm muối',                     rgb: [255, 255, 254], group: 'NNP' },
        { code: 'NKH', name: 'Đất nông nghiệp khác',             rgb: [245, 255, 180], group: 'NNP' },

        // ─── II. NHÓM ĐẤT PHI NÔNG NGHIỆP ──────────────────────
        { code: 'PNN', name: 'Đất phi nông nghiệp',              rgb: [255, 200, 200], group: 'PNN' },
        { code: 'OTC', name: 'Đất ở',                            rgb: [255, 180, 255], group: 'PNN' },
        { code: 'ONT', name: 'Đất ở tại nông thôn',              rgb: [255, 208, 255], group: 'PNN' },
        { code: 'ODT', name: 'Đất ở tại đô thị',                 rgb: [255, 160, 255], group: 'PNN' },
        { code: 'TSC', name: 'Đất trụ sở cơ quan',               rgb: [255, 170, 160], group: 'PNN' },
        { code: 'CQA', name: 'Đất quốc phòng, an ninh',          rgb: [255, 120, 120], group: 'PNN' },
        { code: 'CQP', name: 'Đất quốc phòng',                   rgb: [255, 120, 120], group: 'PNN' },
        { code: 'CAN', name: 'Đất an ninh',                      rgb: [255, 130, 130], group: 'PNN' },
        { code: 'DSN', name: 'Đất công trình sự nghiệp',         rgb: [255, 160, 170], group: 'PNN' },
        { code: 'DVH', name: 'Đất cơ sở văn hóa',               rgb: [255, 170, 160], group: 'PNN' },
        { code: 'DYT', name: 'Đất cơ sở y tế',                  rgb: [255, 170, 160], group: 'PNN' },
        { code: 'DGD', name: 'Đất cơ sở giáo dục',              rgb: [255, 170, 160], group: 'PNN' },
        { code: 'CSK', name: 'Đất sản xuất, kinh doanh',         rgb: [255, 180, 200], group: 'PNN' },
        { code: 'TMD', name: 'Đất thương mại, dịch vụ',          rgb: [255, 190, 200], group: 'PNN' },
        { code: 'SKC', name: 'Đất sản xuất phi nông nghiệp',     rgb: [255, 200, 180], group: 'PNN' },
        { code: 'CCC', name: 'Đất mục đích công cộng',           rgb: [255, 170, 160], group: 'PNN' },
        { code: 'DGT', name: 'Đất giao thông',                   rgb: [255, 170,  50], group: 'PNN' },
        { code: 'DTL', name: 'Đất thủy lợi',                    rgb: [170, 255, 255], group: 'PNN' },
        { code: 'DNL', name: 'Đất năng lượng',                   rgb: [255, 170, 160], group: 'PNN' },
        { code: 'DDT', name: 'Đất di tích lịch sử',             rgb: [255, 170, 160], group: 'PNN' },
        { code: 'TON', name: 'Đất tôn giáo',                    rgb: [255, 170, 160], group: 'PNN' },
        { code: 'NTD', name: 'Đất nghĩa trang, nhà tang lễ',    rgb: [210, 210, 210], group: 'PNN' },
        { code: 'SON', name: 'Đất mặt nước (sông, kênh)',        rgb: [160, 255, 255], group: 'PNN' },
        { code: 'MNC', name: 'Đất mặt nước chuyên dùng',         rgb: [170, 245, 255], group: 'PNN' },
        { code: 'PNK', name: 'Đất phi nông nghiệp khác',         rgb: [240, 200, 210], group: 'PNN' },
        { code: 'DRA', name: 'Đất xử lý chất thải',             rgb: [205, 170, 205], group: 'PNN' },

        // ─── III. NHÓM ĐẤT CHƯA SỬ DỤNG ────────────────────────
        { code: 'CSD', name: 'Đất chưa sử dụng',                rgb: [255, 255, 254], group: 'CSD' },
        { code: 'BCS', name: 'Đất bằng chưa sử dụng',           rgb: [255, 255, 254], group: 'CSD' },
        { code: 'DCS', name: 'Đất đồi núi chưa sử dụng',        rgb: [245, 245, 240], group: 'CSD' }
    ];

    // Nhóm đất — dùng cho UI accordion
    var LAND_GROUPS = [
        { code: 'NNP', name: 'Nông nghiệp',       icon: '🌾' },
        { code: 'PNN', name: 'Phi nông nghiệp',    icon: '🏘️' },
        { code: 'CSD', name: 'Chưa sử dụng',       icon: '📐' }
    ];

    // ── Helpers ──────────────────────────────────────────────────

    /** Lookup loại đất theo code → object hoặc null */
    function getLandType(code) {
        if (!code) return null;
        for (var i = 0; i < LAND_TYPES.length; i++) {
            if (LAND_TYPES[i].code === code) return LAND_TYPES[i];
        }
        return null;
    }

    /** Lấy CSS color string từ code */
    function getLandTypeColor(code) {
        var t = getLandType(code);
        return t ? 'rgb(' + t.rgb[0] + ', ' + t.rgb[1] + ', ' + t.rgb[2] + ')' : null;
    }

    /** Lấy danh sách loại đất theo group */
    function getLandTypesByGroup(groupCode) {
        return LAND_TYPES.filter(function (t) { return t.group === groupCode; });
    }

    // ── Expose globals ──────────────────────────────────────────
    window.__LAND_TYPES = LAND_TYPES;
    window.__LAND_GROUPS = LAND_GROUPS;
    window.__getLandType = getLandType;
    window.__getLandTypeColor = getLandTypeColor;
    window.__getLandTypesByGroup = getLandTypesByGroup;

    // Loại đất đang được chọn (null = chưa chọn)
    window.__currentLandType = null;

    console.log('[LandTypes] ✅ Loaded ' + LAND_TYPES.length + ' land types (' + LAND_GROUPS.length + ' groups)');
})();
