// Heretek Tier 2 — native Vulkan container module.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.heretek.gamestudio.tier2"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.heretek.gamestudio.tier2"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        ndk {
            // Production target: modern Vulkan-capable arm64 devices.
            // x86_64 is included so the debug APK can also run on the Android
            // emulator (the only always-available validation target).
            abiFilters += listOf("arm64-v8a", "x86_64")
        }

        externalNativeBuild {
            cmake {
                cppFlags += listOf("-std=c++17", "-fno-exceptions", "-fno-rtti")
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}
