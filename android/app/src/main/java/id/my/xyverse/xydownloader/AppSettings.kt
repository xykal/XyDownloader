package id.my.xyverse.xydownloader

import android.content.Context

/** Preferensi pengguna (web-parity): preview, kualitas default, hemat data. */
object AppSettings {
    private const val PREFS = "dlaja_settings_v1"

    const val TIER_HEMAT = "hemat"
    const val TIER_NORMAL = "normal"
    const val TIER_TINGGI = "tinggi"
    const val TIER_MAX = "maksimal"
    const val TIER_AUTO = "auto"

    private fun p(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun autoplayVideo(ctx: Context) = p(ctx).getBoolean("autoplayVideo", true)
    fun setAutoplayVideo(ctx: Context, v: Boolean) = p(ctx).edit().putBoolean("autoplayVideo", v).apply()

    fun autoplayMusic(ctx: Context) = p(ctx).getBoolean("autoplayMusic", true)
    fun setAutoplayMusic(ctx: Context, v: Boolean) = p(ctx).edit().putBoolean("autoplayMusic", v).apply()

    fun openMusicPlayer(ctx: Context) = p(ctx).getBoolean("openMusicPlayer", true)
    fun setOpenMusicPlayer(ctx: Context, v: Boolean) = p(ctx).edit().putBoolean("openMusicPlayer", v).apply()

    fun dataSaver(ctx: Context) = p(ctx).getBoolean("dataSaver", false)
    fun setDataSaver(ctx: Context, v: Boolean) = p(ctx).edit().putBoolean("dataSaver", v).apply()

    fun defaultVideoTier(ctx: Context) = p(ctx).getString("defaultVideoTier", TIER_NORMAL) ?: TIER_NORMAL
    fun setDefaultVideoTier(ctx: Context, v: String) = p(ctx).edit().putString("defaultVideoTier", v).apply()

    fun defaultAudioKbps(ctx: Context) = p(ctx).getInt("defaultAudioKbps", 192)
    fun setDefaultAudioKbps(ctx: Context, v: Int) = p(ctx).edit().putInt("defaultAudioKbps", v).apply()

    fun livePhotoMode(ctx: Context) = p(ctx).getString("livePhotoMode", "both") ?: "both"
    fun setLivePhotoMode(ctx: Context, v: String) = p(ctx).edit().putString("livePhotoMode", v).apply()

    /** Pilih tinggi video default dari daftar opsi (sisi pendek). */
    fun pickVideoHeight(ctx: Context, options: List<VideoOption>): Int {
        if (options.isEmpty()) return 0
        val tier = defaultVideoTier(ctx)
        fun rank(h: Int) = when {
            h <= 0 -> 99
            h <= 480 -> 1
            h <= 720 -> 2
            h <= 1080 -> 3
            else -> 4
        }
        val want = when (tier) {
            TIER_HEMAT -> 1
            TIER_NORMAL, TIER_AUTO -> 2
            TIER_TINGGI -> 3
            TIER_MAX -> 4
            else -> 2
        }
        if (tier == TIER_MAX) return options.maxOf { it.height }
        return options.minBy { kotlin.math.abs(rank(it.height) - want) }.height
    }
}
