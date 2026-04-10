
let map;
let tileMeta = [];
let branchMeta = [];
let loadedTiles = new Map();
let groups = [];
let markers = [];

const DEFAULT_CENTER = { lat: 37.275, lng: 127.009 };
const DEFAULT_LEVEL = 9;
const MIN_LEVEL_ALL = 7;
const MAX_MARKERS_ALL = 5000;
const MAX_MARKERS_BRANCH = 12000;
const STORAGE_KEY = "kdn_status_overrides_v1";

let currentGroupNo = null;
let currentInfoOpenIndex = null;
let infoPanel = null;

let searchInput = null;
let searchButton = null;
let resetButton = null;
let branchDropdown = null;
let statusDropdown = null;
let markerCountEl = null;
let statusSummaryEl = null;
let currentLocationButton = null;

let groupMap = new Map();
let markerMap = new Map();
let statusOverrides = loadOverrides();
let appliedSearchQuery = "";
let currentLocationMarker = null;

function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch (e) {
    return {};
  }
}
function saveOverrides() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(statusOverrides));
}

async function copyText(text, label) {
  const value = String(text || "").trim();
  if (!value || value === "-") {
    alert(`${label} 값이 없습니다.`);
    return;
  }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    alert(`${label} 복사됨`);
  } catch (e) {
    alert(`${label} 복사 실패`);
  }
}
window.copyFieldValue = function(value, label) {
  copyText(value, label);
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function debounce(fn, wait) {
  let t = null;
  return function () {
    clearTimeout(t);
    t = setTimeout(() => fn(), wait);
  };
}

function normalizeStatus(value) {
  const v = String(value || "").trim();
  return v;
}
function getRowStatus(groupNo, idx, row) {
  const key = `${groupNo}__${idx}`;
  return normalizeStatus(statusOverrides[key] || row.k || "");
}


function normalizeComparableStatus(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function getGroupColor(group) {
  const statuses = (group.rows || [])
    .map((r, idx) => normalizeComparableStatus(getRowStatus(group.n, idx, r)))
    .filter(Boolean);

  if (!statuses.length) return null;

  const hasEmergency = statuses.includes("긴급");
  const hasPriority1 = statuses.includes("계기교체(1순위)");
  const hasPriority2 = statuses.includes("계기교체(2순위)");
  const allPriority3 = statuses.every(v => v === "계기교체(3순위)");
  const allModem = statuses.every(v => v === "모뎀설치");

  if (hasEmergency) return "black";
  if (hasPriority1) return "red";
  if (hasPriority2) return "orange";
  if (allPriority3) return "yellow";
  if (allModem) return "green";

  return null;
}

function svgMarker(color) {
  const fillMap = {
    red: "#ef4444",
    yellow: "#facc15",
    green: "#22c55e",
    black: "#111111",
    gray: "#6b7280"
  };
  const fill = fillMap[color] || fillMap.gray;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5.5" fill="${fill}" stroke="white" stroke-width="2"/>
    </svg>
  `;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}
function getMarkerImage(color) {
  return new kakao.maps.MarkerImage(svgMarker(color), new kakao.maps.Size(16, 16), {
    offset: new kakao.maps.Point(8, 8)
  });
}

function getSelectedValues(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(el => el.value);
}
function setDropdownLabel(dropdown, values, allLabel) {
  const label = dropdown.querySelector(".kdn-multi-label");
  if (!label) return;
  const filtered = values.filter(v => v !== "all");
  if (!filtered.length || values.includes("all")) {
    label.textContent = allLabel;
  } else if (filtered.length === 1) {
    label.textContent = filtered[0];
  } else {
    label.textContent = filtered.join(", ");
  }
}
function closeAllMenus() {
  document.querySelectorAll(".kdn-multi-menu").forEach(el => el.style.display = "none");
}
function toggleDropdown(dropdown) {
  const menu = dropdown.querySelector(".kdn-multi-menu");
  const isOpen = menu.style.display === "block";
  closeAllMenus();
  menu.style.display = isOpen ? "none" : "block";
}
function buildMultiSelect(dropdown, name, items, allLabel, onChange) {
  const prev = getSelectedValues(name);
  dropdown.innerHTML = "";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "kdn-multi-button";
  button.innerHTML = `<span class="kdn-multi-label">${allLabel}</span><span style="font-size:10px;">▼</span>`;
  button.onclick = (e) => {
    e.stopPropagation();
    toggleDropdown(dropdown);
  };

  const menu = document.createElement("div");
  menu.className = "kdn-multi-menu";
  menu.style.display = "none";

  items.forEach(item => {
    const row = document.createElement("label");
    row.className = "kdn-multi-item";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.value = item.value;
    input.checked = prev.length ? prev.includes(item.value) : !!item.checked;

    const text = document.createElement("span");
    text.textContent = item.label;

    input.onchange = () => {
      if (item.value === "all" && input.checked) {
        dropdown.querySelectorAll(`input[name="${name}"]`).forEach(el => {
          if (el.value !== "all") el.checked = false;
        });
      } else if (item.value !== "all" && input.checked) {
        const allInput = dropdown.querySelector(`input[name="${name}"][value="all"]`);
        if (allInput) allInput.checked = false;
      }

      const current = getSelectedValues(name);
      if (!current.length) {
        const allInput = dropdown.querySelector(`input[name="${name}"][value="all"]`);
        if (allInput) allInput.checked = true;
      }

      const values = getSelectedValues(name);
      setDropdownLabel(dropdown, values, allLabel);
      onChange();
    };

    row.appendChild(input);
    row.appendChild(text);
    menu.appendChild(row);
  });

  dropdown.appendChild(button);
  dropdown.appendChild(menu);
  setDropdownLabel(dropdown, getSelectedValues(name), allLabel);
}

function buildStatusFilter() {
  buildMultiSelect(statusDropdown, "statusFilterCheck", [
    { value: "all", label: "구분 전체", checked: true },
    { value: "black", label: "⚫ 긴급", checked: false },
    { value: "red", label: "🔴 계기교체(1순위)", checked: false },
    { value: "orange", label: "🟠 계기교체(2순위)", checked: false },
    { value: "yellow", label: "🟡 계기교체(3순위)", checked: false },
    { value: "green", label: "🟢 모뎀설치", checked: false }
  ], "구분", refresh);
}
function buildBranchFilter() {
  const current = getSelectedValues("branchFilterCheck");
  const items = [{ value: "all", label: "지사 전체", checked: !current.length || current.includes("all") }]
    .concat(branchMeta.map(b => ({
      value: b.name,
      label: b.name,
      checked: current.includes(b.name)
    })));
  buildMultiSelect(branchDropdown, "branchFilterCheck", items, "지사", onBranchChange);
}

function updateMarkerCount(items = [], meterBaseGroups = []) {
  if (!markerCountEl) return;

  const selectedBranches = getSelectedValues("branchFilterCheck");
  const selectedStatuses = getSelectedValues("statusFilterCheck");
  const filteredBranch = selectedBranches.length && !selectedBranches.includes("all");
  const filteredStatus = selectedStatuses.length && !selectedStatuses.includes("all");

  const activeStatuses = filteredStatus
    ? selectedStatuses.filter(v => v !== "all")
    : [];

  let meterCount = 0;
  const countSource = filteredStatus ? meterBaseGroups : items;

  (countSource || []).forEach(g => {
    (g.rows || []).forEach((r, idx) => {
      const meter = String(r.m || "").trim();
      if (!meter) return;

      const rowStatus = normalizeComparableStatus(getRowStatus(g.n, idx, r));

      if (!filteredStatus) {
        meterCount += 1;
        return;
      }

      if (activeStatuses.includes("black") && rowStatus === "긴급") {
        meterCount += 1;
        return;
      }

      if (activeStatuses.includes("red") && rowStatus === "계기교체(1순위)") {
        meterCount += 1;
        return;
      }

      if (activeStatuses.includes("orange") && rowStatus === "계기교체(2순위)") {
        meterCount += 1;
        return;
      }

      if (activeStatuses.includes("yellow") && rowStatus === "계기교체(3순위)") {
        meterCount += 1;
        return;
      }

      if (activeStatuses.includes("green") && rowStatus === "모뎀설치") {
        meterCount += 1;
        return;
      }
    });
  });

  markerCountEl.textContent = (filteredBranch || filteredStatus)
    ? `대상 ${items.length.toLocaleString()}개 / 계기수 ${meterCount.toLocaleString()}개`
    : "";
}


function updateStatusSummary(items) {
  if (!statusSummaryEl) return;
  const selectedBranches = getSelectedValues("branchFilterCheck");
  const selectedStatuses = getSelectedValues("statusFilterCheck");
  const filteredBranch = selectedBranches.length && !selectedBranches.includes("all");
  const filteredStatus = selectedStatuses.length && !selectedStatuses.includes("all");
  if (!(filteredBranch || filteredStatus)) {
    statusSummaryEl.textContent = "";
    return;
  }
  const counts = { black: 0, red: 0, orange: 0, yellow: 0, green: 0 };
  (items || []).forEach(g => {
    const c = getGroupColor(g);
    if (c && counts[c] !== undefined) counts[c] += 1;
  });
  const parts = [];
  if (counts.black) parts.push(`⚫ ${counts.black}`);
  if (counts.red) parts.push(`🔴 ${counts.red}`);
  if (counts.orange) parts.push(`🟠 ${counts.orange}`);
  if (counts.yellow) parts.push(`🟡 ${counts.yellow}`);
  if (counts.green) parts.push(`🟢 ${counts.green}`);
  statusSummaryEl.textContent = parts.join("  ");
}


function moveToCurrentLocation() {
  if (currentLocationMarker) {
    currentLocationMarker.setMap(null);
    currentLocationMarker = null;
    return;
  }

  if (!navigator.geolocation) {
    alert("위치 정보를 지원하지 않는 기기예요.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const latlng = new kakao.maps.LatLng(lat, lng);

      map.setCenter(latlng);
      if (map.getLevel() > 4) {
        map.setLevel(4);
      }

      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">'
        + '<polygon points="18,2 22,12 34,13 25,20 28,32 18,26 8,32 11,20 2,13 14,12" fill="#8b5cf6" stroke="#ffffff" stroke-width="2"/>'
        + '</svg>';

      const imageSrc = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
      const imageSize = new kakao.maps.Size(36, 36);
      const imageOption = { offset: new kakao.maps.Point(18, 18) };
      const markerImage = new kakao.maps.MarkerImage(imageSrc, imageSize, imageOption);

      currentLocationMarker = new kakao.maps.Marker({
        position: latlng,
        image: markerImage,
        zIndex: 9999
      });

      currentLocationMarker.setMap(map);
    },
    () => {
      alert("현재 위치를 가져오지 못했어요.");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}


function ensureBottomDock_DISABLED() {
  const oldDock = document.getElementById("kdnBottomDock");
  if (oldDock) oldDock.remove();

  const dock = document.createElement("div");
  dock.id = "kdnBottomDock";
  dock.className = "kdn-dock";
  dock.innerHTML = `
    <button type="button" class="kdn-dock-btn" id="kdnDockSearch">검색</button>
    <button type="button" class="kdn-dock-btn" id="kdnDockStatus">구분</button>
    <button type="button" class="kdn-dock-btn" id="kdnDockBranch">지사</button>
    <button type="button" class="kdn-dock-btn" id="kdnDockLocation">현재위치</button>
  `;
  document.body.appendChild(dock);

  dock.querySelector("#kdnDockSearch").onclick = () => {
    if (searchInput) searchInput.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  dock.querySelector("#kdnDockStatus").onclick = () => {
    if (statusDropdown) toggleDropdown(statusDropdown);
  };
  dock.querySelector("#kdnDockBranch").onclick = () => {
    if (branchDropdown) toggleDropdown(branchDropdown);
  };
  dock.querySelector("#kdnDockLocation").onclick = () => {
    moveToCurrentLocation();
  };
}


function ensureUI() {
  const oldBar = document.getElementById("kdnControlBar");
  if (oldBar) oldBar.remove();

  if (!document.getElementById("kdn-ui-style")) {
    const style = document.createElement("style");
    style.id = "kdn-ui-style";
    style.textContent = `
      .kdn-bar {
        position: fixed; top: 8px; left: 8px; right: 8px; z-index: 10;
        display: flex; flex-direction: column; gap: 6px;
        background: rgba(255,255,255,0.96); padding: 6px;
        border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.12);
        backdrop-filter: blur(6px);
      }
      .kdn-row { display:flex; gap:6px; align-items:center; }
      .kdn-input, .kdn-search-btn, .kdn-reset-btn, .kdn-multi-button {
        height: 38px; border: 1px solid #ddd; border-radius: 8px; background: #fff;
        font-size: 13px; box-sizing: border-box;
      }
      .kdn-input { flex: 1; min-width: 0; padding: 0 10px; }
      .kdn-search-btn, .kdn-reset-btn { padding: 0 12px; cursor: pointer; white-space: nowrap; }
      .kdn-multi { position: relative; flex: 1; min-width: 0; }
      .kdn-multi-button {
        width: 100%; padding: 0 10px; display: flex; justify-content: space-between; align-items:center;
        cursor:pointer; overflow:hidden;
      }
      .kdn-multi-label {
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block; text-align:left;
      }
      .kdn-multi-menu {
        position:absolute; top:42px; left:0; right:0; background:#fff; border:1px solid #ddd;
        border-radius:10px; box-shadow:0 8px 20px rgba(0,0,0,0.12); max-height:220px; overflow-y:auto;
        -webkit-overflow-scrolling:touch; padding:6px; z-index:20;
      }
      .kdn-multi-item {
        display:flex; align-items:center; gap:8px; font-size:13px; padding:6px 4px;
        white-space: nowrap;
      }
      .kdn-multi-item input { width:16px; height:16px; flex-shrink:0; }
      .kdn-count {
        font-size: 12px;
        color: #374151;
        white-space: nowrap;
        flex-shrink: 0;
        padding: 0 4px;
      }
      .kdn-count-line {
        font-size: 12px;
        color: #111827;
        font-weight: 700;
        padding: 2px 4px 0;
        white-space: nowrap;
      }
      .kdn-summary {
        font-size: 12px;
        color: #374151;
        padding: 2px 4px 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .kdn-dock {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        bottom: 12px;
        z-index: 11;
        display: flex;
        gap: 8px;
        background: rgba(17,24,39,0.92);
        padding: 8px 10px;
        border-radius: 999px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.18);
        backdrop-filter: blur(8px);
      }
      .kdn-dock-btn {
        border: none;
        background: transparent;
        color: #fff;
        font-size: 12px;
        padding: 6px 8px;
        cursor: pointer;
        white-space: nowrap;
      }
      @media (max-width: 640px) {
        .kdn-input, .kdn-search-btn, .kdn-reset-btn, .kdn-multi-button { font-size:12px; }
        .kdn-count, .kdn-count-line, .kdn-summary { font-size: 11px; }
        .kdn-dock { bottom: 10px; }
        .kdn-dock-btn { font-size: 11px; padding: 6px 6px; }
      }
    `;
    document.head.appendChild(style);
  }

  const bar = document.createElement("div");
  bar.id = "kdnControlBar";
  bar.className = "kdn-bar";

  const row1 = document.createElement("div");
  row1.className = "kdn-row";

  searchInput = document.createElement("input");
  searchInput.id = "searchInput";
  searchInput.className = "kdn-input";
  searchInput.type = "text";
  searchInput.placeholder = "검색";
  searchInput.value = appliedSearchQuery || "";
  searchInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      appliedSearchQuery = (searchInput.value || "").trim();
      refresh();
    }
  };

  searchButton = document.createElement("button");
  searchButton.className = "kdn-search-btn";
  searchButton.type = "button";
  searchButton.textContent = "검색";
  searchButton.onclick = () => {
    appliedSearchQuery = (searchInput.value || "").trim();
    refresh();
  };

  resetButton = document.createElement("button");
  resetButton.className = "kdn-reset-btn";
  resetButton.type = "button";
  resetButton.textContent = "초기화";
  resetButton.onclick = () => {
    appliedSearchQuery = "";
    searchInput.value = "";
    statusOverrides = {};
    localStorage.removeItem(STORAGE_KEY);

    document.querySelectorAll('input[name="statusFilterCheck"]').forEach(el => {
      el.checked = el.value === "all";
    });
    document.querySelectorAll('input[name="branchFilterCheck"]').forEach(el => {
      el.checked = el.value === "all";
    });
    setDropdownLabel(statusDropdown, ["all"], "구분");
    setDropdownLabel(branchDropdown, ["all"], "지사");
    updateMarkerCount(0);

    closeInfo();
    map.setCenter(new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng));
    map.setLevel(DEFAULT_LEVEL);
    refresh();
  };

  currentLocationButton = document.createElement("button");
  currentLocationButton.className = "kdn-reset-btn";
  currentLocationButton.type = "button";
  currentLocationButton.textContent = "현재위치";
  currentLocationButton.onclick = () => { moveToCurrentLocation(); };

  row1.appendChild(searchInput);
  row1.appendChild(searchButton);
  row1.appendChild(resetButton);
  row1.appendChild(currentLocationButton);

  const row2 = document.createElement("div");
  row2.className = "kdn-row";

  statusDropdown = document.createElement("div");
  statusDropdown.id = "statusFilter";
  statusDropdown.className = "kdn-multi";

  branchDropdown = document.createElement("div");
  branchDropdown.id = "branchFilter";
  branchDropdown.className = "kdn-multi";

  const row3 = document.createElement("div");
  row3.className = "kdn-row";

  markerCountEl = document.createElement("div");
  markerCountEl.className = "kdn-count-line";
  row3.appendChild(markerCountEl);

  const row4 = document.createElement("div");
  row4.className = "kdn-summary";
  statusSummaryEl = row4;

  row2.appendChild(statusDropdown);
  row2.appendChild(branchDropdown);

  bar.appendChild(row1);
  bar.appendChild(row2);
  bar.appendChild(row3);
  bar.appendChild(row4);
  document.body.appendChild(bar);

  buildStatusFilter();
  buildBranchFilter();
  

  if (!window.__kdnDocClickBound) {
    document.addEventListener("click", function(e) {
      if (!e.target.closest(".kdn-multi")) closeAllMenus();
    });
    window.__kdnDocClickBound = true;
  }
}

function ensureInfoPanel() {
  if (infoPanel) return infoPanel;

  infoPanel = document.createElement("div");
  infoPanel.id = "infoPanel";
  infoPanel.style.position = "fixed";
  infoPanel.style.left = "0";
  infoPanel.style.right = "0";
  infoPanel.style.bottom = "0";
  infoPanel.style.zIndex = "9999";
  infoPanel.style.background = "#ffffff";
  infoPanel.style.borderTopLeftRadius = "16px";
  infoPanel.style.borderTopRightRadius = "16px";
  infoPanel.style.boxShadow = "0 -6px 20px rgba(0,0,0,0.18)";
  infoPanel.style.maxHeight = "62vh";
  infoPanel.style.display = "none";
  infoPanel.style.flexDirection = "column";
  infoPanel.style.overflow = "hidden";
  infoPanel.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  document.body.appendChild(infoPanel);
  return infoPanel;
}
function closeInfo() {
  const panel = ensureInfoPanel();
  panel.style.display = "none";
  panel.innerHTML = "";
  currentGroupNo = null;
  currentInfoOpenIndex = null;
}
window.closeInfo = closeInfo;

function showDetail(idx) {
  currentInfoOpenIndex = idx;
  document.querySelectorAll(".detail-box").forEach(el => {
    el.style.display = "none";
  });
  const target = document.getElementById("detail-" + idx);
  if (target) target.style.display = "block";
}
window.showDetail = showDetail;


function infoRowWithCopy(label, value, copyLabel) {
  const safeValue = escapeHtml(value || "-");
  const rawValue = String(value || "").replaceAll("'", "\\'");
  const isAddress = label === "주소" || label === "도로명주소";
  const mapUrl = `https://map.kakao.com/?q=${encodeURIComponent(String(value || "").trim())}`;

  return `
    <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;">
      <div style="word-break:break-word;">
        <strong>${label}:</strong> ${safeValue}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button
          onclick="copyFieldValue('${rawValue}', '${copyLabel}')"
          style="border:1px solid #d1d5db;background:#fff;color:#111827;padding:4px 8px;border-radius:8px;font-size:11px;cursor:pointer;">
          복사
        </button>
        ${isAddress ? `<a href="${mapUrl}" target="_blank" rel="noopener noreferrer"
          style="display:inline-block;border:1px solid #d1d5db;background:#fff;color:#111827;padding:4px 8px;border-radius:8px;font-size:11px;text-decoration:none;line-height:1.5;">
          카카오맵
        </a>` : ``}
      </div>
    </div>
  `;
}


function infoRowsWithIndividualCopy(label, values, copyLabel) {
  const rows = Array.isArray(values) ? values : [];
  const htmlValues = rows.map(item => {
    const meter = String(item.meter || "").trim() || "-";
    const apt = String(item.apt || "").trim();
    const store = String(item.store || "").trim();

    const raw = meter.replaceAll("'", "\'");
    return `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <div style="flex:1;word-break:break-word;">
          <div>${meter}</div>
          ${apt ? `<div style="font-size:12px;color:#555;">공동주택명: ${apt}</div>` : ``}
          ${store ? `<div style="font-size:12px;color:#555;">상호명: ${store}</div>` : ``}
        </div>
        <button onclick="copyFieldValue('${raw}','계기번호')" style="font-size:11px;">복사</button>
      </div>
    `;
  }).join("");

  return `<div><strong>${label}</strong><div>${htmlValues}</div></div>`;
}

function renderInfo(group) {
  const panel = ensureInfoPanel();
  currentGroupNo = group.n;
  if (currentInfoOpenIndex === null) currentInfoOpenIndex = 0;

  const titleNo = escapeHtml(group.n || "-");
  const titleName = escapeHtml(group.b || "");
  const rows = Array.isArray(group.rows) ? group.rows : [];

  const buckets = [];
  const bucketMap = new Map();

  rows.forEach((r, i) => {
    const rowStatus = String(getRowStatus(group.n, i, r) || "").trim();

    // 현재상태가 빈칸인 행은 정보확인에서 제외
    if (!rowStatus) return;

    const key = String(r.f || "").trim() || `__empty_${i}`;
    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        key,
        indices: [],
        rows: []
      });
      buckets.push(bucketMap.get(key));
    }
    const bucket = bucketMap.get(key);
    bucket.indices.push(i);
    bucket.rows.push(r);
  });

  const items = buckets.map((bucket, bucketIndex) => {
    const first = bucket.rows[0] || {};
    const address = escapeHtml(first.f || "-");
    const statusList = bucket.indices.map(idx => String(getRowStatus(group.n, idx, rows[idx]) || "").trim()).filter(Boolean);
    const uniqueStatuses = [...new Set(statusList)];
    const currentStatus = uniqueStatuses.length ? uniqueStatuses[0] : "";
    const apt = escapeHtml(first.h || "-");
    const store = escapeHtml(first.i || "-");
    const note = escapeHtml(first.j || "-");
    const open = currentInfoOpenIndex === bucketIndex ? "block" : "none";
    const indexList = bucket.indices.join(",");
    const meterValues = bucket.rows.map(r => ({ meter:r.m||"", apt:r.h||"", store:r.i||"" }));

    return `
      <div style="border:1px solid #ececec;border-radius:12px;padding:10px;margin-bottom:10px;background:#fafafa;">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
          <div style="flex:1;font-size:13px;line-height:1.45;word-break:break-word;">${address}</div>
          <div style="flex-shrink:0;font-size:11px;padding:4px 8px;border-radius:999px;background:#f1f5f9;color:#334155;">${escapeHtml(currentStatus || "-")}</div>
        </div>

        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button onclick="showDetail(${bucketIndex})"
            style="border:none;background:#111827;color:#fff;padding:7px 10px;border-radius:10px;font-size:12px;cursor:pointer;">
            정보확인
          </button>

          <select onchange="changeGroupedStatus('${escapeHtml(group.n)}', '${indexList}', this.value)"
            style="height:32px;border:1px solid #d1d5db;border-radius:8px;padding:0 8px;font-size:12px;background:#fff;">
            <option value="" ${!currentStatus ? "selected" : ""}>상태없음</option>
            <option value="미설치" ${currentStatus === "미설치" ? "selected" : ""}>⚫ 미설치</option>
            <option value="계기교체(1순위)" ${currentStatus === "계기교체(1순위)" ? "selected" : ""}>🔴 계기교체(1순위)</option>
            <option value="계기교체(2순위)" ${currentStatus === "계기교체(2순위)" ? "selected" : ""}>🟡 계기교체(2순위)</option>
            <option value="모뎀설치" ${currentStatus === "모뎀설치" ? "selected" : ""}>🟢 모뎀설치</option>
          </select>
        </div>

        <div id="detail-${bucketIndex}" class="detail-box"
          style="display:${open};margin-top:8px;padding:10px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;font-size:12px;line-height:1.6;word-break:break-word;">
          ${infoRowWithCopy("변대전산화", first.n2 || "-", "변대전산화")}
          ${infoRowWithCopy("변대주명", first.o || "-", "변대주명")}
          ${infoRowWithCopy("주소", first.f || "-", "주소")}
          ${infoRowWithCopy("도로명주소", first.r || "-", "도로명주소")}
          ${infoRowsWithIndividualCopy("계기번호", meterValues, "계기번호")}
          <div><strong>공동주택명:</strong> ${apt}</div>
          <div><strong>상호명:</strong> ${store}</div>
          <div><strong>비고:</strong> ${note}</div>
        </div>
      </div>
    `;
  }).join("");

  panel.innerHTML = `
    <div style="height:5px;width:42px;border-radius:999px;background:#d1d5db;margin:8px auto 0;"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px 8px;border-bottom:1px solid #eef2f7;">
      <div style="font-size:15px;font-weight:700;line-height:1.35;word-break:break-word;padding-right:10px;">
        ${titleNo}${titleName ? ` (${titleName})` : ""}
      </div>
      <button onclick="closeInfo()"
        style="width:34px;height:34px;border:none;border-radius:999px;background:#f3f4f6;font-size:18px;cursor:pointer;flex-shrink:0;">
        ×
      </button>
    </div>
    <div style="overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 14px 16px;max-height:calc(62vh - 58px);">
      ${items || '<div style="text-align:center;color:#6b7280;font-size:13px;padding:12px 0;">표시할 정보가 없습니다.</div>'}
      <div style="font-size:11px;color:#6b7280;margin-top:4px;">상태 변경은 이 기기 브라우저에 저장됩니다.</div>
    </div>
  `;
  panel.style.display = "flex";
}

