// Uptime Kuma src/util.ts 의 상태 상수와 같은 값을 씁니다. (MIT, Copyright (c) 2021 Louis Lam)
// 백엔드(C++ 엔진 → Express)도 이 숫자 규칙대로 status 를 보내 달라고 합의하세요.
export const DOWN = 0;
export const UP = 1;
export const PENDING = 2;
export const MAINTENANCE = 3;
