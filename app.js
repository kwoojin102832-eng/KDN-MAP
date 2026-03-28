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
let branchFilter = null;
let statusFilter = null;
let groupMap = new Map();
let markerMap = new Map();
let statusOverrides = loadOverrides();

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function ensureUI() {
  searchInput = document.getElementById("searchInput");
  branchFilter = document.getElementById("branchFilter");
  statusFilter = document.getElementById("statusFilter");

  if (!searchInput || !branchFilter || !statusFilter) {
    const oldBar = document.getElementById("kdnControlBar");
    if (oldBar) oldBar.remove();

    const bar = document.createElement("div");
    bar.id = "kdnControlBar";
    bar.style.position = "fixed";
    bar.style.top = "8px";
    bar.style.left = "8px";
    bar.style.right = "8px";
    bar.style.zIndex = "10";
    bar.style.display = "flex";
    bar.style.gap = "6px";
    bar.style.background = "rgba(255,255,255,0.96)";
    bar.style.padding = "6px";
    bar.style.borderRadius = "12px";
    bar.style.boxShadow = "0 2px 10px rgba(0,0,0,0.12)";
    bar.style.backdropFilter = "blur(6px)";

    searchInput = document.createElement("input");
    searchInput.id = "searchInput";
    searchInput.type = "text";
    searchInput.placeholder = "검색";
    searchInput.style.flex = "1";
    searchInput.style.height = "34px";
    searchInput.style.border = "1px solid #ddd";
    searchInput.style.borderRadius = "8px";
    searchInput.style.padding = "0 10px";
    searchInput.style.minWidth = "0";
    bar.appendChild(searchInput);

    statusFilter = document.createElement("select");
    statusFilter.id = "statusFilter";
    statusFilter.style.height = "34px";
    statusFilter.style.border = "1px solid #ddd";
    statusFilter.style.borderRadius = "8px";
    statusFilter.style.padding = "0 8px";
    statusFilter.innerHTML = `
      <option value="all">구분</option>
      <option value="red">미설치</option>
      <option value="blue">계기교체</option>
      <option value="green">모뎀설치</option>
    `;
    bar.appendChild(statusFilter);

    branchFilter = document.createElement("select");
    branchFilter.id = "branchFilter";
    branchFilter.style.height = "34px";
    branchFilter.style.border = "1px solid #ddd";
    branchFilter.style.borderRadius = "8px";
    branchFilter.style.padding = "0 8px";
    bar.appendChild(branchFilter);

    document.body.appendChild(bar);
  }

  searchInput.oninput = debounce(refresh, 180);
  statusFilter.onchange = refresh;
  branchFilter.onchange = onBranchChange;
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

function getRowStatus(groupNo, idx, row) {
  const key = `${groupNo}__${idx}`;
  return statusOverrides[key] || row.k || "";
}

function getGroupColor(group) {
  const statuses = (group.rows || []).map((r, idx) => String(getRowStatus(group.n, idx, r)).trim()).filter(Boolean);
  if (!statuses.length) return "gray";
  if (statuses.includes("계기교체")) return "blue";
  if (statuses.every(v => v === "모뎀설치")) return "green";
  return "red";
}

function svgMarker(color) {
  const fill = color === "red" ? "#ef4444" : color === "blue" ? "#3b82f6" : color === "green" ? "#22c55e" : "#6b7280";
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

function renderInfo(group) {
  const panel = ensureInfoPanel();
  currentGroupNo = group.n;
  if (currentInfoOpenIndex === null) currentInfoOpenIndex = 0;

  const titleNo = escapeHtml(group.n || "-");
  const titleName = escapeHtml(group.b || "");
  const rows = Array.isArray(group.rows) ? group.rows : [];

  const items = rows.map((r, i) => {
    const address = escapeHtml(r.f || "-");
    const status = escapeHtml(getRowStatus(group.n, i, r) || "-");
    const contractNo = escapeHtml(r.c || "-");
    const meterNo = escapeHtml(r.m || "-");
    const apt = escapeHtml(r.h || "-");
    const store = escapeHtml(r.i || "-");
    const note = escapeHtml(r.j || "-");
    const open = currentInfoOpenIndex === i ? "block" : "none";

    return `
      <div style="border:1px solid #ececec;border-radius:12px;padding:10px;margin-bottom:10px;background:#fafafa;">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
          <div style="flex:1;font-size:13px;line-height:1.45;word-break:break-word;">${address}</div>
          <div style="flex-shrink:0;font-size:11px;padding:4px 8px;border-radius:999px;background:#f1f5f9;color:#334155;">${status}</div>
        </div>

        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button onclick="showDetail(${i})"
            style="border:none;background:#111827;color:#fff;padding:7px 10px;border-radius:10px;font-size:12px;cursor:pointer;">
            정보확인
          </button>

          <select onchange="changeRowStatus('${escapeHtml(group.n)}', ${i}, this.value)"
            style="height:32px;border:1px solid #d1d5db;border-radius:8px;padding:0 8px;font-size:12px;background:#fff;">
            <option value="미설치" ${status === "미설치" ? "selected" : ""}>미설치</option>
            <option value="계기교체" ${status === "계기교체" ? "selected" : ""}>계기교체</option>
            <option value="모뎀설치" ${status === "모뎀설치" ? "selected" : ""}>모뎀설치</option>
          </select>
        </div>

        <div id="detail-${i}" class="detail-box"
          style="display:${open};margin-top:8px;padding:10px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;font-size:12px;line-height:1.6;word-break:break-word;">
          <div><strong>계약번호:</strong> ${contractNo}</div>
          <div><strong>계기번호:</strong> ${meterNo}</div>
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

window.changeRowStatus = function(groupNo, idx, value) {
  const key = `${groupNo}__${idx}`;
  statusOverrides[key] = value;
  saveOverrides();

  const group = groupMap.get(groupNo);
  if (!group) return;

  const marker = markerMap.get(groupNo);
  if (marker) marker.setImage(getMarkerImage(getGroupColor(group)));

  renderInfo(group);

  const currentItems = filterGroups();
  const stillVisible = currentItems.some(g => g.n === groupNo);
  if (!stillVisible) refresh();
};

function debounce(fn, wait) {
  let t = null;
  return function () {
    clearTimeout(t);
    t = setTimeout(() => fn(), wait);
  };
}

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

function populateBranchFilter() {
  if (!branchFilter) return;
  const current = branchFilter.value || "all";
  branchFilter.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "지사 전체";
  branchFilter.appendChild(allOpt);

  branchMeta.forEach(b => {
    const opt = document.createElement("option");
    opt.value = b.name;
    opt.textContent = b.name;
    branchFilter.appendChild(opt);
  });

  if ([...branchFilter.options].some(o => o.value === current)) branchFilter.value = current;
  else branchFilter.value = "all";
}

function filterGroups() {
  const branch = branchFilter ? branchFilter.value : "all";
  const status = statusFilter ? statusFilter.value : "all";
  const query = searchInput ? searchInput.value.trim().toLowerCase() : "";
  const bounds = getPlainBounds();

  let source = groups.slice();

  if (branch === "all") {
    if (map.getLevel() > MIN_LEVEL_ALL) return [];
    source = source.filter(g => inBounds(g, bounds));
  } else {
    source = source.filter(g => g.branch === branch);
  }

  if (status && status !== "all") {
    source = source.filter(g => getGroupColor(g) === status);
  }

  if (query) {
    source = source.filter(g => {
      const text = [
        g.branch || "", g.n || "", g.b || "",
        ...(g.rows || []).flatMap((r, idx) => [r.f || "", r.h || "", r.i || "", r.j || "", r.c || "", r.m || "", getRowStatus(g.n, idx, r) || ""])
      ].join(" ").toLowerCase();
      return text.includes(query);
    });
  }

  const limit = branch === "all" ? MAX_MARKERS_ALL : MAX_MARKERS_BRANCH;
  return source.slice(0, limit);
}

function drawMarkers(items) {
  clearMarkers();

  for (const g of items) {
    const m = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(g.y, g.x),
      image: getMarkerImage(getGroupColor(g)),
      clickable: true
    });

    kakao.maps.event.addListener(m, "click", function () {
      renderInfo(g);
    });

    m.setMap(map);
    markers.push(m);
    markerMap.set(g.n, m);
  }

  if (currentGroupNo) {
    const found = items.find(g => g.n === currentGroupNo);
    if (found) renderInfo(found);
  }
}

async function refresh() {
  const branch = branchFilter ? branchFilter.value : "all";
  if (branch === "all") await loadVisibleTiles();
  else await loadAllTiles();
  drawMarkers(filterGroups());
}

async function onBranchChange() {
  closeInfo();
  const branch = branchFilter ? branchFilter.value : "all";

  if (branch === "all") {
    map.setCenter(new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng));
    map.setLevel(DEFAULT_LEVEL);
    await refresh();
    return;
  }

  await loadAllTiles();
  const meta = branchMeta.find(b => b.name === branch);
  if (meta) {
    const bounds = new kakao.maps.LatLngBounds(
      new kakao.maps.LatLng(meta.minLat, meta.minLng),
      new kakao.maps.LatLng(meta.maxLat, meta.maxLng)
    );
    map.setBounds(bounds);
  }
  await refresh();
}

function init() {
  ensureUI();
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
    populateBranchFilter();
    refresh();
  });

  kakao.maps.event.addListener(map, "idle", debounce(refresh, 120));
}

init();
