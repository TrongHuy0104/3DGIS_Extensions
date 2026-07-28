// ============================================================
//  TEST: So sánh tọa độ DXF chuẩn VN-2000 (Gia Lai) với code hiện tại
//  File tham chiếu: upload_1714024768426886878.dxf
//  Tỉnh: Gia Lai → kinh tuyến trục 108°15' (108.25°)
// ============================================================

var DEG2RAD = Math.PI / 180;
var WGS84_A  = 6378137.0;
var WGS84_F  = 1.0 / 298.257223563;
var WGS84_B  = WGS84_A * (1 - WGS84_F);
var WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;
var WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2);
var MERC_R = 20037508.342789244;

var TM_K0 = 0.9999;
var TM_FE = 500000;
var TM_FN = 0;

// ── Helmert parameters (hiện tại) ──
var HELMERT_DX =  191.90441429;
var HELMERT_DY =   39.30318279;
var HELMERT_DZ =  111.45032835;
var HELMERT_RX =  (0.00928836 / 3600) * DEG2RAD;
var HELMERT_RY = (-0.01975479 / 3600) * DEG2RAD;
var HELMERT_RZ =  (0.00427372 / 3600) * DEG2RAD;
var HELMERT_DS = -0.252906278e-6;

function mercatorToWgs84(mx, my) {
    var lon = (mx / MERC_R) * 180;
    var lat = (Math.atan(Math.exp((my / MERC_R) * Math.PI)) * 360 / Math.PI) - 90;
    return [lon, lat];
}

function wgs84ToECEF(latDeg, lonDeg) {
    var phi = latDeg * DEG2RAD;
    var lam = lonDeg * DEG2RAD;
    var sinPhi = Math.sin(phi);
    var cosPhi = Math.cos(phi);
    var N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
    return [N * cosPhi * Math.cos(lam), N * cosPhi * Math.sin(lam), N * (1 - WGS84_E2) * sinPhi];
}

function ecefToGeodetic(X, Y, Z) {
    var p  = Math.sqrt(X * X + Y * Y);
    var th = Math.atan2(Z * WGS84_A, p * WGS84_B);
    var lat = Math.atan2(Z + WGS84_EP2 * WGS84_B * Math.pow(Math.sin(th), 3),
                         p - WGS84_E2 * WGS84_A * Math.pow(Math.cos(th), 3));
    var lon = Math.atan2(Y, X);
    return [lat / DEG2RAD, lon / DEG2RAD];
}

function helmertTransform(X, Y, Z, dx, dy, dz, rx, ry, rz, ds) {
    var s = 1 + ds;
    return [
        dx + s * (X + rz*Y - ry*Z),
        dy + s * (-rz*X + Y + rx*Z),
        dz + s * (ry*X - rx*Y + Z)
    ];
}

function tmProject(latDeg, lonDeg, centralMeridianDeg) {
    var phi  = latDeg * DEG2RAD;
    var lam  = lonDeg * DEG2RAD;
    var lam0 = centralMeridianDeg * DEG2RAD;

    var sinPhi = Math.sin(phi), cosPhi = Math.cos(phi), tanPhi = Math.tan(phi);
    var N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
    var T = tanPhi * tanPhi;
    var C = WGS84_EP2 * cosPhi * cosPhi;
    var A = (lam - lam0) * cosPhi;
    var e2 = WGS84_E2;
    var M = WGS84_A * ((1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256)*phi
        - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024)*Math.sin(2*phi)
        + (15*e2*e2/256 + 45*e2*e2*e2/1024)*Math.sin(4*phi)
        - (35*e2*e2*e2/3072)*Math.sin(6*phi));

    var A2=A*A, A3=A2*A, A4=A3*A, A5=A4*A, A6=A5*A;
    var easting = TM_FE + TM_K0*N*(A + (1-T+C)*A3/6 + (5-18*T+T*T+72*C-58*WGS84_EP2)*A5/120);
    var northing = TM_FN + TM_K0*(M + N*tanPhi*(A2/2 + (5-T+9*C+4*C*C)*A4/24 + (61-58*T+T*T+600*C-330*WGS84_EP2)*A6/720));
    return [easting, northing];
}

// ═══════════════════════════════════════
//  VN-2000 → WGS84 (Inverse Helmert)
// ═══════════════════════════════════════

