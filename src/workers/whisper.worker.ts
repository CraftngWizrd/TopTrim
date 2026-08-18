/// <reference lib="webworker" />
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@xenova/transformers';

/**
 * Whisper transcription — Section 9.1.
 *
 * Runs entirely in this worker. The model is downloaded once on first use and
 * cached by the browser's Cache API; after that the feature is fully offline.
 * Nothing is uploaded: the audio never leaves the process.
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Only the model files come from the network, and only once.
env.allowLocalModels = false;
env.useBrowserCache = true;

export type WhisperModel = 'tiny' | 'base' | 'small';

interface TranscribeReq {
  id: string;
  type: 'transcribe';
  /** Mono 16 kHz float samples. */
  audio: Float32Array;
  model: WhisperModel;
  language: string;
}

type Req = TranscribeReq | { id: string; type: 'warm'; model: WhisperModel };

export interface WordChunk {
  text: string;
  start: number;
  end: number;
}

type Res =
  | { id: string; type: 'progress'; value: number; message: string }
  | { id: string; type: 'result'; text: string; chunks: WordChunk[] }
  | { id: string; type: 'error'; message: string };

const post = (msg: Res) => ctx.postMessage(msg);

const MODEL_IDS: Record<WhisperModel, string> = {
  tiny: 'Xenova/whisper-tiny',
  base: 'Xenova/whisper-base',
  small: 'Xenova/whisper-small',
};

let cached: { key: WhisperModel; instance: AutomaticSpeechRecognitionPipeline } | null = null;

async function getPipeline(model: WhisperModel, id: string) {
  if (cached?.key === model) return cached.instance;

  const instance = (await pipeline('automatic-speech-recognition', MODEL_IDS[model], {
    quantized: true, // smaller download, negligible accuracy cost at these sizes
    progress_callback: (p: { status: string; progress?: number; file?: string }) => {
      if (p.status === 'progress' && typeof p.progress === 'number') {
        post({ id, type: 'progress', value: p.progress / 100, message: `Downloading model — ${p.file ?? ''}` });
      } else if (p.status === 'ready') {
        post({ id, type: 'progress', value: 1, message: 'Model ready' });
      }
    },
  })) as AutomaticSpeechRecognitionPipeline;

  cached = { key: model, instance };
  return instance;
}

ctx.onmessage = async (e: MessageEvent<Req>) => {
  const req = e.data;
  try {
    if (req.type === 'warm') {
      await getPipeline(req.model, req.id);
      post({ id: req.id, type: 'result', text: '', chunks: [] });
      return;
    }

    const transcriber = await getPipeline(req.model, req.id);
    post({ id: req.id, type: 'progress', value: 0, message: 'Transcribing' });

    // `callback_function` is supported at runtime but missing from the published
    // types, so the options object is widened here rather than dropped.
    const options = {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      language: req.language === 'auto' ? undefined : req.language,
      task: 'transcribe',
      callback_function: (beams: unknown[]) => {
        // Coarse liveness signal — the pipeline does not report a real fraction.
        if (beams.length) post({ id: req.id, type: 'progress', value: -1, message: 'Transcribing' });
      },
    } as unknown as Parameters<AutomaticSpeechRecognitionPipeline>[1];

    const result = (await transcriber(req.audio, options)) as {
      text: string;
      chunks?: { text: string; timestamp: [number, number | null] }[];
    };

    const chunks: WordChunk[] = (result.chunks ?? [])
      .filter((c) => c.timestamp?.[0] != null)
      .map((c) => ({
        text: c.text.trim(),
        start: c.timestamp[0] as number,
        end: (c.timestamp[1] ?? (c.timestamp[0] as number) + 0.3) as number,
      }))
      .filter((c) => c.text.length > 0);

    post({ id: req.id, type: 'result', text: result.text ?? '', chunks });
  } catch (err) {
    post({ id: req.id, type: 'error', message: (err as Error).message ?? String(err) });
  }
};
