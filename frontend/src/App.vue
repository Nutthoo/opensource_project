<template>
    <header class="d-flex align-items-center px-4 py-3 mb-4 bg-white border-bottom">
        <router-link to="/" class="d-flex align-items-center text-decoration-none text-dark">
            <span class="logo me-2">●</span>
            <span class="fs-4 fw-semibold">웹사이트 관리 리스트</span>
        </router-link>

        <span v-if="store.useMock" class="badge bg-warning text-dark ms-3">MOCK 데이터</span>
        <span v-else-if="!store.loading && !store.connected" class="badge bg-danger ms-3">서버 연결 끊김</span>
        <span v-else-if="store.connected" class="badge bg-primary ms-3">백엔드 연결됨</span>
    </header>

    <main class="container-fluid px-4 pb-5">
        <router-view />
    </main>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from "vue";
import { store, init, dispose } from "./stores/monitorStore.js";

onMounted(init);
onBeforeUnmount(dispose);
</script>

<style lang="scss" scoped>
@import "./assets/vars.scss";

.logo {
    color: $primary;
    font-size: 26px;
    line-height: 1;
}
</style>
