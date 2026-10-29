#include "rtt_estimator.h"

#include <algorithm>
#include <cmath>

namespace engine {

RttEstimator::RttEstimator(RttConfig cfg) : cfg_(cfg) {}

void RttEstimator::update(double sampleMs) {
    if (!(sampleMs >= 0)) return;
    if (samples_ == 0) {
        srtt_ = sampleMs;
        rttvar_ = sampleMs / 2.0;
    } else {
        rttvar_ = (1 - cfg_.beta) * rttvar_ + cfg_.beta * std::fabs(srtt_ - sampleMs);
        srtt_ = (1 - cfg_.alpha) * srtt_ + cfg_.alpha * sampleMs;
    }
    ++samples_;
}

void RttEstimator::reset() {
    srtt_ = rttvar_ = 0.0;
    samples_ = 0;
}

double RttEstimator::timeoutMs() const {
    if (samples_ == 0) return cfg_.maxTimeoutMs;
    double t = srtt_ + cfg_.k * rttvar_;
    return std::clamp(t, cfg_.minTimeoutMs, cfg_.maxTimeoutMs);
}

}  // namespace engine