window.changeGroupedStatus = function(groupNo, indexList, value) {
  const indices = String(indexList || "")
    .split(",")
    .map(v => Number(v))
    .filter(v => !Number.isNaN(v));

  indices.forEach(idx => {
    const key = `${groupNo}__${idx}`;
    statusOverrides[key] = value;
  });
  saveOverrides();

  const group = groupMap.get(groupNo);
  if (!group) return;

  const marker = markerMap.get(groupNo);
  if (marker) marker.setImage(getMarkerImage(getGroupColor(group)));

  renderInfo(group);
  refresh();
};

window.changeRowStatus = function(groupNo, idx, value) {
  window.changeGroupedStatus(groupNo, String(idx), value);
};

function clearMarkers() {
  markers.forEach(m => m.setMap(null));
  markers = [];
  markerMap.clear();
}
function inBounds(g, bounds) {
  return g.y >= bounds.minLat && g.y <= bounds.maxLat && g.x >= bounds.minLng && g.x <= bounds.maxLng;
}
function getPlainBounds() {
  const b = map.getBounds();
  const sw = b.getSouthWest();
  const ne = b.getNorthEast();
  return { minLat: sw.getLat(), maxLat: ne.getLat(), minLng: sw.getLng(), maxLng: ne.getLng() };
}
function intersects(a, b) {
  return !(a.maxLat < b.minLat || a.minLat > b.maxLat || a.maxLng < b.minLng || a.minLng > b.maxLng);
}
async function loadTiles(files) {
  for (const file of files) {
    if (!loadedTiles.has(file)) {
      const d = await fetch(file).then(r => r.json());
      groups.push(...d);
      loadedTiles.set(file, true);
    }
  }
  rebuildGroupMap();
}
function rebuildGroupMap() {
  groupMap = new Map();
  for (const g of groups) groupMap.set(g.n, g);
}
async function loadVisibleTiles() {
  const bounds = getPlainBounds();
  const files = tileMeta.filter(t => intersects(t, bounds)).map(t => t.file);
  await loadTiles(files);
}
async function loadAllTiles() {
  await loadTiles(tileMeta.map(t => t.file));
}

