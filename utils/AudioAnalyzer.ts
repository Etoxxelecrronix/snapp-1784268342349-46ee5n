import * as FileSystem from 'expo-file-system';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnalysisResult {
  uri: string;
  filename: string;
  duration: number;        // seconds
  sampleRate: number;
  channels: number;
  format: string;
  // Rhythm
  bpm: number;             // e.g. 128.00
  bpmConfidence: number;   // 0–1
  tempoStability: number;  // 0–1
  beatgrid: number[];      // beat timestamps (seconds)
  downbeats: number[];     // every 4th beat (seconds)
  // Key
  musicalKey: string;      // e.g. "C Minor"
  camelotKey: string;      // e.g. "10A"
  openKey: string;         // e.g. "12m"
  keyConfidence: number;   // 0–1
  // Loudness
  lufs: number;            // integrated LUFS (ITU-R BS.1770 approx.)
  rms: number;             // dBFS
  peak: number;            // dBFS
  // Waveform
  waveform: number[];      // 200 normalized RMS blocks, 0–1
  // Meta
  analysisSource: 'pcm_wav' | 'pcm_aiff' | 'metadata_only' | 'estimated';
  timestamp: number;
  error?: string;
}

// ─── Constants & maps ─────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Krumhansl-Kessler key profiles
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Camelot wheel (key_mode → camelot)
const CAMELOT_MAP: Record<string, string> = {
  C_major: '8B', G_major: '9B', D_major: '10B', A_major: '11B',
  E_major: '12B', B_major: '1B', 'F#_major': '2B', 'C#_major': '3B',
  'G#_major': '4B', 'D#_major': '5B', 'A#_major': '6B', F_major: '7B',
  A_minor: '8A', E_minor: '9A', B_minor: '10A', 'F#_minor': '11A',
  'C#_minor': '12A', 'G#_minor': '1A', 'D#_minor': '2A', 'A#_minor': '3A',
  F_minor: '4A', C_minor: '5A', G_minor: '6A', D_minor: '7A',
};

// Open Key notation (key_mode → open key)
const OPEN_KEY_MAP: Record<string, string> = {
  C_major: '1d', G_major: '2d', D_major: '3d', A_major: '4d',
  E_major: '5d', B_major: '6d', 'F#_major': '7d', 'C#_major': '8d',
  'G#_major': '9d', 'D#_major': '10d', 'A#_major': '11d', F_major: '12d',
  A_minor: '1m', E_minor: '2m', B_minor: '3m', 'F#_minor': '4m',
  'C#_minor': '5m', 'G#_minor': '6m', 'D#_minor': '7m', 'A#_minor': '8m',
  F_minor: '9m', C_minor: '10m', G_minor: '11m', D_minor: '12m',
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function readU16LE(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8); }
function readU32LE(b: Uint8Array, o: number) {
  return ((b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24)) >>> 0);
}
function readI16BE(b: Uint8Array, o: number) {
  const v = (b[o] << 8) | b[o + 1]; return v > 32767 ? v - 65536 : v;
}
function readU32BE(b: Uint8Array, o: number) {
  return ((b[o] << 24) | (b[o+1] << 16) | (b[o+2] << 8) | b[o+3]) >>> 0;
}
function readI32BE(b: Uint8Array, o: number) {
  return (b[o] << 24) | (b[o+1] << 16) | (b[o+2] << 8) | b[o+3];
}

function readExtended80(b: Uint8Array, o: number): number {
  const exp = (((b[o] & 0x7f) << 8) | b[o + 1]) - 16383;
  const hi = readU32BE(b, o + 2);
  const lo = readU32BE(b, o + 6);
  return (hi * 4294967296 + lo) * Math.pow(2, exp - 63);
}

async function yield_(): Promise<void> {
  await new Promise<void>(r => setTimeout(r, 0));
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─── FFT (Cooley-Tukey radix-2 in-place) ─────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // bit-reversal
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  // butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + half] * cRe - im[i + k + half] * cIm;
        const vIm = re[i + k + half] * cIm + im[i + k + half] * cRe;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe; im[i + k + half] = uIm - vIm;
        const nr = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe; cRe = nr;
      }
    }
  }
}

// ─── WAV Parser ───────────────────────────────────────────────────────────────

interface PCMData {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  duration: number;
}

