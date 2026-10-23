import 'package:flutter/foundation.dart';

/// The most data a take may use per second, so no phone makes files too big
/// to upload on a gym's Wi-Fi. Cameras aim at this as an average (a little
/// under in still scenes). Resolution and frame rate don't change: still
/// 1080p at 30 fps, every moment kept; only fine detail in fast motion
/// gives a little.
///
/// Android records H.264, iPhone HEVC, which needs about two thirds the data
/// for the same picture, so these look about the same. Android's default
/// was ~21 Mbps (160 MB a minute); this is ~90 MB. Keep in step with the web
/// app's src/recording/localRecording.js.
const kAndroidVideoBitrate = 12000000;
const kIosVideoBitrate = 8000000;
const kAudioBitrate = 128000;

int videoBitrateFor(TargetPlatform platform) =>
    platform == TargetPlatform.iOS ? kIosVideoBitrate : kAndroidVideoBitrate;