function filterGroups() {
  const selectedBranches = getSelectedValues("branchFilterCheck");
  const selectedStatuses = getSelectedValues("statusFilterCheck");
  const query = (appliedSearchQuery || "").trim().toLowerCase();
  const bounds = getPlainBounds();

  let source = groups.slice();
  const allBranch = !selectedBranches.length || selectedBranches.includes("all");
  const allStatus = !selectedStatuses.length || selectedStatuses.includes("all");

  if (allBranch) {
    if (!query && map.getLevel() > MIN_LEVEL_ALL) return [];
    if (!query) {
      source = source.filter(g => inBounds(g, bounds));
    }
  } else {
    source = source.filter(g => selectedBranches.includes(g.branch));
  }

  if (!allStatus) {
    source = source.filter(g => selectedStatuses.includes(getGroupColor(g)));
  }

  if (query) {
    source = source.filter(g => {
      const text = [
        g.branch || "", g.n || "", g.b || "",
        ...(g.rows || []).flatMap((r, idx) => [r.n2 || "", r.o || "", r.f || "", r.r || "", r.h || "", r.i || "", r.j || "", r.c || "", r.m || "", getRowStatus(g.n, idx, r) || ""])
      ].join(" ").toLowerCase();
      return text.includes(query);
    });
  }

  const limit = allBranch ? MAX_MARKERS_ALL : MAX_MARKERS_BRANCH;
  return source.slice(0, limit);
}


