<!--
    미방문 사이트 정리 창 (제안서 1-f: 자주 방문하지 않는 사이트는 정리)
    - GET /sites/unvisited?days=N 으로 N일 넘게 방문하지 않은 사이트를 받아서 보여주고
    - 사용자가 고른 사이트만 DELETE /sites/:id 로 삭제
    (서버의 자동 삭제는 UNVISITED_DELETE_DAYS 를 정해야 켜짐. 이 창은 직접 확인하고 지우는 용도)
-->
<template>
    <div v-if="modelValue" class="modal d-block" tabindex="-1" @click.self="close">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">미방문 사이트 정리</h5>
                    <button type="button" class="btn-close" aria-label="닫기" @click="close"></button>
                </div>

                <div class="modal-body">
                    <div class="d-flex align-items-center gap-2 mb-3">
                        <select v-model.number="days" class="form-select days-select" :disabled="loading || deleting" @change="load">
                            <option v-for="d in DAY_OPTIONS" :key="d" :value="d">{{ d }}일</option>
                        </select>
                        <span>넘게 방문하지 않은 사이트</span>
                    </div>

                    <div v-if="error" class="alert alert-danger py-2">{{ error }}</div>
                    <div v-if="loading" class="text-secondary py-4 text-center">불러오는 중…</div>
                    <div v-else-if="sites.length === 0" class="text-secondary py-4 text-center">
                        {{ days }}일 넘게 방문하지 않은 사이트가 없습니다.
                    </div>

                    <table v-else class="table table-hover align-middle mb-0">
                        <thead>
                            <tr>
                                <th class="check-col">
                                    <input class="form-check-input" type="checkbox" :checked="allChecked" :disabled="deleting" aria-label="전체 선택" @change="toggleAll" />
                                </th>
                                <th>이름</th>
                                <th>방문</th>
                                <th>마지막 방문</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="site in sites" :key="site.id" @click="!deleting && toggle(site.id)">
                                <td class="check-col">
                                    <input class="form-check-input" type="checkbox" :checked="selected.has(site.id)" :disabled="deleting" :aria-label="site.name + ' 선택'" @click.stop @change="toggle(site.id)" />
                                </td>
                                <td>
                                    <div class="fw-semibold">{{ site.name }}</div>
                                    <div class="sub">{{ site.url }}</div>
                                </td>
                                <td>{{ site.visitCount }}회</td>
                                <td>
                                    <template v-if="site.lastVisitedAt">{{ formatDate(site.lastVisitedAt) }} ({{ daysAgo(site.lastVisitedAt) }}일 전)</template>
                                    <span v-else class="text-secondary">방문 기록 없음 (등록 {{ daysAgo(site.createdAt) }}일 전)</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="modal-footer">
                    <span v-if="confirming" class="me-auto text-danger small">삭제하면 상태 기록도 함께 지워지고 되돌릴 수 없습니다.</span>
                    <button type="button" class="btn btn-outline-secondary" :disabled="deleting" @click="confirming ? (confirming = false) : close()">
                        {{ confirming ? "취소" : "닫기" }}
                    </button>
                    <button type="button" class="btn btn-danger" :disabled="selected.size === 0 || deleting" @click="onDelete">
                        <template v-if="deleting">삭제 중…</template>
                        <template v-else-if="confirming">정말 {{ selected.size }}개 삭제</template>
                        <template v-else>선택한 {{ selected.size }}개 삭제</template>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import dayjs from "dayjs";
import { getUnvisitedSites, removeSite } from "../stores/monitorStore.js";

const DAY_OPTIONS = [7, 14, 30, 60, 90, 180];

export default {
    props: {
        modelValue: { type: Boolean, default: false },
    },

    emits: ["update:modelValue", "deleted"],

    data() {
        return { DAY_OPTIONS, days: 30, sites: [], selected: new Set(), loading: false, deleting: false, confirming: false, error: null };
    },

    computed: {
        allChecked() {
            return this.sites.length > 0 && this.selected.size === this.sites.length;
        },
    },

    watch: {
        modelValue: {
            immediate: true,
            handler(open) {
                if (open) this.load();
            },
        },

        // 고른 사이트가 바뀌면 "정말 삭제" 확인 단계를 처음부터 다시
        "selected.size"() {
            this.confirming = false;
        },
    },

    methods: {
        close() {
            if (this.deleting) return;
            this.$emit("update:modelValue", false);
        },

        async load() {
            this.loading = true;
            this.error = null;
            this.confirming = false;
            this.selected = new Set();
            try {
                this.sites = await getUnvisitedSites(this.days);
            } catch (e) {
                this.sites = [];
                this.error = "목록을 불러오지 못했습니다: " + e.message;
            } finally {
                this.loading = false;
            }
        },

        toggle(id) {
            const next = new Set(this.selected);
            next.has(id) ? next.delete(id) : next.add(id);
            this.selected = next;
        },

        toggleAll() {
            this.selected = this.allChecked ? new Set() : new Set(this.sites.map((s) => s.id));
        },

        // 첫 클릭은 확인 단계, 두 번째 클릭에서 실제 삭제
        async onDelete() {
            if (!this.confirming) {
                this.confirming = true;
                return;
            }
            this.deleting = true;
            this.error = null;
            const ids = [...this.selected];
            const failed = [];
            for (const id of ids) {
                try {
                    await removeSite(id);
                } catch (e) {
                    const name = this.sites.find((s) => s.id === id)?.name ?? id;
                    failed.push(`${name} (${e.message})`);
                }
            }
            this.deleting = false;
            this.$emit("deleted", ids.length - failed.length);
            await this.load();
            if (failed.length) this.error = "삭제하지 못한 사이트: " + failed.join(", ");
        },

        formatDate(t) {
            return dayjs(t).format("YYYY-MM-DD");
        },

        daysAgo(t) {
            return t ? dayjs().diff(dayjs(t), "day") : "?";
        },
    },
};
</script>

<style scoped>
.modal {
    background: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(3px);
}

.days-select {
    width: auto;
}

.check-col {
    width: 40px;
}

tbody tr {
    cursor: pointer;
}

.sub {
    font-size: 12px;
    color: #6c757d;
    word-break: break-all;
}

table {
    font-size: 14px;
}
</style>
