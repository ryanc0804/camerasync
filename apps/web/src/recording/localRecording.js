// tries mp4 first and falls back to webm
const RECORDING_FORMATS = [
  { mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", extension: "mp4" },
  { mimeType: "video/mp4", extension: "mp4" },
  { mimeType: "video/webm;codecs=vp9,opus", extension: "webm" },
  { mimeType: "video/webm;codecs=vp8,opus", extension: "webm" },
  { mimeType: "video/webm", extension: "webm" },
];

// creates a recorder from the selected local stream
export function createLocalRecorder(stream) {
  if (!window.MediaRecorder) {
    throw new Error("This browser does not support local recording.");
  }

  const format = RECORDING_FORMATS.find(({ mimeType }) =>
    MediaRecorder.isTypeSupported(mimeType)
  );
  const recorder = format
    ? new MediaRecorder(stream, { mimeType: format.mimeType })
    : new MediaRecorder(stream);

  return {
    recorder,
    extension:
      format?.extension ||
      (recorder.mimeType.includes("mp4") ? "mp4" : "webm"),
  };
}

// keeps recording names sortable by their start time
export function recordingBaseName({
  sessionName,
  sessionId,
  userId,
  recordingNumber,
  plannedStartAtEpochMs,
}) {
  const date = new Date(plannedStartAtEpochMs);
  const parts = [
    String(date.getFullYear()).slice(-2),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ];
  const safeName =
    String(sessionName)
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || sessionId;

  return `${parts.join("-")}-${userId}-${safeName}_recording_${recordingNumber}`;
}

// downloads the finished file through the browser
export function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pad(number) {
  return String(number).padStart(2, "0");
}