// Inverse TM projection (VN-2000 E,N → geodetic lat,lon on VN-2000 datum)
function inverseTM(easting, northing, centralMeridianDeg) {
    var e2 = WGS84_E2;
    var e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    var M1 = (northing - TM_FN) / TM_K0;
    var mu1 = M1 / (WGS84_A * (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256));

    var phi1 = mu1
        + (3*e1/2 - 27*e1*e1*e1/32) * Math.sin(2*mu1)
        + (21*e1*e1/16 - 55*e1*e1*e1*e1/32) * Math.sin(4*mu1)
        + (151*e1*e1*e1/96) * Math.sin(6*mu1)
        + (1097*e1*e1*e1*e1/512) * Math.sin(8*mu1);

    var sinPhi1 = Math.sin(phi1), cosPhi1 = Math.cos(phi1), tanPhi1 = Math.tan(phi1);
    var N1 = WGS84_A / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
    var R1 = WGS84_A * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
    var T1 = tanPhi1 * tanPhi1;
    var C1 = WGS84_EP2 * cosPhi1 * cosPhi1;
    var D  = (easting - TM_FE) / (N1 * TM_K0);

    var D2=D*D, D3=D2*D, D4=D3*D, D5=D4*D, D6=D5*D;

    var lat = phi1 - (N1*tanPhi1/R1) * (D2/2 - (5+3*T1+10*C1-4*C1*C1-9*WGS84_EP2)*D4/24
              + (61+90*T1+298*C1+45*T1*T1-252*WGS84_EP2-3*C1*C1)*D6/720);
    var lon = (centralMeridianDeg * DEG2RAD) + (D - (1+2*T1+C1)*D3/6
              + (5-2*C1+28*T1-3*C1*C1+8*WGS84_EP2+24*T1*T1)*D5/120) / cosPhi1;

    return [lat / DEG2RAD, lon / DEG2RAD];
}

// ═══════════════════════════════════════
//  CHẠY KIỂM TRA
// ═══════════════════════════════════════

// Tọa độ VN-2000 chuẩn từ file DXF (thửa đất đầu tiên - 18 điểm)
var REFERENCE_VN2000 = [
    [595298.546602805, 1538840.97379929],
    [595301.80891973,  1538839.4513336],
    [595305.919351362, 1538838.34026266],
    [595309.546900981, 1538837.62161258],
    [595312.210143902, 1538837.2935952],
    [595314.589983576, 1538837.02084393],
    [595316.341792127, 1538838.09734467],
    [595318.654457395, 1538848.2990919],
    [595320.036925945, 1538854.93235806],
    [595321.619175828, 1538862.29730643],
    [595322.620711865, 1538866.72802634],
    [595312.239898944, 1538870.11640988],
    [595308.764934498, 1538871.15337995],
    [595305.278734342, 1538872.09985606],
    [595299.964745618, 1538852.34816098],
    [595298.426650098, 1538847.08995281],
    [595297.420399144, 1538844.02298611],
    [595298.556434376, 1538840.91497249],
];

// Gia Lai → kinh tuyến trục 108°15' = 108.25°
var MERIDIAN = 108.25;

console.log('='.repeat(70));
console.log('  SO SÁNH VỚI TỌA ĐỘ VN-2000 CHUẨN (Gia Lai)');
console.log('  File: upload_1714024768426886878.dxf');
console.log('  Kinh tuyến trục: ' + MERIDIAN + '° (Gia Lai)');
console.log('='.repeat(70));

// Bước 1: Chuyển ngược VN-2000 → WGS84 geodetic (trên datum VN-2000)
// rồi từ đó tính ra WGS84 thực (qua Helmert ngược)
// Cuối cùng so sánh khi chuyển xuôi lại

// Lấy điểm trung tâm của thửa đất
var sumE = 0, sumN = 0;
for (var i = 0; i < REFERENCE_VN2000.length; i++) {
    sumE += REFERENCE_VN2000[i][0];
    sumN += REFERENCE_VN2000[i][1];
}
var centerE = sumE / REFERENCE_VN2000.length;
var centerN = sumN / REFERENCE_VN2000.length;

console.log('\n  Tâm thửa đất VN-2000: E=' + centerE.toFixed(3) + '  N=' + centerN.toFixed(3));

