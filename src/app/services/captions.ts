import type { Clip, MediaAsset } from '../../types/project';
import { useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import { ffmpegClient, getFileHandle, safeName } from '../../engine/ffmpegClient';
import { createClip, createTrack, defaultTextProps, id as newId } from '../../engine/defaults';
import { secondsToFrames } from '../../engine/time';
import { TEXT_PRESETS } from '../../engine/libraries';
import type { WhisperModel, WordChunk } from '../../workers/whisper.worker';

/**
 * Auto captions: extract 16 kHz mono audio with ffmpeg, transcribe with
 * Whisper in a worker, then lay the word timings out as caption clips on a
 * text track.
 */

let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('../../workers/whisper.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

export interface CaptionOptions {
  model: WhisperModel;
  language: string;
  /** Words per caption clip. */
  wordsPerLine: number;
  presetId: string;
}

export const CAPTION_LANGUAGES = [
  { label: 'Auto-detect', value: 'auto' },
  { label: 'English', value: 'english' },
  { label: 'Spanish', value: 'spanish' },
  { label: 'French', value: 'french' },
  { label: 'German', value: 'german' },
  { label: 'Portuguese', value: 'portuguese' },
  { label: 'Italian', value: 'italian' },
  { label: 'Dutch', value: 'dutch' },
  { label: 'Japanese', value: 'japanese' },
  { label: 'Korean', value: 'korean' },
  { label: 'Chinese', value: 'chinese' },
  { label: 'Hindi', value: 'hindi' },
  { label: 'Arabic', value: 'arabic' },
  { label: 'Russian', value: 'russian' },
];

/** Pick the asset the captions should come from: first clip with audio. */
function sourceAsset(): { asset: MediaAsset; clip: Clip } | null {
  const { state } = useEditorStore.getState();
  const candidates = Object.values(state.clips)
    .filter((c) => (c.kind === 'audio' || c.kind === 'video') && c.assetId)
    .sort((a, b) => a.start - b.start);

  for (const clip of candidates) {
    const asset = state.assets[clip.assetId!];
    if (asset && (asset.kind === 'audio' || asset.hasAudio)) return { asset, clip };
  }
  return null;
}

/** ffmpeg → raw 16 kHz mono float32, which is exactly what Whisper wants. */
async function extractAudioForWhisper(asset: MediaAsset): Promise<Float32Array> {
  const file = await getFileHandle(asset);
  if (!file) throw new Error(`Source file for "${asset.name}" is not available. Re-import it to transcribe.`);

  const bytes = await ffmpegClient.run(
    [
      '-hide_banner', '-loglevel', 'error',
      '-i', `/mnt/${safeName(asset.name)}`,
      '-vn', '-ac', '1', '-ar', '16000',
      '-f', 'f32le',
      'whisper.raw',
    ],
    'whisper.raw',
    { files: [new File([file], safeName(asset.name), { type: file.type })] }
  );

  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
}

export async function generateCaptions(options: CaptionOptions): Promise<number> {
  const ui = useUIStore.getState();
  const editor = useEditorStore.getState();
  const fps = editor.meta?.fps ?? 30;
  const jobId = `captions-${++seq}`;

  const source = sourceAsset();
  if (!source) {
    ui.setJob({ id: jobId, label: 'Auto captions', detail: '', progress: 1, error: 'No clip with audio on the timeline.' });
    return 0;
  }

  ui.setJob({ id: jobId, label: 'Auto captions', detail: 'Extracting audio', progress: -1 });

  try {
    const audio = await extractAudioForWhisper(source.asset);
    ui.setJob({ id: jobId, label: 'Auto captions', detail: 'Loading Whisper model', progress: -1 });

    const chunks = await transcribe(audio, options, (value, message) =>
      ui.setJob({ id: jobId, label: 'Auto captions', detail: message, progress: value })
    );

    if (chunks.length === 0) {
      ui.setJob({ id: jobId, label: 'Auto captions', detail: '', progress: 1, error: 'No speech detected.' });
      return 0;
    }

    // Caption times are relative to the source; shift them onto the clip.
    const offsetFrames = source.clip.start - Math.round(source.clip.inPoint / source.clip.speed);
    const lines = groupWords(chunks, options.wordsPerLine);
    const preset = TEXT_PRESETS.find((p) => p.id === options.presetId) ?? TEXT_PRESETS.find((p) => p.id === 'caption')!;

    editor.commit('Auto captions', (d) => {
      let track = d.tracks.find((t) => t.kind === 'text' && t.name.startsWith('Caption'));
      if (!track) {
        track = createTrack('text', 'Captions');
        d.tracks.push(track);
      }
      for (const line of lines) {
        const start = Math.max(0, offsetFrames + secondsToFrames(line.start, fps));
        const end = Math.max(start + 1, offsetFrames + secondsToFrames(line.end, fps));
        const clip = createClip({
          trackId: track.id,
          kind: 'text',
          name: line.text.slice(0, 30),
          start,
          duration: end - start,
          text: { ...defaultTextProps(line.text), ...preset.patch },
          captionWords: line.words.map((w) => ({
            text: w.text,
            start: offsetFrames + secondsToFrames(w.start, fps),
            end: offsetFrames + secondsToFrames(w.end, fps),
          })),
        });
        d.clips[clip.id] = clip;
      }
    });

    ui.setJob({ id: jobId, label: 'Auto captions', detail: `${lines.length} caption clips added`, progress: 1, done: true });
    window.setTimeout(() => ui.clearJob(jobId), 2600);
    return lines.length;
  } catch (err) {
    ui.setJob({ id: jobId, label: 'Auto captions', detail: '', progress: 1, error: (err as Error).message });
    return 0;
  }
}

function transcribe(
  audio: Float32Array,
  options: CaptionOptions,
  onProgress: (value: number, message: string) => void
): Promise<WordChunk[]> {
  const id = `whisper-${++seq}`;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress') return onProgress(msg.value, msg.message);
      w.removeEventListener('message', handler);
      if (msg.type === 'error') reject(new Error(msg.message));
      else resolve(msg.chunks as WordChunk[]);
    };
    w.addEventListener('message', handler);
    // The buffer is transferred; the caller must not use it afterwards.
    w.postMessage({ id, type: 'transcribe', audio, model: options.model, language: options.language }, [audio.buffer]);
  });
}

