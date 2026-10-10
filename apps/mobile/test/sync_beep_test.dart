import 'dart:math' as math;
import 'dart:typed_data';

import 'package:camerasync_mobile/sync_beep.dart';
import 'package:flutter_test/flutter_test.dart';

// Share of a stretch's energy at [hz]: 1 for a pure tone at that pitch.
double toneShare(List<int> samples, int rate, double hz) {
  final coeff = 2 * math.cos(2 * math.pi * hz / rate);
  var s1 = 0.0, s2 = 0.0, energy = 0.0;
  for (final x in samples) {
    final s0 = x + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
    energy += x * x;
  }
  final power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return power / (energy * samples.length / 2);
}

void main() {
  test('the beep is a mono 16-bit WAV of two tones back to back', () {
    const rate = 16000;
    final wav = syncBeepWav(sampleRate: rate);
    final header = ByteData.sublistView(wav, 0, 44);
    expect(String.fromCharCodes(wav.sublist(0, 4)), 'RIFF');
    expect(String.fromCharCodes(wav.sublist(8, 12)), 'WAVE');
    expect(header.getUint16(22, Endian.little), 1);
    expect(header.getUint32(24, Endian.little), rate);

    final samples = Int16List.sublistView(wav, 44);
    const tone = rate * kSyncBeepToneMs ~/ 1000;
    expect(samples.length, tone * 2);

    // The middle of each half is almost entirely its own pitch, which is
    // what the server listens for.
    final first = samples.sublist(tone ~/ 4, tone * 3 ~/ 4);
    final second = samples.sublist(tone + tone ~/ 4, tone + tone * 3 ~/ 4);
    expect(toneShare(first, rate, kSyncBeepTonesHz[0].toDouble()), greaterThan(0.9));
    expect(toneShare(second, rate, kSyncBeepTonesHz[1].toDouble()), greaterThan(0.9));
    expect(toneShare(first, rate, kSyncBeepTonesHz[1].toDouble()), lessThan(0.05));
  });
}
