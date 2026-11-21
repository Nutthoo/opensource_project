<!--
    Based on Uptime Kuma src/components/PingChart.vue (1.23.X) (MIT, Copyright (c) 2021 Louis Lam)
    원본 구성: 응답 시간 선 그래프(y) + 장애 구간 막대(y1, 다운=빨강/대기=주황/점검=파랑)
    변경점:
      - $root.heartbeatList[id] → store.heartbeats[id] (최근 기록, 백엔드 /heartbeats 기준 최대 100개)
        원본의 "최근" 보기처럼 지금으로부터 6시간 이내 기록만 그림 (서버를 꺼 둔 기간이 직선으로 이어지지 않게)
      - 기간 선택(3h/6h/24h/1w)은 백엔드에 기간별 조회 API 가 없어서 제거하고 "최근" 기록만 표시
      - $t → 한국어, 다크 테마 분기 제거(우리 화면은 밝은 테마만), vue-toastification 제거
      - 다운일 때 응답 시간은 백엔드가 null 로 저장하므로 선이 끊겨 보임
-->
<template>
    <div class="chart-wrapper">
        <Line v-if="beats.length" :data="chartData" :options="chartOptions" />
        <div v-else class="empty">최근 {{ RECENT_HOURS }}시간 동안 상태 기록이 없습니다.</div>
    </div>
</template>

<script>
import { BarController, BarElement, Chart, Filler, LinearScale, LineController, LineElement, PointElement, TimeScale, Tooltip } from "chart.js";
import "chartjs-adapter-dayjs-4";
import { Line } from "vue-chartjs";
import dayjs from "dayjs";
import { DOWN, PENDING, MAINTENANCE } from "../util.js";
import { store } from "../stores/monitorStore.js";

// 원본 PingChart 의 "최근" 보기와 같은 범위
const RECENT_HOURS = 6;

Chart.register(LineController, BarController, LineElement, PointElement, TimeScale, BarElement, LinearScale, Tooltip, Filler);

export default {
    components: { Line },

    props: {
        /** ID of the monitor(site) */
        monitorId: {
            type: Number,
            required: true,
        },
    },

    data() {
        return { RECENT_HOURS };
    },

    computed: {
        beats() {
            const since = dayjs().subtract(RECENT_HOURS, "hour");
            return (store.heartbeats[this.monitorId] || []).filter((beat) => dayjs(beat.time).isAfter(since));
        },

        chartOptions() {
            return {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                bounds: "ticks",
                layout: {
                    padding: { left: 10, right: 30, top: 30, bottom: 10 },
                },
                elements: {
                    point: {
                        // 점은 마우스를 올렸을 때만
                        radius: 0,
                        hitRadius: 100,
                    },
                },
                scales: {
                    x: {
                        type: "time",
                        time: {
                            minUnit: "minute",
                            round: "second",
                            tooltipFormat: "YYYY-MM-DD HH:mm:ss",
                            displayFormats: {
                                minute: "HH:mm",
                                hour: "MM-DD HH:mm",
                            },
                        },
                        ticks: {
                            sampleSize: 3,
                            maxRotation: 0,
                            autoSkipPadding: 30,
                            padding: 3,
                        },
                        grid: {
                            color: "rgba(0,0,0,0.1)",
                            offset: false,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "응답 시간 (ms)",
                        },
                        offset: false,
                        grid: {
                            color: "rgba(0,0,0,0.1)",
                        },
                    },
                    y1: {
                        display: false,
                        position: "right",
                        grid: {
                            drawOnChartArea: false,
                        },
                        min: 0,
                        max: 1,
                        offset: false,
                    },
                },
                plugins: {
                    tooltip: {
                        mode: "nearest",
                        intersect: false,
                        padding: 10,
                        backgroundColor: "rgba(255,255,255,0.95)",
                        bodyColor: "rgba(12,12,18,1.0)",
                        titleColor: "rgba(12,12,18,1.0)",
                        borderColor: "rgba(0,0,0,0.1)",
                        borderWidth: 1,
                        // 장애 막대(1번 데이터)는 툴팁에서 뺌
                        filter: (item) => item.datasetIndex !== 1,
                        callbacks: {
                            label: (context) => (context.parsed.y == null ? " -" : ` ${new Intl.NumberFormat().format(context.parsed.y)} ms`),
                        },
                    },
                    legend: {
                        display: false,
                    },
                },
            };
        },

        chartData() {
            const pingData = [];
            const downData = [];
            const colorData = [];

            for (const beat of this.beats) {
                const x = dayjs(beat.time).valueOf();
                pingData.push({ x, y: beat.ping });

                const bad = beat.status === DOWN || beat.status === MAINTENANCE || beat.status === PENDING;
                downData.push({ x, y: bad ? 1 : 0 });
                colorData.push(
                    beat.status === MAINTENANCE ? "rgba(23,71,245,0.41)" : beat.status === PENDING ? "rgba(245,182,23,0.41)" : "#DC354568"
                );
            }

            return {
                datasets: [
                    {
                        // 응답 시간
                        data: pingData,
                        fill: "origin",
                        tension: 0.2,
                        borderColor: "#5CDD8B",
                        backgroundColor: "#5CDD8B38",
                        yAxisID: "y",
                        label: "ping",
                    },
                    {
                        // 다운 / 대기 / 점검 구간
                        type: "bar",
                        data: downData,
                        borderColor: "#00000000",
                        backgroundColor: colorData,
                        yAxisID: "y1",
                        barThickness: "flex",
                        barPercentage: 1,
                        categoryPercentage: 1,
                        inflateAmount: 0.05,
                        label: "status",
                    },
                ],
            };
        },
    },
};
</script>

<style scoped>
.chart-wrapper {
    position: relative;
    height: 250px;
}

.empty {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6c757d;
    font-size: 14px;
}
</style>
