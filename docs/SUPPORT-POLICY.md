# Compatibility and release checks

Support is maintained by testing and updating, not by claiming every platform always works.

- Android bundles the current stable yt-dlp at build time and supports updating the upstream engine from the app. Custom extractor code is bundled in signed APKs; custom plugin changes require a new APK release.
- 48 featured platforms have separate metadata folders; only 11 currently have project-specific extractors. Remaining sites depend on yt-dlp upstream support. Folder presence does not certify a platform.
- Weekly and manually dispatched `Extractor compatibility probes` run 4 public sample links (YouTube, TikTok video/photo, Twitter gallery). They extract metadata only, impose per-probe timeouts, retain reports, and maintain an issue if failures occur. They run on CI IPs, so results are not a certification of Android devices or all sites.
- Fixtures can disappear. When a sample fails, first distinguish removed content, network/anti-bot and actual regressions. Replace a fixture only when the sample is invalid, not to hide a failure.
- Before a tagged release can publish: build all three architectures, verify 48 metadata files and 11 extractors in the APK, verify release signing matches v1.3.4, and pass emulator smoke. Crashes/terminated processes now fail the smoke job, rather than always returning exit 0.
- Emulator smoke exercises existing UI/link flows and captures screenshots/logs. It does not assert every platform, every download codec or every device configuration; live-probe reports must be read separately.
- Release assets include SHA256SUMS.txt. APK hosting links refresh explicitly after publishing because GitHub releases created by GITHUB_TOKEN do not automatically trigger other workflows.
- Login, geo restrictions, anti-bot, DRM and deleted/private posts remain limitations. Failures need triage, and no always-on human maintenance or guaranteed future fixes are implied by the scheduled checks.
