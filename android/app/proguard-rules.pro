# XyDownloader — aturan R8 (built in XyVerse)

# youtubedl-android: library kecil; simpan utuh (dipanggil dari kode kita + reflection Jackson di mapper)
-keep class com.yausername.** { *; }

# Jackson (dibuat oleh youtubedl-android saat inisialisasi)
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-keep class com.fasterxml.jackson.annotation.** { *; }
-keep class com.fasterxml.jackson.databind.ext.** { *; }
-dontwarn com.fasterxml.jackson.databind.**
-dontwarn java.beans.**
-dontwarn org.w3c.dom.bootstrap.**

# commons-compress / commons-io: dependensi opsional yang tidak dipakai
-dontwarn org.apache.commons.compress.**
-dontwarn org.apache.commons.io.**
-dontwarn org.tukaani.xz.**
-dontwarn com.github.luben.zstd.**
-dontwarn org.brotli.dec.**
-dontwarn org.objectweb.asm.**
-dontwarn javax.annotation.**
-dontwarn org.slf4j.**
