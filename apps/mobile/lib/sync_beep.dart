import 'dart:math' as math;
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';

/// The sync beep: a short two-tone chirp the device that starts a take plays
/// a moment after the shared start, like a film clapboard. The server finds
/// it in every angle's audio and lines the angles up by it. Same tones as
/// the web app's src/recording/syncBeep.js and the server's
/// src/recordings/syncBeep.js, which listens for them; keep the three in
/// step.
const kSyncBeepTonesHz = [2800, 4200];
const kSyncBeepToneMs = 120;

/// The beep as a 16-bit mono WAV file.
Uint8List syncBeepWav({int sampleRate = 44100}) {
  final toneSamples = sampleRate * kSyncBeepToneMs ~/ 1000;
  final ramp = sampleRate * 5 ~/ 1000;
  final samples = Int16List(toneSamples * kSyncBeepTonesHz.length);
  for (var t = 0; t < kSyncBeepTonesHz.length; t++) {
    final hz = kSyncBeepTonesHz[t];
    for (var n = 0; n < toneSamples; n++) {
      // Short ramps so the tones don't click, which would smear their pitch.
      final edge = math.min(n, toneSamples - 1 - n);
      final level = edge < ramp ? edge / ramp : 1.0;
      samples[t * toneSamples + n] =
          (0.7 * level * 32767 * math.sin(2 * math.pi * hz * n / sampleRate))
              .round();
    }
  }

  final data = samples.buffer.asUint8List();
  final header = ByteData(44)
    ..setUint32(0, 0x52494646) // "RIFF"
    ..setUint32(4, 36 + data.length, Endian.little)
    ..setUint32(8, 0x57415645) // "WAVE"
    ..setUint32(12, 0x666d7420) // "fmt "
    ..setUint32(16, 16, Endian.little)
    ..setUint16(20, 1, Endian.little) // PCM
    ..setUint16(22, 1, Endian.little) // mono
    ..setUint32(24, sampleRate, Endian.little)
    ..setUint32(28, sampleRate * 2, Endian.little)
    ..setUint16(32, 2, Endian.little)
    ..setUint16(34, 16, Endian.little)
    ..setUint32(36, 0x64617461) // "data"
    ..setUint32(40, data.length, Endian.little);
  return Uint8List.fromList([...header.buffer.asUint8List(), ...data]);
}

/// Plays the beep. [prepare] loads it ahead of time so [play] starts as
/// close to on time as the phone allows.
class SyncBeep {
  final AudioPlayer _player = AudioPlayer();

  Future<void> prepare() async {
    await _player.setReleaseMode(ReleaseMode.stop);
    await _player.setSource(BytesSource(syncBeepWav(), mimeType: 'audio/wav'));
  }

  Future<void> play() => _player.resume();

  Future<void> dispose() => _player.dispose();
}
