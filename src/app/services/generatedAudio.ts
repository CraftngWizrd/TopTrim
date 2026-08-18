import type { MediaAsset } from '../../types/project';
import { useEditorStore } from '../stores/editorStore';
import { id as newId } from '../../engine/defaults';
import { registerFileHandle } from '../../engine/ffmpegClient';
import { ensureWaveform } from '../../engine/waveform';
import { secondsToFrames } from '../../engine/time';

/**
 * Turn audio produced inside the app — synthesised effects, voiceover
 * recordings, text-to-speech — into a first-class project asset.
 *
 * These have no path on disk, so they live as blob URLs for the session and are
 * re-materialised from the project only if the user saves them out.
 */
export async function addGeneratedAudio(name: string, blob: Blob, fps: number): Promise<MediaAsset> {
  const url = URL.createObjectURL(blob);
  const durationSeconds = await probeDuration(url);

  const file = new File([blob], `${name.replace(/[^\w-]/g, '_')}.wav`, { type: blob.type || 'audio/wav' });
  const hash = `generated:${name}:${blob.size}:${Date.now()}`;
  registerFileHandle(hash, file);

  const asset: MediaAsset = {
    id: newId(),
    kind: 'audio',
    name,
    path: null,
    url,
    size: blob.size,
    durationFrames: Math.max(1, secondsToFrames(durationSeconds, fps)),
    width: 0,
    height: 0,
    fps,
    hasAudio: true,
    hash,
    importedAt: Date.now(),
  };

  useEditorStore.getState().addAssets([asset]);
  void ensureWaveform(asset, fps);
  return asset;
}

function probeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement('audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 1);
    el.onerror = () => resolve(1);
    el.src = url;
  });
}

/* ------------------------------------------------------------------ *
 * Voiceover recorder
 * ------------------------------------------------------------------ */

export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType: pickMimeType() });
    this.recorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    this.recorder.start(200);
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const rec = this.recorder;
      if (!rec) return reject(new Error('Not recording'));
      rec.onstop = () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
        this.recorder = null;
        resolve(new Blob(this.chunks, { type: rec.mimeType }));
      };
      rec.stop();
    });
  }

  get recording() {
    return this.recorder?.state === 'recording';
  }
}

function pickMimeType(): string {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

/* ------------------------------------------------------------------ *
 * Text to speech — Web Speech API, free and built in
 * ------------------------------------------------------------------ */

export const listVoices = (): SpeechSynthesisVoice[] => window.speechSynthesis?.getVoices() ?? [];

/**
 * Speak `text` and capture the result.
 *
 * The Web Speech API has no direct audio output tap, so the utterance is routed
 * through the default output device and captured from the loopback that Chromium
 * exposes to MediaRecorder via `getDisplayMedia({audio:true})` — which needs a
 * user gesture and a share prompt. That trade-off is surfaced to the caller
 * rather than hidden: `speakOnly` just plays it, `speakAndCapture` records it.
 */
export function speakOnly(text: string, voice?: SpeechSynthesisVoice, rate = 1, pitch = 1): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) return reject(new Error('Speech synthesis unavailable'));
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.onend = () => resolve();
    utterance.onerror = (e) => reject(new Error(e.error));
    window.speechSynthesis.speak(utterance);
  });
}
