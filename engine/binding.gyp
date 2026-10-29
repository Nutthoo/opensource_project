{
  "targets": [
    {
      "target_name": "monitor_engine",
      "sources": [
        "src/addon.cc",
        "src/probe.cc",
        "src/rtt_estimator.cc",
        "src/net_compat.cc"
      ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")"
      ],
      "defines": ["NAPI_VERSION=8", "NAPI_CPP_EXCEPTIONS"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++17"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "MACOSX_DEPLOYMENT_TARGET": "10.15"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/std:c++17", "/utf-8"]
        }
      },
      "conditions": [
        ["OS=='win'", {
          "libraries": ["ws2_32.lib"],
          "defines": ["_WINSOCK_DEPRECATED_NO_WARNINGS"]
        }]
      ]
    }
  ]
}
