import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";

import "./assets/app.scss";
import App from "./App.vue";
import DashboardHome from "./pages/DashboardHome.vue";

const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: "/", name: "DashboardHome", component: DashboardHome },
    ],
});

createApp(App).use(router).mount("#app");