function parseWAV(bytes: Uint8Array): PCMData | null {
  if (bytes.length < 44) return null;
  if (
    bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46 ||
    bytes[8] !== 0x57 || bytes[9] !== 0x41 || bytes[10] !== 0x56 || bytes[11] !== 0x45
  ) return null;

  let offset = 12;
  let audioFmt = 0, numCh = 0, sr = 0, bps = 0, dataOff = -1, dataSize = 0;

  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]);
    const sz = readU32LE(bytes, offset + 4);
    if (id === 'fmt ') {
      audioFmt = readU16LE(bytes, offset + 8);
      numCh    = readU16LE(bytes, offset + 10);
      sr       = readU32LE(bytes, offset + 12);
      bps      = readU16LE(bytes, offset + 22);
    } else if (id === 'data') {
      dataOff  = offset + 8;
      dataSize = sz;
      break;
    }
    offset += 8 + sz + (sz & 1);
  }

  if (dataOff < 0 || numCh === 0 || sr === 0) return null;

  const bytesPerSample = bps >> 3;
  const totalFrames = Math.floor(dataSize / (bytesPerSample * numCh));
  const duration = totalFrames / sr;
  const mono = new Float32Array(totalFrames);

  for (let i = 0; i < totalFrames; i++) {
    let sum = 0;
    for (let c = 0; c < numCh; c++) {
      const idx = dataOff + (i * numCh + c) * bytesPerSample;
      if (idx + bytesPerSample > bytes.length) break;
      let s = 0;
      if (bps === 16) {
        s = (bytes[idx] | (bytes[idx+1] << 8)) << 16 >> 16;
        s /= 32768;
      } else if (bps === 24) {
        let v = bytes[idx] | (bytes[idx+1] << 8) | (bytes[idx+2] << 16);
        if (v & 0x800000) v |= ~0xFFFFFF;
        s = v / 8388608;
      } else if (bps === 32) {
        if (audioFmt === 3) {
          const dv = new DataView(bytes.buffer, bytes.byteOffset + idx, 4);
          s = dv.getFloat32(0, true);
        } else {
          s = ((bytes[idx] | (bytes[idx+1] << 8) | (bytes[idx+2] << 16) | (bytes[idx+3] << 24))) / 2147483648;
        }
      } else if (bps === 8) {
        s = (bytes[idx] - 128) / 128;
      }
      sum += s;
    }
    mono[i] = sum / numCh;
  }

  return { samples: mono, sampleRate: sr, channels: numCh, duration };
}

// ─── AIFF Parser ──────────────────────────────────────────────────────────────

function parseAIFF(bytes: Uint8Array): PCMData | null {
  if (bytes.length < 12) return null;
  if (
    bytes[0] !== 0x46 || bytes[1] !== 0x4F || bytes[2] !== 0x52 || bytes[3] !== 0x4D
  ) return null;
  const formType = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (formType !== 'AIFF' && formType !== 'AIFC') return null;

  let offset = 12;
  let numCh = 0, numFrames = 0, bps = 0, sr = 0, dataOff = -1;
  let isFloat = false;

  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]);
    const sz = readU32BE(bytes, offset + 4);
    if (id === 'COMM') {
      numCh    = (bytes[offset+8] << 8) | bytes[offset+9];
      numFrames = readU32BE(bytes, offset + 10);
      bps      = (bytes[offset+14] << 8) | bytes[offset+15];
      sr       = Math.round(readExtended80(bytes, offset + 16));
      if (formType === 'AIFC' && sz >= 26) {
        const ct = String.fromCharCode(bytes[offset+26], bytes[offset+27], bytes[offset+28], bytes[offset+29]);
        if (ct === 'fl32' || ct === 'FL32') isFloat = true;
      }
    } else if (id === 'SSND') {
      const ssndOff = readU32BE(bytes, offset + 8);
      dataOff = offset + 16 + ssndOff;
    }
    if (dataOff > 0 && sr > 0) break;
    offset += 8 + sz + (sz & 1);
  }

  if (dataOff < 0 || numCh === 0 || sr === 0) return null;

  const bpSample = Math.ceil(bps / 8);
  const mono = new Float32Array(numFrames);
  const dur = numFrames / sr;

  for (let i = 0; i < numFrames; i++) {
    let sum = 0;
    for (let c = 0; c < numCh; c++) {
      const idx = dataOff + (i * numCh + c) * bpSample;
      if (idx + bpSample > bytes.length) break;
      let s = 0;
      if (bps === 16) {
        s = readI16BE(bytes, idx) / 32768;
      } else if (bps === 24) {
        let v = (bytes[idx] << 16) | (bytes[idx+1] << 8) | bytes[idx+2];
        if (v & 0x800000) v -= 0x1000000;
        s = v / 8388608;
      } else if (bps === 32) {
        if (isFloat) {
          const dv = new DataView(bytes.buffer, bytes.byteOffset + idx, 4);
          s = dv.getFloat32(0, false);
        } else {
          s = readI32BE(bytes, idx) / 2147483648;
        }
      }
      sum += s;
    }
    mono[i] = sum / numCh;
  }

  return { samples: mono, sampleRate: sr, channels: numCh, duration: dur };
}

