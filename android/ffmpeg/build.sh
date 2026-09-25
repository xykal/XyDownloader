#!/usr/bin/env bash
# =============================================================================
# DownloadAja — FFmpeg minimal untuk Android (built in XyVerse)
# -----------------------------------------------------------------------------
# youtubedl-android versi penuh membawa FFmpeg Termux + ±40 library (aom, x265,
# svt-av1, gnutls, glib, harfbuzz, ...) = 35 MB di dalam APK. Padahal yt-dlp di
# aplikasi ini hanya butuh:
#   - merge video + audio (stream copy)        -> mp4 / webm / mkv
#   - konversi MP3 (libmp3lame) & M4A (aac)
#   - perbaikan hasil HLS/DASH (aac_adtstoasc, faststart, dll)
#   - ugoira pixiv (frame JPG/PNG) -> MP4 (encoder mpeg4)
# Script ini mem-build FFmpeg STATIS berisi komponen itu saja (±2 MB).
# (decoder vp9 ikut disertakan: muxer MP4 butuh info profil/pix_fmt VP9 untuk box vpcC)
#
# Lisensi hasil build: LGPL-2.1-or-later (FFmpeg tanpa --enable-gpl) + LAME (LGPL).
#
# Pemakaian:
#   ANDROID_NDK_HOME=/path/ndk ./build.sh <out-dir> arm64-v8a armeabi-v7a x86_64
#   ./build.sh <out-dir> host          # build untuk Linux (tes komponen di PC/CI)
# Hasil: <out-dir>/<abi>/libffmpeg.so   (executable ffmpeg; diberi nama lib*.so
#        supaya Android meng-install-nya ke nativeLibraryDir yang boleh dieksekusi)
# =============================================================================
set -euo pipefail

FFMPEG_VERSION=8.0.3
FFMPEG_SHA256=6136812ea6d4e68bdba27e33c2a94382711cdf4f8602ffef056ff792bd6f9818
LAME_VERSION=3.100
LAME_SHA256=ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e
API=24

