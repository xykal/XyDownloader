package id.my.xyverse.xydownloader

import android.content.Context
import org.json.JSONObject

/** Komponen open source (assets/licenses/components.json, disalin dari folder licenses/ di repo). */
data class LicenseItem(
    val name: String,
    val license: String,
    val file: String,
    val url: String,
    val copyright: String,
    val note: String,
)

object Licenses {
    data class Catalog(val items: List<LicenseItem>, val trademarks: String)

    fun load(ctx: Context): Catalog = try {
        val o = JSONObject(ctx.assets.open("licenses/components.json").bufferedReader().use { it.readText() })
        val arr = o.optJSONArray("android")
        val items = ArrayList<LicenseItem>()
        for (i in 0 until (arr?.length() ?: 0)) {
            val c = arr!!.optJSONObject(i) ?: continue
            items.add(
                LicenseItem(
                    name = c.optString("name"), license = c.optString("license"), file = c.optString("file"),
                    url = c.optString("url"), copyright = c.optString("copyright"), note = c.optString("note"),
                )
            )
        }
        Catalog(items, o.optString("trademarks"))
    } catch (e: Exception) {
        Catalog(emptyList(), "")
    }

    fun text(ctx: Context, file: String): String = try {
        ctx.assets.open("licenses/texts/$file").bufferedReader().use { it.readText() }
    } catch (e: Exception) {
        "Teks lisensi tidak ditemukan ($file)."
    }
}
