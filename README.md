# 3DG Map Tools — Chrome Extension

> Bộ công cụ mở rộng cho bản đồ OpenLayers trên **3dg.vn**, bao gồm: Undo/Redo, Auto-Save, Box Selection, Split Tool, Panel Auto-Hide, Snapping và Floating Taskbar.

---

## 📦 Cài đặt

1. Mở Chrome → `chrome://extensions/`
2. Bật **Developer mode** (góc trên phải)
3. Click **Load unpacked** → chọn thư mục chứa extension
4. Truy cập `https://3dg.vn` — extension tự động kích hoạt

---

## ⌨️ Phím tắt tổng hợp

| Phím tắt | Chức năng |
|---|---|
| `Ctrl + Z` | Undo (hoàn tác) |
| `Ctrl + Y` | Redo (làm lại) |
| `Ctrl + B` | Bật/tắt panel "Biên tập dữ liệu" |
| `Ctrl + Alt + T` | Pin/Unpin taskbar |
| `Alt + S` | Bật/tắt Split Tool |
| `Shift + Kéo thả` | Chọn vùng tìm giao điểm *(trong Split mode)* |

---

## 🔧 Các module

### 1. Undo / Redo (`inject.js`)

Thêm khả năng hoàn tác cho bản đồ OpenLayers.

- **Ctrl + Z**: Hoàn tác thao tác gần nhất (vẽ, xóa, split...)
- **Ctrl + Y**: Làm lại thao tác đã hoàn tác
- Tự động tìm OpenLayers map instance qua React Fiber

---

### 2. Auto-Save (`autosave.js`)

Tự động lưu dữ liệu bản đồ định kỳ.

- Theo dõi thay đổi trên tất cả vector sources
- Tự động attach vào source mới khi React thêm layers
- Dispatch event `3dg:features-changed` khi có thay đổi

---

### 3. Box Selection (`selection.js`)

Chọn nhiều features cùng lúc bằng cách kéo thả.

- **Shift + Kéo thả**: Vẽ hình chữ nhật chọn vùng *(khi KHÔNG ở Split mode)*
- Highlight features được chọn (xanh dương)
- Floating toolbar: xóa, bỏ chọn, export

> ⚠️ Khi Split Tool đang bật, Shift + Kéo thả sẽ chọn vùng tìm giao điểm thay vì bôi vùng xóa.

---

### 4. Split Tool (`split.js`) ✂️

Chia đường (LineString) tại giao điểm với các đường khác.

#### Quy trình sử dụng:

```
1. Bật Split Tool
   └─ Nhấn Alt+S hoặc click nút ✂ trên taskbar

2. Chọn vùng tìm giao điểm
   └─ Shift + Kéo thả trên bản đồ
   └─ Hình chữ nhật nét đứt xanh hiện khi kéo
   └─ Thả chuột → tìm giao điểm trong vùng

3. Xem giao điểm
   └─ Các chấm cam (●) hiện tại vị trí giao nhau
   └─ Di chuột gần chấm cam → đường gần nhất highlight

4. Cắt đường
   └─ Double-click vào gần chấm cam để split
   └─ Đường bị chia thành 2 phần

5. Tiếp tục cắt
   └─ Các chấm cam khác VẪN CÒN sau khi cắt
   └─ Có thể cắt đường khác tại cùng giao điểm
   └─ Shift + Kéo thả lại để chọn vùng mới

6. Tắt Split Tool
   └─ Nhấn Alt+S hoặc click nút ✂ lần nữa
```

#### Màu highlight khi hover:

| Màu | Ý nghĩa |
|---|---|
| 🔵 **Xanh dương (cyan)** | Đường chưa cắt |
| 🟢 **Xanh lá (green)** | Đường đã được cắt (split result) |
| 🟠 **Chấm cam** | Giao điểm — double-click để cắt |

#### Lưu ý:
- Chỉ tìm giao điểm trong **vùng đã chọn** (không scan toàn bản đồ → tránh lag)
- Marker giao điểm **giữ lại** sau khi cắt — vẫn dùng được cho đường khác
- Hỗ trợ **Undo** split (Ctrl + Z)

---

### 5. Panel Auto-Hide (`panel-autohide.js`)

Tự động ẩn/hiện panel "Biên tập dữ liệu".

- **Mặc định**: Panel hiện + pin khi trang load
- **Ctrl + B**: Toggle ẩn/hiện + pin/unpin
- Di chuột vào cạnh trái (< 80px) → panel hiện
- Di chuột ra xa → panel ẩn (nếu không pin)
- Override React style changes tự động

---

### 6. Snapping (`snapping.js`)

Bắt điểm tự động khi vẽ polygon/polyline.

- Tolerance: **20px**
- Khi vẽ, nếu chuột gần điểm đầu → tự động snap vào
- Click khi đang snap → auto `finishDrawing()`

---

### 7. Floating Taskbar (`taskbar.js`)

Thanh công cụ nổi phía trên header.

- **Hover header** → taskbar hiện
- **Ctrl + Alt + T** → pin/unpin taskbar
- 3 nút:
  - ↶ Undo (Ctrl + Z)
  - ↷ Redo (Ctrl + Y)
  - ✂ Split (Alt + S) — toggle, sáng khi active

---

## 📁 Cấu trúc files

```
├── manifest.json          # Chrome Extension manifest v3
├── content.js             # Loader — inject scripts vào page context
├── inject.js              # Core: tìm OL map, Undo/Redo, shared globals
├── autosave.js            # Auto-save theo dõi feature changes
├── selection.js           # Box selection (Shift+Drag)
├── panel-autohide.js      # Panel "Biên tập dữ liệu" auto-hide
├── snapping.js            # Snap to first point khi vẽ
├── taskbar.js             # Floating taskbar UI
└── split.js               # Split tool (chia đường tại giao điểm)
```

---

## 🔄 Thứ tự load

Scripts được inject **tuần tự** qua `content.js`:

```
inject.js → autosave.js → selection.js → panel-autohide.js → snapping.js → taskbar.js → split.js
```

`inject.js` chạy đầu tiên để setup shared globals (`window.__olMap`, `window.__findOlMap`, `window.__undoStack`...). Các module sau dùng các globals này.

---

## ⚡ Console logs

Mỗi module log trạng thái vào console với prefix riêng:

```
[CtrlZ]     → inject.js (Undo/Redo core)
[AutoSave]  → autosave.js
[Selection] → selection.js
[PanelHide] → panel-autohide.js
[Snapping]  → snapping.js
[Taskbar]   → taskbar.js
[Split]     → split.js
```

Dùng `console.log` filter trong DevTools để debug từng module.
