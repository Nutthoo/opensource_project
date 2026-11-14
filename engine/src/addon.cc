// node-addon-api 바인딩: backend 에서 require('../engine') 로 호출
//
// 네트워크 검사는 블로킹이라 Node 메인 스레드에서 돌리면 Express 가 멈춘다.
// 그래서 AsyncWorker 로 libuv 스레드풀에서 실행하고 Promise 로 결과를 돌려준다.
#include <napi.h>

#include <functional>
#include <string>
#include <vector>

#include "probe.h"
#include "rtt_estimator.h"
#include "tls_client.h"

namespace {

using engine::ProbeResult;
using engine::Target;

Napi::Value msOrNull(Napi::Env env, double ms) {
    if (ms < 0) return env.Null();
    return Napi::Number::New(env, static_cast<double>(static_cast<long long>(ms * 100 + 0.5)) / 100);
}

Napi::Object toJs(Napi::Env env, const ProbeResult& r) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("up", r.up);
    o.Set("status", r.up ? "up" : "down");  // site_status.status 컬럼에 그대로 저장 가능
    o.Set("method", r.method);
    o.Set("ip", r.ip.empty() ? env.Null() : Napi::String::New(env, r.ip));
    o.Set("responseTime", msOrNull(env, r.totalMs));
    o.Set("dnsMs", msOrNull(env, r.dnsMs));
    o.Set("connectMs", msOrNull(env, r.connectMs));
    o.Set("tlsMs", msOrNull(env, r.tlsMs));
    o.Set("ttfbMs", msOrNull(env, r.ttfbMs));
    o.Set("rttMs", msOrNull(env, r.rttMs));
    o.Set("statusCode", r.statusCode ? Napi::Number::New(env, r.statusCode) : env.Null());
    o.Set("statusText", r.statusText);
    o.Set("location", r.location.empty() ? env.Null() : Napi::String::New(env, r.location));
    o.Set("timedOut", r.timedOut);
    o.Set("refused", r.refused);
    if (r.method == "https") {
        Napi::Object tls = Napi::Object::New(env);
        tls.Set("version", r.tlsVersion.empty() ? env.Null() : Napi::String::New(env, r.tlsVersion));
        tls.Set("certValid", r.certValid);
        tls.Set("certError", r.certError.empty() ? env.Null() : Napi::String::New(env, r.certError));
        tls.Set("expiresAt", r.hasCert ? Napi::String::New(env, r.certExpiresAt) : env.Null());
        tls.Set("daysLeft", r.hasCert ? Napi::Number::New(env, r.certDaysLeft) : env.Null());
        o.Set("tls", tls);
    } else {
        o.Set("tls", env.Null());
    }
    o.Set("message", r.message);
    return o;
}

int timeoutArg(const Napi::CallbackInfo& info, size_t idx, int def) {
    if (info.Length() > idx && info[idx].IsNumber()) {
        int t = info[idx].As<Napi::Number>().Int32Value();
        if (t > 0) return t;
    }
    return def;
}

std::string stringArg(const Napi::CallbackInfo& info, size_t idx, const char* name) {
    if (info.Length() <= idx || !info[idx].IsString()) {
        throw Napi::TypeError::New(info.Env(), std::string(name) + " 는 문자열이어야 합니다");
    }
    return info[idx].As<Napi::String>().Utf8Value();
}

class ProbeWorker : public Napi::AsyncWorker {
public:
    ProbeWorker(Napi::Env env, std::function<ProbeResult()> fn)
        : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), fn_(std::move(fn)) {}

    Napi::Promise promise() { return deferred_.Promise(); }

    void Execute() override {
        try {
            result_ = fn_();
        } catch (const std::exception& e) {
            SetError(e.what());
        }
    }
    void OnOK() override { deferred_.Resolve(toJs(Env(), result_)); }
    void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

private:
    Napi::Promise::Deferred deferred_;
    std::function<ProbeResult()> fn_;
    ProbeResult result_;
};

