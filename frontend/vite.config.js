import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const backend = env.VITE_BACKEND_URL || "http://localhost:3000";

    return {
        plugins: [vue()],
        server: {
            port: 5173,
            proxy: {
                "/api": {
                    target: backend,
                    changeOrigin: true,
                    // backend 라우트에 /api prefix 없음
                    rewrite: (path) => path.replace(/^\/api/, ""),
                },
                "/socket.io": { target: backend, ws: true, changeOrigin: true },
            },
        },
        css: {
            preprocessorOptions: {
                scss: { quietDeps: true, silenceDeprecations: ["import", "global-builtin", "color-functions"] },
            },
        },
    };
});
