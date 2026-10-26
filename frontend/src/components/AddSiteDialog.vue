<template>
    <div v-if="modelValue" class="modal d-block" tabindex="-1" @click.self="close">
        <div class="modal-dialog modal-dialog-centered">
            <form class="modal-content" @submit.prevent="submit">
                <div class="modal-header">
                    <h5 class="modal-title">사이트 추가</h5>
                    <button type="button" class="btn-close" aria-label="닫기" @click="close"></button>
                </div>

                <div class="modal-body">
                    <div class="mb-3">
                        <label class="form-label" for="site-name">이름</label>
                        <input id="site-name" v-model.trim="form.name" class="form-control" required placeholder="예: 학교 포털" />
                    </div>

                    <div class="mb-3">
                        <label class="form-label" for="site-url">주소 (URL)</label>
                        <input id="site-url" v-model.trim="form.url" class="form-control" type="url" required placeholder="https://" />
                    </div>

                    <div class="mb-3">
                        <label class="form-label" for="site-type">상태 확인 방식</label>
                        <select id="site-type" v-model="form.type" class="form-select">
                            <option value="http">HTTP(S)</option>
                            <option value="ping">Ping (ICMP)</option>
                            <option value="port">TCP 포트</option>
                        </select>
                    </div>

                    <div class="mb-3">
                        <label class="form-label" for="site-interval">확인 주기 (초)</label>
                        <input id="site-interval" v-model.number="form.interval" class="form-control" type="number" min="20" />
                    </div>

                    <div class="form-check">
                        <input id="site-autologin" v-model="form.autoLogin.enabled" class="form-check-input" type="checkbox" />
                        <label class="form-check-label" for="site-autologin">자동 로그인 사용</label>
                    </div>

                    <p v-if="!useMock" class="form-text mt-2 mb-0">
                        ※ 지금 백엔드는 이름과 주소만 저장해요. 확인 방식·주기·자동 로그인은 백엔드에 기능이 생기면 반영돼요.
                    </p>

                    <div v-if="error" class="alert alert-danger mt-3 mb-0 py-2">{{ error }}</div>
                </div>

                <div class="modal-footer">
                    <button type="button" class="btn btn-outline-secondary" @click="close">취소</button>
                    <button type="submit" class="btn btn-primary" :disabled="saving">
                        {{ saving ? "저장 중…" : "저장" }}
                    </button>
                </div>
            </form>
        </div>
    </div>
</template>

<script>
import { addSite } from "../stores/monitorStore.js";
import { USE_MOCK } from "../api/client.js";

const emptyForm = () => ({ name: "", url: "https://", type: "http", interval: 60, autoLogin: { enabled: false } });

export default {
    props: {
        modelValue: { type: Boolean, default: false },
    },

    emits: ["update:modelValue", "added"],

    data() {
        return { form: emptyForm(), saving: false, error: null, useMock: USE_MOCK };
    },

    methods: {
        close() {
            this.$emit("update:modelValue", false);
            this.form = emptyForm();
            this.error = null;
        },

        async submit() {
            this.saving = true;
            this.error = null;
            try {
                const site = await addSite(this.form);
                this.$emit("added", site);
                this.close();
            } catch (e) {
                this.error = e.message;
            } finally {
                this.saving = false;
            }
        },
    },
};
</script>

<style scoped>
.modal {
    background: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(3px);
}
</style>
