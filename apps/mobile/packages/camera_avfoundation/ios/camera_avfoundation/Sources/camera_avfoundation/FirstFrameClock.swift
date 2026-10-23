// Added for 8kount (not part of the upstream plugin).

import CoreMedia
import Flutter
import Foundation

/// When the current recording's first frame was captured, on this phone's
/// wall clock (ms since the epoch), so the app can line angles up by time
/// instead of by sound.
///
/// The writer starts the file at the first video frame's presentation time,
/// which is on the host time clock; how long ago that was, taken from now,
/// gives the wall-clock moment.
enum FirstFrameClock {
  private static let lock = NSLock()
  private static var epochMs: Int64?

  /// A new recording: forget the last one's.
  static func reset() {
    lock.lock()
    epochMs = nil
    lock.unlock()
  }

  /// The first frame written, with its presentation time.
  static func noteFirstFrame(at sampleTime: CMTime) {
    let hostNow = CMClockGetTime(CMClockGetHostTimeClock())
    let ago = CMTimeGetSeconds(CMTimeSubtract(hostNow, sampleTime))
    guard ago.isFinite, ago >= 0, ago < 10 else { return }
    let ms = Int64((Date().timeIntervalSince1970 - ago) * 1000)
    lock.lock()
    epochMs = ms
    lock.unlock()
  }

  static func setUp(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(
      name: "app.eightkount/first_frame", binaryMessenger: messenger)
    channel.setMethodCallHandler { call, result in
      guard call.method == "get" else {
        result(FlutterMethodNotImplemented)
        return
      }
      FirstFrameClock.lock.lock()
      let value = FirstFrameClock.epochMs
      FirstFrameClock.lock.unlock()
      result(value.map { NSNumber(value: $0) })
    }
  }
}
