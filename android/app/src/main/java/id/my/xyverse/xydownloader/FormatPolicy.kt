package id.my.xyverse.xydownloader

/** Exact source selectors; do not silently substitute another codec/resolution. */
object FormatPolicy {
    fun validId(id: String) = id.matches(Regex("[A-Za-z0-9_.:-]+"))
    fun videoSelector(id: String, audioSeparate: Boolean): String {
        require(validId(id))
        return if (audioSeparate) "$id+ba" else id
    }
    fun validSelector(selector: String) = selector.removeSuffix("+ba").let { validId(it) }
}