// ─── Resampling (averaging decimator) ────────────────────────────────────────

function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  const w = Math.ceil(ratio);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(start + w, samples.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / (end - start);
  }
  return out;
}

// ─── BPM Detection via Autocorrelation of Energy Envelope ────────────────────

function energyEnvelope(samples: Float32Array, frameSize: number, hopSize: number): Float32Array {
  const n = Math.floor((samples.length - frameSize) / hopSize) + 1;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * hopSize;
    let e = 0;
    for (let j = s; j < s + frameSize && j < samples.length; j++) e += samples[j] * samples[j];
    env[i] = Math.sqrt(e / frameSize);
  }
  return env;
}

function findOnsets(env: Float32Array, hopDur: number): number[] {
  const onsets: number[] = [];
  const win = 10;
  for (let i = win; i < env.length - 1; i++) {
    let avg = 0;
    for (let j = i - win; j < i; j++) avg += env[j];
    avg /= win;
    const thr = avg * 1.5 + 0.05;
    if (env[i] > thr && env[i] > env[i-1] && env[i] >= env[i+1]) {
      onsets.push(i * hopDur);
      i += 3;
    }
  }
  return onsets;
}

export interface BPMResult {
  bpm: number;
  bpmConfidence: number;
  tempoStability: number;
  beatgrid: number[];
  downbeats: number[];
}

function detectBPM(samples: Float32Array, sampleRate: number, totalDuration: number): BPMResult {
  const targetRate = 4000;
  const ds = downsample(samples, sampleRate, targetRate);

  const frameSize = 64;
  const hopSize = 32;
  const hopDur = hopSize / targetRate;
  const env = energyEnvelope(ds, frameSize, hopSize);

  // normalize
  let maxE = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > maxE) maxE = env[i];
  if (maxE > 0) for (let i = 0; i < env.length; i++) env[i] /= maxE;

  const minBPM = 60, maxBPM = 200;
  const minLag = Math.max(1, Math.floor(60 / (maxBPM * hopDur)));
  const maxLag = Math.ceil(60 / (minBPM * hopDur));

  // autocorrelation
  const ac = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0, cnt = 0;
    for (let i = 0; i + lag < env.length; i++) { sum += env[i] * env[i + lag]; cnt++; }
    ac[lag] = cnt > 0 ? sum / cnt : 0;
  }

  let bestLag = minLag, bestVal = ac[minLag];
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (ac[lag] > bestVal) { bestVal = ac[lag]; bestLag = lag; }
  }

  const period = bestLag * hopDur;
  let bpm = 60 / period;

  // half/double tempo disambiguation
  if (bpm < 90) {
    const dLag = Math.round(bestLag / 2);
    if (dLag >= minLag && ac[dLag] > bestVal * 0.65) bpm *= 2;
  } else if (bpm > 160) {
    const hLag = Math.round(bestLag * 2);
    if (hLag <= maxLag && ac[hLag] > bestVal * 0.65) bpm /= 2;
  }

  bpm = Math.max(60, Math.min(200, bpm));

  const confidence = Math.min(1, bestVal * 1.5);

  // tempo stability from IOI variance
  const onsets = findOnsets(env, hopDur);
  const iois: number[] = [];
  const beatDur = 60 / bpm;
  for (let i = 1; i < onsets.length; i++) {
    const ioi = onsets[i] - onsets[i-1];
    if (ioi > beatDur * 0.5 && ioi < beatDur * 1.5) iois.push(ioi);
  }
  let stability = 0.5;
  if (iois.length > 4) {
    const mean = iois.reduce((a, b) => a + b, 0) / iois.length;
    const variance = iois.reduce((a, b) => a + (b - mean) ** 2, 0) / iois.length;
    stability = Math.max(0, Math.min(1, 1 - (Math.sqrt(variance) / mean) * 4));
  }

  // beatgrid: find best phase by scoring against onsets
  const beatgrid: number[] = [];
  const downbeats: number[] = [];

  if (confidence > 0.15) {
    let bestPhase = 0, bestScore = -1;
    const phaseSteps = 16;
    for (let p = 0; p < phaseSteps; p++) {
      const phase = (p / phaseSteps) * beatDur;
      let score = 0;
      for (const o of onsets) {
        const rel = ((o - phase) % beatDur + beatDur) % beatDur;
        score += Math.exp(-(Math.min(rel, beatDur - rel) ** 2) * 80);
      }
      if (score > bestScore) { bestScore = score; bestPhase = phase; }
    }

    let t = bestPhase;
    let beatIdx = 0;
    while (t < totalDuration) {
      beatgrid.push(parseFloat(t.toFixed(3)));
      if (beatIdx % 4 === 0) downbeats.push(parseFloat(t.toFixed(3)));
      t += beatDur;
      beatIdx++;
    }
  }

  return {
    bpm: parseFloat(bpm.toFixed(2)),
    bpmConfidence: parseFloat(confidence.toFixed(3)),
    tempoStability: parseFloat(stability.toFixed(3)),
    beatgrid,
    downbeats,
  };
}

