{
  "targets": [
    {
      # Mbed TLS 3.6.7 (deps/mbedtls, Apache-2.0): HTTPS 검사용 TLS 라이브러리
      "target_name": "mbedtls",
      "type": "static_library",
      "sources": [
        "<!@(node -p \"require('fs').readdirSync('deps/mbedtls/library').filter(f => f.endsWith('.c')).map(f => 'deps/mbedtls/library/' + f).join(' ')\")"
      ],
      "include_dirs": ["deps/mbedtls/include", "deps/mbedtls/library", "src/tls"],
      "defines": ["MBEDTLS_USER_CONFIG_FILE=\"mbedtls_user_config.h\""],
      "direct_dependent_settings": {
        "include_dirs": ["deps/mbedtls/include", "src/tls"],
        "defines": ["MBEDTLS_USER_CONFIG_FILE=\"mbedtls_user_config.h\""]
      },
      "cflags": ["-w"],
      "xcode_settings": { "OTHER_CFLAGS": ["-w"] },
      "msvs_settings": {
        "VCCLCompilerTool": { "WarningLevel": 0, "AdditionalOptions": ["/utf-8"] }
      },
      "conditions": [
        ["OS!='win'", { "link_settings": { "libraries": ["-lpthread"] } }]
      ]
    },
    {
      "target_name": "monitor_engine",
      "dependencies": ["mbedtls"],
      "sources": [
        "src/addon.cc",
        "src/probe.cc",
        "src/rtt_estimator.cc",
        "src/net_compat.cc",
        "src/tls_client.cc"
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
          "libraries": ["ws2_32.lib", "bcrypt.lib", "crypt32.lib", "advapi32.lib"],
          "defines": ["_WINSOCK_DEPRECATED_NO_WARNINGS"]
        }]
      ]
    }
  ]
}
