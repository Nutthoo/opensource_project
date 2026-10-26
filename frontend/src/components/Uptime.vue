<!--
    Ported from Uptime Kuma src/components/Uptime.vue (MIT, Copyright (c) 2021 Louis Lam)
    변경점:
      - $root.uptimeList[id + "_24"]   → monitor.uptime24 (Express /api/sites 응답에 포함)
      - $root.lastHeartbeatList[id]    → lastBeat(id) (store)
      - $t(...) / $route 의존성 제거
-->
<template>
    <span :class="className" title="최근 24시간 가동률">{{ uptime }}</span>
</template>

<script>
import { DOWN, MAINTENANCE, PENDING, UP } from "../util.js";
import { lastBeat } from "../stores/monitorStore.js";

export default {
    props: {
        /** Monitor(site) this represents */
        monitor: {
            type: Object,
            default: null,
        },
        /** Is this a pill? */
        pill: {
            type: Boolean,
            default: false,
        },
    },

    computed: {
        uptime() {
            const value = this.monitor?.uptime24;
            if (value === null || value === undefined) return "N/A";

            const result = Math.round(value * 10000) / 100;
            return Math.min(result, 100) + "%";
        },

        color() {
            if (!this.monitor.active) return "secondary";

            const status = this.lastHeartBeat.status;
            if (status === MAINTENANCE) return "maintenance";
            if (status === DOWN) return "danger";
            if (status === UP) return "primary";
            if (status === PENDING) return "warning";
            return "secondary";
        },

        lastHeartBeat() {
            return lastBeat(this.monitor.id) || { status: -1 };
        },

        className() {
            return this.pill ? `badge rounded-pill bg-${this.color}` : "";
        },
    },
};
</script>
