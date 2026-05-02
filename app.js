import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  setDoc,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// TODO: Firebase 콘솔 > 프로젝트 설정 > 일반 > 웹 앱 Firebase 구성값으로 교체하세요.
const firebaseConfig = {
  apiKey: "AIzaSyDfpnGLUxcqY69szJCmbWE10s2Mv9xF7Cw",
  authDomain: "kdn-map.firebaseapp.com",
  projectId: "kdn-map",
  storageBucket: "kdn-map.firebasestorage.app",
  messagingSenderId: "774166998071",
  appId: "1:774166998071:web:d99011e3487d86849e23b2",
  measurementId: "G-DE4C2P3GKZ"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

let currentUser = null;
let unsubscribeOverrides = null;
let authPanel = null;
let firebaseReady = false;


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
const REGION_BRANCHES = {
  "1권역": ["경기본부직할", "오산지사", "서수원지사"],
  "2권역": ["광명지사", "안산지사", "안양지사"],
  "3권역": ["평택지사", "서평택지사", "안성지사", "화성지사"],
  "4권역": ["성남지사", "광주지사", "하남지사"],
  "5권역": ["이천지사", "여주지사", "서용인지사", "동용인지사"]
};

let currentGroupNo = null;
let currentInfoOpenIndex = null;
let infoPanel = null;

let searchInput = null;
let searchButton = null;
let resetButton = null;
let branchDropdown = null;
let regionDropdown = null;
let statusDropdown = null;
let markerCountEl = null;
let statusSummaryEl = null;
let currentLocationButton = null;

let groupMap = new Map();
let markerMap = new Map();
let statusOverrides = loadOverrides();
let appliedSearchQuery = "";
let currentLocationMarker = null;
let selectedMarkerGroupNo = null;

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

function isFirebaseConfigured() {
  return firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("YOUR_");
}

function safeDocId(value) {
  return encodeURIComponent(String(value || "")).replaceAll(".", "%2E");
}

function ensureAuthPanel() {
  if (authPanel) return authPanel;

  authPanel = document.createElement("div");
  authPanel.id = "kdnAuthPanel";
  authPanel.style.position = "fixed";
  authPanel.style.left = "0";
  authPanel.style.right = "0";
  authPanel.style.top = "0";
  authPanel.style.bottom = "0";
  authPanel.style.zIndex = "10000";
  authPanel.style.background = "rgba(17,24,39,0.72)";
  authPanel.style.display = "none";
  authPanel.style.alignItems = "center";
  authPanel.style.justifyContent = "center";
  authPanel.style.padding = "18px";
  authPanel.style.boxSizing = "border-box";
  document.body.appendChild(authPanel);
  return authPanel;
}

function renderAuthPanel(message = "") {
  const panel = ensureAuthPanel();
  const configured = isFirebaseConfigured();

  panel.innerHTML = `
    <div style="width:min(420px,100%);background:#fff;border-radius:18px;padding:20px;box-shadow:0 18px 48px rgba(0,0,0,0.25);font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
      <div style="font-size:20px;font-weight:800;margin-bottom:6px;">KDN MAP 로그인</div>
      <div style="font-size:13px;color:#4b5563;line-height:1.5;margin-bottom:14px;">
        작업자별 상태 변경을 실시간으로 공유하려면 Firebase 로그인이 필요합니다.
      </div>
      ${!configured ? `
        <div style="font-size:13px;line-height:1.55;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:12px;padding:10px;margin-bottom:12px;">
          app.js 상단의 <strong>firebaseConfig</strong> 값을 실제 Firebase 웹 앱 구성값으로 먼저 교체하세요.
        </div>
      ` : ``}
      <input id="kdnAuthEmail" type="text" placeholder="아이디 (예: kdn01)" autocomplete="username"
        style="width:100%;height:42px;border:1px solid #d1d5db;border-radius:10px;padding:0 12px;box-sizing:border-box;margin-bottom:8px;font-size:14px;">
      <input id="kdnAuthPassword" type="password" placeholder="비밀번호" autocomplete="current-password"
        style="width:100%;height:42px;border:1px solid #d1d5db;border-radius:10px;padding:0 12px;box-sizing:border-box;margin-bottom:10px;font-size:14px;">
      ${message ? `<div style="font-size:12px;color:#dc2626;margin-bottom:10px;">${escapeHtml(message)}</div>` : ``}
      <button id="kdnAuthLoginBtn" type="button" ${configured ? "" : "disabled"}
        style="width:100%;height:42px;border:none;border-radius:10px;background:${configured ? "#111827" : "#9ca3af"};color:#fff;font-size:14px;font-weight:700;cursor:${configured ? "pointer" : "not-allowed"};">
        로그인
      </button>
    </div>
  `;

  const loginBtn = panel.querySelector("#kdnAuthLoginBtn");
  if (loginBtn && configured) {
    loginBtn.onclick = async () => {
      const loginId = panel.querySelector("#kdnAuthEmail").value.trim();
      const email = loginId.includes("@") ? loginId : `${loginId}@kdn.local`;
      const password = panel.querySelector("#kdnAuthPassword").value;
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (e) {
        renderAuthPanel("로그인 실패: 아이디/비밀번호를 확인하세요.");
      }
    };
  }

  panel.style.display = "flex";
}

function hideAuthPanel() {
  const panel = ensureAuthPanel();
  panel.style.display = "none";
}

function startOverrideSync() {
  if (unsubscribeOverrides) unsubscribeOverrides();

  unsubscribeOverrides = onSnapshot(collection(db, "statusOverrides"), (snapshot) => {
    const next = {};
    snapshot.forEach(d => {
      const data = d.data() || {};
      if (typeof data.key === "string") {
        next[data.key] = normalizeStatus(data.status || "");
      }
    });
    statusOverrides = next;
    saveOverrides();
    refresh();

    if (currentGroupNo) {
      const group = groupMap.get(currentGroupNo);
      if (group) renderInfo(group);
    }
  }, () => {
    alert("Firebase 상태 동기화 권한 또는 규칙을 확인하세요.");
  });
}

async function saveRemoteOverride(groupNo, idx, value) {
  if (!currentUser) {
    renderAuthPanel("로그인 후 상태를 변경할 수 있습니다.");
    throw new Error("not-authenticated");
  }

  const key = `${groupNo}__${idx}`;
  const status = normalizeStatus(value);

  await setDoc(doc(db, "statusOverrides", safeDocId(key)), {
    key,
    groupNo: String(groupNo),
    rowIndex: Number(idx),
    status,
    updatedAt: serverTimestamp(),
    updatedByUid: currentUser.uid,
    updatedByEmail: currentUser.email || ""
  }, { merge: true });

  await addDoc(collection(db, "statusLogs"), {
    key,
    groupNo: String(groupNo),
    rowIndex: Number(idx),
    status,
    updatedAt: serverTimestamp(),
    updatedByUid: currentUser.uid,
    updatedByEmail: currentUser.email || ""
  });
}

function initAuthSync() {
  if (!isFirebaseConfigured()) {
    renderAuthPanel();
    return;
  }

  onAuthStateChanged(auth, (user) => {
    currentUser = user;

    if (!user) {
      if (unsubscribeOverrides) {
        unsubscribeOverrides();
        unsubscribeOverrides = null;
      }
      renderAuthPanel();
      return;
    }

    hideAuthPanel();
    firebaseReady = true;
    startOverrideSync();
    renderLoginStatus();
  });
}

function renderLoginStatus() {
  const old = document.getElementById("kdnLoginStatus");
  if (old) old.remove();
  if (!currentUser) return;

  const box = document.createElement("div");
  box.id = "kdnLoginStatus";
  box.style.position = "fixed";
  box.style.right = "10px";
  box.style.bottom = "10px";
  box.style.zIndex = "12";
  box.style.background = "rgba(255,255,255,0.96)";
  box.style.border = "1px solid #e5e7eb";
  box.style.borderRadius = "999px";
  box.style.padding = "6px 8px 6px 10px";
  box.style.boxShadow = "0 4px 14px rgba(0,0,0,0.12)";
  box.style.fontSize = "11px";
  box.style.display = "flex";
  box.style.alignItems = "center";
  box.style.gap = "6px";
  box.innerHTML = `
    <span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml((currentUser.email || "로그인됨").replace("@kdn.local", ""))}</span>
    <button id="kdnLogoutBtn" type="button" style="border:none;background:#111827;color:#fff;border-radius:999px;padding:4px 7px;font-size:11px;cursor:pointer;">로그아웃</button>
  `;
  document.body.appendChild(box);
  box.querySelector("#kdnLogoutBtn").onclick = () => signOut(auth);
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

function svgMarker(color, selected = false) {
  const fillMap = {
    red: "#ef4444",
    orange: "#8b5cf6",
    yellow: "#facc15",
    green: "#22c55e",
    black: "#111111",
    gray: "#6b7280"
  };
  const fill = fillMap[color] || fillMap.gray;

  if (selected) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
        <polygon points="14,2 17.4,10.2 26.3,10.9 19.5,16.7 21.6,25.4 14,20.8 6.4,25.4 8.5,16.7 1.7,10.9 10.6,10.2" fill="${fill}" stroke="white" stroke-width="2.4" stroke-linejoin="round"/>
      </svg>
    `;
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5.5" fill="${fill}" stroke="white" stroke-width="2"/>
    </svg>
  `;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}
function getMarkerImage(color, selected = false) {
  const size = selected ? 28 : 16;
  const offset = selected ? 14 : 8;
  return new kakao.maps.MarkerImage(svgMarker(color, selected), new kakao.maps.Size(size, size), {
    offset: new kakao.maps.Point(offset, offset)
  });
}
function refreshMarkerSelection() {
  markerMap.forEach((marker, groupNo) => {
    const group = groupMap.get(groupNo);
    if (!group) return;
    const color = getGroupColor(group);
    if (!color) return;
    marker.setImage(getMarkerImage(color, groupNo === selectedMarkerGroupNo));
    marker.setZIndex(groupNo === selectedMarkerGroupNo ? 10000 : 0);
  });
}

function getSelectedValues(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(el => el.value);
}

function getSelectedRegionBranches() {
  const selectedRegions = getSelectedValues("regionFilterCheck");
  const allRegion = !selectedRegions.length || selectedRegions.includes("all");
  if (allRegion) return null;

  const branches = new Set();
  selectedRegions.forEach(region => {
    (REGION_BRANCHES[region] || []).forEach(branch => branches.add(branch));
  });
  return branches;
}

function hasActiveRegionFilter() {
  const selectedRegions = getSelectedValues("regionFilterCheck");
  return selectedRegions.length && !selectedRegions.includes("all");
}

function hasActiveBranchFilter() {
  const selectedBranches = getSelectedValues("branchFilterCheck");
  return selectedBranches.length && !selectedBranches.includes("all");
}

function filterByRegionAndBranch(source) {
  let result = source || [];
  const regionBranches = getSelectedRegionBranches();
  const selectedBranches = getSelectedValues("branchFilterCheck");

  if (regionBranches) {
    result = result.filter(g => regionBranches.has(g.branch));
  }

  if (selectedBranches.length && !selectedBranches.includes("all")) {
    result = result.filter(g => selectedBranches.includes(g.branch));
  }

  return result;
}

function getActiveMapBranches() {
  const selectedBranches = getSelectedValues("branchFilterCheck");
  if (selectedBranches.length && !selectedBranches.includes("all")) {
    return selectedBranches;
  }

  const regionBranches = getSelectedRegionBranches();
  if (regionBranches) return Array.from(regionBranches);

  return [];
}
function setDropdownLabel(dropdown, values, allLabel) {
  const label = dropdown.querySelector(".kdn-multi-label");
  if (!label) return;

  const statusLabelMap = {
    black: "긴급",
    red: "계기교체(1순위)",
    orange: "계기교체(2순위)",
    yellow: "계기교체(3순위)",
    green: "모뎀설치"
  };

  const filtered = values.filter(v => v !== "all");

  if (!filtered.length || values.includes("all")) {
    label.textContent = allLabel;
    return;
  }

  const mapped = filtered.map(v => statusLabelMap[v] || v);

  if (mapped.length === 1) {
    label.textContent = mapped[0];
  } else {
    label.textContent = mapped.join(", ");
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
    { value: "orange", label: "🟣 계기교체(2순위)", checked: false },
    { value: "yellow", label: "🟡 계기교체(3순위)", checked: false },
    { value: "green", label: "🟢 모뎀설치", checked: false }
  ], "구분", refresh);
}
function buildRegionFilter() {
  const current = getSelectedValues("regionFilterCheck");
  const items = [{ value: "all", label: "권역 전체", checked: !current.length || current.includes("all") }]
    .concat(Object.keys(REGION_BRANCHES).map(region => ({
      value: region,
      label: `${region} (${REGION_BRANCHES[region].join(", ")})`,
      checked: current.includes(region)
    })));
  buildMultiSelect(regionDropdown, "regionFilterCheck", items, "권역", onAreaFilterChange);
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
  const filteredBranch = hasActiveBranchFilter() || hasActiveRegionFilter();
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
  const filteredBranch = hasActiveBranchFilter() || hasActiveRegionFilter();
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
  if (counts.orange) parts.push(`🟣 ${counts.orange}`);
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

  currentLocationButton = document.createElement("button");
  currentLocationButton.className = "kdn-reset-btn";
  currentLocationButton.type = "button";
  currentLocationButton.textContent = "현재위치";
  currentLocationButton.onclick = () => { moveToCurrentLocation(); };

  row1.appendChild(searchInput);
  row1.appendChild(searchButton);
  row1.appendChild(currentLocationButton);

  const row2 = document.createElement("div");
  row2.className = "kdn-row";

  statusDropdown = document.createElement("div");
  statusDropdown.id = "statusFilter";
  statusDropdown.className = "kdn-multi";

  regionDropdown = document.createElement("div");
  regionDropdown.id = "regionFilter";
  regionDropdown.className = "kdn-multi";

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
  row2.appendChild(regionDropdown);
  row2.appendChild(branchDropdown);

  bar.appendChild(row1);
  bar.appendChild(row2);
  bar.appendChild(row3);
  bar.appendChild(row4);
  document.body.appendChild(bar);

  buildStatusFilter();
  buildRegionFilter();
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
    const rowStatus = normalizeComparableStatus(getRowStatus(group.n, i, r));

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
    const meterValues = bucket.rows
  .filter((r, localIdx) => {
    const originalIdx = bucket.indices[localIdx];
    return normalizeComparableStatus(getRowStatus(group.n, originalIdx, rows[originalIdx]));
  })
  .map(r => ({ meter:r.m||"", apt:r.h||"", store:r.i||"" }));

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
            <option value="긴급" ${currentStatus === "긴급" ? "selected" : ""}>⚫ 긴급</option>
            <option value="계기교체(1순위)" ${currentStatus === "계기교체(1순위)" ? "selected" : ""}>🔴 계기교체(1순위)</option>
            <option value="계기교체(2순위)" ${currentStatus === "계기교체(2순위)" ? "selected" : ""}>🟣 계기교체(2순위)</option>
            <option value="계기교체(3순위)" ${currentStatus === "계기교체(3순위)" ? "selected" : ""}>🟡 계기교체(3순위)</option>
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

window.changeGroupedStatus = async function(groupNo, indexList, value) {
  const indices = String(indexList || "")
    .split(",")
    .map(v => Number(v))
    .filter(v => !Number.isNaN(v));

  const previous = { ...statusOverrides };

  indices.forEach(idx => {
    const key = `${groupNo}__${idx}`;
    statusOverrides[key] = value;
  });
  saveOverrides();

  const group = groupMap.get(groupNo);
  if (group) {
    const marker = markerMap.get(groupNo);
    if (marker) marker.setImage(getMarkerImage(getGroupColor(group), groupNo === selectedMarkerGroupNo));
    renderInfo(group);
  }
  refresh();

  try {
    await Promise.all(indices.map(idx => saveRemoteOverride(groupNo, idx, value)));
  } catch (e) {
    statusOverrides = previous;
    saveOverrides();
    if (group) renderInfo(group);
    refresh();
    if (String(e.message || "") !== "not-authenticated") {
      alert("상태 저장 실패: Firebase 권한/네트워크를 확인하세요.");
    }
  }
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
  const selectedStatuses = getSelectedValues("statusFilterCheck");
  const query = (appliedSearchQuery || "").trim().toLowerCase();
  const bounds = getPlainBounds();

  let source = groups.slice();
  const filteredArea = hasActiveBranchFilter() || hasActiveRegionFilter();
  const allStatus = !selectedStatuses.length || selectedStatuses.includes("all");

  if (!filteredArea) {
    if (!query && map.getLevel() > MIN_LEVEL_ALL) return [];
    if (!query) {
      source = source.filter(g => inBounds(g, bounds));
    }
  } else {
    source = filterByRegionAndBranch(source);
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

  const limit = filteredArea ? MAX_MARKERS_BRANCH : MAX_MARKERS_ALL;
  return source.slice(0, limit);
}


function getMeterCountBaseGroups() {
  const query = (appliedSearchQuery || "").trim().toLowerCase();

  let source = groups.slice();

  if (hasActiveBranchFilter() || hasActiveRegionFilter()) {
    source = filterByRegionAndBranch(source);
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

    const isSelected = g.n === selectedMarkerGroupNo;
    const m = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(g.y, g.x),
      image: getMarkerImage(color, isSelected),
      clickable: true,
      zIndex: isSelected ? 10000 : 0
    });

    kakao.maps.event.addListener(m, "click", function () {
      selectedMarkerGroupNo = g.n;
      refreshMarkerSelection();
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
  const selectedStatuses = getSelectedValues("statusFilterCheck");
  const query = (appliedSearchQuery || "").trim();
  const filteredArea = hasActiveBranchFilter() || hasActiveRegionFilter();
  const filteredStatus = selectedStatuses.length && !selectedStatuses.includes("all");

  if (query || filteredStatus || filteredArea) {
    await loadAllTiles();
  } else {
    await loadVisibleTiles();
  }

  drawMarkers(filterGroups());
}

async function onAreaFilterChange() {
  closeInfo();
  const query = (appliedSearchQuery || "").trim();
  const targetBranchNames = getActiveMapBranches();

  if (!targetBranchNames.length && !query) {
    map.setCenter(new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng));
    map.setLevel(DEFAULT_LEVEL);
    await refresh();
    return;
  }

  await loadAllTiles();
  const targets = branchMeta.filter(b => targetBranchNames.includes(b.name));

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

async function onBranchChange() {
  await onAreaFilterChange();
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
    initAuthSync();
    refresh();
  });

  kakao.maps.event.addListener(map, "idle", debounce(refresh, 120));
}

init();
