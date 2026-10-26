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

// POST/PUT 응답은 {id, name, url} 만 오므로 나머지는 prev 로 채움
export function toSite(raw, prev = {}) {
    const visit = pick(raw, "visitCount", "visit_count");
    const active = pick(raw, "active");

    return {
        id: Number(raw.id ?? prev.id),
        name: raw.name ?? prev.name ?? "",
        url: raw.url ?? prev.url ?? "",
        type: raw.type ?? prev.type ?? "http",
        interval: raw.interval ?? prev.interval ?? 60,
        active: active !== undefined ? Boolean(active) : (prev.active ?? true),
        visitCount: visit !== undefined ? Number(visit) : (prev.visitCount ?? 0),
        lastVisitedAt: toISO(pick(raw, "lastVisitedAt", "last_visited_at")) ?? prev.lastVisitedAt ?? null,
        // TODO: 자동로그인 컬럼 정해지면 수정
        autoLogin: raw.autoLogin ?? prev.autoLogin ?? { enabled: false, loggedIn: false },
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