// Inverse TM: VN-2000 projected → VN-2000 geodetic
var vnGeo = inverseTM(centerE, centerN, MERIDIAN);
console.log('  VN-2000 geodetic: lat=' + vnGeo[0].toFixed(8) + '°  lon=' + vnGeo[1].toFixed(8) + '°');

// Inverse Helmert: VN-2000 ECEF → WGS84 ECEF
// Nếu WGS84→VN2000 dùng params (dx,dy,dz,rx,ry,rz,ds)
// Thì VN2000→WGS84 dùng params (-dx,-dy,-dz,-rx,-ry,-rz,-ds)
var vnEcef = wgs84ToECEF(vnGeo[0], vnGeo[1]); // geodetic→ECEF (dùng chung ellipsoid)

// Inverse Helmert (VN2000 → WGS84)
var wgsEcef = helmertTransform(vnEcef[0], vnEcef[1], vnEcef[2],
    -HELMERT_DX, -HELMERT_DY, -HELMERT_DZ,
    -HELMERT_RX, -HELMERT_RY, -HELMERT_RZ,
    -HELMERT_DS);
var wgsGeo = ecefToGeodetic(wgsEcef[0], wgsEcef[1], wgsEcef[2]);
console.log('  WGS84 (qua inverse Helmert): lat=' + wgsGeo[0].toFixed(8) + '°  lon=' + wgsGeo[1].toFixed(8) + '°');

// Bước 2: Chuyển WGS84 → VN-2000 bằng code hiện tại → so sánh
console.log('\n  ─── KIỂM TRA CHUYỂN ĐỔI XUÔI (WGS84 → VN-2000) ───');

// [A] Code hiện tại (Helmert dương)
var ecef_a = wgs84ToECEF(wgsGeo[0], wgsGeo[1]);
var vnEcef_a = helmertTransform(ecef_a[0], ecef_a[1], ecef_a[2],
    HELMERT_DX, HELMERT_DY, HELMERT_DZ, HELMERT_RX, HELMERT_RY, HELMERT_RZ, HELMERT_DS);
var vnGeo_a = ecefToGeodetic(vnEcef_a[0], vnEcef_a[1], vnEcef_a[2]);
var result_a = tmProject(vnGeo_a[0], vnGeo_a[1], MERIDIAN);

// [B] Không Helmert
var result_b = tmProject(wgsGeo[0], wgsGeo[1], MERIDIAN);

// [C] Helmert đảo dấu
var vnEcef_c = helmertTransform(ecef_a[0], ecef_a[1], ecef_a[2],
    -HELMERT_DX, -HELMERT_DY, -HELMERT_DZ, -HELMERT_RX, -HELMERT_RY, -HELMERT_RZ, -HELMERT_DS);
var vnGeo_c = ecefToGeodetic(vnEcef_c[0], vnEcef_c[1], vnEcef_c[2]);
var result_c = tmProject(vnGeo_c[0], vnGeo_c[1], MERIDIAN);

console.log('\n  VN-2000 CHUẨN (file DXF):');
console.log('    E = ' + centerE.toFixed(4) + '  N = ' + centerN.toFixed(4));

console.log('\n  [A] Code hiện tại (Helmert dương):');
console.log('    E = ' + result_a[0].toFixed(4) + '  N = ' + result_a[1].toFixed(4));
var da_e = result_a[0] - centerE, da_n = result_a[1] - centerN;
console.log('    ΔE = ' + da_e.toFixed(4) + 'm  ΔN = ' + da_n.toFixed(4) + 'm  Total = ' + Math.sqrt(da_e*da_e+da_n*da_n).toFixed(4) + 'm');

console.log('\n  [B] Không Helmert:');
console.log('    E = ' + result_b[0].toFixed(4) + '  N = ' + result_b[1].toFixed(4));
var db_e = result_b[0] - centerE, db_n = result_b[1] - centerN;
console.log('    ΔE = ' + db_e.toFixed(4) + 'm  ΔN = ' + db_n.toFixed(4) + 'm  Total = ' + Math.sqrt(db_e*db_e+db_n*db_n).toFixed(4) + 'm');

console.log('\n  [C] Helmert đảo dấu:');
console.log('    E = ' + result_c[0].toFixed(4) + '  N = ' + result_c[1].toFixed(4));
var dc_e = result_c[0] - centerE, dc_n = result_c[1] - centerN;
console.log('    ΔE = ' + dc_e.toFixed(4) + 'm  ΔN = ' + dc_n.toFixed(4) + 'm  Total = ' + Math.sqrt(dc_e*dc_e+dc_n*dc_n).toFixed(4) + 'm');

