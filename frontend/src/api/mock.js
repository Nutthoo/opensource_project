// VITE_USE_MOCK=true 일 때 쓰는 테스트 데이터 (백엔드 응답과 같은 모양을 흉내냄)
import { DOWN, UP, PENDING } from "../util.js";

let nextId = 7;
const now = () => new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

const sites = [
    { id: 1, name: "Google", url: "https://www.google.com", type: "http", port: null, interval: 60, active: true, visitCount: 42, lastVisitedAt: daysAgo(0), autoLogin: { enabled: true, loggedIn: true }, uptime24: 0.998 },
    { id: 2, name: "GitHub", url: "https://github.com", type: "http", port: null, interval: 60, active: true, visitCount: 35, lastVisitedAt: daysAgo(1), autoLogin: { enabled: true, loggedIn: false }, uptime24: 1 },
    { id: 3, name: "네이버", url: "https://www.naver.com", type: "http", port: null, interval: 60, active: true, visitCount: 18, lastVisitedAt: daysAgo(2), autoLogin: { enabled: false, loggedIn: false }, uptime24: 0.97 },
    { id: 4, name: "팀 디스코드", url: "https://discord.com", type: "http", port: null, interval: 60, active: true, visitCount: 7, lastVisitedAt: daysAgo(5), autoLogin: { enabled: false, loggedIn: false }, uptime24: 0.912 },
    { id: 5, name: "학과 DB 서버", url: "tcp://db.example.com:3306", type: "tcp", port: 3306, interval: 60, active: true, visitCount: 3, lastVisitedAt: daysAgo(10), autoLogin: { enabled: false, loggedIn: false }, uptime24: 1 },
    { id: 6, name: "예전 과제 사이트", url: "https://example.com", type: "http", port: null, interval: 60, active: false, visitCount: 1, lastVisitedAt: daysAgo(40), autoLogin: { enabled: false, loggedIn: false }, uptime24: 0.5 },
];

const heartbeats = {};

function randomStatus(siteId) {
    if (siteId === 4) return Math.random() < 0.25 ? DOWN : UP;
    if (siteId === 3) return Math.random() < 0.08 ? PENDING : UP;
    return Math.random() < 0.02 ? DOWN : UP;
}

function makeBeat(siteId, time) {
    const status = randomStatus(siteId);
    return {
        siteId,
        status,
        time,
        ping: status === UP ? Math.round(40 + Math.random() * 200) : null,
        msg: status === DOWN ? "connect ETIMEDOUT" : status === PENDING ? "응답 지연" : "200 OK",
    };
}

for (const s of sites) {
    heartbeats[s.id] = [];
    if (!s.active) continue;
    for (let i = 60; i > 0; i--) {
        heartbeats[s.id].push(makeBeat(s.id, new Date(Date.now() - i * 60000).toISOString()));
    }
}

const delay = (v) => new Promise((r) => setTimeout(() => r(structuredClone(v)), 150));
const fail = (msg) => new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), 150));
const find = (id) => sites.find((x) => x.id === Number(id));

export const getSites = () => delay(sites);

export const getHeartbeats = (limit) => {
    const out = {};
    for (const id in heartbeats) out[id] = heartbeats[id].slice(-limit);
    return delay(out);
};

export const createSite = (data) => {
    if (sites.some((s) => s.url === data.url)) return fail("이미 등록된 URL입니다");
    const site = {
        id: nextId++,
        name: data.name,
        url: data.url,
        type: data.type || "http",
        port: data.type === "tcp" ? Number(data.port) : null,
        interval: data.interval || 60,
        active: true,
        visitCount: 0,
        lastVisitedAt: null,
        createdAt: now(),
        autoLogin: { enabled: Boolean(data.autoLogin?.enabled), loggedIn: false },
        uptime24: null,
    };
    sites.push(site);
    heartbeats[site.id] = [];
    return delay(site);
};

export const updateSite = (id, data) => {
    const s = find(id);
    if (!s) return fail("사이트를 찾을 수 없습니다");
    if (sites.some((x) => x.id !== s.id && x.url === data.url)) return fail("이미 등록된 URL입니다");
    Object.assign(s, {
        name: data.name,
        url: data.url,
        type: data.type || s.type,
        port: data.type === "tcp" ? Number(data.port) : null,
        interval: data.interval || s.interval,
    });
    if (data.autoLogin) {
        s.autoLogin.enabled = Boolean(data.autoLogin.enabled);
        if (!s.autoLogin.enabled) s.autoLogin.loggedIn = false;
    }
    return delay(s);
};

export const deleteSite = (id) => {
    const i = sites.findIndex((x) => x.id === Number(id));
    if (i < 0) return fail("사이트를 찾을 수 없습니다");
    sites.splice(i, 1);
    delete heartbeats[id];
    return delay(null);
};

// 백엔드 GET /sites/unvisited 와 같은 규칙: 마지막 방문(없으면 등록일)이 days 일보다 오래된 사이트, 오래된 순
export const getUnvisitedSites = (days) => {
    const limit = Date.now() - days * 86400000;
    const since = (s) => new Date(s.lastVisitedAt ?? s.createdAt ?? now()).getTime();
    return delay(sites.filter((s) => since(s) < limit).sort((a, b) => since(a) - since(b)));
};

export const visitSite = (id) => {
    const s = find(id);
    if (!s) return fail("사이트를 찾을 수 없습니다");
    s.visitCount++;
    s.lastVisitedAt = now();
    return delay(s);
};

function setLoggedIn(id, value) {
    const s = find(id);
    if (!s) return fail("사이트를 찾을 수 없습니다");
    if (!s.autoLogin.enabled) return fail("자동 로그인이 켜져 있지 않은 사이트입니다");
    s.autoLogin.loggedIn = value;
    return delay(s);
}

export const remoteLogin = (id) => setLoggedIn(id, true);
export const remoteLogout = (id) => setLoggedIn(id, false);

// socket heartbeat 이벤트 대신 3초마다 생성
export function subscribe(onHeartbeat) {
    const timer = setInterval(() => {
        const active = sites.filter((s) => s.active);
        if (!active.length) return;
        const s = active[Math.floor(Math.random() * active.length)];
        const beat = makeBeat(s.id, now());
        heartbeats[s.id].push(beat);
        onHeartbeat(structuredClone(beat));
    }, 3000);
    return () => clearInterval(timer);
}
