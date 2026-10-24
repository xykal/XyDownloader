package id.my.xyverse.xydownloader

import id.my.xyverse.xydownloader.engines.PlatformRuntime
import org.junit.Assert.*
import org.junit.Test

class PlatformRuntimeTest {
    @Test fun twitterOwnsItsRuntimePolicy() {
        assertEquals(listOf("syndication", null), PlatformRuntime.forUrl("https://x.com/a/status/1").attempts())
        assertEquals("twitter", PlatformRuntime.forUrl("https://twitter.com/a/status/1").id)
    }
    @Test fun unrelatedHostsNeverReceiveTwitterPolicy() {
        for (url in listOf("https://eviltwitter.com/a", "https://twitter.com.evil.test/a", "https://youtube.com/a")) {
            assertEquals("default", PlatformRuntime.forUrl(url).id)
            assertEquals(listOf<String?>(null), PlatformRuntime.forUrl(url).attempts())
        }
    }
}
