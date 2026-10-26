<!--
    Based on Uptime Kuma src/pages/DashboardHome.vue (MIT, Copyright (c) 2021 Louis Lam)
    원본 구성: 상단 "Quick Stats" 카드 + 하단 최근 이벤트 표
    우리 구성: Quick Stats 카드 + 사이트 목록(MonitorList) + 최근 상태 변화 표
    변경점: $root.stats / $root.monitorList → store, $t → 한국어, 페이지네이션·이벤트 삭제 제거
-->
<template>
    <transition name="slide-fade" appear>
        <div>
            <div v-if="store.error" class="alert alert-danger">{{ store.error }}</div>
            <div v-if="toast" class="alert alert-warning py-2">{{ toast }}</div>

            <h1 class="mb-3">한눈에 보기</h1>

            <div class="shadow-box big-padding text-center mb-4">
                <div class="row">
                    <div class="col">
                        <h3>정상</h3>
                        <span class="num" :class="stats.up === 0 && 'text-secondary'">{{ stats.up }}</span>
                    </div>
                    <div class="col">
                        <h3>다운</h3>
                        <span class="num" :class="stats.down > 0 ? 'text-danger' : 'text-secondary'">
                            {{ stats.down }}
                        </span>
                    </div>
                    <div class="col">
                        <h3>대기</h3>
                        <span class="num" :class="stats.pending > 0 ? 'text-warning' : 'text-secondary'">
                            {{ stats.pending }}
                        </span>
                    </div>
                    <div class="col">
                        <h3>알 수 없음</h3>
                        <span class="num text-secondary">{{ stats.unknown }}</span>
                    </div>
                    <div class="col">
                        <h3>일시정지</h3>
                        <span class="num text-secondary">{{ stats.pause }}</span>
                    </div>
                </div>
            </div>

            <h2 class="mb-3">자주 가는 사이트</h2>
            <div v-if="store.loading" class="text-secondary mb-3">불러오는 중…</div>
            <MonitorList v-else @add="showAdd = true" @delete="onDelete" @error="showToast" />

            <h2 class="mb-3 mt-4">최근 상태 변화</h2>
            <div class="shadow-box table-wrapper">
                <table class="table table-borderless table-hover mb-0">
                    <thead>
                        <tr>
                            <th class="name-column">이름</th>
                            <th>상태</th>
                            <th>시간</th>
                            <th>메시지</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(beat, index) in importantEvents" :key="index">
                            <td class="name-column">{{ store.sites[beat.siteId]?.name }}</td>
                            <td><Status :status="beat.status" /></td>
                            <td>{{ formatTime(beat.time) }}</td>
                            <td>{{ beat.msg }}</td>
                        </tr>
                        <tr v-if="importantEvents.length === 0">
                            <td colspan="4" class="text-center text-secondary">기록이 없습니다.</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <AddSiteDialog v-model="showAdd" />
        </div>
    </transition>
</template>

<script>
import dayjs from "dayjs";
import Status from "../components/Status.vue";
import MonitorList from "../components/MonitorList.vue";
import AddSiteDialog from "../components/AddSiteDialog.vue";
import { store, stats, importantEvents, removeSite } from "../stores/monitorStore.js";

export default {
    components: { Status, MonitorList, AddSiteDialog },

    data() {
        return { showAdd: false, toast: null };
    },

    computed: {
        store: () => store,
        stats: () => stats.value,
        importantEvents: () => importantEvents.value,
    },

    methods: {
        formatTime(t) {
            return dayjs(t).format("MM-DD HH:mm:ss");
        },

        showToast(msg) {
            this.toast = msg;
            setTimeout(() => (this.toast = null), 4000);
        },

        async onDelete(site) {
            if (!confirm(`'${site.name}' 사이트를 삭제할까요?`)) return;
            try {
                await removeSite(site.id);
            } catch (e) {
                this.showToast("삭제 실패: " + e.message);
            }
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

h3 {
    font-size: 1.1rem;
}

.num {
    font-size: 30px;
    color: $primary;
    font-weight: bold;
    display: block;
}

.shadow-box {
    padding: 20px;
}

table {
    font-size: 14px;
}

.name-column {
    min-width: 150px;
}

.table-wrapper {
    overflow-x: auto;
}
</style>