interface CaptionLine {
  text: string;
  start: number;
  end: number;
  words: WordChunk[];
}

/** Group words into readable lines, breaking early on sentence punctuation. */
function groupWords(words: WordChunk[], perLine: number): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let current: WordChunk[] = [];

  const flush = () => {
    if (current.length === 0) return;
    lines.push({
      text: current.map((w) => w.text).join(' '),
      start: current[0].start,
      end: current[current.length - 1].end,
      words: current,
    });
    current = [];
  };

  for (const word of words) {
    current.push(word);
    const endsSentence = /[.!?]$/.test(word.text);
    // A gap longer than a beat is a natural break even mid-sentence.
    const nextGap = words[words.indexOf(word) + 1];
    const bigGap = nextGap ? nextGap.start - word.end > 0.7 : false;
    if (current.length >= perLine || endsSentence || bigGap) flush();
  }
  flush();
  return lines;
}

/* ------------------------------------------------------------------ *
 * SRT
 * ------------------------------------------------------------------ */

const srtTime = (seconds: number) => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rem = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(rem, 3)}`;
};

export function captionsToSrt(): string {
  const { state, meta } = useEditorStore.getState();
  const fps = meta?.fps ?? 30;
  const captions = Object.values(state.clips)
    .filter((c) => c.kind === 'text' && c.text)
    .sort((a, b) => a.start - b.start);

  return captions
    .map((c, i) =>
      [
        String(i + 1),
        `${srtTime(c.start / fps)} --> ${srtTime((c.start + c.duration) / fps)}`,
        c.text!.content,
        '',
      ].join('\n')
    )
    .join('\n');
}

export function importSrt(text: string): number {
  const editor = useEditorStore.getState();
  const fps = editor.meta?.fps ?? 30;

  const parseTime = (t: string): number => {
    const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t);
    if (!m) return 0;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
  };

  const blocks = text.split(/\r?\n\r?\n/).filter((b) => b.trim());
  let added = 0;

  editor.commit('Import subtitles', (d) => {
    let track = d.tracks.find((t) => t.kind === 'text' && t.name.startsWith('Caption'));
    if (!track) {
      track = createTrack('text', 'Captions');
      d.tracks.push(track);
    }
    for (const block of blocks) {
      const lines = block.split(/\r?\n/).filter(Boolean);
      const timeLine = lines.find((l) => l.includes('-->'));
      if (!timeLine) continue;
      const [from, to] = timeLine.split('-->');
      const start = secondsToFrames(parseTime(from), fps);
      const end = secondsToFrames(parseTime(to), fps);
      const content = lines.slice(lines.indexOf(timeLine) + 1).join('\n');
      if (!content) continue;

      const clipId = newId();
      d.clips[clipId] = {
        ...createClip({
          trackId: track.id,
          kind: 'text',
          name: content.slice(0, 30),
          start,
          duration: Math.max(1, end - start),
          text: { ...defaultTextProps(content), ...TEXT_PRESETS.find((p) => p.id === 'caption')!.patch },
        }),
        id: clipId,
      };
      added++;
    }
  });

  return added;
}
