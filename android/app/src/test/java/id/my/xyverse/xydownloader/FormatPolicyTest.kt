package id.my.xyverse.xydownloader

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class FormatPolicyTest {
    private fun video(id: String, codec: String = "avc1", height: Int = 720, audio: String = "none") = JSONObject()
        .put("format_id", id).put("vcodec", codec).put("acodec", audio)
        .put("width", height * 2).put("height", height).put("ext", "mp4")
        .put("url", "https://example.org/$id.mp4").put("protocol", "https")
    private fun json(vararg fs: JSONObject) = JSONObject().put("extractor_key", "Test").put("formats", JSONArray(fs.toList()))

    @Test fun preservesAllVariantsNotEightResolutions() {
        val variants = (1..12).map { video("v$it", if (it % 2 == 0) "hevc" else "avc1") }
        val options = InfoParser.videoOptions(json(*variants.toTypedArray()))
        assertEquals(12, options.size)
        assertEquals(setOf("HEVC", "H.264"), options.map { it.codec }.toSet())
        assertEquals(12, options.map { it.formatId }.distinct().size)
        assertTrue(options.all { it.selector == "${it.formatId}+ba" })
    }
    @Test fun muxedSelectionIsExactAndNotDoubleAudio() {
        val option = InfoParser.videoOptions(json(video("muxed", audio = "aac"))).single()
        assertEquals("muxed", option.selector)
    }
    @Test fun sourceAudioKeepsCodecAndLanguageVariants() {
        val a = video("a-en", "none", 0, "opus").put("ext", "webm").put("language", "en").put("abr", 128)
        val b = video("a-id", "none", 0, "aac").put("ext", "m4a").put("language", "id").put("abr", 96)
        val info = InfoParser.parse(json(a, b), "https://example.org/item")
        assertEquals(0, info.videoOptions.size)
        assertEquals(listOf("a-en", "a-id"), info.audioOptions.map { it.formatId })
        assertTrue(info.audioOptions[0].label.contains("opus"))
        assertTrue(info.audioOptions[1].label.contains("id"))
    }
    @Test fun excludesDrmAndStoryboardInsteadOfInventingFormat() {
        assertEquals(0, InfoParser.videoOptions(json(video("drm").put("has_drm", true), video("story").put("ext", "mhtml"))).size)
    }
    @Test fun lightweightPreviewPrefers480Over720() {
        val info = InfoParser.parse(json(video("720", height = 720, audio = "aac"), video("480", height = 480, audio = "aac")), "https://example.org/item")
        assertEquals("https://example.org/480.mp4", info.preview?.video?.url)
    }
    @Test fun selectorDoesNotAllowInjectedFallbacks() {
        assertFalse(FormatPolicy.validId("123/best"))
        assertFalse(FormatPolicy.validSelector("123+ba/best"))
        assertTrue(FormatPolicy.validSelector("dash-video_01.2+ba"))
    }
}