// ─── Chromagram + Key Detection (Krumhansl-Schmuckler) ───────────────────────

function computeChroma(samples: Float32Array, sampleRate: number): Float64Array {
  const maxS = Math.min(samples.length, sampleRate * 90);
  const sub = samples.subarray(0, maxS);
  const target = 11025;
  const ds = downsample(sub, sampleRate, target);

  const frameSize = 4096;
  const hopSize = 2048;
  const chroma = new Float64Array(12);

  const hann = new Float64Array(frameSize);
  for (let i = 0; i < frameSize; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));

  const re = new Float64Array(frameSize);
  const im = new Float64Array(frameSize);

  for (let start = 0; start + frameSize <= ds.length; start += hopSize) {
    for (let i = 0; i < frameSize; i++) { re[i] = ds[start + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let bin = 1; bin < frameSize >> 1; bin++) {
      const freq = (bin * target) / frameSize;
      if (freq < 27.5 || freq > 4200) continue;
      const midi = 12 * Math.log2(freq / 440) + 69;
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += Math.sqrt(re[bin] ** 2 + im[bin] ** 2);
    }
  }

  let maxC = 0;
  for (let i = 0; i < 12; i++) if (chroma[i] > maxC) maxC = chroma[i];
  if (maxC > 0) for (let i = 0; i < 12; i++) chroma[i] /= maxC;
  return chroma;
}

function zzNormalize(arr: number[]): number[] {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const std  = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
  return arr.map(x => (std > 0 ? (x - mean) / std : 0));
}

export interface KeyResult {
  musicalKey: string;
  camelotKey: string;
  openKey: string;
  keyConfidence: number;
}

function detectKey(chroma: Float64Array): KeyResult {
  const chromaArr = Array.from(chroma);
  const normChroma = zzNormalize(chromaArr);
  const normMajor  = zzNormalize(KK_MAJOR);
  const normMinor  = zzNormalize(KK_MINOR);

  let bestCorr = -Infinity, bestRoot = 0, bestMode = 0;
  const allCorrs: number[] = [];

  for (let root = 0; root < 12; root++) {
    let cMaj = 0, cMin = 0;
    for (let i = 0; i < 12; i++) {
      cMaj += normChroma[(i + root) % 12] * normMajor[i];
      cMin += normChroma[(i + root) % 12] * normMinor[i];
    }
    allCorrs.push(cMaj, cMin);
    if (cMaj > bestCorr) { bestCorr = cMaj; bestRoot = root; bestMode = 0; }
    if (cMin > bestCorr) { bestCorr = cMin; bestRoot = root; bestMode = 1; }
  }

  allCorrs.sort((a, b) => b - a);
  const confidence = allCorrs.length > 1 ? Math.min(1, Math.max(0, (allCorrs[0] - allCorrs[1]) * 4)) : 0.5;

  const note = NOTE_NAMES[bestRoot];
  const mode = bestMode === 0 ? 'major' : 'minor';
  const keyId = `${note}_${mode}`;
  return {
    musicalKey: bestMode === 0 ? `${note} Major` : `${note} Minor`,
    camelotKey: CAMELOT_MAP[keyId] || '—',
    openKey:    OPEN_KEY_MAP[keyId] || '—',
    keyConfidence: parseFloat(confidence.toFixed(3)),
  };
}

// ─── LUFS (ITU-R BS.1770 approximation) & RMS ─────────────────────────────────

export interface LoudnessResult {
  lufs: number;
  rms: number;
  peak: number;
}

