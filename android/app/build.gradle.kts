import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ca.co2lab.agent"
    compileSdk = 36

    defaultConfig {
        applicationId = "ca.co2lab.agent"
        minSdk = 30
        targetSdk = 36
        versionCode = 6
        versionName = "0.6"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // In-app QR scanning through Google Play services (no camera permission needed).
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
}
