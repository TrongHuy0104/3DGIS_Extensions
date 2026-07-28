// ============================================================
//  TEST: Kiểm tra chuyển đổi tọa độ WGS84 → VN-2000 TM-3
//  So sánh kết quả của code với giá trị tham chiếu
//  Chạy: node test-transform.js
// ============================================================

// ── Copy từ dxf-export.js ──
var WGS84_A  = 6378137.0;
var WGS84_F  = 1.0 / 298.257223563;
var WGS84_B  = WGS84_A * (1 - WGS84_F);
var WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;
var WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2);

var TM_K0 = 0.9999;
var TM_FE = 500000;
var TM_FN = 0;

var DEG2RAD = Math.PI / 180;
var MERC_R = 20037508.342789244;

function mercatorToWgs84(mx, my) {
    var lon = (mx / MERC_R) * 180;
    var lat = (Math.atan(Math.exp((my / MERC_R) * Math.PI)) * 360 / Math.PI) - 90;
    return [lon, lat];
}

// ── Helmert parameters (hiện tại trong code) ──
var HELMERT_DX =  191.90441429;
var HELMERT_DY =   39.30318279;
var HELMERT_DZ =  111.45032835;
var HELMERT_RX =  (0.00928836 / 3600) * DEG2RAD;
var HELMERT_RY = (-0.01975479 / 3600) * DEG2RAD;
var HELMERT_RZ =  (0.00427372 / 3600) * DEG2RAD;
var HELMERT_DS = -0.252906278e-6;

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

function helmertWGS84toVN2000(X, Y, Z) {
    var s = 1 + HELMERT_DS;
    return [
        HELMERT_DX + s * (X + HELMERT_RZ * Y - HELMERT_RY * Z),
        HELMERT_DY + s * (-HELMERT_RZ * X + Y + HELMERT_RX * Z),
        HELMERT_DZ + s * (HELMERT_RY * X - HELMERT_RX * Y + Z)
    ];
}

