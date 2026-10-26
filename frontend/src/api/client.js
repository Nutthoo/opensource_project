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
        const err = new Error(data?.error || data?.msg || `${res.status} ${res.statusText}`);
        err.status = res.status;
        // HTML 404 = 라우트 없음
        err.notImplemented = res.status === 404 && data === null;
        throw err;
    }

    return data;
}

// sites
export async function getSites() {
    const list = USE_MOCK ? await mock.getSites() : await request("GET", "/sites");
    return list.map((raw) => toSite(raw));
}

export async function createSite(site) {
    const raw = USE_MOCK ? await mock.createSite(site) : await request("POST", "/sites", site);
    return toSite(raw);
}

export async function updateSite(id, site) {
    const raw = USE_MOCK
        ? await mock.updateSite(id, site)
        : await request("PUT", `/sites/${id}`, { name: site.name, url: site.url });
    return toSite(raw, site);
}

export const deleteSite = (id) => (USE_MOCK ? mock.deleteSite(id) : request("DELETE", `/sites/${id}`));

// visit (TODO: backend)
export async function visitSite(id, prev) {
    const raw = USE_MOCK ? await mock.visitSite(id) : await request("POST", `/sites/${id}/visit`);
    return toSite(raw, prev);
}

// heartbeats (TODO: backend)
export async function getHeartbeats(limit = 100) {
    try {
        const data = USE_MOCK ? await mock.getHeartbeats(limit) : await request("GET", `/heartbeats?limit=${limit}`);
        return toHeartbeatMap(data);
    } catch (e) {
        if (e.notImplemented) return {};
        throw e;
    }
}

// auto login / logout (TODO: backend)
export async function remoteLogin(id, prev) {
    const raw = USE_MOCK ? await mock.remoteLogin(id) : await request("POST", `/sites/${id}/login`);
    return toSite(raw, prev);
}

export async function remoteLogout(id, prev) {
    const raw = USE_MOCK ? await mock.remoteLogout(id) : await request("POST", `/sites/${id}/logout`);
    return toSite(raw, prev);
}

export const subscribeMock = mock.subscribe;
