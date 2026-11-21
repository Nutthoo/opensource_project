<!--
    사이트 추가 / 수정 창 (site 가 없으면 추가, 있으면 수정)
    - 확인 방식: http(웹 주소) / ping(호스트) / tcp(호스트 + 포트)
    - tcp 는 주소를 tcp://호스트:포트 로 저장하고 port 도 따로 보냄
      (같은 호스트의 다른 포트를 각각 등록할 수 있게)
-->
<template>
    <div v-if="modelValue" class="modal d-block" tabindex="-1" @click.self="close">
        <div class="modal-dialog modal-dialog-centered">
            <form class="modal-content" @submit.prevent="submit">
                <div class="modal-header">
                    <h5 class="modal-title">{{ isEdit ? "사이트 수정" : "사이트 추가" }}</h5>
                    <button type="button" class="btn-close" aria-label="닫기" @click="close"></button>
                </div>

                <div class="modal-body">
                    <div class="mb-3">
                        <label class="form-label" for="site-name">이름</label>
                        <input id="site-name" v-model.trim="form.name" class="form-control" required maxlength="100" placeholder="예: 학교 포털" />
                    </div>

                    <div class="mb-3">
                        <label class="form-label" for="site-type">상태 확인 방식</label>
                        <select id="site-type" v-model="form.type" class="form-select" @change="onTypeChange">
                            <option value="http">HTTP(S) - 웹사이트</option>
                            <option value="ping">Ping (ICMP)</option>
                            <option value="tcp">TCP 포트</option>
                        </select>
                    </div>

                    <div class="row">
                        <div class="mb-3" :class="form.type === 'tcp' ? 'col-8' : 'col-12'">
                            <label class="form-label" for="site-url">{{ form.type === "http" ? "주소 (URL)" : "호스트" }}</label>
                            <input
                                id="site-url"
                                v-model.trim="form.address"
                                class="form-control"
                                :type="form.type === 'http' ? 'url' : 'text'"
                                required
                                maxlength="2048"
                                :placeholder="addressPlaceholder"
                            />
                        </div>
                        <div v-if="form.type === 'tcp'" class="col-4 mb-3">
                            <label class="form-label" for="site-port">포트</label>
                            <input id="site-port" v-model.number="form.port" class="form-control" type="number" min="1" max="65535" required placeholder="3306" />
                        </div>
                    </div>

                    <div class="mb-3">
                        <label class="form-label" for="site-interval">확인 주기 (초)</label>
                        <input id="site-interval" v-model.number="form.interval" class="form-control" type="number" min="20" />
                    </div>

                    <div v-if="form.type === 'http'" class="form-check">
                        <input id="site-autologin" v-model="form.autoLogin" class="form-check-input" type="checkbox" />
                        <label class="form-check-label" for="site-autologin">자동 로그인 사용</label>
                    </div>

                    <p v-if="!useMock" class="form-text mt-2 mb-0">
                        ※ 확인 주기는 아직 저장되지 않아요. 지금은 모든 사이트를 60초마다 확인합니다.
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
import { addSite, editSite } from "../stores/monitorStore.js";
import { USE_MOCK } from "../api/client.js";

const emptyForm = () => ({ name: "", type: "http", address: "", port: null, interval: 60, autoLogin: false });

// "tcp://host:3306", "host:3306", "host" -> { host, port }
function splitHostPort(input) {
    const s = String(input || "").trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0];
    const m = s.match(/^(.+):(\d{1,5})$/);
    return m ? { host: m[1], port: Number(m[2]) } : { host: s, port: null };
}

// 저장된 사이트 -> 입력 폼
function toForm(site) {
    const form = {
        name: site.name,
        type: site.type,
        address: site.url,
        port: site.port,
        interval: site.interval ?? 60,
        autoLogin: Boolean(site.autoLogin?.enabled),
    };
    if (site.type === "tcp") {
        const { host, port } = splitHostPort(site.url);
        form.address = host;
        form.port = site.port ?? port;
    }
    return form;
}

export default {
    props: {
        modelValue: { type: Boolean, default: false },
        /** 수정할 사이트. 없으면 추가 */
        site: { type: Object, default: null },
    },

    emits: ["update:modelValue", "saved"],

    data() {
        return { form: emptyForm(), lastType: "http", saving: false, error: null, useMock: USE_MOCK };
    },

    computed: {
        isEdit() {
            return Boolean(this.site);
        },

        addressPlaceholder() {
            if (this.form.type === "http") return "예: https://www.naver.com";
            if (this.form.type === "tcp") return "예: db.example.com";
            return "예: 8.8.8.8 또는 example.com";
        },
    },

    watch: {
        // 창이 열릴 때마다 폼을 새로 채움
        modelValue: {
            immediate: true,
            handler(open) {
                if (!open) return;
                this.form = this.site ? toForm(this.site) : emptyForm();
                this.lastType = this.form.type;
                this.error = null;
            },
        },
    },

    methods: {
        // 사용자가 확인 방식을 바꾸면 이미 입력한 주소를 그 형식에 맞춰 줌
        onTypeChange() {
            const type = this.form.type;
            if (type === this.lastType) return;
            this.lastType = type;
            const { host, port } = splitHostPort(this.form.address);
            if (type === "http") {
                this.form.address = host ? `https://${host}` : "";
            } else {
                this.form.address = host;
                if (type === "tcp" && port && !this.form.port) this.form.port = port;
            }
        },

        close() {
            this.$emit("update:modelValue", false);
        },

        // 폼 -> 백엔드로 보낼 사이트 필드
        toSiteFields() {
            const f = this.form;
            const base = { name: f.name, type: f.type, interval: f.interval || 60, autoLogin: { enabled: f.type === "http" && f.autoLogin } };

            if (f.type === "tcp") {
                const { host, port } = splitHostPort(f.address);
                const p = Number(f.port || port);
                if (!host) throw new Error("호스트를 입력해 주세요.");
                if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error("포트는 1~65535 사이의 숫자여야 합니다.");
                return { ...base, url: `tcp://${host}:${p}`, port: p };
            }
            if (f.type === "ping") {
                const { host } = splitHostPort(f.address);
                if (!host) throw new Error("호스트를 입력해 주세요.");
                return { ...base, url: host, port: null };
            }
            return { ...base, url: f.address, port: null };
        },

        async submit() {
            this.saving = true;
            this.error = null;
            try {
                const fields = this.toSiteFields();
                const site = this.isEdit ? await editSite(this.site.id, fields) : await addSite(fields);
                this.$emit("saved", site);
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
