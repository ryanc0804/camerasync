/// Display name for a recording: "YY-MM-DD HH:MM:SS - Recording 001", with
/// the shared start time in the phone's local time. Mirrors
/// recordingDisplayName in apps/web/src/recording/localRecording.js.
String recordingDisplayName(int startedAtEpochMs, int number) {
  final d = DateTime.fromMillisecondsSinceEpoch(startedAtEpochMs).toLocal();
  String two(int v) => v.toString().padLeft(2, '0');
  final stamp = '${two(d.year % 100)}-${two(d.month)}-${two(d.day)}';
  final time = '${two(d.hour)}:${two(d.minute)}:${two(d.second)}';
  return '$stamp $time - Recording ${number.toString().padLeft(3, '0')}';
}

/// "m:ss" or "h:mm:ss" for playback clocks.
String formatClock(Duration d) {
  String two(int v) => v.toString().padLeft(2, '0');
  final h = d.inHours;
  final m = d.inMinutes.remainder(60);
  final s = d.inSeconds.remainder(60);
  return h > 0 ? '$h:${two(m)}:${two(s)}' : '${two(m)}:${two(s)}';
}