// ═══════════════════════════════════════
//  KIỂM TRA TRỰC TIẾP: VN-2000 → WGS84 → EPSG:3857 → VN-2000
//  Round-trip test
// ═══════════════════════════════════════

console.log('\n\n' + '='.repeat(70));
console.log('  ROUND-TRIP TEST (VN-2000 → WGS84 → 3857 → WGS84 → VN-2000)');
console.log('='.repeat(70));

// Chuyển tâm thửa đất sang WGS84 (dùng WGS84 thuần, KHÔNG Helmert)
var geo_noHelmert = inverseTM(centerE, centerN, MERIDIAN);
console.log('\n  VN-2000 geodetic (inverse TM): lat=' + geo_noHelmert[0].toFixed(8) + '°  lon=' + geo_noHelmert[1].toFixed(8) + '°');

// WGS84 → EPSG:3857
var merc_x = geo_noHelmert[1] * MERC_R / 180;
var merc_y = Math.log(Math.tan(Math.PI/4 + geo_noHelmert[0]*DEG2RAD/2)) / Math.PI * MERC_R;
console.log('  EPSG:3857: x=' + merc_x.toFixed(2) + '  y=' + merc_y.toFixed(2));

// EPSG:3857 → WGS84 (mercatorToWgs84)
var wgs = mercatorToWgs84(merc_x, merc_y);
console.log('  WGS84 (from 3857): lat=' + wgs[1].toFixed(8) + '°  lon=' + wgs[0].toFixed(8) + '°');

// WGS84 → VN-2000 với các phương pháp khác nhau
// Ở đây geo_noHelmert đã là tọa độ geodetic trên datum VN-2000
// Khi web 3DGIS hiển thị, nó có thể dùng WGS84 trực tiếp
// Nên EPSG:3857 coords trên web sẽ tương ứng với WGS84 geodetic

// Test: lấy lat/lon từ inverse TM (coi như WGS84 xấp xỉ) → chuyển qua code

var test_result_a = (function() {
    var ecef = wgs84ToECEF(wgs[1], wgs[0]);
    var vnE = helmertTransform(ecef[0], ecef[1], ecef[2],
        HELMERT_DX, HELMERT_DY, HELMERT_DZ, HELMERT_RX, HELMERT_RY, HELMERT_RZ, HELMERT_DS);
    var vnG = ecefToGeodetic(vnE[0], vnE[1], vnE[2]);
    return tmProject(vnG[0], vnG[1], MERIDIAN);
})();

var test_result_b = tmProject(wgs[1], wgs[0], MERIDIAN);

console.log('\n  Kết quả chuyển đổi từ EPSG:3857:');
console.log('  VN-2000 CHUẨN: E=' + centerE.toFixed(3) + '  N=' + centerN.toFixed(3));
console.log('  [A] Có Helmert:    E=' + test_result_a[0].toFixed(3) + '  N=' + test_result_a[1].toFixed(3));
console.log('  [B] Không Helmert: E=' + test_result_b[0].toFixed(3) + '  N=' + test_result_b[1].toFixed(3));

var ta_e = test_result_a[0]-centerE, ta_n = test_result_a[1]-centerN;
var tb_e = test_result_b[0]-centerE, tb_n = test_result_b[1]-centerN;
console.log('\n  Sai lệch so với chuẩn:');
console.log('  [A] Có Helmert:    ΔE=' + ta_e.toFixed(3) + 'm  ΔN=' + ta_n.toFixed(3) + 'm  |Δ|=' + Math.sqrt(ta_e*ta_e+ta_n*ta_n).toFixed(3) + 'm');
console.log('  [B] Không Helmert: ΔE=' + tb_e.toFixed(3) + 'm  ΔN=' + tb_n.toFixed(3) + 'm  |Δ|=' + Math.sqrt(tb_e*tb_e+tb_n*tb_n).toFixed(3) + 'm');

console.log('\n' + '='.repeat(70));
console.log('  KẾT LUẬN');
console.log('  Phương pháp nào có |Δ| nhỏ nhất → ĐÚNG');
console.log('  Nếu cả 2 đều lớn → cần kiểm tra lại tham số hoặc kinh tuyến trục');
console.log('='.repeat(70));
