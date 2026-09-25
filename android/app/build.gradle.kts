// XyDownloader Android app (built in XyVerse)
// Engine: youtubedl-android (Python + yt-dlp + QuickJS jalan langsung di HP)
//       + FFmpeg minimal hasil build sendiri (android/ffmpeg/build.sh) — jauh lebih kecil dari versi penuh.

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Versi diisi dari CI (tag v1.2.3 -> 1.2.3). Build lokal pakai default.
val appVersionName: String = System.getenv("VERSION_NAME") ?: "1.2.0-dev"
val appVersionCode: Int = (System.getenv("VERSION_CODE") ?: "1").toInt()

// Signing release dari GitHub Secrets (KEYSTORE_BASE64 -> file, lihat workflow android.yml)
val keystorePath: String? = System.getenv("KEYSTORE_PATH")
val hasReleaseKeystore = keystorePath != null && file(keystorePath).exists()

// Native lib tambahan hasil CI: libpython.zip.so versi ramping + libffmpeg.so minimal
// (android/tools/prepare_native.py). Kalau folder ini kosong, dipakai versi bawaan library.
val xyJniDir: File = layout.buildDirectory.dir("xy-jni").get().asFile
// yt-dlp terbaru yang dibundel saat build CI (menimpa res/raw/ytdlp bawaan library)
val xyResDir: File = layout.buildDirectory.dir("xy-res").get().asFile

android {
    namespace = "id.my.xyverse.xydownloader"
    compileSdk = 35

    defaultConfig {
        applicationId = "id.my.xyverse.xydownloader"
        minSdk = 24
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
        // Aplikasi berbahasa Indonesia: buang terjemahan library lain (hemat ukuran)
        resourceConfigurations += listOf("en", "in")
        buildConfigField("String", "WEB_URL", "\"https://xydl.projectkal.my.id\"")
        buildConfigField("String", "REPO_URL", "\"https://github.com/xykal/XyDownloader\"")
    }

    sourceSets["main"].jniLibs.srcDir(xyJniDir)
    sourceSets["main"].res.srcDir(xyResDir)

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
            // R8: kecilkan & obfuscate kode + buang resource yang tidak terpakai
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (hasReleaseKeystore) signingConfigs.getByName("release")
            else signingConfigs.getByName("debug")
        }
    }

    // Satu APK per arsitektur
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = false
        }
    }

    packaging {
        jniLibs {
            // WAJIB untuk youtubedl-android: native lib harus di-extract ke disk (extractNativeLibs=true)
            useLegacyPackaging = true
            // libpython.zip.so versi ramping (xy-jni) menggantikan versi bawaan AAR
            pickFirsts += "**/libpython.zip.so"
        }
        resources {
            excludes += setOf(
                "META-INF/{AL2.0,LGPL2.1}", "META-INF/DEPENDENCIES", "META-INF/*.version",
                "DebugProbesKt.bin", "kotlin-tooling-metadata.json",
            )
        }
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
// Assets dari repo: plugin extractor yt-dlp (../plugins, sumber yang sama dengan backend web)
// + daftar & teks lisensi (../licenses) untuk layar "Lisensi open source".
// ---------------------------------------------------------------------------
abstract class CopyRepoAssetsTask : DefaultTask() {
    @get:InputDirectory
    abstract val plugins: DirectoryProperty

    @get:InputDirectory
    abstract val licenses: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun run() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        // yt-dlp --plugin-dirs mengharapkan: <dir>/<nama-paket>/yt_dlp_plugins/extractor/*.py
        val target = File(out, "ytdlp-plugins/xydl/yt_dlp_plugins")
        plugins.get().asFile.copyRecursively(target, overwrite = true)
        target.walkBottomUp()
            .filter { it.name == "__pycache__" || it.name.endsWith(".pyc") }
            .forEach { it.deleteRecursively() }
        licenses.get().asFile.copyRecursively(File(out, "licenses"), overwrite = true)
    }
}

val copyRepoAssets = tasks.register<CopyRepoAssetsTask>("copyRepoAssets") {
    plugins.set(rootProject.layout.projectDirectory.dir("../plugins/yt_dlp_plugins"))
    licenses.set(rootProject.layout.projectDirectory.dir("../licenses"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyRepoAssets, CopyRepoAssetsTask::outputDir)
    }
}

dependencies {
    val ytdl = "0.18.1"
    implementation("io.github.junkfood02.youtubedl-android:library:$ytdl") {
        // library tidak memakai AppCompat sama sekali (dicek dari bytecode) -> hemat ukuran APK
        exclude(group = "androidx.appcompat")
    }
    // Catatan: artifact youtubedl-android:ffmpeg (±35 MB) sengaja TIDAK dipakai.

    val media3 = "1.5.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-ui:$media3")

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