class ManyWorker : public Napi::AsyncWorker {
public:
    ManyWorker(Napi::Env env, std::vector<Target> targets, int concurrency)
        : Napi::AsyncWorker(env),
          deferred_(Napi::Promise::Deferred::New(env)),
          targets_(std::move(targets)),
          concurrency_(concurrency) {}

    Napi::Promise promise() { return deferred_.Promise(); }

    void Execute() override {
        try {
            results_ = engine::checkMany(targets_, concurrency_);
        } catch (const std::exception& e) {
            SetError(e.what());
        }
    }
    void OnOK() override {
        Napi::Env env = Env();
        Napi::Array arr = Napi::Array::New(env, results_.size());
        for (size_t i = 0; i < results_.size(); ++i) arr.Set(static_cast<uint32_t>(i), toJs(env, results_[i]));
        deferred_.Resolve(arr);
    }
    void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

private:
    Napi::Promise::Deferred deferred_;
    std::vector<Target> targets_;
    int concurrency_;
    std::vector<ProbeResult> results_;
};

template <typename Fn>
Napi::Value queue(Napi::Env env, Fn fn) {
    auto* w = new ProbeWorker(env, fn);
    Napi::Promise p = w->promise();
    w->Queue();
    return p;
}

bool ignoreTlsOf(const Napi::Value& v) {
    if (!v.IsObject()) return false;
    Napi::Value f = v.As<Napi::Object>().Get("ignoreTls");
    return f.IsBoolean() && f.As<Napi::Boolean>().Value();
}

// checkHttp(url, timeoutMs?, { ignoreTls }?) -> Promise<Result>
Napi::Value CheckHttp(const Napi::CallbackInfo& info) {
    std::string url = stringArg(info, 0, "url");
    int timeout = timeoutArg(info, 1, 10000);
    bool ignoreTls = info.Length() > 2 && ignoreTlsOf(info[2]);
    return queue(info.Env(), [url, timeout, ignoreTls] { return engine::checkHttp(url, timeout, ignoreTls); });
}

// checkTcp(host, port, timeoutMs?) -> Promise<Result>
Napi::Value CheckTcp(const Napi::CallbackInfo& info) {
    std::string host = stringArg(info, 0, "host");
    if (info.Length() < 2 || !info[1].IsNumber()) throw Napi::TypeError::New(info.Env(), "port 는 숫자여야 합니다");
    int port = info[1].As<Napi::Number>().Int32Value();
    int timeout = timeoutArg(info, 2, 10000);
    return queue(info.Env(), [host, port, timeout] { return engine::checkTcp(host, port, timeout); });
}

// ping(host, timeoutMs?) -> Promise<Result>
Napi::Value Ping(const Napi::CallbackInfo& info) {
    std::string host = stringArg(info, 0, "host");
    int timeout = timeoutArg(info, 1, 5000);
    return queue(info.Env(), [host, timeout] { return engine::ping(host, timeout); });
}

// checkMany([{type, url, host, port, timeoutMs, ignoreTls}], concurrency?) -> Promise<Result[]>
Napi::Value CheckMany(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsArray()) throw Napi::TypeError::New(env, "targets 배열이 필요합니다");
    Napi::Array arr = info[0].As<Napi::Array>();

    std::vector<Target> targets;
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        Napi::Value v = arr.Get(i);
        if (!v.IsObject()) throw Napi::TypeError::New(env, "target 은 객체여야 합니다");
        Napi::Object o = v.As<Napi::Object>();
        Target t;
        if (o.Get("type").IsString()) t.type = o.Get("type").As<Napi::String>().Utf8Value();
        if (o.Get("url").IsString()) t.url = o.Get("url").As<Napi::String>().Utf8Value();
        if (o.Get("host").IsString()) t.host = o.Get("host").As<Napi::String>().Utf8Value();
        if (o.Get("port").IsNumber()) t.port = o.Get("port").As<Napi::Number>().Int32Value();
        if (o.Get("timeoutMs").IsNumber()) t.timeoutMs = o.Get("timeoutMs").As<Napi::Number>().Int32Value();
        t.ignoreTls = ignoreTlsOf(o);
        targets.push_back(std::move(t));
    }
    int concurrency = timeoutArg(info, 1, 16);

    auto* w = new ManyWorker(env, std::move(targets), concurrency);
    Napi::Promise p = w->promise();
    w->Queue();
    return p;
}

