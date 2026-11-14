// RTT 추정기 (CS168 교과서 "Reliably Delivering a Single Packet", Lec11/12 "Detecting Loss")
//
// - 타이머는 RTT 에 비례해야 한다: RTT 쯤이면 응답이 와야 하니까.
// - 하지만 RTT 는 경로/큐 상태에 따라 계속 변하므로, 측정값들을
//   지수 이동 평균(EWMA)으로 합쳐 추정하고, 변동(variance)도 함께 반영한다.
// - 타이머가 너무 짧으면 멀쩡한 서버를 죽었다고 오판하므로 길게 잡는 쪽으로 보정한다.
//
//   srtt   = (1 - alpha) * srtt   + alpha * sample
//   rttvar = (1 - beta)  * rttvar + beta  * |srtt - sample|
//   timeout = clamp(srtt + k * rttvar, minTimeout, maxTimeout)
#pragma once

namespace engine {

struct RttConfig {
    double alpha = 0.125;  // 1/8
    double beta = 0.25;    // 1/4
    double k = 4.0;
    double minTimeoutMs = 1000.0;
    double maxTimeoutMs = 10000.0;
};

class RttEstimator {
public:
    explicit RttEstimator(RttConfig cfg = {});

    // 성공한 측정값(ms)만 넣는다. 타임아웃난 시도는 RTT 를 알 수 없으므로 넣지 않음.
    void update(double sampleMs);
    void reset();

    double srtt() const { return srtt_; }
    double rttvar() const { return rttvar_; }
    int samples() const { return samples_; }
    // 샘플이 없으면 아직 RTT 를 모르므로 maxTimeout 사용
    double timeoutMs() const;
    const RttConfig& config() const { return cfg_; }

private:
    RttConfig cfg_;
    double srtt_ = 0.0;
    double rttvar_ = 0.0;
    int samples_ = 0;
};

}  // namespace engine
