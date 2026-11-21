import { reactive, computed } from "vue";
import { io } from "socket.io-client";
import * as api from "../api/client.js";
import { toBeat, toSite } from "../api/adapter.js";
import { DOWN, UP, PENDING, MAINTENANCE } from "../util.js";

const MAX_BEATS = 100;
// 백엔드가 60초마다 상태를 검사하므로 화면도 60초마다 사이트 목록(가동률·로그인 상태)과 상태 기록을 다시 받음
const POLL_MS = 5000;

export const store = reactive({
    useMock: api.USE_MOCK,
    connected: false,
    loading: true,
    error: null,
    sites: {},
    heartbeats: {}, // siteId -> beats (oldest first)
});

let socket = null;
let unsubscribeMock = null;
let pollTimer = null;

function pushBeat(raw) {
    const beat = toBeat(raw);
    const list = (store.heartbeats[beat.siteId] ||= []);
    list.push(beat);
    if (list.length > MAX_BEATS) list.splice(0, list.length - MAX_BEATS);
}

async function loadSites() {
    try {
        const sites = await api.getSites();
        store.sites = Object.fromEntries(sites.map((s) => [s.id, s]));
        store.connected = true;
        store.error = null;
    } catch (e) {
        // 목록은 지우지 않고 그대로 두고, 연결 끊김만 표시
        store.connected = false;
        store.error = "사이트 목록을 불러오지 못했습니다: " + e.message;
    } finally {
        store.loading = false;
    }
}

async function loadHeartbeats() {
    try {
        store.heartbeats = await api.getHeartbeats(MAX_BEATS);
    } catch (e) {
        console.warn("상태 기록을 불러오지 못했습니다:", e.message);
    }
}

export async function refresh() {
    await loadSites();
    if (store.connected) await loadHeartbeats();
}

export async function init() {
    await refresh();

    if (api.USE_MOCK) {
        unsubscribeMock = api.subscribeMock(pushBeat);
        pollTimer = setInterval(loadSites, POLL_MS);
        return;
    }

    if (!api.USE_SOCKET) {
        pollTimer = setInterval(refresh, POLL_MS);
        return;
    }

    socket = io({ path: "/socket.io" });
    socket.on("heartbeat", pushBeat);
    socket.on("siteUpdated", (raw) => (store.sites[raw.id] = toSite(raw, store.sites[raw.id])));
    socket.on("siteDeleted", ({ id }) => {
        delete store.sites[id];
        delete store.heartbeats[id];
    });
    // 가동률은 socket 이벤트로 오지 않으므로 목록은 계속 주기적으로 받음
    pollTimer = setInterval(loadSites, POLL_MS);
}

export function dispose() {
    socket?.disconnect();
    unsubscribeMock?.();
    clearInterval(pollTimer);
}

export function lastBeat(siteId) {
    const list = store.heartbeats[siteId];
    return list && list.length ? list[list.length - 1] : null;
}

// 방문 횟수 내림차순
export const sortedSites = computed(() =>
    Object.values(store.sites).sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
        return a.name.localeCompare(b.name);
    })
);

export const stats = computed(() => {
    const result = { up: 0, down: 0, maintenance: 0, pending: 0, unknown: 0, pause: 0 };
    for (const site of Object.values(store.sites)) {
        const beat = lastBeat(site.id);
        if (!site.active) result.pause++;
        else if (!beat) result.unknown++;
        else if (beat.status === UP) result.up++;
        else if (beat.status === DOWN) result.down++;
        else if (beat.status === PENDING) result.pending++;
        else if (beat.status === MAINTENANCE) result.maintenance++;
        else result.unknown++;
    }
    return result;
});

// 상태가 바뀐 시점만 추림
export const importantEvents = computed(() => {
    const events = [];
    for (const [id, list] of Object.entries(store.heartbeats)) {
        for (let i = 0; i < list.length; i++) {
            if (i === 0 || list[i].status !== list[i - 1].status) {
                events.push({ ...list[i], siteId: Number(id) });
            }
        }
    }
    return events.sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 20);
});

export async function addSite(data) {
    const site = await api.createSite(data);
    store.sites[site.id] = site;
    store.heartbeats[site.id] ||= [];
    return site;
}

export async function editSite(id, data) {
    const prev = store.sites[id];
    const site = await api.updateSite(id, { ...prev, ...data }, prev);
    store.sites[id] = site;
    return site;
}

export async function removeSite(id) {
    await api.deleteSite(id);
    delete store.sites[id];
    delete store.heartbeats[id];
}

// 미방문 사이트 정리 화면용 후보 목록
export const getUnvisitedSites = (days) => api.getUnvisitedSites(days);

// http 사이트만 새 탭으로 열 수 있음 (ping/tcp 는 주소가 웹페이지가 아님)
export function canOpen(site) {
    return site.type === "http";
}

export async function visit(site) {
    if (!canOpen(site)) return;
    window.open(site.url, "_blank", "noopener");
    store.sites[site.id] = await api.visitSite(site.id, site);
}

export async function toggleLogin(site) {
    const fn = site.autoLogin.loggedIn ? api.remoteLogout : api.remoteLogin;
    store.sites[site.id] = await fn(site.id, site);
}
