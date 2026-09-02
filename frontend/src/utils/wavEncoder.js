// Encodes captured microphone samples as a WAV file.
//
// Why not MediaRecorder: in Chrome it only produces WebM/Opus, and Gemini does
// not accept WebM audio. Capturing raw PCM and writing the WAV ourselves gives
// a format Gemini definitely accepts, and has a second benefit - every upload
// is a complete, self-contained file, so partial transcripts no longer depend
// on a container header that only exists in the first chunk.

/** Speech-recognition sample rate. Higher rates cost bandwidth for no gain. */
export const TARGET_SAMPLE_RATE = 16000

/**
 * Reduce a Float32 buffer to `targetRate` by averaging each source window.
 * Averaging rather than picking one sample avoids the aliasing you get from
 * naive decimation, which makes speech sound harsh and hurts recognition.
 */
export function downsample(samples, inputRate, targetRate = TARGET_SAMPLE_RATE) {
  if (targetRate >= inputRate) return samples

  const ratio = inputRate / targetRate
  const outLength = Math.floor(samples.length / ratio)
  const out = new Float32Array(outLength)

  for (let i = 0; i < outLength; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.min(Math.floor((i + 1) * ratio), samples.length)
    let sum = 0
    for (let j = start; j < end; j += 1) sum += samples[j]
    out[i] = end > start ? sum / (end - start) : 0
  }
  return out
}

/** Join recorded chunks into one contiguous buffer. */
export function concatChunks(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * Write mono 16-bit PCM WAV bytes.
 *
 * @param {Float32Array} samples normalised to -1..1
 * @param {number} sampleRate of `samples`
 * @returns {Blob} audio/wav
 */
export function encodeWav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const bytesPerSample = 2
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample)
  const view = new DataView(buffer)

  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }

  const byteRate = sampleRate * bytesPerSample
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * bytesPerSample, true) // file size - 8
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header size
  view.setUint16(20, 1, true) // format: PCM
  view.setUint16(22, 1, true) // channels: mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, bytesPerSample, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, samples.length * bytesPerSample, true)

  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    // Clamp before scaling: values outside -1..1 would wrap and click.
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += bytesPerSample
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

/** Chunks → downsampled → WAV blob, in one step. */
export function chunksToWav(chunks, inputRate) {
  const merged = concatChunks(chunks)
  const reduced = downsample(merged, inputRate, TARGET_SAMPLE_RATE)
  return encodeWav(reduced, TARGET_SAMPLE_RATE)
}
