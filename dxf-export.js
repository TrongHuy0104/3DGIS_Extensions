// ============================================================
//  DXF EXPORT — Xuất file DXF với layers theo loại đất
//  - Transform tọa độ EPSG:3857 → VN-2000 (TM-3)
//  - Sinh DXF file chuẩn AutoCAD 2004 (AC1018)
//  - True Color (group code 420) cho layer
//  - UI dialog chọn kinh tuyến trục tỉnh/thành
// ============================================================

(function () {
    'use strict';

    // ════════════════════════════════════════════════════════
    //  KINH TUYẾN TRỤC THEO 34 TỈNH/THÀNH — VN-2000 (TM-3)
    //  Theo NQ 202/2025/QH15 + TT 24/2025/TT-BNNMT
    //  Có hiệu lực từ 01/07/2025
    // ════════════════════════════════════════════════════════
    var PROVINCES = [
        // === 6 Thành phố trực thuộc TW ===
        { name: 'TP. Hà Nội',                meridian: 105.00 },  // Giữ nguyên
        { name: 'TP. Hải Phòng',              meridian: 105.75 },  // HN: Hải Dương + Hải Phòng
        { name: 'TP. Huế',                    meridian: 107.00 },  // Giữ nguyên (TT-Huế → TP Huế)
        { name: 'TP. Đà Nẵng',               meridian: 107.75 },  // HN: Quảng Nam + Đà Nẵng
        { name: 'TP. Hồ Chí Minh',           meridian: 105.75 },  // HN: TP.HCM + Bình Dương + BR-VT
        { name: 'TP. Cần Thơ',               meridian: 105.00 },  // HN: Cần Thơ + Sóc Trăng + Hậu Giang

        // === 28 Tỉnh ===
        { name: 'An Giang',                   meridian: 104.75 },  // HN: Kiên Giang + An Giang
        { name: 'Bắc Ninh',                   meridian: 107.00 },  // HN: Bắc Giang + Bắc Ninh
        { name: 'Cà Mau',                     meridian: 104.50 },  // HN: Bạc Liêu + Cà Mau
        { name: 'Cao Bằng',                   meridian: 105.75 },  // Giữ nguyên
        { name: 'Đắk Lắk',                   meridian: 108.50 },  // HN: Phú Yên + Đắk Lắk
        { name: 'Điện Biên',                  meridian: 103.00 },  // Giữ nguyên
        { name: 'Đồng Nai',                   meridian: 107.75 },  // HN: Đồng Nai + Bình Phước
        { name: 'Đồng Tháp',                  meridian: 105.00 },  // HN: Tiền Giang + Đồng Tháp
        { name: 'Gia Lai',                    meridian: 108.25 },  // HN: Bình Định + Gia Lai
        { name: 'Hà Tĩnh',                   meridian: 105.50 },  // Giữ nguyên
        { name: 'Hưng Yên',                   meridian: 105.50 },  // HN: Thái Bình + Hưng Yên
        { name: 'Khánh Hòa',                 meridian: 108.25 },  // HN: Ninh Thuận + Khánh Hòa
        { name: 'Lai Châu',                   meridian: 104.75 },  // Giữ nguyên (Lai Châu → kinh tuyến mới)
        { name: 'Lâm Đồng',                  meridian: 107.75 },  // HN: Đắk Nông + Bình Thuận + Lâm Đồng
        { name: 'Lạng Sơn',                   meridian: 107.25 },  // Giữ nguyên
        { name: 'Lào Cai',                    meridian: 104.75 },  // HN: Yên Bái + Lào Cai
        { name: 'Nghệ An',                    meridian: 104.75 },  // Giữ nguyên
        { name: 'Ninh Bình',                  meridian: 105.00 },  // HN: Hà Nam + Nam Định + Ninh Bình
        { name: 'Phú Thọ',                    meridian: 104.75 },  // HN: Vĩnh Phúc + Hòa Bình + Phú Thọ
        { name: 'Quảng Ngãi',                 meridian: 108.00 },  // HN: Kon Tum + Quảng Ngãi
        { name: 'Quảng Ninh',                 meridian: 107.75 },  // Giữ nguyên
        { name: 'Quảng Trị',                  meridian: 106.25 },  // HN: Quảng Bình + Quảng Trị
        { name: 'Sơn La',                     meridian: 104.00 },  // Giữ nguyên
        { name: 'Tây Ninh',                   meridian: 105.50 },  // HN: Tây Ninh + Long An
        { name: 'Thái Nguyên',                meridian: 106.50 },  // HN: Bắc Kạn + Thái Nguyên
        { name: 'Thanh Hóa',                  meridian: 105.00 },  // Giữ nguyên
        { name: 'Tuyên Quang',                meridian: 106.00 },  // HN: Hà Giang + Tuyên Quang
        { name: 'Vĩnh Long',                  meridian: 105.50 },  // HN: Bến Tre + Vĩnh Long + Trà Vinh
    ];

    // ════════════════════════════════════════════════════════
    //  COORDINATE TRANSFORM
    //  EPSG:3857 (Web Mercator) → WGS84 → Helmert → VN-2000 TM-3
    //  Bao gồm phép biến đổi Helmert 7 tham số chuyển datum
    //  WGS84 sang VN-2000 (Nghị định 973/QĐ-BTNMT)
    // ════════════════════════════════════════════════════════

    // WGS84 ellipsoid parameters
    var WGS84_A  = 6378137.0;                          // semi-major axis (m)
    var WGS84_F  = 1.0 / 298.257223563;                // flattening
    var WGS84_B  = WGS84_A * (1 - WGS84_F);            // semi-minor axis
    var WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;   // eccentricity squared
    var WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2);        // second eccentricity squared

    // VN-2000 TM-3 projection parameters
    var TM_K0 = 0.9999;    // Scale factor
    var TM_FE = 500000;    // False Easting (m)
    var TM_FN = 0;         // False Northing (m)

    var DEG2RAD = Math.PI / 180;
    var MERC_R = 20037508.342789244; // Earth radius * PI for EPSG:3857

    /** EPSG:3857 → WGS84 (degrees) */
    function mercatorToWgs84(mx, my) {
        var lon = (mx / MERC_R) * 180;
        var lat = (Math.atan(Math.exp((my / MERC_R) * Math.PI)) * 360 / Math.PI) - 90;
        return [lon, lat];
    }

    // ── Helmert 7-parameter datum transform (WGS84 → VN-2000) ──
    // Tham số nghịch đảo từ bộ VN-2000→WGS84 (Nghị định 973/QĐ-BTNMT)
    var HELMERT_DX =  191.90441429;       // m
    var HELMERT_DY =   39.30318279;       // m
    var HELMERT_DZ =  111.45032835;       // m
    var HELMERT_RX =  (0.00928836 / 3600) * DEG2RAD;   // arc-sec → rad
    var HELMERT_RY = (-0.01975479 / 3600) * DEG2RAD;   // arc-sec → rad
    var HELMERT_RZ =  (0.00427372 / 3600) * DEG2RAD;   // arc-sec → rad
    var HELMERT_DS = -0.252906278e-6;     // ppm → unitless

    /** WGS84 geodetic (degrees, h=0) → ECEF (meters) */
    function wgs84ToECEF(latDeg, lonDeg) {
        var phi = latDeg * DEG2RAD;
        var lam = lonDeg * DEG2RAD;
        var sinPhi = Math.sin(phi);
        var cosPhi = Math.cos(phi);
        var N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
        return [
            N * cosPhi * Math.cos(lam),
            N * cosPhi * Math.sin(lam),
            N * (1 - WGS84_E2) * sinPhi
        ];
    }

    /** ECEF (meters) → Geodetic (degrees) on WGS84 ellipsoid */
    function ecefToGeodetic(X, Y, Z) {
        var p  = Math.sqrt(X * X + Y * Y);
        var th = Math.atan2(Z * WGS84_A, p * WGS84_B);
        var lat = Math.atan2(
            Z + WGS84_EP2 * WGS84_B * Math.pow(Math.sin(th), 3),
            p - WGS84_E2  * WGS84_A * Math.pow(Math.cos(th), 3)
        );
        var lon = Math.atan2(Y, X);
        return [lat / DEG2RAD, lon / DEG2RAD];
    }

    /**
     * Helmert 7-parameter transform: WGS84 ECEF → VN-2000 ECEF
     * Position Vector convention (EPSG:9606)
     */
    function helmertWGS84toVN2000(X, Y, Z) {
        var s = 1 + HELMERT_DS;
        return [
            HELMERT_DX + s * (X + HELMERT_RZ * Y - HELMERT_RY * Z),
            HELMERT_DY + s * (-HELMERT_RZ * X + Y + HELMERT_RX * Z),
            HELMERT_DZ + s * (HELMERT_RY * X - HELMERT_RX * Y + Z)
        ];
    }

    /**
     * WGS84 (degrees) → VN-2000 TM-3 (meters)
     * Pipeline: WGS84 → ECEF → Helmert → VN-2000 datum → TM projection
     * @param {number} latDeg - Latitude in degrees (WGS84)
     * @param {number} lonDeg - Longitude in degrees (WGS84)
     * @param {number} centralMeridianDeg - Central meridian in degrees
     * @returns {[number, number]} [easting, northing]
     */
    function wgs84ToVN2000(latDeg, lonDeg, centralMeridianDeg) {
        // ── Bước 1: Chuyển datum WGS84 → VN-2000 qua Helmert ──
        var ecef   = wgs84ToECEF(latDeg, lonDeg);
        var vnEcef = helmertWGS84toVN2000(ecef[0], ecef[1], ecef[2]);
        var vnGeo  = ecefToGeodetic(vnEcef[0], vnEcef[1], vnEcef[2]);

        // ── Bước 2: TM projection trên datum VN-2000 ──
        var phi  = vnGeo[0] * DEG2RAD;
        var lam  = vnGeo[1] * DEG2RAD;
        var lam0 = centralMeridianDeg * DEG2RAD;

        var sinPhi = Math.sin(phi);
        var cosPhi = Math.cos(phi);
        var tanPhi = Math.tan(phi);

        var N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
        var T = tanPhi * tanPhi;
        var C = WGS84_EP2 * cosPhi * cosPhi;
        var A = (lam - lam0) * cosPhi;

        // Meridional arc length
        var e2 = WGS84_E2;
        var M = WGS84_A * (
            (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * phi
            - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * Math.sin(2*phi)
            + (15*e2*e2/256 + 45*e2*e2*e2/1024) * Math.sin(4*phi)
            - (35*e2*e2*e2/3072) * Math.sin(6*phi)
        );

        var A2 = A * A;
        var A3 = A2 * A;
        var A4 = A3 * A;
        var A5 = A4 * A;
        var A6 = A5 * A;

        var easting = TM_FE + TM_K0 * N * (
            A
            + (1 - T + C) * A3 / 6
            + (5 - 18*T + T*T + 72*C - 58*WGS84_EP2) * A5 / 120
        );

        var northing = TM_FN + TM_K0 * (
            M + N * tanPhi * (
                A2 / 2
                + (5 - T + 9*C + 4*C*C) * A4 / 24
                + (61 - 58*T + T*T + 600*C - 330*WGS84_EP2) * A6 / 720
            )
        );

        return [easting, northing];
    }

    /** Tọa độ nguồn → VN-2000 (hỗ trợ EPSG:3857 và EPSG:4326) */
    function transformCoord(mx, my, centralMeridianDeg, sourceProj) {
        var lon, lat;
        if (sourceProj === 'EPSG:4326') {
            // Đã là WGS84 (lon, lat)
            lon = mx; lat = my;
        } else {
            // Mặc định: EPSG:3857 → WGS84
            var wgs84 = mercatorToWgs84(mx, my);
            lon = wgs84[0]; lat = wgs84[1];
        }
        return wgs84ToVN2000(lat, lon, centralMeridianDeg);
    }

    // ════════════════════════════════════════════════════════
    //  DXF GENERATOR — Mô phỏng cấu trúc chuẩn AC1018
    //  Dựa trên file DXF mẫu từ 3dg.vn
    // ════════════════════════════════════════════════════════

    /** Convert RGB array to True Color 32-bit integer */
    function rgbToTrueColor(rgb) {
        return (rgb[0] << 16) + (rgb[1] << 8) + rgb[2];
    }

    /** Format meridian degrees → display string "xxx-xx" */
    function formatMeridian(deg) {
        var d = Math.floor(deg);
        var m = Math.round((deg - d) * 60);
        return d + '-' + (m < 10 ? '0' + m : m);
    }

    // Mỗi group code + value thành 2 dòng riêng biệt
    function w(lines, code, value) {
        var cs = '' + code;
        while (cs.length < 3) cs = ' ' + cs;
        lines.push(cs);
        lines.push(value === undefined ? '' : '' + value);
    }

    function generateDXF(features, centralMeridianDeg, sourceProj) {
        var lines = [];
        var processedFeatures = [];
        var xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;

        for (var i = 0; i < features.length; i++) {
            var f = features[i];
            var geom = f.geometry;
            var coords;
            if (geom.type === 'Polygon') { coords = geom.coordinates[0]; }
            else if (geom.type === 'LineString') { coords = geom.coordinates; }
            else { continue; }

            var transformed = [];
            for (var j = 0; j < coords.length; j++) {
                var vn = transformCoord(coords[j][0], coords[j][1], centralMeridianDeg, sourceProj);
                transformed.push(vn);
                if (vn[0] < xMin) xMin = vn[0];
                if (vn[1] < yMin) yMin = vn[1];
                if (vn[0] > xMax) xMax = vn[0];
                if (vn[1] > yMax) yMax = vn[1];
            }
            if (geom.type === 'Polygon' && transformed.length > 1) {
                var first = transformed[0], last = transformed[transformed.length - 1];
                if (Math.abs(first[0] - last[0]) < 0.001 && Math.abs(first[1] - last[1]) < 0.001) {
                    transformed.pop();
                }
            }
            processedFeatures.push({ coords: transformed, closed: geom.type === 'Polygon', landType: f.landType || null });
        }
        if (xMin === Infinity) { xMin = 0; yMin = 0; xMax = 1; yMax = 1; }

        var usedLandTypes = {};
        for (var k = 0; k < processedFeatures.length; k++) {
            var lt = processedFeatures[k].landType;
            if (lt && !usedLandTypes[lt]) {
                var info = window.__getLandType ? window.__getLandType(lt) : null;
                if (info) usedLandTypes[lt] = info;
            }
        }
        var landTypeCodes = Object.keys(usedLandTypes);

        // ══ HEADER ══
        w(lines, 0, 'SECTION'); w(lines, 2, 'HEADER');
        w(lines, 9, '$ACADVER');    w(lines, 1, 'AC1018');
        w(lines, 9, '$ACADMAINTVER'); w(lines, 70, 0);
        w(lines, 9, '$DWGCODEPAGE'); w(lines, 3, 'ANSI_1252');
        w(lines, 9, '$EXTMIN'); w(lines, 10, xMin); w(lines, 20, yMin); w(lines, 30, '0.0');
        w(lines, 9, '$EXTMAX'); w(lines, 10, xMax); w(lines, 20, yMax); w(lines, 30, '0.0');
        w(lines, 9, '$LIMMIN'); w(lines, 10, '0.0'); w(lines, 20, '0.0');
        w(lines, 9, '$LIMMAX'); w(lines, 10, '12.0'); w(lines, 20, '9.0');
        w(lines, 9, '$ORTHOMODE');  w(lines, 70, 0);
        w(lines, 9, '$REGENMODE');  w(lines, 70, 1);
        w(lines, 9, '$FILLMODE');   w(lines, 70, 1);
        w(lines, 9, '$QTEXTMODE');  w(lines, 70, 0);
        w(lines, 9, '$MIRRTEXT');   w(lines, 70, 1);
        w(lines, 9, '$LTSCALE');    w(lines, 40, '1.0');
        w(lines, 9, '$ATTMODE');    w(lines, 70, 1);
        w(lines, 9, '$TEXTSIZE');   w(lines, 40, '0.2');
        w(lines, 9, '$TRACEWID');   w(lines, 40, '0.05');
        w(lines, 9, '$TEXTSTYLE');  w(lines, 7, 'Standard');
        w(lines, 9, '$CLAYER');     w(lines, 8, '0');
        w(lines, 9, '$CELTYPE');    w(lines, 6, 'ByLayer');
        w(lines, 9, '$CECOLOR');    w(lines, 62, 256);
        w(lines, 9, '$CELTSCALE'); w(lines, 40, '1.0');
        w(lines, 9, '$LUNITS');     w(lines, 70, 2);
        w(lines, 9, '$LUPREC');     w(lines, 70, 4);
        w(lines, 9, '$HANDSEED');   w(lines, 5, 'FFFF');
        w(lines, 0, 'ENDSEC');

        // ══ CLASSES (empty) ══
        w(lines, 0, 'SECTION'); w(lines, 2, 'CLASSES');
        w(lines, 0, 'ENDSEC');

        // ══ TABLES ══
        w(lines, 0, 'SECTION'); w(lines, 2, 'TABLES');

        // ── VPORT ──
        w(lines, 0, 'TABLE'); w(lines, 2, 'VPORT'); w(lines, 5, '8'); w(lines, 330, '0');
        w(lines, 100, 'AcDbSymbolTable'); w(lines, 70, 1);
        w(lines, 0, 'VPORT'); w(lines, 5, '29'); w(lines, 330, '8');
        w(lines, 100, 'AcDbSymbolTableRecord'); w(lines, 100, 'AcDbViewportTableRecord');
        w(lines, 2, '*Active'); w(lines, 70, 0);
        w(lines, 10, '0.0'); w(lines, 20, '0.0'); w(lines, 11, '1.0'); w(lines, 21, '1.0');
        var cx = (xMin+xMax)/2, cy = (yMin+yMax)/2;
        w(lines, 12, cx); w(lines, 22, cy);
        w(lines, 13, '0.0'); w(lines, 23, '0.0'); w(lines, 14, '0.5'); w(lines, 24, '0.5');
        w(lines, 15, '0.5'); w(lines, 25, '0.5');
        w(lines, 16, '0.0'); w(lines, 26, '0.0'); w(lines, 36, '1.0');
        w(lines, 17, '0.0'); w(lines, 27, '0.0'); w(lines, 37, '0.0');
        w(lines, 40, (yMax-yMin)*1.1||100); w(lines, 41, '1.0');
        w(lines, 42, '50.0'); w(lines, 43, '0.0'); w(lines, 44, '0.0');
        w(lines, 50, '0.0'); w(lines, 51, '0.0');
        w(lines, 71, 0); w(lines, 72, 1000); w(lines, 73, 1); w(lines, 74, 3);
        w(lines, 75, 0); w(lines, 76, 0); w(lines, 77, 0); w(lines, 78, 0);
        w(lines, 281, 0); w(lines, 65, 1);
        w(lines, 110, '0.0'); w(lines, 120, '0.0'); w(lines, 130, '0.0');
        w(lines, 111, '1.0'); w(lines, 121, '0.0'); w(lines, 131, '0.0');
        w(lines, 112, '0.0'); w(lines, 122, '1.0'); w(lines, 132, '0.0');
        w(lines, 79, 0); w(lines, 146, '0.0');
        w(lines, 0, 'ENDTAB');

        // ── LTYPE ── (ByBlock, ByLayer, Continuous)
        w(lines, 0, 'TABLE'); w(lines, 2, 'LTYPE'); w(lines, 5, '5'); w(lines, 330, '0');
        w(lines, 100, 'AcDbSymbolTable'); w(lines, 70, 1);
        w(lines, 0, 'LTYPE'); w(lines, 5, '14'); w(lines, 330, '5');
        w(lines, 100, 'AcDbSymbolTableRecord'); w(lines, 100, 'AcDbLinetypeTableRecord');
        w(lines, 2, 'ByBlock'); w(lines, 70, 0); w(lines, 3, ''); w(lines, 72, 65); w(lines, 73, 0); w(lines, 40, '0.0');
        w(lines, 0, 'LTYPE'); w(lines, 5, '15'); w(lines, 330, '5');
        w(lines, 100, 'AcDbSymbolTableRecord'); w(lines, 100, 'AcDbLinetypeTableRecord');
        w(lines, 2, 'ByLayer'); w(lines, 70, 0); w(lines, 3, ''); w(lines, 72, 65); w(lines, 73, 0); w(lines, 40, '0.0');
        w(lines, 0, 'LTYPE'); w(lines, 5, '16'); w(lines, 330, '5');
        w(lines, 100, 'AcDbSymbolTableRecord'); w(lines, 100, 'AcDbLinetypeTableRecord');
        w(lines, 2, 'Continuous'); w(lines, 70, 0); w(lines, 3, 'Solid line'); w(lines, 72, 65); w(lines, 73, 0); w(lines, 40, '0.0');
        w(lines, 0, 'ENDTAB');

        // ── LAYER ──
        w(lines, 0, 'TABLE'); w(lines, 2, 'LAYER'); w(lines, 5, '2'); w(lines, 330, '0');
        w(lines, 100, 'AcDbSymbolTable'); w(lines, 70, 1 + landTypeCodes.length);
        w(lines, 0, 'LAYER'); w(lines, 5, '10'); w(lines, 330, '2');
        w(lines, 100, 'AcDbSymbolTableRecord'); w(lines, 100, 'AcDbLayerTableRecord');
        w(lines, 2, '0'); w(lines, 70, 0); w(lines, 62, 7); w(lines, 6, 'Continuous');
        w(lines, 370, -3); w(lines, 390, 'F');
        for (var li = 0; li < landTypeCodes.length; li++) {
            var lc = landTypeCodes[li], linfo = usedLandTypes[lc];
            w(lines, 0, 'LAYER'); w(lines, 5, (0x30+li).toString(16).toUpperCase()); w(lines, 330, '2');
            w(lines, 100, 'AcDbSymbolTableRecord'); w(lines, 100, 'AcDbLayerTableRecord');
            w(lines, 2, lc); w(lines, 70, 0); w(lines, 62, 7); w(lines, 420, rgbToTrueColor(linfo.rgb));
            w(lines, 6, 'Continuous'); w(lines, 370, -3); w(lines, 390, 'F');
        }
        w(lines, 0, 'ENDTAB');

        // ── STYLE ──
        w(lines, 0, 'TABLE'); w(lines, 2, 'STYLE'); w(lines, 5, '3'); w(lines, 330, '0');
        w(lines, 100, 'AcDbSymbolTable'); w(lines, 70, 1);
        w(lines, 0, 'STYLE'); w(lines, 5, '11'); w(lines, 330, '3');
        w(lines, 100, 'AcDbSymbolTableRecord'); w(lines, 100, 'AcDbTextStyleTableRecord');
        w(lines, 2, 'Standard'); w(lines, 70, 0);
        w(lines, 40, '0.0'); w(lines, 41, '1.0'); w(lines, 50, '0.0');
        w(lines, 71, 0); w(lines, 42, '0.2'); w(lines, 3, 'txt'); w(lines, 4, '');
        w(lines, 0, 'ENDTAB');

        // ── VIEW (empty) ──
        w(lines, 0, 'TABLE'); w(lines, 2, 'VIEW'); w(lines, 5, '6'); w(lines, 330, '0');
        w(lines, 100, 'AcDbSymbolTable'); w(lines, 70, 0);
        w(lines, 0, 'ENDTAB');

        // ── UCS (empty) ──
        w(lines, 0, 'TABLE'); w(lines, 2, 'UCS'); w(lines, 5, '7'); w(lines, 330, '0');
        w(lines, 100, 'AcDbSymbolTable'); w(lines, 70, 0);
        w(lines, 0, 'ENDTAB');

        // ── APPID ──
        w(lines, 0, 'TABLE'); w(lines, 2, 'APPID'); w(lines, 5, '9'); w(lines, 330, '0');
        w(lines, 100, 'AcDbSymbolTable'); w(lines, 70, 1);
        w(lines, 0, 'APPID'); w(lines, 5, '12'); w(lines, 330, '9');
        w(lines, 100, 'AcDbSymbolTableRecord'); w(lines, 100, 'AcDbRegAppTableRecord');
        w(lines, 2, 'ACAD'); w(lines, 70, 0);
        w(lines, 0, 'ENDTAB');

        // ── DIMSTYLE ──
        w(lines, 0, 'TABLE'); w(lines, 2, 'DIMSTYLE'); w(lines, 5, 'A'); w(lines, 330, '0');
        w(lines, 100, 'AcDbSymbolTable'); w(lines, 70, 1); w(lines, 100, 'AcDbDimStyleTable');
        w(lines, 0, 'DIMSTYLE'); w(lines, 105, '27'); w(lines, 330, 'A');
        w(lines, 100, 'AcDbSymbolTableRecord'); w(lines, 100, 'AcDbDimStyleTableRecord');
        w(lines, 2, 'Standard'); w(lines, 70, 0); w(lines, 340, '11');
        w(lines, 0, 'ENDTAB');

        // ── BLOCK_RECORD ──
        w(lines, 0, 'TABLE'); w(lines, 2, 'BLOCK_RECORD'); w(lines, 5, '1'); w(lines, 330, '0');
        w(lines, 100, 'AcDbSymbolTable'); w(lines, 70, 1);
        w(lines, 0, 'BLOCK_RECORD'); w(lines, 5, '1F'); w(lines, 330, '1');
        w(lines, 100, 'AcDbSymbolTableRecord'); w(lines, 100, 'AcDbBlockTableRecord');
        w(lines, 2, '*Model_Space'); w(lines, 340, '22');
        w(lines, 0, 'BLOCK_RECORD'); w(lines, 5, '1B'); w(lines, 330, '1');
        w(lines, 100, 'AcDbSymbolTableRecord'); w(lines, 100, 'AcDbBlockTableRecord');
        w(lines, 2, '*Paper_Space'); w(lines, 340, '1E');
        w(lines, 0, 'ENDTAB');

        w(lines, 0, 'ENDSEC');

        // ══ BLOCKS ══
        w(lines, 0, 'SECTION'); w(lines, 2, 'BLOCKS');
        // *Model_Space
        w(lines, 0, 'BLOCK'); w(lines, 5, '20'); w(lines, 330, '1F');
        w(lines, 100, 'AcDbEntity'); w(lines, 8, '0'); w(lines, 100, 'AcDbBlockBegin');
        w(lines, 2, '*Model_Space'); w(lines, 70, 0);
        w(lines, 10, '0.0'); w(lines, 20, '0.0'); w(lines, 30, '0.0');
        w(lines, 3, '*Model_Space'); w(lines, 1, '');
        w(lines, 0, 'ENDBLK'); w(lines, 5, '21'); w(lines, 330, '1F');
        w(lines, 100, 'AcDbEntity'); w(lines, 8, '0'); w(lines, 100, 'AcDbBlockEnd');
        // *Paper_Space
        w(lines, 0, 'BLOCK'); w(lines, 5, '1C'); w(lines, 330, '1B');
        w(lines, 100, 'AcDbEntity'); w(lines, 67, 1); w(lines, 8, '0'); w(lines, 100, 'AcDbBlockBegin');
        w(lines, 2, '*Paper_Space'); w(lines, 70, 0);
        w(lines, 10, '0.0'); w(lines, 20, '0.0'); w(lines, 30, '0.0');
        w(lines, 3, '*Paper_Space'); w(lines, 1, '');
        w(lines, 0, 'ENDBLK'); w(lines, 5, '1D'); w(lines, 330, '1B');
        w(lines, 100, 'AcDbEntity'); w(lines, 67, 1); w(lines, 8, '0'); w(lines, 100, 'AcDbBlockEnd');
        w(lines, 0, 'ENDSEC');

        // ══ ENTITIES ══
        w(lines, 0, 'SECTION'); w(lines, 2, 'ENTITIES');
        for (var ei = 0; ei < processedFeatures.length; ei++) {
            var pf = processedFeatures[ei];
            var layerName = pf.landType || '0';
            w(lines, 0, 'LWPOLYLINE');
            w(lines, 5, (0x20000 + ei).toString(16).toUpperCase());
            w(lines, 100, 'AcDbEntity');
            w(lines, 8, layerName);
            w(lines, 100, 'AcDbPolyline');
            w(lines, 70, pf.closed ? 1 : 0);
            w(lines, 90, pf.coords.length);
            for (var vi = 0; vi < pf.coords.length; vi++) {
                w(lines, 10, pf.coords[vi][0]);
                w(lines, 20, pf.coords[vi][1]);
            }
        }
        w(lines, 0, 'ENDSEC');

        // ══ OBJECTS ══
        w(lines, 0, 'SECTION'); w(lines, 2, 'OBJECTS');
        w(lines, 0, 'DICTIONARY'); w(lines, 5, 'C');
        w(lines, 100, 'AcDbDictionary'); w(lines, 281, 1);
        w(lines, 3, 'ACAD_GROUP'); w(lines, 350, 'D');
        w(lines, 3, 'ACAD_MLINESTYLE'); w(lines, 350, '17');
        w(lines, 0, 'DICTIONARY'); w(lines, 5, 'D'); w(lines, 330, 'C');
        w(lines, 100, 'AcDbDictionary'); w(lines, 281, 1);
        w(lines, 0, 'DICTIONARY'); w(lines, 5, '17'); w(lines, 330, 'C');
        w(lines, 100, 'AcDbDictionary'); w(lines, 281, 1);
        w(lines, 0, 'ACDBPLACEHOLDER'); w(lines, 5, 'F');
        w(lines, 0, 'ENDSEC');

        w(lines, 0, 'EOF');
        return lines.join('\r\n');
    }

    // ════════════════════════════════════════════════════════
    //  EXPORT LOGIC
    // ════════════════════════════════════════════════════════

    function doExport(centralMeridianDeg) {
        // Extract features từ OL map
        var olMap = window.__olMap;
        if (!olMap) {
            alert('Không tìm thấy bản đồ OpenLayers!');
            return;
        }

        var features = [];
        var seenIds = new Set();

        // ── Kiểm tra hệ tọa độ của map ──
        var mapProj = 'EPSG:3857'; // default
        try {
            var viewProj = olMap.getView().getProjection();
            if (viewProj) {
                mapProj = viewProj.getCode();
                console.log('[DXF Export] Map projection: ' + mapProj);
            }
        } catch (e) {}

        var isEPSG3857 = (mapProj === 'EPSG:3857');
        var isEPSG4326 = (mapProj === 'EPSG:4326');

        if (!isEPSG3857 && !isEPSG4326) {
            console.warn('[DXF Export] ⚠️ Map projection không phải EPSG:3857 hoặc EPSG:4326: ' + mapProj);
            if (!confirm('Hệ tọa độ bản đồ là ' + mapProj + ', không phải EPSG:3857.\nTọa độ xuất ra có thể không chính xác.\n\nVẫn tiếp tục?')) {
                return;
            }
        }

        // Thu thập features từ DOM (giống autosave extractFeatures)
        var domIds = new Set();
        document.querySelectorAll('div[data-feature-id]').forEach(function (el) {
            var fid = el.getAttribute('data-feature-id');
            if (fid) domIds.add(fid);
        });

        function collectLayer(layer) {
            if (layer.getLayers) { layer.getLayers().forEach(collectLayer); return; }
            try {
                var src = layer.getSource?.();
                if (!src?.getFeatures) return;
                for (var f of src.getFeatures()) {
                    var geom = f.getGeometry();
                    if (!geom) continue;
                    var fid = f.getId();
                    if (domIds.size > 0 && fid && !domIds.has(fid)) continue;
                    if (domIds.size > 0 && !fid) continue;
                    if (fid && seenIds.has(fid)) continue;
                    if (fid) seenIds.add(fid);

                    var type = geom.getType();
                    if (type === 'Point' || type === 'MultiPoint') continue;

                    features.push({
                        id: fid,
                        geometry: { type: type, coordinates: geom.getCoordinates() },
                        landType: f.get('__landType') || null
                    });
                }
            } catch (e) {}
        }

        try { olMap.getLayers().forEach(collectLayer); } catch (e) {}

        if (features.length === 0) {
            alert('Không có feature nào để xuất!');
            return;
        }

        // Generate DXF
        console.log('[DXF Export] Generating DXF with ' + features.length + ' features, proj=' + mapProj + ', meridian=' + centralMeridianDeg + '°');
        var dxfContent = generateDXF(features, centralMeridianDeg, mapProj);

        // Download file
        var blob = new Blob([dxfContent], { type: 'application/dxf' });
        var url = URL.createObjectURL(blob);
        var filename = 'export_' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.dxf';
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        console.log('[DXF Export] ✅ Exported ' + features.length + ' features → ' + filename);
        return features.length;
    }

    // ════════════════════════════════════════════════════════
    //  UI — Export Dialog
    // ════════════════════════════════════════════════════════

    var dialogEl = null;

    function injectStyles() {
        var STYLE_ID = '__dxf-export-style';
        if (document.getElementById(STYLE_ID)) return;

        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = '\
/* DXF Export Dialog Overlay */\
#__dxf-overlay {\
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;\
    background: rgba(0,0,0,0.5); z-index: 99999;\
    display: flex; align-items: center; justify-content: center;\
    opacity: 0; pointer-events: none;\
    transition: opacity 0.2s ease;\
}\
#__dxf-overlay.--visible { opacity: 1; pointer-events: auto; }\
\
/* Dialog box */\
.dxf-dialog {\
    background: rgba(15, 23, 42, 0.97);\
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);\
    border: 1px solid rgba(255,255,255,0.12);\
    border-radius: 16px; color: #e2e8f0;\
    box-shadow: 0 12px 48px rgba(0,0,0,0.6);\
    font-family: "Segoe UI", system-ui, sans-serif;\
    min-width: 360px; max-width: 420px;\
    transform: scale(0.95) translateY(-10px);\
    transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);\
}\
#__dxf-overlay.--visible .dxf-dialog {\
    transform: scale(1) translateY(0);\
}\
\
.dxf-dialog-header {\
    display: flex; justify-content: space-between; align-items: center;\
    padding: 18px 20px 12px; border-bottom: 1px solid rgba(255,255,255,0.08);\
}\
.dxf-dialog-header span { font-weight: 700; font-size: 16px; }\
.dxf-dialog-close {\
    background: none; border: none; color: #94a3b8; cursor: pointer;\
    font-size: 18px; padding: 2px 6px; border-radius: 4px; transition: all 0.15s;\
}\
.dxf-dialog-close:hover { color: #e2e8f0; background: rgba(255,255,255,0.1); }\
\
.dxf-dialog-body { padding: 16px 20px; }\
.dxf-dialog-body label {\
    display: block; font-size: 13px; color: #94a3b8; margin-bottom: 6px;\
}\
.dxf-dialog-body select {\
    width: 100%; padding: 10px 12px;\
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);\
    border-radius: 10px; color: #e2e8f0; font-size: 14px; font-family: inherit;\
    outline: none; cursor: pointer; transition: border-color 0.15s;\
    -webkit-appearance: none; appearance: none;\
    background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' fill=\'%2394a3b8\'%3E%3Cpath d=\'M6 8L0 0h12z\'/%3E%3C/svg%3E");\
    background-repeat: no-repeat; background-position: right 12px center;\
}\
.dxf-dialog-body select:focus {\
    border-color: rgba(99,102,241,0.5); background-color: rgba(255,255,255,0.08);\
}\
.dxf-dialog-body select option {\
    background: #1e293b; color: #e2e8f0;\
}\
.dxf-info {\
    margin-top: 12px; padding: 10px 12px;\
    background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.15);\
    border-radius: 8px; font-size: 12px; color: #a5b4fc; line-height: 1.5;\
}\
\
.dxf-dialog-footer {\
    padding: 12px 20px 18px; display: flex; gap: 10px; justify-content: flex-end;\
}\
.dxf-btn {\
    padding: 9px 20px; border-radius: 9px; font-size: 14px; font-family: inherit;\
    font-weight: 600; cursor: pointer; transition: all 0.15s; border: none;\
}\
.dxf-btn-cancel {\
    background: rgba(255,255,255,0.06); color: #94a3b8;\
    border: 1px solid rgba(255,255,255,0.1);\
}\
.dxf-btn-cancel:hover { background: rgba(255,255,255,0.1); color: #e2e8f0; }\
.dxf-btn-export {\
    background: linear-gradient(135deg, #6366f1, #8b5cf6);\
    color: #fff; box-shadow: 0 2px 8px rgba(99,102,241,0.3);\
}\
.dxf-btn-export:hover {\
    box-shadow: 0 4px 16px rgba(99,102,241,0.4);\
    transform: translateY(-1px);\
}\
.dxf-btn-export:active { transform: translateY(0); }\
';
        document.head.appendChild(style);
    }

    function createDialog() {
        var overlay = document.createElement('div');
        overlay.id = '__dxf-overlay';

        var dialog = document.createElement('div');
        dialog.className = 'dxf-dialog';

        // ── Header ──
        var header = document.createElement('div');
        header.className = 'dxf-dialog-header';
        var title = document.createElement('span');
        title.textContent = '📐 Xuất DXF';
        var closeBtn = document.createElement('button');
        closeBtn.className = 'dxf-dialog-close';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', function () { hideDialog(); });
        header.appendChild(title);
        header.appendChild(closeBtn);
        dialog.appendChild(header);

        // ── Body ──
        var body = document.createElement('div');
        body.className = 'dxf-dialog-body';

        var label = document.createElement('label');
        label.textContent = 'Kinh tuyến trục (tỉnh/thành phố)';

        var select = document.createElement('select');
        select.id = '__dxf-province-select';

        // Placeholder option
        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '-- Chọn tỉnh/thành --';
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);

        for (var i = 0; i < PROVINCES.length; i++) {
            var p = PROVINCES[i];
            var opt = document.createElement('option');
            opt.value = '' + p.meridian;
            opt.textContent = p.name + '  (' + formatMeridian(p.meridian) + ')';
            select.appendChild(opt);
        }

        // Prevent keyboard shortcuts when using select
        select.addEventListener('keydown', function (e) { e.stopPropagation(); });

        var infoBox = document.createElement('div');
        infoBox.className = 'dxf-info';
        infoBox.textContent = '💡 Tọa độ sẽ chuyển đổi từ EPSG:3857 sang VN-2000 (TM-3) theo kinh tuyến trục đã chọn. Layers sẽ được phân theo loại đất.';

        body.appendChild(label);
        body.appendChild(select);
        body.appendChild(infoBox);
        dialog.appendChild(body);

        // ── Footer ──
        var footer = document.createElement('div');
        footer.className = 'dxf-dialog-footer';

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'dxf-btn dxf-btn-cancel';
        cancelBtn.textContent = 'Hủy';
        cancelBtn.addEventListener('click', function () { hideDialog(); });

        var exportBtn = document.createElement('button');
        exportBtn.className = 'dxf-btn dxf-btn-export';
        exportBtn.textContent = '📥 Xuất DXF';
        exportBtn.addEventListener('click', function () {
            var sel = document.getElementById('__dxf-province-select');
            if (!sel || !sel.value) {
                alert('Vui lòng chọn tỉnh/thành phố!');
                return;
            }
            var meridian = parseFloat(sel.value);
            hideDialog();
            var count = doExport(meridian);
            if (count > 0) {
                showExportToast('✅ Đã xuất ' + count + ' features sang DXF');
            }
        });

        footer.appendChild(cancelBtn);
        footer.appendChild(exportBtn);
        dialog.appendChild(footer);

        overlay.appendChild(dialog);

        // Click overlay to close
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) hideDialog();
        });

        // Escape to close
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && overlay.classList.contains('--visible')) {
                hideDialog();
            }
        });

        return overlay;
    }

    function showDialog() {
        if (!dialogEl) {
            dialogEl = createDialog();
            document.body.appendChild(dialogEl);
        }
        requestAnimationFrame(function () {
            dialogEl.classList.add('--visible');
        });
    }

    function hideDialog() {
        if (dialogEl) dialogEl.classList.remove('--visible');
    }

    function showExportToast(message) {
        var toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 20px;' +
            'background:rgba(15,23,42,0.95);color:#a5f3fc;border:1px solid rgba(99,102,241,0.3);' +
            'border-radius:10px;font-size:14px;font-family:"Segoe UI",system-ui,sans-serif;' +
            'z-index:100000;box-shadow:0 4px 20px rgba(0,0,0,0.4);' +
            'animation:fadeInUp 0.3s ease;pointer-events:none';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(function () {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(function () { toast.remove(); }, 300);
        }, 3000);
    }

    // ════════════════════════════════════════════════════════
    //  TASKBAR BUTTON
    // ════════════════════════════════════════════════════════

    function injectExportButton() {
        var taskbar = document.getElementById('__3dg-taskbar');
        if (!taskbar) return false;
        if (document.getElementById('__dxf-export-btn')) return true;

        var btn = document.createElement('button');
        btn.className = 'tb-btn';
        btn.id = '__dxf-export-btn';
        btn.setAttribute('title', 'Xuất DXF (với layer loại đất)');
        btn.setAttribute('type', 'button');
        btn.style.fontSize = '12px';
        btn.style.fontWeight = '600';
        btn.style.fontFamily = '"Segoe UI", system-ui, sans-serif';
        btn.textContent = '📐 DXF';

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            showDialog();
        });

        // Insert before pin badge
        var pinBadge = taskbar.querySelector('.tb-pin-badge');
        if (pinBadge) {
            taskbar.insertBefore(btn, pinBadge);
        } else {
            taskbar.appendChild(btn);
        }

        return true;
    }

    // ════════════════════════════════════════════════════════
    //  INIT
    // ════════════════════════════════════════════════════════

    function init() {
        injectStyles();

        if (!injectExportButton()) {
            var attempts = 0;
            var timer = setInterval(function () {
                attempts++;
                if (injectExportButton()) {
                    clearInterval(timer);
                    console.log('[DXF Export] ✅ Ready! Click 📐 DXF on taskbar to export.');
                } else if (attempts > 30) {
                    clearInterval(timer);
                    console.warn('[DXF Export] ⚠️ Taskbar not found');
                }
            }, 1000);
        } else {
            console.log('[DXF Export] ✅ Ready! Click 📐 DXF on taskbar to export.');
        }
    }

    if (document.readyState === 'complete') {
        setTimeout(init, 500);
    } else {
        window.addEventListener('load', function () { setTimeout(init, 500); });
    }
})();
