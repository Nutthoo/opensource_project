import { reactive, computed } from "vue";
import { io } from "socket.io-client";
import * as api from "../api/client.js";
import { toBeat, toSite } from "../api/adapter.js";
import { DOWN, UP, PENDING, MAINTENANCE } from "../util.js";

const MAX_BEATS = 100;
const POLL_MS = 30000;

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
let warnedVisit = false;

function pushBeat(raw) {
    const beat = toBeat(raw);
    const list = (store.heartbeats[beat.siteId] ||= []);
    list.push(beat);
    if (list.length > MAX_BEATS) list.splice(0, list.length - MAX_BEATS);
}

async function loadHeartbeats() {
    try {
        store.heartbeats = await api.getHeartbeats(MAX_BEATS);
    } catch (e) {
        console.warn("상태 기록을 불러오지 못했습니다:", e.message);
    }
}

export async function refresh() {
    try {
        const sites = await api.getSites();
        store.sites = Object.fromEntries(sites.map((s) => [s.id, s]));
        store.connected = true;
        store.error = null;
    } catch (e) {
        store.connected = false;
        store.error = "사이트 목록을 불러오지 못했습니다: " + e.message;
    } finally {
        store.loading = false;
    }
    await loadHeartbeats();
}

export async function init() {
    await refresh();

    if (api.USE_MOCK) {
        unsubscribeMock = api.subscribeMock(pushBeat);
        return;
    }

    if (!api.USE_SOCKET) {
        // 소켓 미사용 시 polling
        pollTimer = setInterval(loadHeartbeats, POLL_MS);
        return;
    }

    socket = io({ path: "/socket.io" });
    socket.on("heartbeat", pushBeat);
    socket.on("siteUpdated", (raw) => (store.sites[raw.id] = toSite(raw, store.sites[raw.id])));
    socket.on("siteDeleted", ({ id }) => {
        delete store.sites[id];
        delete store.heartbeats[id];
    });
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
    // PUT /sites/:id 는 name, url 둘 다 필요
    store.sites[id] = await api.updateSite(id, { ...store.sites[id], ...data });
}

export async function removeSite(id) {
    await api.deleteSite(id);
    delete store.sites[id];
    delete store.heartbeats[id];
}

export async function visit(site) {
    window.open(site.url, "_blank", "noopener");
    try {
        store.sites[site.id] = await api.visitSite(site.id, site);
    } catch (e) {
        if (!e.notImplemented) throw e;

        // TODO: 백엔드 visit API 생기면 제거
        const s = store.sites[site.id];
        s.visitCount++;
        s.lastVisitedAt = new Date().toISOString();
        if (!warnedVisit) {
            warnedVisit = true;
            throw new Error("백엔드에 방문 기록 기능이 아직 없어서, 방문 횟수는 화면에만 반영돼요. (새로고침하면 사라짐)");
        }
    }
}

export async function toggleLogin(site) {
    const fn = site.autoLogin.loggedIn ? api.remoteLogout : api.remoteLogin;
    try {
        store.sites[site.id] = await fn(site.id, site);
    } catch (e) {
        if (e.notImplemented) throw new Error("백엔드에 자동로그인 기능이 아직 없어요.");
        throw e;
    }
}
