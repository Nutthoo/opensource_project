<!--
    Based on Uptime Kuma src/components/HeartbeatBar.vue (MIT, Copyright (c) 2021 Louis Lam)

    최신 Uptime Kuma(2.x)의 HeartbeatBar 는 <canvas> 로 그리는 850줄짜리 컴포넌트라
    $root 의존성이 많아 그대로 쓰기 어렵습니다. 그래서 같은 모양(알약 모양 막대,
    색상 규칙, hover 확대, 시간 표시)을 내던 1.x 버전의 div 방식으로 다시 구성했습니다.
    변경점:
      - $root.heartbeatList[id] → store.heartbeats[id]
      - $root.isMobile / styleElapsedTime 설정 제거
      - 막대 개수는 ResizeObserver 로 너비에 맞춰 자동 계산
-->
<template>
    <div ref="wrap" class="wrap">
        <div class="hp-bar-big">
            <div
                v-for="(beat, index) in shortBeatList"
                :key="index"
                class="beat"
                :class="beatClass(beat)"
                :style="beatStyle"
                :title="beatTitle(beat)"
            />
        </div>
        <div
            v-if="size !== 'small' && beatList.length > 4"
            class="d-flex justify-content-between align-items-center word"
        >
            <div>{{ timeSinceFirstBeat }}</div>
            <div class="connecting-line"></div>
            <div>{{ timeSinceLastBeat }}</div>
        </div>
    </div>
</template>

<script>
import dayjs from "dayjs";
import { DOWN, UP, PENDING, MAINTENANCE } from "../util.js";
import { store } from "../stores/monitorStore.js";

export default {
    props: {
        /** Size of the heartbeat bar: "big" | "mid" | "small" */
        size: {
            type: String,
            default: "big",
        },
        /** ID of the monitor(site) */
        monitorId: {
            type: Number,
            required: true,
        },
    },

    data() {
        return {
            beatWidth: 10,
            beatHeight: 30,
            beatHoverAreaPadding: 4,
            maxBeat: 0,
            resizeObserver: null,
        };
    },

    computed: {
        beatList() {
            return store.heartbeats[this.monitorId] || [];
        },

        /** 너비에 들어가는 만큼만 최신 기록을 보여주고, 모자라면 앞을 빈 칸(0)으로 채움 */
        shortBeatList() {
            if (!this.maxBeat) return [];
            const list = this.beatList.slice(-this.maxBeat);
            const empty = new Array(Math.max(0, this.maxBeat - list.length)).fill(0);
            return [...empty, ...list];
        },

        beatStyle() {
            return {
                width: this.beatWidth + "px",
                height: this.beatHeight + "px",
                margin: this.beatHoverAreaPadding + "px " + this.beatHoverAreaPadding / 2 + "px",
            };
        },

        timeSinceFirstBeat() {
            const first = this.beatList.slice(-this.maxBeat)[0];
            if (!first) return "";
            const minutes = dayjs().diff(dayjs(first.time), "minute");
            return minutes > 60 ? Math.round(minutes / 60) + "시간 전" : minutes + "분 전";
        },

        timeSinceLastBeat() {
            const last = this.beatList[this.beatList.length - 1];
            if (!last) return "";
            const seconds = dayjs().diff(dayjs(last.time), "second");
            return seconds < 120 ? "지금" : Math.round(seconds / 60) + "분 전";
        },
    },

    watch: {
        size: {
            immediate: true,
            handler(size) {
                // Uptime Kuma 원본과 같은 크기 규칙
                if (size === "small") {
                    this.beatWidth = 5;
                    this.beatHeight = 16;
                    this.beatHoverAreaPadding = 2;
                } else if (size === "mid") {
                    this.beatWidth = 8;
                    this.beatHeight = 24;
                    this.beatHoverAreaPadding = 3;
                } else {
                    this.beatWidth = 10;
                    this.beatHeight = 30;
                    this.beatHoverAreaPadding = 4;
                }
                this.$nextTick(this.resize);
            },
        },
    },

    mounted() {
        this.resizeObserver = new ResizeObserver(this.resize);
        this.resizeObserver.observe(this.$refs.wrap);
        this.resize();
    },

    beforeUnmount() {
        this.resizeObserver?.disconnect();
    },

    methods: {
        resize() {
            if (!this.$refs.wrap) return;
            const one = this.beatWidth + this.beatHoverAreaPadding;
            this.maxBeat = Math.max(0, Math.floor(this.$refs.wrap.clientWidth / one));
        },

        beatClass(beat) {
            if (beat === 0) return "empty";
            if (beat.status === DOWN) return "down";
            if (beat.status === PENDING) return "pending";
            if (beat.status === MAINTENANCE) return "maintenance";
            if (beat.status === UP) return "";
            return "empty";
        },

        beatTitle(beat) {
            if (beat === 0) return "";
            const time = dayjs(beat.time).format("YYYY-MM-DD HH:mm:ss");
            const ping = beat.ping != null ? ` (${beat.ping}ms)` : "";
            return `${time}${ping}${beat.msg ? " - " + beat.msg : ""}`;
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.wrap {
    overflow: hidden;
    width: 100%;
    white-space: nowrap;
}

.hp-bar-big {
    white-space: nowrap;

    .beat {
        display: inline-block;
        background-color: $primary;
        border-radius: $border-radius;

        &.empty {
            background-color: aliceblue;
        }

        &.down {
            background-color: $danger;
        }

        &.pending {
            background-color: $warning;
        }

        &.maintenance {
            background-color: $maintenance;
        }

        &:not(.empty):hover {
            transition: all ease-in-out 0.15s;
            opacity: 0.8;
            transform: scale(1.5);
        }
    }
}

.word {
    color: $secondary-text;
    font-size: 12px;
}

.connecting-line {
    flex-grow: 1;
    height: 1px;
    background-color: #ededed;
    margin-left: 10px;
    margin-right: 10px;
    margin-top: 2px;
}
</style>
