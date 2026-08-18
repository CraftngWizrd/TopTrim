import type { Clip, MediaAsset } from '../../types/project';
import { useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import { asBlobPart, ffmpegClient, getFileHandle, registerFileHandle, safeName } from '../../engine/ffmpegClient';
import { KNOWN_ABSENT, hasFilter } from '../../engine/ffmpegCapabilities';
import { platform } from '../hooks/usePlatform';
import { id as newId } from '../../engine/defaults';
import { primeStoryboard } from '../../engine/storyboard';
import { ensureWaveform } from '../../engine/waveform';
import { secondsToFrames } from '../../engine/time';

/**
 * Clip-level processing that produces a new media asset.
 *
 * Each operation renders through ffmpeg.wasm in the worker, registers the
 * result as a project asset, and repoints the clip at it — so the original
 * source is never modified and undo puts the clip straight back.
 */

export type AiOpId =
  | 'stabilize'
  | 'denoise'
  | 'optical-flow'
  | 'upscale'
  | 'denoise-audio'
  | 'isolate-vocals';

/** Human labels for the badge tooltip and the AI panel's "applied" state. */
export const AI_OP_LABELS: Record<AiOpId, string> = {
  stabilize: 'Stabilise',
  denoise: 'Noise reduction',
  'optical-flow': 'Optical flow',
  upscale: 'Upscale',
  'denoise-audio': 'Noise reduction',
  'isolate-vocals': 'Vocal isolation',
};

/** Undo a baked-in pass by pointing the clip back at what it used before. */
export function revertOp(clipId: string, opId: AiOpId) {
  const editor = useEditorStore.getState();
  const clip = editor.state.clips[clipId];
  const applied = clip?.appliedOps?.find((o) => o.id === opId);
  if (!applied?.previousAssetId) return false;

  editor.commit(`Revert ${applied.label.toLowerCase()}`, (d) => {
    const c = d.clips[clipId];
    if (!c) return;
    c.assetId = applied.previousAssetId;
    c.appliedOps = (c.appliedOps ?? []).filter((o) => o.id !== opId);
  });

  const restored = useEditorStore.getState().state.assets[applied.previousAssetId];
  if (restored) {
    const fps = editor.meta?.fps ?? 30;
    if (restored.kind === 'video') primeStoryboard(restored, fps);
    void ensureWaveform(restored, fps);
  }
  return true;
}

export const appliedOpIds = (clip: Clip): Set<string> => new Set((clip.appliedOps ?? []).map((o) => o.id));

interface OpResult {
  assetId: string | null;
  error?: string;
}

/** Pull `time=00:00:04.10` out of ffmpeg's status line. */
function parseTimeSeconds(line: string): number | null {
  const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

async function runOp(
  clip: Clip,
  asset: MediaAsset,
  label: string,
  buildArgs: (input: string, output: string) => string[],
  outputName: string,
  mimeType: string,
  requiredFilters: string[] = [],
  opId: AiOpId = 'stabilize',
  /**
   * An analysis pass run before the main command, native path only. Its output
   * goes in `{TMP}`, which is kept alive for the second pass. Used by
   * vidstab, whose detect pass must finish writing before transform reads it.
   */
  nativePrePass?: (input: string) => string[]
): Promise<OpResult> {
  const ui = useUIStore.getState();
  const editor = useEditorStore.getState();
  const jobId = `op-${clip.id}-${Date.now()}`;

  // Refuse up front rather than running into a wall. A missing filter used to
  // produce a job that sat on "Processing" forever.
  const missing = requiredFilters.filter((f) => !hasFilter(f));
  if (missing.length) {
    const error = KNOWN_ABSENT[missing[0]] ?? `This ffmpeg build has no "${missing[0]}" filter.`;
    ui.setJob({ id: jobId, label, detail: '', progress: 1, error });
    return { assetId: null, error };
  }

  const file = await getFileHandle(asset);
  if (!file) {
    const error = `Source for "${asset.name}" is not available. Re-import it and try again.`;
    ui.setJob({ id: jobId, label, detail: '', progress: 1, error });
    return { assetId: null, error };
  }

  const inputName = safeName(asset.name);
  const fps = editor.meta?.fps ?? 30;
  const totalSeconds = Math.max(0.001, asset.durationFrames / fps);
  const startedAt = Date.now();

  // Native ffmpeg where possible: these filters are far too slow in WASM to be
  // usable on real footage (deshake alone runs about realtime natively, which
  // would be tens of minutes compiled to WebAssembly).
  const native = await platform.nativeFFmpeg();
  const outPath = native && asset.path ? await platform.renderOutputPath(outputName) : null;
  const useNative = !!native && !!asset.path && !!outPath;

  const publishProgress = (seconds: number, cancel: () => void) => {
    const value = Math.max(0, Math.min(1, seconds / totalSeconds));
    ui.setJob({
      id: jobId,
      label,
      detail: `${seconds.toFixed(1)}s of ${totalSeconds.toFixed(1)}s processed`,
      progress: value,
      startedAt,
      onCancel: cancel,
    });
  };

  try {
    let produced: MediaAsset;

    if (useNative) {
      const cancel = () => {
        void native!.cancel(jobId);
        ui.setJob({ id: jobId, label, detail: '', progress: 1, error: `${label} cancelled.` });
      };
      ui.setJob({ id: jobId, label, detail: 'Starting', progress: 0, startedAt, onCancel: cancel });

      const stopLog = native!.onLog(({ jobId: id, text }) => {
        if (id !== jobId) return;
        for (const line of text.split(/[\r\n]+/)) {
          const t = parseTimeSeconds(line);
          if (t !== null) publishProgress(t, cancel);
        }
      });

      let result;
      try {
        if (nativePrePass) {
          // Analysis writes into {TMP}; keepTemp holds that directory open so
          // the render pass below can read it.
          ui.setJob({ id: jobId, label, detail: 'Analysing motion (pass 1 of 2)', progress: 0, startedAt, onCancel: cancel });
          const pre = await native!.run(jobId, nativePrePass(asset.path!), [], true);
          if (pre.cancelled) {
            ui.clearJob(jobId);
            return { assetId: null, error: 'Cancelled' };
          }
          if (pre.code !== 0) {
            const reason = pre.stderr.split(/[\r\n]+/).filter(Boolean).slice(-3).join(' ');
            const error = reason || `Analysis pass failed with code ${pre.code}`;
            ui.setJob({ id: jobId, label, detail: '', progress: 1, error });
            return { assetId: null, error };
          }
        }
        result = await native!.run(jobId, buildArgs(asset.path!, outPath!), []);
      } finally {
        stopLog();
      }

      if (result.cancelled) {
        ui.clearJob(jobId);
        return { assetId: null, error: 'Cancelled' };
      }
      if (result.code !== 0) {
        // The tail of stderr carries the real reason (a bad filter parameter
        // shows up here, not as an exception).
        const reason = result.stderr.split(/[\r\n]+/).filter(Boolean).slice(-3).join(' ');
        const error = reason || `ffmpeg exited with code ${result.code}`;
        ui.setJob({ id: jobId, label, detail: '', progress: 1, error });
        return { assetId: null, error };
      }

      produced = {
        ...asset,
        id: newId(),
        name: `${asset.name} (${label.toLowerCase()})`,
        // A real path means the result survives a reopen and can be fed
        // straight into the next native operation or the export.
        path: outPath!,
        url: await platform.getObjectUrl(outPath!),
        // Read the real size back, otherwise the media panel reports 0 B.
        size: (await platform.statFile(outPath!)).size,
        hash: `${asset.hash}::${label}::${Date.now()}`,
        importedAt: Date.now(),
        kind: mimeType.startsWith('audio') ? 'audio' : asset.kind,
      };
    } else {
      const cancel = () => {
        void import('../../engine/ffmpegHost').then((m) => m.ffmpegHost.terminate());
        ui.setJob({ id: jobId, label, detail: '', progress: 1, error: `${label} cancelled.` });
      };
      ui.setJob({ id: jobId, label, detail: 'Starting (WebAssembly)', progress: 0, startedAt, onCancel: cancel });

      const data = await ffmpegClient.run(buildArgs(`/mnt/${inputName}`, outputName), outputName, {
        files: [new File([file], inputName, { type: file.type })],
        // ffmpeg's own progress event is unreliable for filter graphs that
        // change duration, so the status line is the source of truth.
        onLog: (line) => {
          const t = parseTimeSeconds(line);
          if (t !== null) publishProgress(t, cancel);
        },
      });

      const blob = new Blob([asBlobPart(data)], { type: mimeType });
      const hash = `${asset.hash}::${label}::${Date.now()}`;
      registerFileHandle(hash, new File([blob], outputName, { type: mimeType }));

      produced = {
        ...asset,
        id: newId(),
        name: `${asset.name} (${label.toLowerCase()})`,
        path: null,
        url: URL.createObjectURL(blob),
        size: blob.size,
        hash,
        importedAt: Date.now(),
        kind: mimeType.startsWith('audio') ? 'audio' : asset.kind,
      };
    }

    editor.commit(label, (d) => {
      d.assets[produced.id] = produced;
      const c = d.clips[clip.id];
      if (!c) return;
      const previousAssetId = c.assetId;
      c.assetId = produced.id;
      // Record the pass so the timeline can badge the clip and the AI panel
      // can show it as done. Re-running the same pass replaces the entry but
      // keeps the ORIGINAL previousAssetId, so revert always goes back to the
      // untouched source rather than to a half-processed intermediate.
      const existing = c.appliedOps?.find((o) => o.id === opId);
      const rest = (c.appliedOps ?? []).filter((o) => o.id !== opId);
      c.appliedOps = [
        ...rest,
        { id: opId, label, at: Date.now(), previousAssetId: existing?.previousAssetId ?? previousAssetId },
      ];
    });

    // Show the result rather than leaving the old thumbnails in place: the new
    // asset has its own hash, so the strip must be rebuilt from it.
    if (produced.kind === 'video') primeStoryboard(produced, fps);
    void ensureWaveform(produced, fps);

    ui.setJob({
      id: jobId,
      label,
      detail: `Applied to "${clip.name}"`,
      progress: 1,
      done: true,
      startedAt,
    });
    window.setTimeout(() => ui.clearJob(jobId), 3000);
    return { assetId: produced.id };
  } catch (err) {
    const error = (err as Error).message;
    ui.setJob({ id: jobId, label, detail: '', progress: 1, error });
    return { assetId: null, error };
  }
}

/**
 * Stabilisation — Section 9.5.
 *
 * Two implementations, because the two ffmpeg builds differ:
 *
 *  - The native binary HAS libvidstab, so it runs the proper two-pass job:
 *    `vidstabdetect` measures camera motion into a transforms file, then
 *    `vidstabtransform` smooths the trajectory and warps each frame. This
 *    corrects rotation and scale, not just translation, and it can plan the
 *    whole shot because it sees the motion of the entire clip first.
 *  - @ffmpeg/core is not built with `--enable-libvidstab`, so the WASM path
 *    falls back to `deshake`, a single-pass per-block estimator. Less
 *    sophisticated, but real stabilisation that actually runs there.
 *
 * The two passes cannot be chained into one `-vf`: detect has to finish writing
 * the transforms file before transform can read it.
 */
/**
 * Deliberately a bare filename, not a path. ffmpeg runs with its working
 * directory set to the job's scratch dir (see the ffmpeg:run handler), and an
 * absolute Windows path inside a filtergraph breaks parsing — `:` separates
 * filter options, so the drive letter splits the argument.
 */
const TRF = 'transforms.trf';

export async function stabilize(clip: Clip, asset: MediaAsset, strength: number) {
  const useVidstab = hasFilter('vidstabdetect') && hasFilter('vidstabtransform');

  // deshake rejects any rx/ry that is not a multiple of 16 and caps at 64 —
  // "rx must be a multiple of 16" kills the whole filtergraph, it does not
  // round for you. Quantise into the four legal search radii.
  const steps = [16, 32, 48, 64];
  const rx = steps[Math.min(steps.length - 1, Math.floor((strength / 100) * steps.length))];

  // vidstab: shakiness 1-10 is how much motion to expect, smoothing is the
  // number of frames averaged either side of each frame.
  const shakiness = Math.max(1, Math.min(10, Math.round(1 + (strength / 100) * 9)));
  const smoothing = Math.max(3, Math.round(5 + (strength / 100) * 25));

  // Encoder settings shared by both paths. Being explicit about the pixel
  // format matters — an mp4 that is not yuv420p is a coin flip in Chromium —
  // and faststart matters because the result is played back immediately.
  const encode = [
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-c:a', 'copy',
  ];

  return runOp(
    clip,
    asset,
    'Stabilise',
    (input, output) => [
      '-hide_banner',
      '-i', input,
      '-vf',
      useVidstab
        ? // optzoom=1 crops just enough to hide the borders the warp exposes.
          `vidstabtransform=input=${TRF}:smoothing=${smoothing}:optzoom=1:interpol=bicubic,unsharp=5:5:0.4`
        : // edge=3 (mirror) fills the exposed area with mirrored pixels. edge=1
          // ("original") pastes the UNSTABILISED frame into the border, which
          // reintroduces the shake and reads as the picture edge juddering.
          `deshake=rx=${rx}:ry=${rx}:edge=3:blocksize=8:contrast=125,unsharp=5:5:0.4`,
      ...encode,
      '-y', output,
    ],
    'stabilized.mp4',
    'video/mp4',
    useVidstab ? ['vidstabtransform'] : ['deshake'],
    'stabilize',
    useVidstab
      ? (input) => [
          '-hide_banner',
          '-i', input,
          '-vf', `vidstabdetect=shakiness=${shakiness}:accuracy=15:result=${TRF}`,
          '-f', 'null', '-',
        ]
      : undefined
  );
}

/** Video noise reduction — hqdn3d, strength mapped onto its four knobs. */
export async function denoiseVideo(clip: Clip, asset: MediaAsset, strength: number) {
  const s = (strength / 100) * 6;
  return runOp(
    clip,
    asset,
    'Noise reduction',
    (input, output) => [
      // No `-loglevel error`: the default level is what prints the `time=`
      // status lines that drive the progress bar.
      '-hide_banner',
      '-i', input,
      '-vf', `hqdn3d=${s.toFixed(1)}:${(s * 0.75).toFixed(1)}:${(s * 1.5).toFixed(1)}:${(s * 1.5).toFixed(1)}`,
      '-c:a', 'copy',
      '-y', output,
    ],
    'denoised.mp4',
    'video/mp4',
    ['hqdn3d'],
    'denoise'
  );
}

/** Optical-flow interpolation — Section 9.8. */
export async function opticalFlow(clip: Clip, asset: MediaAsset, targetFps: number) {
  return runOp(
    clip,
    asset,
    'Optical flow',
    (input, output) => [
      // No `-loglevel error`: the default level is what prints the `time=`
      // status lines that drive the progress bar.
      '-hide_banner',
      '-i', input,
      '-vf', `minterpolate=fps=${targetFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`,
      '-c:a', 'copy',
      '-y', output,
    ],
    'interpolated.mp4',
    'video/mp4',
    ['minterpolate'],
    'optical-flow'
  );
}

/** Upscale via Lanczos. Real-ESRGAN is a later addition; this is honest bicubic-class scaling. */
export async function upscale(clip: Clip, asset: MediaAsset, factor: 2 | 4) {
  return runOp(
    clip,
    asset,
    `Upscale ${factor}×`,
    (input, output) => [
      // No `-loglevel error`: the default level is what prints the `time=`
      // status lines that drive the progress bar.
      '-hide_banner',
      '-i', input,
      '-vf', `scale=iw*${factor}:ih*${factor}:flags=lanczos,unsharp=5:5:0.6`,
      '-c:a', 'copy',
      '-y', output,
    ],
    'upscaled.mp4',
    'video/mp4',
    ['scale', 'unsharp'],
    'upscale'
  );
}

/** Audio noise reduction using ffmpeg's spectral gate (afftdn). */
export async function denoiseAudio(clip: Clip, asset: MediaAsset, strength: number) {
  const nr = Math.round(6 + (strength / 100) * 90);
  return runOp(
    clip,
    asset,
    'Noise reduction',
    (input, output) => [
      // No `-loglevel error`: the default level is what prints the `time=`
      // status lines that drive the progress bar.
      '-hide_banner',
      '-i', input,
      '-vn',
      '-af', `afftdn=nr=${nr}:nf=-25:tn=1,highpass=f=70,lowpass=f=15000`,
      '-y', output,
    ],
    'cleaned.wav',
    'audio/wav',
    ['afftdn', 'highpass', 'lowpass'],
    'denoise-audio'
  );
}

/**
 * Vocal isolation via mid/side separation.
 *
 * This is the classic centre-channel extraction, not Demucs: it removes or
 * isolates whatever sits in the middle of the stereo field. It works well on
 * ordinary stereo music and not at all on mono sources, which is a real limit
 * worth knowing rather than papering over.
 */
export async function isolateVocals(clip: Clip, asset: MediaAsset, mode: 'vocals' | 'instrumental') {
  const pan = mode === 'vocals' ? 'pan=mono|c0=0.5*c0+0.5*c1' : 'pan=stereo|c0=c0-c1|c1=c1-c0';
  return runOp(
    clip,
    asset,
    mode === 'vocals' ? 'Isolate vocals' : 'Remove vocals',
    (input, output) => ['-hide_banner', '-i', input, '-vn', '-af', pan, '-y', output],
    mode === 'vocals' ? 'vocals.wav' : 'instrumental.wav',
    'audio/wav',
    ['pan'],
    'isolate-vocals'
  );
}

/** Beat detection — onset strength over a spectral flux envelope, then tempo lock. */
export async function detectBeats(asset: MediaAsset): Promise<number[]> {
  const ui = useUIStore.getState();
  const editor = useEditorStore.getState();
  const fps = editor.meta?.fps ?? 30;
  const jobId = `beats-${asset.id}`;

  const file = await getFileHandle(asset);
  if (!file) {
    ui.setJob({ id: jobId, label: 'Beat sync', detail: '', progress: 1, error: 'Source unavailable.' });
    return [];
  }

  ui.setJob({ id: jobId, label: 'Beat sync', detail: 'Analysing audio', progress: -1 });
  try {
    const name = safeName(asset.name);
    const raw = await ffmpegClient.run(
      ['-hide_banner', '-loglevel', 'error', '-i', `/mnt/${name}`, '-vn', '-ac', '1', '-ar', '22050', '-f', 'f32le', '-y', 'beats.raw'],
      'beats.raw',
      { files: [new File([file], name, { type: file.type })] }
    );

    const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
    const beats = findBeats(samples, 22050).map((t) => secondsToFrames(t, fps));

    editor.commit('Detect beats', (d) => {
      d.beats = beats;
    });

    ui.setJob({ id: jobId, label: 'Beat sync', detail: `${beats.length} beats found`, progress: 1, done: true });
    window.setTimeout(() => ui.clearJob(jobId), 2400);
    return beats;
  } catch (err) {
    ui.setJob({ id: jobId, label: 'Beat sync', detail: '', progress: 1, error: (err as Error).message });
    return [];
  }
}

/**
 * Energy-envelope beat tracker.
 *
 * Frame the signal, take the positive first difference of frame energy (the
 * onset envelope), autocorrelate it to find the dominant inter-onset interval,
 * then pick peaks on that grid. Good enough to snap cuts to music, and it costs
 * nothing to ship.
 */
function findBeats(samples: Float32Array, sampleRate: number): number[] {
  const hop = Math.round(sampleRate * 0.01); // 10 ms frames
  const frames = Math.floor(samples.length / hop);
  if (frames < 8) return [];

  const energy = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const start = i * hop;
    for (let j = start; j < start + hop && j < samples.length; j++) sum += samples[j] * samples[j];
    energy[i] = Math.sqrt(sum / hop);
  }

  const onset = new Float32Array(frames);
  for (let i = 1; i < frames; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);

  // Autocorrelate over 60–200 BPM to find the beat period.
  const minLag = Math.round(60 / 200 / 0.01);
  const maxLag = Math.round(60 / 60 / 0.01);
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag && lag < frames; lag++) {
    let score = 0;
    for (let i = lag; i < frames; i++) score += onset[i] * onset[i - lag];
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // Phase: whichever offset lands the most onset energy on the grid.
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  for (let phase = 0; phase < bestLag; phase++) {
    let score = 0;
    for (let i = phase; i < frames; i += bestLag) score += onset[i];
    if (score > bestPhaseScore) {
      bestPhaseScore = score;
      bestPhase = phase;
    }
  }

  const beats: number[] = [];
  for (let i = bestPhase; i < frames; i += bestLag) beats.push((i * hop) / sampleRate);
  return beats;
}