function wgs84ToVN2000(latDeg, lonDeg, centralMeridianDeg) {
    var ecef   = wgs84ToECEF(latDeg, lonDeg);
    var vnEcef = helmertWGS84toVN2000(ecef[0], ecef[1], ecef[2]);
    var vnGeo  = ecefToGeodetic(vnEcef[0], vnEcef[1], vnEcef[2]);

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

// ── Phiên bản KHÔNG có Helmert (chỉ TM projection trên WGS84) ──
function wgs84ToVN2000_noHelmert(latDeg, lonDeg, centralMeridianDeg) {
    var phi  = latDeg * DEG2RAD;
    var lam  = lonDeg * DEG2RAD;
    var lam0 = centralMeridianDeg * DEG2RAD;

    var sinPhi = Math.sin(phi);
    var cosPhi = Math.cos(phi);
    var tanPhi = Math.tan(phi);

    var N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
    var T = tanPhi * tanPhi;
    var C = WGS84_EP2 * cosPhi * cosPhi;
    var A = (lam - lam0) * cosPhi;

    var e2 = WGS84_E2;
    var M = WGS84_A * (
        (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * phi
        - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * Math.sin(2*phi)
        + (15*e2*e2/256 + 45*e2*e2*e2/1024) * Math.sin(4*phi)
        - (35*e2*e2*e2/3072) * Math.sin(6*phi)
    );

    var A2 = A * A, A3 = A2 * A, A4 = A3 * A, A5 = A4 * A, A6 = A5 * A;

    var easting = TM_FE + TM_K0 * N * (
        A + (1 - T + C) * A3 / 6 + (5 - 18*T + T*T + 72*C - 58*WGS84_EP2) * A5 / 120
    );
    var northing = TM_FN + TM_K0 * (
        M + N * tanPhi * (
            A2 / 2 + (5 - T + 9*C + 4*C*C) * A4 / 24 + (61 - 58*T + T*T + 600*C - 330*WGS84_EP2) * A6 / 720
        )
    );
    return [easting, northing];
}

// ── Phiên bản Helmert ĐẢO DẤU (test) ──
function wgs84ToVN2000_invertedHelmert(latDeg, lonDeg, centralMeridianDeg) {
    var ecef = wgs84ToECEF(latDeg, lonDeg);
    // Đảo dấu tất cả tham số Helmert
    var s = 1 + (0.252906278e-6); // đảo dấu DS
    var vnEcef = [
        -191.90441429 + s * (ecef[0] + (-0.00427372/3600*DEG2RAD)*ecef[1] - (0.01975479/3600*DEG2RAD)*ecef[2]),
        -39.30318279  + s * (-(-0.00427372/3600*DEG2RAD)*ecef[0] + ecef[1] + (-0.00928836/3600*DEG2RAD)*ecef[2]),
        -111.45032835 + s * ((0.01975479/3600*DEG2RAD)*ecef[0] - (-0.00928836/3600*DEG2RAD)*ecef[1] + ecef[2])
    ];
    var vnGeo = ecefToGeodetic(vnEcef[0], vnEcef[1], vnEcef[2]);

    var phi = vnGeo[0] * DEG2RAD;
    var lam = vnGeo[1] * DEG2RAD;
    var lam0 = centralMeridianDeg * DEG2RAD;

    var sinPhi = Math.sin(phi);
    var cosPhi = Math.cos(phi);
    var tanPhi = Math.tan(phi);
    var N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
    var T = tanPhi * tanPhi;
    var C = WGS84_EP2 * cosPhi * cosPhi;
    var A = (lam - lam0) * cosPhi;

    var e2 = WGS84_E2;
    var M = WGS84_A * (
        (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * phi
        - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * Math.sin(2*phi)
        + (15*e2*e2/256 + 45*e2*e2*e2/1024) * Math.sin(4*phi)
        - (35*e2*e2*e2/3072) * Math.sin(6*phi)
    );

    var A2 = A*A, A3 = A2*A, A4 = A3*A, A5 = A4*A, A6 = A5*A;
    var easting = TM_FE + TM_K0 * N * (A + (1-T+C)*A3/6 + (5-18*T+T*T+72*C-58*WGS84_EP2)*A5/120);
    var northing = TM_FN + TM_K0 * (M + N*tanPhi*(A2/2 + (5-T+9*C+4*C*C)*A4/24 + (61-58*T+T*T+600*C-330*WGS84_EP2)*A6/720));
    return [easting, northing];
}

// ════════════════════════════════════════════════════════
//  TEST CASES
// ════════════════════════════════════════════════════════

console.log('=' .repeat(70));
console.log('  KIỂM TRA CHUYỂN ĐỔI TỌA ĐỘ WGS84 → VN-2000 TM-3');
console.log('=' .repeat(70));

// Điểm kiểm tra: Khu vực Việt Nam
var testPoints = [
    { name: 'HCMC (Bến Thành)',    lat: 10.7726,  lon: 106.6981, meridian: 105.75 },
    { name: 'Hà Nội (Hồ Gươm)',   lat: 21.0285,  lon: 105.8542, meridian: 105.00 },
    { name: 'Đà Nẵng (Trung tâm)', lat: 16.0544,  lon: 108.2022, meridian: 107.75 },
    { name: 'Cần Thơ',             lat: 10.0452,  lon: 105.7469, meridian: 105.00 },
    { name: 'Khu vực test (13°N, 108°E)', lat: 13.0, lon: 108.0, meridian: 108.25 },
];

for (var i = 0; i < testPoints.length; i++) {
    var pt = testPoints[i];
    console.log('\n─── ' + pt.name + ' ───');
    console.log('  WGS84: lat=' + pt.lat + '°, lon=' + pt.lon + '°');
    console.log('  Kinh tuyến trục: ' + pt.meridian + '°');

    var withHelmert    = wgs84ToVN2000(pt.lat, pt.lon, pt.meridian);
    var noHelmert      = wgs84ToVN2000_noHelmert(pt.lat, pt.lon, pt.meridian);
    var invertedHelmert = wgs84ToVN2000_invertedHelmert(pt.lat, pt.lon, pt.meridian);

    console.log('\n  [A] Với Helmert (code hiện tại):');
    console.log('      E = ' + withHelmert[0].toFixed(4) + '  N = ' + withHelmert[1].toFixed(4));

    console.log('  [B] KHÔNG Helmert (chỉ TM trên WGS84):');
    console.log('      E = ' + noHelmert[0].toFixed(4) + '  N = ' + noHelmert[1].toFixed(4));

    console.log('  [C] Helmert ĐẢO DẤU:');
    console.log('      E = ' + invertedHelmert[0].toFixed(4) + '  N = ' + invertedHelmert[1].toFixed(4));

    var diffAB_E = Math.abs(withHelmert[0] - noHelmert[0]);
    var diffAB_N = Math.abs(withHelmert[1] - noHelmert[1]);
    var diffAC_E = Math.abs(withHelmert[0] - invertedHelmert[0]);
    var diffAC_N = Math.abs(withHelmert[1] - invertedHelmert[1]);

    console.log('\n  Sai lệch:');
    console.log('    |A-B| (Helmert vs No Helmert):  ΔE=' + diffAB_E.toFixed(3) + 'm  ΔN=' + diffAB_N.toFixed(3) + 'm  Total=' + Math.sqrt(diffAB_E*diffAB_E + diffAB_N*diffAB_N).toFixed(3) + 'm');
    console.log('    |A-C| (Current vs Inverted):    ΔE=' + diffAC_E.toFixed(3) + 'm  ΔN=' + diffAC_N.toFixed(3) + 'm  Total=' + Math.sqrt(diffAC_E*diffAC_E + diffAC_N*diffAC_N).toFixed(3) + 'm');
}

// ── Kiểm tra bước EPSG:3857 → WGS84 ──
console.log('\n\n' + '='.repeat(70));
console.log('  KIỂM TRA EPSG:3857 → WGS84');
console.log('='.repeat(70));

// EPSG:3857 for HCMC (approx)
var merc_x = 106.6981 * MERC_R / 180;
var merc_y = Math.log(Math.tan(Math.PI / 4 + 10.7726 * DEG2RAD / 2)) * WGS84_A;

console.log('\n  EPSG:3857 tính toán: x=' + merc_x.toFixed(2) + '  y=' + merc_y.toFixed(2));
var wgs = mercatorToWgs84(merc_x, merc_y);
console.log('  → WGS84: lon=' + wgs[0].toFixed(8) + '  lat=' + wgs[1].toFixed(8));
console.log('  Kỳ vọng: lon=106.69810000  lat=10.77260000');
console.log('  Sai lệch: Δlon=' + Math.abs(wgs[0] - 106.6981).toExponential(3) + '°  Δlat=' + Math.abs(wgs[1] - 10.7726).toExponential(3) + '°');

console.log('\n\n' + '='.repeat(70));
console.log('  KẾT LUẬN');
console.log('='.repeat(70));
console.log('  Nếu |A-B| >> "vài chục mét": Helmert có ảnh hưởng lớn');
console.log('  Nếu |A-C| ≈ 2 × |A-B|: A và C là 2 chiều ngược nhau');
console.log('  → So sánh kết quả với phần mềm chuyển đổi VN-2000 uy tín');
console.log('  → hoặc tọa độ VN-2000 đã biết để xác định chiều đúng');
console.log('='.repeat(70));