function getMeterCountBaseGroups() {
  const selectedBranches = getSelectedValues("branchFilterCheck");
  const allBranch = !selectedBranches.length || selectedBranches.includes("all");
  const query = (appliedSearchQuery || "").trim().toLowerCase();

  let source = groups.slice();

  if (!allBranch) {
    source = source.filter(g => selectedBranches.includes(g.branch));
  }

  if (query) {
    source = source.filter(g => {
      const text = [
        g.branch || "", g.n || "", g.b || "",
        ...(g.rows || []).flatMap((r, idx) => [
          r.n2 || "", r.o || "", r.f || "", r.r || "",
          r.h || "", r.i || "", r.j || "", r.c || "", r.m || "",
          getRowStatus(g.n, idx, r) || ""
        ])
      ].join(" ").toLowerCase();
      return text.includes(query);
    });
  }

  return source;
}

function drawMarkers(items) {
  clearMarkers();

  const visibleItems = [];

  for (const g of items) {
    const color = getGroupColor(g);
    if (!color) continue;

    const m = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(g.y, g.x),
      image: getMarkerImage(color),
      clickable: true
    });

    kakao.maps.event.addListener(m, "click", function () {
      renderInfo(g);
    });

    m.setMap(map);
    markers.push(m);
    markerMap.set(g.n, m);
    visibleItems.push(g);
  }

  updateMarkerCount(visibleItems, getMeterCountBaseGroups());
  updateStatusSummary(visibleItems);

  if (currentGroupNo) {
    const found = visibleItems.find(g => g.n === currentGroupNo);
    if (found) renderInfo(found);
  }
}