function computeLoudness(samples: Float32Array, sampleRate: number): LoudnessResult {
  // K-weighting: simplified first-order high-pass pre-filter
  const fc = 1000; // Hz
  const alpha = 1 / (1 + (sampleRate / (2 * Math.PI * fc)));
  const filtered = new Float32Array(samples.length);
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    filtered[i] = alpha * (prev + samples[i] - (i > 0 ? samples[i-1] : 0));
    prev = filtered[i];
  }

  // 400 ms blocks, 75 % overlap
  const blockSize = Math.round(sampleRate * 0.4);
  const hopB = Math.round(sampleRate * 0.1);
  const blockMs: number[] = [];
  for (let i = 0; i + blockSize <= filtered.length; i += hopB) {
    let s = 0;
    for (let j = i; j < i + blockSize; j++) s += filtered[j] ** 2;
    const ms = s / blockSize;
    if (ms > 1e-10) blockMs.push(ms);
  }

  let lufs = -70;
  if (blockMs.length > 0) {
    const absGate = Math.pow(10, (-70 + 0.691) / 10);
    const g1 = blockMs.filter(b => b > absGate);
    if (g1.length > 0) {
      const avg = g1.reduce((a, b) => a + b, 0) / g1.length;
      const relGate = avg * Math.pow(10, -10 / 10);
      const g2 = g1.filter(b => b > relGate);
      if (g2.length > 0) {
        lufs = -0.691 + 10 * Math.log10(g2.reduce((a, b) => a + b, 0) / g2.length);
      }
    }
  }

  let sumSq = 0, pk = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] ** 2;
    const a = Math.abs(samples[i]);
    if (a > pk) pk = a;
  }
  const rmsLin = Math.sqrt(sumSq / samples.length);

  return {
    lufs: parseFloat(lufs.toFixed(1)),
    rms:  parseFloat((rmsLin > 0 ? 20 * Math.log10(rmsLin) : -120).toFixed(1)),
    peak: parseFloat((pk > 0 ? 20 * Math.log10(pk) : -120).toFixed(1)),
  };
}

// ─── Waveform ─────────────────────────────────────────────────────────────────

function computeWaveform(samples: Float32Array, blocks = 200): number[] {
  const bs = Math.floor(samples.length / blocks);
  if (bs === 0) return new Array(blocks).fill(0);
  const wf: number[] = [];
  for (let i = 0; i < blocks; i++) {
    const s = i * bs;
    const e = Math.min(s + bs, samples.length);
    let sum = 0;
    for (let j = s; j < e; j++) sum += samples[j] ** 2;
    wf.push(Math.sqrt(sum / (e - s)));
  }
  const max = Math.max(...wf);
  return max > 0 ? wf.map(v => parseFloat((v / max).toFixed(4))) : wf;
}

// Byte-magnitude waveform for compressed formats (rough energy envelope)
function compressedWaveform(bytes: Uint8Array, startOffset: number, blocks = 200): number[] {
  const dataLen = bytes.length - startOffset;
  if (dataLen <= 0) return new Array(blocks).fill(0.5);
  const bs = Math.floor(dataLen / blocks);
  const wf: number[] = [];
  for (let i = 0; i < blocks; i++) {
    const s = startOffset + i * bs;
    const e = Math.min(s + bs, bytes.length);
    let sum = 0;
    for (let j = s; j < e; j++) sum += Math.abs(bytes[j] - 128);
    wf.push(sum / (e - s));
  }
  const max = Math.max(...wf, 1);
  return wf.map(v => parseFloat((v / max).toFixed(4)));
}

// ─── MP3 Frame Header Parser ──────────────────────────────────────────────────

interface MP3Info { sampleRate: number; channels: number; duration: number; mp3DataOffset: number; }

function parseMP3Frames(bytes: Uint8Array): MP3Info {
  const SR_MPEG1  = [44100, 48000, 32000];
  const SR_MPEG2  = [22050, 24000, 16000];
  const SR_MPEG25 = [11025, 12000, 8000];
  const BR_L3_V1  = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
  const BR_L3_V2  = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0];

  let offset = 0;
  // skip ID3v2
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const ss = (bytes[6]&0x7f)<<21|(bytes[7]&0x7f)<<14|(bytes[8]&0x7f)<<7|(bytes[9]&0x7f);
    offset = ss + 10;
  }
  const mp3DataOffset = offset;

  let sr = 44100, ch = 2, totalBits = 0, frameCount = 0;
  while (offset + 4 < bytes.length && frameCount < 500) {
    if ((bytes[offset] & 0xff) !== 0xff || (bytes[offset+1] & 0xe0) !== 0xe0) { offset++; continue; }
    const hdr = (bytes[offset] << 24) | (bytes[offset+1] << 16) | (bytes[offset+2] << 8) | bytes[offset+3];
    const ver = (hdr >> 19) & 0x3;
    const layer = (hdr >> 17) & 0x3;
    const brIdx = (hdr >> 12) & 0xf;
    const srIdx = (hdr >> 10) & 0x3;
    const pad   = (hdr >> 9) & 0x1;
    const cMode = (hdr >> 6) & 0x3;
    if (ver === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) { offset++; continue; }
    const srt = ver === 3 ? SR_MPEG1[srIdx] : ver === 2 ? SR_MPEG2[srIdx] : SR_MPEG25[srIdx];
    const brt = (ver === 3 ? BR_L3_V1[brIdx] : BR_L3_V2[brIdx]) * 1000;
    if (!srt || !brt) { offset++; continue; }
    const frameLen = Math.floor(144 * brt / srt) + pad;
    if (frameLen < 4 || frameLen > 2880) { offset++; continue; }
    sr = srt; ch = cMode === 3 ? 1 : 2;
    totalBits += brt; frameCount++;
    offset += frameLen;
  }

  const duration = frameCount > 0 && totalBits > 0
    ? (bytes.length - mp3DataOffset) * 8 / (totalBits / frameCount)
    : 0;

  return { sampleRate: sr, channels: ch, duration, mp3DataOffset };
}

