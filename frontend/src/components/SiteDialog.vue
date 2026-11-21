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
                        <input id="site-interval" v-model.number="form.interval" class="form-control" type="number" min="5" />
                    </div>

                    <div v-if="form.type === 'http'" class="form-check">
                        <input id="site-autologin" v-model="form.autoLogin" class="form-check-input" type="checkbox" />
                        <label class="form-check-label" for="site-autologin">자동 로그인 사용 (웹 접속 후 자동 입력)</label>
                    </div>

                    <!-- 자동 로그인 활성화 시 자격 증명 입력 영역 -->
                    <div v-if="form.type === 'http' && form.autoLogin" class="border rounded p-3 mt-2 bg-light">
                        <div class="mb-2">
                            <label class="form-label small mb-1" for="login-url">로그인 페이지 주소 (비워두면 위 주소 사용)</label>
                            <input id="login-url" v-model.trim="form.loginUrl" class="form-control form-control-sm" type="url" placeholder="예: https://example.com/login" />
                        </div>
                        <div class="row g-2 mb-2">
                            <div class="col-6">
                                <label class="form-label small mb-1" for="login-user">아이디</label>
                                <input id="login-user" v-model.trim="form.username" class="form-control form-control-sm" :required="form.autoLogin" placeholder="아이디 입력" />
                            </div>
                            <div class="col-6">
                                <label class="form-label small mb-1" for="login-pass">비밀번호</label>
                                <input
                                    id="login-pass"
                                    v-model="form.password"
                                    class="form-control form-control-sm"
                                    type="password"
                                    :required="form.autoLogin && !hasExistingPassword"
                                    :placeholder="hasExistingPassword ? '변경 시에만 입력' : '비밀번호 입력'"
                                />
                            </div>
                        </div>
                        <details class="small text-muted">
                            <summary style="cursor: pointer">고급 설정 (CSS 선택자 직접 지정)</summary>
                            <div class="mt-2">
                                <input v-model.trim="form.userSelector" class="form-control form-control-sm mb-1" placeholder="아이디 입력칸 선택자 (예: #id)" />
                                <input v-model.trim="form.passSelector" class="form-control form-control-sm mb-1" placeholder="비밀번호 입력칸 선택자 (예: #pw)" />
                                <input v-model.trim="form.submitSelector" class="form-control form-control-sm" placeholder="로그인 버튼 선택자 (예: button[type=submit])" />
                            </div>
                        </details>
                    </div>

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

const emptyForm = () => ({
    name: "",
    type: "http",
    address: "",
    port: null,
    interval: 60,
    autoLogin: false,
    loginUrl: "",
    username: "",
    password: "",
    userSelector: "",
    passSelector: "",
    submitSelector: "",
});

function splitHostPort(input) {
    const s = String(input || "").trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0];
    const m = s.match(/^(.+):(\d{1,5})$/);
    return m ? { host: m[1], port: Number(m[2]) } : { host: s, port: null };
}

function toForm(site) {
    const form = {
        name: site.name,
        type: site.type,
        address: site.url,
        port: site.port,
        interval: site.interval ?? 60,
        autoLogin: Boolean(site.autoLogin?.enabled),
        loginUrl: site.autoLogin?.loginUrl || "",
        username: site.autoLogin?.username || "",
        password: "",
        userSelector: site.autoLogin?.userSelector || "",
        passSelector: site.autoLogin?.passSelector || "",
        submitSelector: site.autoLogin?.submitSelector || "",
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
        hasExistingPassword() {
            return Boolean(this.site?.autoLogin?.hasCredentials);
        },
        addressPlaceholder() {
            if (this.form.type === "http") return "예: https://www.naver.com";
            if (this.form.type === "tcp") return "예: db.example.com";
            return "예: 8.8.8.8 또는 example.com";
        },
    },

    watch: {
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

        toSiteFields() {
            const f = this.form;
            const enabled = f.type === "http" && f.autoLogin;
            const base = {
                name: f.name,
                type: f.type,
                interval: f.interval || 60,
                autoLogin: {
                    enabled,
                    loginUrl: enabled ? f.loginUrl : "",
                    username: enabled ? f.username : "",
                    password: enabled ? f.password : "",
                    userSelector: enabled ? f.userSelector : "",
                    passSelector: enabled ? f.passSelector : "",
                    submitSelector: enabled ? f.submitSelector : "",
                },
            };

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