async function refresh() {
  const selectedBranches = getSelectedValues("branchFilterCheck");
  const selectedStatuses = getSelectedValues("statusFilterCheck");
  const query = (appliedSearchQuery || "").trim();
  const allBranch = !selectedBranches.length || selectedBranches.includes("all");
  const filteredStatus = selectedStatuses.length && !selectedStatuses.includes("all");

  if (query || filteredStatus) {
    await loadAllTiles();
  } else if (allBranch) {
    await loadVisibleTiles();
  } else {
    await loadAllTiles();
  }

  drawMarkers(filterGroups());
}

async function onBranchChange() {
  closeInfo();
  const selectedBranches = getSelectedValues("branchFilterCheck");
  const query = (appliedSearchQuery || "").trim();
  const allBranch = !selectedBranches.length || selectedBranches.includes("all");

  if (allBranch && !query) {
    map.setCenter(new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng));
    map.setLevel(DEFAULT_LEVEL);
    await refresh();
    return;
  }

  await loadAllTiles();
  const targets = branchMeta.filter(b => selectedBranches.includes(b.name));

  if (targets.length === 1) {
    const b = targets[0];
    const bounds = new kakao.maps.LatLngBounds(
      new kakao.maps.LatLng(b.minLat, b.minLng),
      new kakao.maps.LatLng(b.maxLat, b.maxLng)
    );
    map.setBounds(bounds);
  } else if (targets.length > 1) {
    const bounds = new kakao.maps.LatLngBounds();
    targets.forEach(b => {
      bounds.extend(new kakao.maps.LatLng(b.minLat, b.minLng));
      bounds.extend(new kakao.maps.LatLng(b.maxLat, b.maxLng));
    });
    map.setBounds(bounds);
  }

  await refresh();
}

function init() {
  ensureInfoPanel();

  map = new kakao.maps.Map(document.getElementById("map"), {
    center: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
    level: DEFAULT_LEVEL
  });

  Promise.all([
    fetch("tiles_index.json").then(r => r.json()),
    fetch("branches.json").then(r => r.json()).catch(() => [])
  ]).then(([tileData, branchData]) => {
    tileMeta = tileData.tiles || [];
    branchMeta = Array.isArray(branchData) ? branchData : [];
    ensureUI();
    refresh();
  });

  kakao.maps.event.addListener(map, "idle", debounce(refresh, 120));
}

init();
