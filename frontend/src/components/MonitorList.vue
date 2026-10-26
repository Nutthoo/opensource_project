<!--
    Based on Uptime Kuma src/components/MonitorList.vue (MIT, Copyright (c) 2021 Louis Lam)
    원본의 검색창 + 목록 카드(shadow-box) 레이아웃만 남기고,
    필터 드롭다운/일괄 선택/그룹 기능은 제거했습니다.
    정렬은 "방문 횟수 많은 순" (핵심 기능 1: 자주 방문하는 사이트 상단 배치)
-->
<template>
    <div class="shadow-box mb-3">
        <div class="list-header d-flex gap-2 align-items-center">
            <input
                v-model="searchText"
                class="form-control search-input"
                type="search"
                placeholder="사이트 이름 또는 주소 검색"
                autocomplete="off"
            />
            <button class="btn btn-primary text-nowrap" @click="$emit('add')">+ 사이트 추가</button>
        </div>

        <div class="monitor-list">
            <div v-if="filtered.length === 0" class="text-center text-secondary py-5">
                {{ searchText ? "검색 결과가 없습니다." : "등록된 사이트가 없습니다. 오른쪽 위 버튼으로 추가해 보세요." }}
            </div>

            <MonitorListItem
                v-for="(item, index) in filtered"
                :key="item.id"
                :monitor="item"
                :rank="index + 1"
                @delete="$emit('delete', $event)"
                @error="$emit('error', $event)"
            />
        </div>
    </div>
</template>

<script>
import MonitorListItem from "./MonitorListItem.vue";
import { sortedSites } from "../stores/monitorStore.js";

export default {
    components: { MonitorListItem },

    emits: ["add", "delete", "error"],

    data() {
        return { searchText: "" };
    },

    computed: {
        filtered() {
            const q = this.searchText.trim().toLowerCase();
            if (!q) return sortedSites.value;
            return sortedSites.value.filter(
                (s) => s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q)
            );
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.list-header {
    border-bottom: 1px solid #dee2e6;
    padding: 10px 10px 15px;
    margin: -10px -10px 10px;
}

.search-input {
    max-width: 320px;
    border-radius: $border-radius;
}

.monitor-list {
    min-height: 200px;
}
</style>
