<!--
    Ported from Uptime Kuma src/components/MonitorListItem.vue (MIT, Copyright (c) 2021 Louis Lam)
    변경점:
      - <router-link to="/dashboard/:id"> → 클릭 시 실제 사이트를 새 탭으로 열고 방문 횟수 기록
      - 드래그&드롭 그룹, 선택 모드, 태그, 접기 기능 제거 (우리 프로젝트에 불필요)
      - 우리 기능 추가: 방문 횟수, 자동로그인 상태 배지, 원격 로그인/로그아웃, 삭제 버튼
      - $root.userHeartbeatBar 설정 제거 (항상 오른쪽에 상태바 표시)
-->
<template>
    <div class="item" :class="{ disabled: !monitor.active }" role="button" @click="onVisit">
        <div class="row align-items-center">
            <div class="col-12 col-md-6 small-padding d-flex gap-2 align-items-center">
                <div class="me-1">
                    <Uptime :monitor="monitor" :pill="true" />
                </div>

                <img class="favicon" :src="favicon" alt="" loading="lazy" @error="hideIcon" />

                <div class="flex-fill text-truncate" style="min-width: 0">
                    <div class="text-truncate fw-semibold">
                        <span v-if="rank <= 3 && monitor.visitCount > 0" class="rank me-1">#{{ rank }}</span>
                        {{ monitor.name }}
                    </div>
                    <div class="sub text-truncate">
                        {{ host }} · 방문 {{ monitor.visitCount }}회
                        <template v-if="pingText"> · {{ pingText }}</template>
                    </div>
                </div>

                <!-- 자동로그인 상태 + 원격 로그인/로그아웃 -->
                <button
                    v-if="monitor.autoLogin?.enabled"
                    class="btn btn-sm login-btn"
                    :class="monitor.autoLogin.loggedIn ? 'btn-outline-primary' : 'btn-outline-secondary'"
                    :disabled="busy"
                    :title="monitor.autoLogin.loggedIn ? '원격 로그아웃' : '자동 로그인'"
                    @click.stop="onToggleLogin"
                >
                    {{ monitor.autoLogin.loggedIn ? "로그인됨" : "로그아웃됨" }}
                </button>

                <button class="btn btn-sm btn-link text-secondary delete-btn" title="삭제" @click.stop="$emit('delete', monitor)">
                    ✕
                </button>
            </div>

            <div class="col-12 col-md-6 mt-2 mt-md-0">
                <HeartbeatBar size="small" :monitor-id="monitor.id" />
            </div>
        </div>
    </div>
</template>

<script>
import HeartbeatBar from "./HeartbeatBar.vue";
import Uptime from "./Uptime.vue";
import { lastBeat, visit, toggleLogin } from "../stores/monitorStore.js";

export default {
    components: { HeartbeatBar, Uptime },

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

    emits: ["delete", "error"],

    data() {
        return { busy: false };
    },

    computed: {
        host() {
            try {
                return new URL(this.monitor.url).host;
            } catch {
                return this.monitor.url;
            }
        },

        favicon() {
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
            try {
                await visit(this.monitor);
            } catch (e) {
                this.$emit("error", e.message);
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
    cursor: pointer;
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

.sub {
    font-size: 12px;
    color: $secondary-text;
}

.rank {
    color: $primary;
    font-weight: bold;
}

.login-btn {
    font-size: 12px;
    padding: 2px 10px;
    white-space: nowrap;
}

.delete-btn {
    padding: 0 6px;
    text-decoration: none;
    opacity: 0;
    transition: opacity 0.15s;
}

.item:hover .delete-btn {
    opacity: 1;
}

.item.disabled {
    opacity: 0.4;
}
</style>
