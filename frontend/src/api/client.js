import * as mock from "./mock.js";
import { toSite, toHeartbeatMap } from "./adapter.js";

const env = import.meta.env || {};

export const USE_MOCK = env.VITE_USE_MOCK === "true";
export const USE_SOCKET = env.VITE_USE_SOCKET === "true";
const API_BASE = env.VITE_API_BASE || "/api";

async function request(method, path, body) {
    const res = await fetch(API_BASE + path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return null;

    let data = null;
    try {
        data = await res.json();
    } catch {
        // non-JSON response
    }

    if (!res.ok) {
        const err = new Error(data?.error || `${res.status} ${res.statusText}`);
        err.status = res.status;
        throw err;
    }

    return data;
}

// 백엔드로 보내는 사이트 필드 (name, url 필수 / type: http|ping|tcp / tcp 는 port 필수)
// interval 은 백엔드가 아직 저장하지 않지만 나중을 위해 같이 보냄
function toBody(site) {
    return {
        name: site.name,
        url: site.url,
        type: site.type,
        port: site.type === "tcp" ? site.port : undefined,
        interval: site.interval,
        autoLogin: { enabled: Boolean(site.autoLogin?.enabled) },
    };
}

// sites
export async function getSites() {
    const list = USE_MOCK ? await mock.getSites() : await request("GET", "/sites");
    return list.map((raw) => toSite(raw));
}

export async function createSite(site) {
    const raw = USE_MOCK ? await mock.createSite(toBody(site)) : await request("POST", "/sites", toBody(site));
    return toSite(raw);
}

// PUT 은 name, url 이 필수라서 항상 전체 필드를 보냄. 응답에 없는 값(uptime 등)은 prev 로 유지
export async function updateSite(id, site, prev) {
    const raw = USE_MOCK ? await mock.updateSite(id, toBody(site)) : await request("PUT", `/sites/${id}`, toBody(site));
    return toSite(raw, prev);
}

export const deleteSite = (id) => (USE_MOCK ? mock.deleteSite(id) : request("DELETE", `/sites/${id}`));

// days 일 넘게 방문하지 않은 사이트 (한 번도 방문 안 했으면 등록일 기준), 오래된 순
export async function getUnvisitedSites(days) {
    const list = USE_MOCK ? await mock.getUnvisitedSites(days) : await request("GET", `/sites/unvisited?days=${days}`);
    return list.map((raw) => toSite(raw));
}

// 방문 기록 (visit_count + 1, last_visited_at 갱신)
export async function visitSite(id, prev) {
    const raw = USE_MOCK ? await mock.visitSite(id) : await request("POST", `/sites/${id}/visit`);
    return toSite(raw, prev);
}

// 사이트별 최근 상태 기록 (site_status)
export async function getHeartbeats(limit = 100) {
    const data = USE_MOCK ? await mock.getHeartbeats(limit) : await request("GET", `/heartbeats?limit=${limit}`);
    return toHeartbeatMap(data);
}

// 원격 로그인 / 로그아웃 (자동 로그인이 켜진 사이트만)
export async function remoteLogin(id, prev) {
    const raw = USE_MOCK ? await mock.remoteLogin(id) : await request("POST", `/sites/${id}/login`);
    return toSite(raw, prev);
}

export async function remoteLogout(id, prev) {
    const raw = USE_MOCK ? await mock.remoteLogout(id) : await request("POST", `/sites/${id}/logout`);
    return toSite(raw, prev);
}

export const subscribeMock = mock.subscribe;