OUT=$(mkdir -p "${1:?out-dir}" && cd "$1" && pwd)
shift
ABIS=("$@")
[ ${#ABIS[@]} -gt 0 ] || { echo "sebutkan minimal satu ABI" >&2; exit 2; }

WORK=${WORK_DIR:-$(pwd)/.ffmpeg-work}
mkdir -p "$WORK/src"
JOBS=$(nproc 2>/dev/null || echo 4)

fetch() { # url sha256 dest
  local url=$1 sum=$2 dest=$3
  if [ ! -f "$dest" ] || ! echo "$sum  $dest" | sha256sum -c --quiet - 2>/dev/null; then
    for i in 1 2 3 4; do
      curl -fsSL --retry 3 -o "$dest.tmp" "$url" && mv "$dest.tmp" "$dest" && break
      echo "download gagal ($url), ulang $i..." >&2; sleep $((i * 5))
    done
  fi
  echo "$sum  $dest" | sha256sum -c --quiet - || { echo "checksum salah: $dest" >&2; exit 1; }
}

fetch "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" "$FFMPEG_SHA256" "$WORK/src/ffmpeg.tar.xz"
if ! fetch "https://downloads.sourceforge.net/project/lame/lame/${LAME_VERSION}/lame-${LAME_VERSION}.tar.gz" \
      "$LAME_SHA256" "$WORK/src/lame.tar.gz" 2>/dev/null; then
  fetch "https://deb.debian.org/debian/pool/main/l/lame/lame_${LAME_VERSION}.orig.tar.gz" "$LAME_SHA256" "$WORK/src/lame.tar.gz"
fi

# ---- komponen FFmpeg (satu-satunya tempat daftar ini diatur) -----------------
PROTOCOLS=file,pipe
DEMUXERS=mov,matroska,mpegts,aac,mp3,ogg,flac,wav,flv,avi,concat,gif,image2,image_jpeg_pipe,image_png_pipe,image_gif_pipe,image_webp_pipe
MUXERS=mp4,ipod,mov,matroska,webm,mp3,adts,ogg,opus,flac,wav,mpegts,null
DECODERS=aac,aac_fixed,aac_latm,mp3,mp3float,opus,vorbis,flac,alac,pcm_s16le,pcm_s16be,pcm_s24le,pcm_f32le,pcm_u8,mjpeg,png,gif,bmp,vp9
ENCODERS=libmp3lame,aac,mpeg4
PARSERS=aac,aac_latm,h264,hevc,mpegaudio,opus,vorbis,flac,vp8,vp9,av1,mjpeg,png,gif,mpeg4video,ac3
BSFS=aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,extract_extradata,vp9_superframe,vp9_superframe_split,av1_frame_merge,av1_frame_split,setts,dump_extradata,null
FILTERS=aresample,aformat,anull,null,scale,format,pad,fps,setpts,asetpts,copy,acopy,crop,transpose,hflip,vflip,trim,atrim,split,concat

COMMON_FLAGS=(
  --enable-pic --enable-static --disable-shared --enable-small
  --disable-debug --disable-doc --disable-programs --enable-ffmpeg
  --disable-autodetect --enable-zlib --disable-network --disable-avdevice
  --disable-everything
  --enable-protocol=$PROTOCOLS --enable-demuxer=$DEMUXERS --enable-muxer=$MUXERS
  --enable-decoder=$DECODERS --enable-encoder=$ENCODERS --enable-parser=$PARSERS
  --enable-bsf=$BSFS --enable-filter=$FILTERS
  --enable-libmp3lame
)

build_one() {
  local abi=$1 prefix="$WORK/$abi" b="$WORK/build-$abi"
  rm -rf "$b" "$prefix"; mkdir -p "$b" "$prefix"
  local cc ar ranlib strip lame_host cflags ldflags
  local -a cross=()
  if [ "$abi" = host ]; then
    cc=${CC:-gcc}; ar=ar; ranlib=ranlib; strip=strip; lame_host=""
    cflags="-O2 -fPIC"; ldflags=""
    cross=(--disable-x86asm)
  else
    local ndk=${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}
    [ -d "$ndk" ] || { echo "ANDROID_NDK_HOME belum diset" >&2; exit 1; }
    local tc="$ndk/toolchains/llvm/prebuilt/linux-x86_64" triple arch cpu extra=()
    case $abi in
      arm64-v8a)   triple=aarch64-linux-android;    arch=aarch64; cpu=armv8-a; lame_host=aarch64-linux; cflags="" ;;
      armeabi-v7a) triple=armv7a-linux-androideabi; arch=arm;     cpu=armv7-a; lame_host=arm-linux
                   cflags="-march=armv7-a -mfpu=neon -mfloat-abi=softfp"; extra=(--enable-neon --enable-thumb) ;;
      x86_64)      triple=x86_64-linux-android;     arch=x86_64;  cpu="";      lame_host=x86_64-linux; cflags=""
                   extra=(--disable-asm) ;;
      *) echo "ABI tidak dikenal: $abi" >&2; exit 2 ;;
    esac
    cc="$tc/bin/${triple}${API}-clang"; ar="$tc/bin/llvm-ar"; ranlib="$tc/bin/llvm-ranlib"; strip="$tc/bin/llvm-strip"
    cflags="-O2 -fPIC -ffunction-sections -fdata-sections $cflags"
    # 16 KB page size (Android 15+) + buang section yang tidak terpakai
    ldflags="-Wl,-z,max-page-size=16384 -Wl,--gc-sections"
    cross=(--target-os=android --enable-cross-compile --arch="$arch" ${cpu:+--cpu="$cpu"}
           --cc="$cc" --cxx="$cc++" --ld="$cc" --ar="$ar" --nm="$tc/bin/llvm-nm" --ranlib="$ranlib"
           --strip="$strip" --sysroot="$tc/sysroot" --pkg-config=false "${extra[@]}")
  fi

  echo "::group::LAME $LAME_VERSION ($abi)"
  tar -xzf "$WORK/src/lame.tar.gz" -C "$b"
  ( cd "$b/lame-$LAME_VERSION"
    # simbol lama yang tidak ada di header -> gagal link di toolchain baru
    sed -i '/lame_init_old/d' include/libmp3lame.sym || true
    CC="$cc" AR="$ar" RANLIB="$ranlib" CFLAGS="$cflags" ./configure ${lame_host:+--host=$lame_host} \
      --prefix="$prefix" --enable-static --disable-shared --with-pic --disable-frontend \
      --disable-decoder --disable-analyzer-hooks --disable-gtktest >/dev/null
    make -j"$JOBS" >/dev/null && make install >/dev/null )
  echo "::endgroup::"

  echo "::group::FFmpeg $FFMPEG_VERSION ($abi)"
  tar -xJf "$WORK/src/ffmpeg.tar.xz" -C "$b"
  ( cd "$b/ffmpeg-$FFMPEG_VERSION"
    ./configure --prefix="$prefix" "${cross[@]}" "${COMMON_FLAGS[@]}" \
      --extra-cflags="$cflags -I$prefix/include" --extra-ldflags="$ldflags -L$prefix/lib" \
      --extra-libs="-lm" || { tail -n 60 ffbuild/config.log; exit 1; }
    make -j"$JOBS" ffmpeg >/dev/null
    mkdir -p "$OUT/$abi"
    "$strip" -o "$OUT/$abi/libffmpeg.so" ffmpeg )
  echo "::endgroup::"
  ls -la "$OUT/$abi/libffmpeg.so"
}

for abi in "${ABIS[@]}"; do build_one "$abi"; done
{ echo "FFmpeg $FFMPEG_VERSION (LGPL-2.1-or-later) + LAME $LAME_VERSION (LGPL)"
  echo "demuxers: $DEMUXERS"; echo "muxers: $MUXERS"; echo "decoders: $DECODERS"; echo "encoders: $ENCODERS"
  echo "filters: $FILTERS"; echo "bsfs: $BSFS"; } > "$OUT/BUILDINFO.txt"
echo "selesai -> $OUT"
