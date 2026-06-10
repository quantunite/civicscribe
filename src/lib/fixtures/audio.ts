// Synthetic WAV generation for mock mode. Produces a small but fully valid
// 16-bit PCM mono WAV file containing a soft 440 Hz tone, so the audio player
// in the UI has something audibly real to stream during mock-mode e2e runs.

const SAMPLE_RATE = 8_000; // 8 kHz keeps files tiny (~16 KB/s) but playable.
const TONE_HZ = 440;
const AMPLITUDE = Math.round(0.15 * 0x7fff); // soft, not full-scale
const WAV_HEADER_BYTES = 44;

/**
 * Generate a valid 16-bit PCM mono WAV buffer of the given duration.
 * Deterministic: the same duration always yields byte-identical output.
 */
export function synthesizeWav(durationSeconds: number): Buffer {
  const numSamples = Math.max(1, Math.floor(durationSeconds * SAMPLE_RATE));
  const dataSize = numSamples * 2; // 16-bit mono => 2 bytes per sample
  const buffer = Buffer.alloc(WAV_HEADER_BYTES + dataSize);

  // RIFF chunk descriptor
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");

  // "fmt " sub-chunk (PCM)
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // sub-chunk size for PCM
  buffer.writeUInt16LE(1, 20); // audio format: 1 = PCM
  buffer.writeUInt16LE(1, 22); // channels: mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate = rate * align
  buffer.writeUInt16LE(2, 32); // block align = channels * bytesPerSample
  buffer.writeUInt16LE(16, 34); // bits per sample

  // "data" sub-chunk
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  // Soft sine tone with a short fade in/out so playback has no clicks.
  const angularStep = (2 * Math.PI * TONE_HZ) / SAMPLE_RATE;
  const fadeSamples = Math.min(
    Math.floor(SAMPLE_RATE * 0.05),
    Math.floor(numSamples / 2)
  );
  for (let i = 0; i < numSamples; i++) {
    let gain = 1;
    if (fadeSamples > 0) {
      if (i < fadeSamples) {
        gain = i / fadeSamples;
      } else if (i >= numSamples - fadeSamples) {
        gain = (numSamples - 1 - i) / fadeSamples;
      }
    }
    const sample = Math.round(AMPLITUDE * gain * Math.sin(angularStep * i));
    buffer.writeInt16LE(sample, WAV_HEADER_BYTES + i * 2);
  }

  return buffer;
}