// new RttEstimator({alpha, beta, k, minTimeoutMs, maxTimeoutMs})
class RttEstimatorWrap : public Napi::ObjectWrap<RttEstimatorWrap> {
public:
    static Napi::Function Init(Napi::Env env) {
        return DefineClass(env, "RttEstimator",
                           {
                               InstanceMethod("update", &RttEstimatorWrap::Update),
                               InstanceMethod("reset", &RttEstimatorWrap::Reset),
                               InstanceMethod("toJSON", &RttEstimatorWrap::ToJSON),
                               InstanceAccessor("srtt", &RttEstimatorWrap::Srtt, nullptr),
                               InstanceAccessor("rttvar", &RttEstimatorWrap::Rttvar, nullptr),
                               InstanceAccessor("samples", &RttEstimatorWrap::Samples, nullptr),
                               InstanceAccessor("timeoutMs", &RttEstimatorWrap::Timeout, nullptr),
                           });
    }

    explicit RttEstimatorWrap(const Napi::CallbackInfo& info) : Napi::ObjectWrap<RttEstimatorWrap>(info) {
        engine::RttConfig cfg;
        if (info.Length() > 0 && info[0].IsObject()) {
            Napi::Object o = info[0].As<Napi::Object>();
            auto num = [&](const char* key, double& out) {
                if (o.Get(key).IsNumber()) out = o.Get(key).As<Napi::Number>().DoubleValue();
            };
            num("alpha", cfg.alpha);
            num("beta", cfg.beta);
            num("k", cfg.k);
            num("minTimeoutMs", cfg.minTimeoutMs);
            num("maxTimeoutMs", cfg.maxTimeoutMs);
        }
        est_ = engine::RttEstimator(cfg);
    }

private:
    Napi::Value Update(const Napi::CallbackInfo& info) {
        if (info.Length() > 0 && info[0].IsNumber()) est_.update(info[0].As<Napi::Number>().DoubleValue());
        return Napi::Number::New(info.Env(), est_.timeoutMs());
    }
    Napi::Value Reset(const Napi::CallbackInfo& info) {
        est_.reset();
        return info.Env().Undefined();
    }
    Napi::Value ToJSON(const Napi::CallbackInfo& info) {
        Napi::Object o = Napi::Object::New(info.Env());
        o.Set("srtt", est_.srtt());
        o.Set("rttvar", est_.rttvar());
        o.Set("samples", est_.samples());
        o.Set("timeoutMs", est_.timeoutMs());
        return o;
    }
    Napi::Value Srtt(const Napi::CallbackInfo& info) { return Napi::Number::New(info.Env(), est_.srtt()); }
    Napi::Value Rttvar(const Napi::CallbackInfo& info) { return Napi::Number::New(info.Env(), est_.rttvar()); }
    Napi::Value Samples(const Napi::CallbackInfo& info) { return Napi::Number::New(info.Env(), est_.samples()); }
    Napi::Value Timeout(const Napi::CallbackInfo& info) { return Napi::Number::New(info.Env(), est_.timeoutMs()); }

    engine::RttEstimator est_;
};

// setCaBundle(path): HTTPS 인증서 검증에 쓸 CA 목록 파일 (index.js 가 자동 호출)
Napi::Value SetCaBundle(const Napi::CallbackInfo& info) {
    engine::setCaBundlePath(stringArg(info, 0, "path"));
    return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("setCaBundle", Napi::Function::New(env, SetCaBundle));
    exports.Set("checkHttp", Napi::Function::New(env, CheckHttp));
    exports.Set("checkTcp", Napi::Function::New(env, CheckTcp));
    exports.Set("ping", Napi::Function::New(env, Ping));
    exports.Set("checkMany", Napi::Function::New(env, CheckMany));
    exports.Set("RttEstimator", RttEstimatorWrap::Init(env));
    return exports;
}

}  // namespace

NODE_API_MODULE(monitor_engine, Init)
