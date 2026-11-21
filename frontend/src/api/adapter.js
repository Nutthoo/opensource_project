// 백엔드 응답(snake_case) -> 프론트 모델(camelCase)
import { DOWN, UP, PENDING, MAINTENANCE } from "../util.js";

function pick(obj, ...keys) {
    for (const k of keys) {
        if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return undefined;
}

// SQLite CURRENT_TIMESTAMP 는 UTC 인데 'Z' 가 없음
export function toISO(t) {
    if (!t) return null;
    if (typeof t === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(t)) {
        return t.replace(" ", "T") + "Z";
    }
    return t;
}

// site_status.status 가 TEXT 라서 숫자/문자 모두 허용
const STATUS_WORDS = {
    up: UP,
    ok: UP,
    online: UP,
    down: DOWN,
    fail: DOWN,
    error: DOWN,
    offline: DOWN,
    pending: PENDING,
    maintenance: MAINTENANCE,
};

export function toStatus(s) {
    if (typeof s === "number") return s;
    if (s === undefined || s === null) return -1;
    const key = String(s).trim().toLowerCase();
    if (/^\d+$/.test(key)) return Number(key);
    return STATUS_WORDS[key] ?? -1;
}

// 확인 방식: http | ping | tcp (예전 값 "port" 는 tcp 로 취급)
export function toType(t) {
    if (t === "port") return "tcp";
    return t === "tcp" || t === "ping" ? t : "http";
}

// 사이트 1건. 단건 응답(POST/PUT/visit/login)에는 uptime_24 가 없어서 prev 값으로 채움
export function toSite(raw, prev = {}) {
    const visit = pick(raw, "visitCount", "visit_count");
    const active = pick(raw, "active");
    // http/ping 은 port 가 null 로 오므로 pick 대신 키 존재 여부로 판단
    const port = "port" in raw ? (raw.port == null ? null : Number(raw.port)) : (prev.port ?? null);

    return {
        id: Number(raw.id ?? prev.id),
        name: raw.name ?? prev.name ?? "",
        url: raw.url ?? prev.url ?? "",
        type: toType(raw.type ?? prev.type),
        port,
        interval: raw.interval ?? prev.interval ?? 60,
        active: active !== undefined ? Boolean(active) : (prev.active ?? true),
        visitCount: visit !== undefined ? Number(visit) : (prev.visitCount ?? 0),
        lastVisitedAt: toISO(pick(raw, "lastVisitedAt", "last_visited_at")) ?? prev.lastVisitedAt ?? null,
        createdAt: toISO(pick(raw, "createdAt", "created_at")) ?? prev.createdAt ?? null,
        autoLogin: {
            enabled: Boolean(raw.autoLogin?.enabled ?? prev.autoLogin?.enabled ?? false),
            loggedIn: Boolean(raw.autoLogin?.loggedIn ?? prev.autoLogin?.loggedIn ?? false),
            hasCredentials: Boolean(raw.autoLogin?.hasCredentials ?? prev.autoLogin?.hasCredentials ?? false),
            username: raw.autoLogin?.username ?? prev.autoLogin?.username ?? "",
            loginUrl: raw.autoLogin?.loginUrl ?? prev.autoLogin?.loginUrl ?? "",
            userSelector: raw.autoLogin?.userSelector ?? prev.autoLogin?.userSelector ?? "",
            passSelector: raw.autoLogin?.passSelector ?? prev.autoLogin?.passSelector ?? "",
            submitSelector: raw.autoLogin?.submitSelector ?? prev.autoLogin?.submitSelector ?? "",
        },
        uptime24: pick(raw, "uptime24", "uptime_24") ?? prev.uptime24 ?? null,
    };
}

export function toBeat(raw) {
    return {
        siteId: Number(pick(raw, "siteId", "site_id")),
        status: toStatus(raw.status),
        time: toISO(pick(raw, "time", "checked_at")),
        ping: pick(raw, "ping", "response_time") ?? null,
        msg: pick(raw, "msg", "message") ?? "",
    };
}

// 배열(site_status rows) 또는 { siteId: [...] } 둘 다 처리
export function toHeartbeatMap(data) {
    const rows = Array.isArray(data)
        ? data
        : Object.entries(data || {}).flatMap(([id, list]) => list.map((b) => ({ site_id: Number(id), ...b })));

    const map = {};
    for (const beat of rows.map(toBeat)) {
        (map[beat.siteId] ||= []).push(beat);
    }
    for (const list of Object.values(map)) {
        list.sort((a, b) => new Date(a.time) - new Date(b.time));
    }
    return map;
}