// ─── ID3v2 Tag Parser ─────────────────────────────────────────────────────────

interface AudioMeta { bpm?: number; key?: string; }

function parseID3(bytes: Uint8Array): AudioMeta {
  const meta: AudioMeta = {};
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return meta;
  const ver = bytes[3];
  const flags = bytes[5];
  const tagSz = (bytes[6]&0x7f)<<21|(bytes[7]&0x7f)<<14|(bytes[8]&0x7f)<<7|(bytes[9]&0x7f);
  let off = 10;
  if (flags & 0x40) {
    const esz = ver >= 4
      ? (bytes[10]&0x7f)<<21|(bytes[11]&0x7f)<<14|(bytes[12]&0x7f)<<7|(bytes[13]&0x7f)
      : readU32BE(bytes, 10);
    off += esz + 4;
  }
  const end = Math.min(10 + tagSz, bytes.length);

  while (off + 10 < end) {
    const fid = String.fromCharCode(bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]);
    if (fid === '\x00\x00\x00\x00') break;
    const fsz = ver >= 4
      ? (bytes[off+4]&0x7f)<<21|(bytes[off+5]&0x7f)<<14|(bytes[off+6]&0x7f)<<7|(bytes[off+7]&0x7f)
      : readU32BE(bytes, off + 4);
    const ds = off + 10, de = Math.min(ds + fsz, end);

    if (fid === 'TBPM' || fid === 'TBP') {
      const txt = decodeID3Text(bytes, ds, de);
      const v = parseFloat(txt);
      if (!isNaN(v) && v > 0) meta.bpm = v;
    } else if (fid === 'TKEY' || fid === 'KEY') {
      meta.key = decodeID3Text(bytes, ds, de);
    }
    off = de;
  }
  return meta;
}

function decodeID3Text(b: Uint8Array, s: number, e: number): string {
  if (s >= e) return '';
  const enc = b[s]; const data = b.slice(s + 1, e);
  try {
    if (enc === 0) return Array.from(data).map(x => String.fromCharCode(x)).join('').replace(/\0/g,'').trim();
    if (enc === 3) return Array.from(data).map(x => String.fromCharCode(x)).join('').replace(/\0/g,'').trim();
    if (enc === 1 || enc === 2) {
      let i = 0, be = enc === 2;
      if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) { i = 2; be = false; }
      else if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) { i = 2; be = true; }
      let str = '';
      while (i + 1 < data.length) {
        const c = be ? (data[i] << 8 | data[i+1]) : (data[i] | data[i+1] << 8);
        if (c === 0) break;
        str += String.fromCharCode(c); i += 2;
      }
      return str.trim();
    }
  } catch {}
  return '';
}

// ─── FLAC Metadata Parser ─────────────────────────────────────────────────────

interface FLACMeta { sampleRate: number; channels: number; duration: number; bpm?: number; key?: string; }

function parseFLAC(bytes: Uint8Array): FLACMeta {
  const meta: FLACMeta = { sampleRate: 0, channels: 0, duration: 0 };
  if (bytes[0]!==0x66||bytes[1]!==0x4c||bytes[2]!==0x61||bytes[3]!==0x43) return meta;
  let off = 4;
  while (off + 4 < bytes.length) {
    const hdr = bytes[off]; const isLast = (hdr & 0x80) !== 0;
    const btype = hdr & 0x7f;
    const blen = (bytes[off+1] << 16) | (bytes[off+2] << 8) | bytes[off+3];
    off += 4;
    if (btype === 0) { // STREAMINFO
      const sr = (bytes[off] << 12) | (bytes[off+1] << 4) | ((bytes[off+2] >> 4) & 0xf);
      const ch = ((bytes[off+2] >> 1) & 0x7) + 1;
      const hi = (bytes[off+3] & 0xf);
      const lo = readU32BE(bytes, off + 4);
      const totalSamples = hi * 4294967296 + lo;
      meta.sampleRate = sr; meta.channels = ch;
      meta.duration = sr > 0 ? totalSamples / sr : 0;
    } else if (btype === 4) { // VORBIS_COMMENT
      let voff = off;
      const vlen = readU32LE(bytes, voff); voff += 4 + vlen;
      const cnt = readU32LE(bytes, voff); voff += 4;
      for (let i = 0; i < cnt && voff + 4 < off + blen; i++) {
        const clen = readU32LE(bytes, voff); voff += 4;
        const comment = Array.from(bytes.slice(voff, voff + clen)).map(x => String.fromCharCode(x)).join('').toUpperCase();
        voff += clen;
        if (comment.startsWith('BPM=')) { const v = parseFloat(comment.slice(4)); if (!isNaN(v)) meta.bpm = v; }
        else if (comment.startsWith('INITIALKEY=')) meta.key = comment.slice(11);
        else if (comment.startsWith('KEY=')) meta.key = comment.slice(4);
      }
    }
    off += blen;
    if (isLast) break;
  }
  return meta;
}

