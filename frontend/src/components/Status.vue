<!--
    Ported from Uptime Kuma src/components/Status.vue (MIT, Copyright (c) 2021 Louis Lam)
    변경점: $t("Down") 같은 다국어 함수 → 한국어 문자열로 직접 교체
-->
<template>
    <span class="badge rounded-pill" :class="'bg-' + color">{{ text }}</span>
</template>

<script>
import { DOWN, UP, PENDING, MAINTENANCE } from "../util.js";

export default {
    props: {
        /** Current status of monitor */
        status: {
            type: Number,
            default: 0,
        },
    },

    computed: {
        color() {
            if (this.status === DOWN) return "danger";
            if (this.status === UP) return "primary";
            if (this.status === PENDING) return "warning";
            if (this.status === MAINTENANCE) return "maintenance";
            return "secondary";
        },

        text() {
            if (this.status === DOWN) return "다운";
            if (this.status === UP) return "정상";
            if (this.status === PENDING) return "대기";
            if (this.status === MAINTENANCE) return "점검";
            return "알 수 없음";
        },
    },
};
</script>

<style scoped>
span {
    min-width: 64px;
}
</style>
