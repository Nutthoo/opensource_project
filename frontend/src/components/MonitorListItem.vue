<!--
    Ported from Uptime Kuma src/components/MonitorListItem.vue (MIT, Copyright (c) 2021 Louis Lam)
    변경점:
      - <router-link to="/dashboard/:id"> → 클릭 시 실제 사이트를 새 탭으로 열고 방문 횟수 기록 (http 사이트만)
      - 드래그&드롭 그룹, 선택 모드, 태그, 접기 기능 제거 (우리 프로젝트에 불필요)
      - 우리 기능 추가: 방문 횟수, 로그인 상태 표시(로그인됨 / 비로그인 시 공백),
        로그인·로그아웃 / 그래프 / 수정 / 삭제 버튼, 펼쳐 보는 응답 속도 그래프(PingChart)
      - $root.userHeartbeatBar 설정 제거 (항상 오른쪽에 상태바 표시)
-->
<template>
    <div class="item" :class="{ disabled: !monitor.active, clickable: openable }" :role="openable ? 'button' : undefined" @click="onVisit">
        <div class="row align-items-center">
            <div class="col-12 col-md-6 small-padding d-flex gap-2 align-items-center">
                <div class="me-1">
                    <Uptime :monitor="monitor" :pill="true" />
                </div>

                <img v-if="favicon" class="favicon" :src="favicon" alt="" loading="lazy" @error="hideIcon" />
                <span v-else class="favicon type-icon" :title="typeLabel">{{ monitor.type === "tcp" ? "⇄" : "◎" }}</span>

                <div class="flex-fill text-truncate" style="min-width: 0">
                    <div class="text-truncate fw-semibold">
                        <span v-if="rank <= 3 && monitor.visitCount > 0" class="rank me-1">#{{ rank }}</span>
                        {{ monitor.name }}
                        <!-- 로그인 상태: 로그인됨일 때만 표시 (비로그인 시 공백) -->
                        <span v-if="monitor.autoLogin?.loggedIn" class="badge rounded-pill bg-primary ms-1 login-badge">로그인됨</span>
                    </div>
                    <div class="sub text-truncate">
                        <template v-if="monitor.type !== 'http'">{{ typeLabel }} · </template>
                        {{ host }} · 방문 {{ monitor.visitCount }}회
                        <template v-if="pingText"> · {{ pingText }}</template>
                    </div>
                </div>

                <!-- 로그인·로그아웃 / 그래프 / 수정 / 삭제 버튼 -->
                <div class="actions d-flex align-items-center">
                    <button
                        v-if="monitor.autoLogin?.enabled"
                        class="btn btn-sm btn-outline-secondary action-btn"
                        :disabled="busy"
                        @click.stop="onToggleLogin"
                    >
                        {{ monitor.autoLogin.loggedIn ? "로그아웃" : "로그인" }}
                    </button>
                    <button
                        class="btn btn-sm btn-link icon-btn"
                        :class="showChart ? 'text-primary' : 'text-secondary'"
                        :title="showChart ? '응답 속도 그래프 닫기' : '응답 속도 그래프'"
                        :aria-expanded="showChart"
                        @click.stop="showChart = !showChart"
                    >
                        📈
                    </button>
                    <button class="btn btn-sm btn-link text-secondary icon-btn" title="수정" @click.stop="$emit('edit', monitor)">✎</button>
                    <button class="btn btn-sm btn-link text-secondary icon-btn" title="삭제" @click.stop="$emit('delete', monitor)">✕</button>
                </div>
            </div>

            <div class="col-12 col-md-6 mt-2 mt-md-0">
                <HeartbeatBar size="small" :monitor-id="monitor.id" />
            </div>
        </div>

        <!-- 응답 속도 그래프 (📈 버튼으로 펼치기) -->
        <div v-if="showChart" class="chart-row" @click.stop>
            <PingChart :monitor-id="monitor.id" />
        </div>
    </div>
</template>

<script>
import { defineAsyncComponent, h } from "vue";
import HeartbeatBar from "./HeartbeatBar.vue";
import Uptime from "./Uptime.vue";
import { lastBeat, visit, toggleLogin, canOpen } from "../stores/monitorStore.js";

// 그래프는 펼칠 때만 불러옴 (chart.js 가 설치되지 않은 PC 에서도 나머지 화면은 동작하도록)
const PingChart = defineAsyncComponent({
    loader: () => import("./PingChart.vue"),
    loadingComponent: { render: () => h("div", { class: "chart-message" }, "그래프 불러오는 중…") },
    errorComponent: {
        render: () => h("div", { class: "chart-message" }, "그래프를 불러오지 못했습니다. frontend 폴더에서 npm install 을 실행해 주세요."),
    },
});

const TYPE_LABELS = { http: "HTTP", ping: "Ping", tcp: "TCP" };

export default {
    components: { HeartbeatBar, Uptime, PingChart },

    props: {
        /** Monitor(site) this represents */
        monitor: {
            type: Object,
            required: true,
        },
        /** 목록에서의 순위 (1부터) */
        rank: {
            type: Number,
            default: 99,
        },
    },

    emits: ["edit", "delete", "error"],

    data() {
        return { busy: false, showChart: false };
    },

    computed: {
        openable() {
            return canOpen(this.monitor);
        },

        typeLabel() {
            return TYPE_LABELS[this.monitor.type] || this.monitor.type;
        },

        host() {
            try {
                return new URL(this.monitor.url).host || this.monitor.url;
            } catch {
                return this.monitor.url;
            }
        },

        // 웹사이트(http)만 파비콘이 있음
        favicon() {
            if (this.monitor.type !== "http") return "";
            try {
                return new URL(this.monitor.url).origin + "/favicon.ico";
            } catch {
                return "";
            }
        },

        pingText() {
            const beat = lastBeat(this.monitor.id);
            return beat?.ping != null ? beat.ping + "ms" : "";
        },
    },

    methods: {
        hideIcon(e) {
            e.target.style.visibility = "hidden";
        },

        async onVisit() {
            if (!this.openable) return;
            try {
                await visit(this.monitor);
            } catch (e) {
                this.$emit("error", "방문 기록 실패: " + e.message);
            }
        },

        async onToggleLogin() {
            this.busy = true;
            try {
                await toggleLogin(this.monitor);
            } catch (e) {
                this.$emit("error", e.message);
            } finally {
                this.busy = false;
            }
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.item {
    cursor: default;

    &.clickable {
        cursor: pointer;
    }
}

.small-padding {
    padding-left: 5px !important;
    padding-right: 5px !important;
}

.favicon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
}

.type-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: $secondary-text;
}

.sub {
    font-size: 12px;
    color: $secondary-text;
}

.rank {
    color: $primary;
    font-weight: bold;
}

.login-badge {
    font-size: 11px;
    font-weight: 500;
    vertical-align: middle;
}

.actions {
    gap: 2px;
    flex-shrink: 0;
}

.action-btn {
    font-size: 12px;
    padding: 2px 10px;
    white-space: nowrap;
}

.icon-btn {
    padding: 0 6px;
    text-decoration: none;
}

.item.disabled {
    opacity: 0.4;
}

.chart-row {
    cursor: default;
    margin-top: 10px;
    border-top: 1px solid #f0f0f0;
}

// defineAsyncComponent 의 로딩/오류 문구 (자식 컴포넌트라 :deep 사용)
:deep(.chart-message) {
    padding: 30px 0;
    text-align: center;
    font-size: 13px;
    color: $secondary-text;
}
</style>