// ─── Musical key string → KeyResult ──────────────────────────────────────────

function parseKeyString(keyStr: string): Partial<KeyResult> | null {
  const s = keyStr.trim().toUpperCase();
  // Camelot format "8A", "10B"
  const cm = s.match(/^(\d{1,2})([AB])$/);
  if (cm) {
    const ck = `${cm[1]}${cm[2]}`;
    const entry = Object.entries(CAMELOT_MAP).find(([, v]) => v === ck);
    if (entry) {
      const [keyId] = entry;
      const [note, mode] = keyId.split('_');
      return {
        musicalKey: mode === 'major' ? `${note} Major` : `${note} Minor`,
        camelotKey: ck,
        openKey: OPEN_KEY_MAP[keyId] || '—',
        keyConfidence: 1,
      };
    }
  }
  // Standard notation "Am", "C#", "Gbmaj", etc.
  const noteMap: Record<string, number> = {
    C:0,'C#':1,DB:1,D:2,'D#':3,EB:3,E:4,F:5,'F#':6,GB:6,G:7,'G#':8,AB:8,A:9,'A#':10,BB:10,B:11,
  };
  const km = s.match(/^([A-G][#B]?)(M|MIN|MINOR|MAJ|MAJOR)?$/);
  if (km) {
    const ni = noteMap[km[1]];
    if (ni !== undefined) {
      const ms = km[2] || '';
      const isMin = ms === 'M' || ms === 'MIN' || ms === 'MINOR';
      const mode = isMin ? 'minor' : 'major';
      const keyId = `${NOTE_NAMES[ni]}_${mode}`;
      return {
        musicalKey: isMin ? `${NOTE_NAMES[ni]} Minor` : `${NOTE_NAMES[ni]} Major`,
        camelotKey: CAMELOT_MAP[keyId] || '—',
        openKey: OPEN_KEY_MAP[keyId] || '—',
        keyConfidence: 0.95,
      };
    }
  }
  return null;
}

// ─── Beatgrid from stored BPM ─────────────────────────────────────────────────

function makeBeatgrid(bpm: number, duration: number): { beatgrid: number[]; downbeats: number[] } {
  const beatDur = 60 / bpm;
  const beatgrid: number[] = [], downbeats: number[] = [];
  let t = 0, idx = 0;
  while (t < duration) {
    beatgrid.push(parseFloat(t.toFixed(3)));
    if (idx % 4 === 0) downbeats.push(parseFloat(t.toFixed(3)));
    t += beatDur; idx++;
  }
  return { beatgrid, downbeats };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

const MAX_READ = 20 * 1024 * 1024; // 20 MB

export async function analyzeAudioFile(
  uri: string,
  filename: string,
  onProgress?: (p: number) => void,
): Promise<AnalysisResult> {
  const fmt = (filename.split('.').pop() || '').toLowerCase();

  const base: AnalysisResult = {
    uri, filename, duration: 0, sampleRate: 0, channels: 1, format: fmt,
    bpm: 0, bpmConfidence: 0, tempoStability: 0, beatgrid: [], downbeats: [],
    musicalKey: '—', camelotKey: '—', openKey: '—', keyConfidence: 0,
    lufs: -70, rms: -60, peak: -60, waveform: [],
    analysisSource: 'estimated', timestamp: Date.now(),
  };

  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    if (!info.exists) throw new Error('Datei nicht gefunden');
    const fileSize = (info as any).size ?? 0;
    const readLen = Math.min(fileSize, MAX_READ);

    onProgress?.(0.05);

    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: (FileSystem.EncodingType as any).Base64,
      position: 0,
      length: readLen,
    } as any);

    onProgress?.(0.2);
    await yield_();

    const bytes = base64ToUint8Array(b64);

    // ── WAV ──
    if (fmt === 'wav') {
      onProgress?.(0.25);
      const pcm = parseWAV(bytes);
      if (!pcm) throw new Error('WAV-Datei konnte nicht gelesen werden');

      onProgress?.(0.35);
      await yield_();
      const bpmRes = detectBPM(pcm.samples, pcm.sampleRate, pcm.duration);

      onProgress?.(0.55);
      await yield_();
      const chroma = computeChroma(pcm.samples, pcm.sampleRate);

      onProgress?.(0.7);
      await yield_();
      const keyRes = detectKey(chroma);

      onProgress?.(0.8);
      await yield_();
      const loud = computeLoudness(pcm.samples, pcm.sampleRate);
      const wf   = computeWaveform(pcm.samples);

      onProgress?.(1);
      return {
        ...base, ...bpmRes, ...keyRes, ...loud,
        duration: pcm.duration, sampleRate: pcm.sampleRate, channels: pcm.channels,
        waveform: wf, analysisSource: 'pcm_wav', timestamp: Date.now(),
      };
    }

    // ── AIFF / AIF ──
    if (fmt === 'aiff' || fmt === 'aif') {
      onProgress?.(0.25);
      const pcm = parseAIFF(bytes);
      if (!pcm) throw new Error('AIFF-Datei konnte nicht gelesen werden');

      onProgress?.(0.35);
      await yield_();
      const bpmRes = detectBPM(pcm.samples, pcm.sampleRate, pcm.duration);

      onProgress?.(0.55);
      await yield_();
      const chroma = computeChroma(pcm.samples, pcm.sampleRate);

      onProgress?.(0.7);
      await yield_();
      const keyRes = detectKey(chroma);

      onProgress?.(0.8);
      await yield_();
      const loud = computeLoudness(pcm.samples, pcm.sampleRate);
      const wf   = computeWaveform(pcm.samples);

      onProgress?.(1);
      return {
        ...base, ...bpmRes, ...keyRes, ...loud,
        duration: pcm.duration, sampleRate: pcm.sampleRate, channels: pcm.channels,
        waveform: wf, analysisSource: 'pcm_aiff', timestamp: Date.now(),
      };
    }

    // ── MP3 ──
    if (fmt === 'mp3') {
      onProgress?.(0.3);
      const id3meta = parseID3(bytes);
      const mp3info = parseMP3Frames(bytes);
      await yield_();

      const wf = compressedWaveform(bytes, mp3info.mp3DataOffset);
      onProgress?.(0.7);

      const result: AnalysisResult = {
        ...base,
        duration: mp3info.duration || 0,
        sampleRate: mp3info.sampleRate || 44100,
        channels: mp3info.channels || 2,
        waveform: wf,
        analysisSource: 'metadata_only',
        timestamp: Date.now(),
      };

      if (id3meta.bpm && id3meta.bpm > 0) {
        Object.assign(result, makeBeatgrid(id3meta.bpm, result.duration), {
          bpm: id3meta.bpm,
          bpmConfidence: 0.95,
          tempoStability: 0.95,
        });
      }
      if (id3meta.key) {
        const kp = parseKeyString(id3meta.key);
        if (kp) Object.assign(result, kp);
      }

      onProgress?.(1);
      return result;
    }

    // ── FLAC ──
    if (fmt === 'flac') {
      onProgress?.(0.3);
      const fmeta = parseFLAC(bytes);
      await yield_();
      const wf = compressedWaveform(bytes, 4);
      onProgress?.(0.7);

      const result: AnalysisResult = {
        ...base,
        duration: fmeta.duration || 0,
        sampleRate: fmeta.sampleRate || 44100,
        channels: fmeta.channels || 2,
        waveform: wf,
        analysisSource: 'metadata_only',
        timestamp: Date.now(),
      };

      if (fmeta.bpm && fmeta.bpm > 0) {
        Object.assign(result, makeBeatgrid(fmeta.bpm, result.duration), {
          bpm: fmeta.bpm,
          bpmConfidence: 0.95,
          tempoStability: 0.95,
        });
      }
      if (fmeta.key) {
        const kp = parseKeyString(fmeta.key);
        if (kp) Object.assign(result, kp);
      }

      onProgress?.(1);
      return result;
    }

    // ── AAC / M4A / OGG / other ──
    {
      const wf = compressedWaveform(bytes, 0);
      onProgress?.(1);
      return { ...base, waveform: wf, analysisSource: 'estimated', timestamp: Date.now() };
    }

  } catch (err: any) {
    return { ...base, error: err?.message || 'Analyse fehlgeschlagen', timestamp: Date.now() };
  }
}
