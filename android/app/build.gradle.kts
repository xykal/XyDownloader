// XyDownloader Android app (by XyVerse)
// Engine: youtubedl-android (Python + yt-dlp + FFmpeg + QuickJS jalan langsung di HP)

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Versi diisi dari CI (tag v1.2.3 -> 1.2.3). Build lokal pakai default.
val appVersionName: String = System.getenv("VERSION_NAME") ?: "1.0.0"
val appVersionCode: Int = (System.getenv("VERSION_CODE") ?: "1").toInt()

// Signing release dari GitHub Secrets (KEYSTORE_BASE64 -> file, lihat workflow android.yml)
val keystorePath: String? = System.getenv("KEYSTORE_PATH")
val hasReleaseKeystore = keystorePath != null && file(keystorePath).exists()

android {
    namespace = "id.my.xyverse.xydownloader"
    compileSdk = 35

    defaultConfig {
        applicationId = "id.my.xyverse.xydownloader"
        minSdk = 24
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
        buildConfigField("String", "WEB_URL", "\"https://xydl.vercel.app\"")
        buildConfigField("String", "REPO_URL", "\"https://github.com/xykal/XyDownloader\"")
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // Minify dimatikan: library engine memakai reflection (Jackson) & ukuran APK
            // didominasi native lib (Python/FFmpeg), jadi R8 tidak banyak membantu.
            isMinifyEnabled = false
            signingConfig = if (hasReleaseKeystore) signingConfigs.getByName("release")
            else signingConfigs.getByName("debug")
        }
    }

    // Satu APK per arsitektur supaya ukurannya masuk akal (~70-90 MB, bukan 250 MB)
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = false
        }
    }

    packaging {
        // WAJIB untuk youtubedl-android: native lib harus di-extract ke disk (extractNativeLibs=true)
        jniLibs { useLegacyPackaging = true }
        resources { excludes += setOf("META-INF/{AL2.0,LGPL2.1}", "META-INF/DEPENDENCIES") }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

// ---------------------------------------------------------------------------
// Plugin extractor yt-dlp XyDownloader (Douyin, Kuaishou, Threads, Bilibili) diambil dari
// folder ../plugins (sumber yang sama dengan backend web) lalu dibundel sebagai assets.
// ---------------------------------------------------------------------------
abstract class CopyYtDlpPluginsTask : DefaultTask() {
    @get:InputDirectory
    abstract val source: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun run() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        // yt-dlp --plugin-dirs mengharapkan: <dir>/<nama-paket>/yt_dlp_plugins/extractor/*.py
        val target = File(out, "ytdlp-plugins/xydl/yt_dlp_plugins")
        source.get().asFile.copyRecursively(target, overwrite = true)
        target.walkBottomUp()
            .filter { it.name == "__pycache__" || it.name.endsWith(".pyc") }
            .forEach { it.deleteRecursively() }
    }
}

val copyYtDlpPlugins = tasks.register<CopyYtDlpPluginsTask>("copyYtDlpPlugins") {
    source.set(rootProject.layout.projectDirectory.dir("../plugins/yt_dlp_plugins"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyYtDlpPlugins, CopyYtDlpPluginsTask::outputDir)
    }
}

dependencies {
    val ytdl = "0.18.1"
    implementation("io.github.junkfood02.youtubedl-android:library:$ytdl")
    implementation("io.github.junkfood02.youtubedl-android:ffmpeg:$ytdl")

    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
