// When the camera captured a recording's first frame, so playback can line
// this angle up by time instead of by sound. Chrome and Edge report each
// camera frame's capture time (requestVideoFrameCallback's captureTime);
// Firefox and Safari don't, and keep the time the recorder said it started.
//
// A hidden <video> plays the camera stream for as long as the session page is
// open; asking for the next frame right before the recorder starts gets the
// first frame it records.
export function createFrameWatcher(stream) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.play().catch(() => {});
  const supported = "requestVideoFrameCallback" in HTMLVideoElement.prototype;

  return {
    /// Resolves with the next frame's capture time on performance.now()'s
    /// clock, or null when the browser can't say.
    nextFrameCaptureTime() {
      if (!supported) return Promise.resolve(null);
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 2000);
        video.requestVideoFrameCallback((_, metadata) => {
          clearTimeout(timer);
          resolve(Number.isFinite(metadata?.captureTime) ? metadata.captureTime : null);
        });
      });
    },
    stop() {
      video.pause();
      video.srcObject = null;
    },
  };
}
