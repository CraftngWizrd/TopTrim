import { useMemo } from 'react';
import type { Clip } from '../../../types/project';
import { useEditorStore } from '../../stores/editorStore';
import { KeyframeDiamond } from '../common/Icon';
import { engagedPaths, hasKeyframeAt } from '../../../engine/keyframes';
import { defaultAudioProps, defaultColorGrade, defaultTransform } from '../../../engine/defaults';

/**
 * Group-level keyframe diamond, as in a typical editor's section headers.
 *
 * Pressing it records the group at the playhead — but only the properties that
 * are actually in play. A clip where you have nudged Scale and nothing else
 * gets one Scale keyframe, not five. If nothing in the group has been touched,
 * it records the whole group so you can pin a starting pose.
 */

export type CategoryId = 'transform' | 'crop' | 'color' | 'audio';

const PATHS: Record<CategoryId, string[]> = {
  transform: [
    'transform.x',
    'transform.y',
    'transform.scale',
    'transform.scaleX',
    'transform.scaleY',
    'transform.rotation',
    'transform.opacity',
  ],
  crop: ['transform.crop.left', 'transform.crop.right', 'transform.crop.top', 'transform.crop.bottom'],
  color: [
    'color.exposure', 'color.contrast', 'color.highlights', 'color.shadows',
    'color.whites', 'color.blacks', 'color.saturation', 'color.vibrance',
    'color.temperature', 'color.tint', 'color.sharpen', 'color.clarity', 'color.vignette',
  ],
  audio: ['audio.volumeDb', 'audio.pan'],
};

const LABEL: Record<CategoryId, string> = {
  transform: 'Keyframe position & size',
  crop: 'Keyframe crop',
  color: 'Keyframe colour',
  audio: 'Keyframe audio',
};

/** Neutral clip used to decide whether a property has been adjusted. */
const defaults = () => ({
  transform: defaultTransform(),
  color: defaultColorGrade(),
  audio: defaultAudioProps(),
});

export function CategoryKeyframe({
  clip,
  frame,
  category,
}: {
  clip: Clip;
  frame: number;
  category: CategoryId;
}) {
  const toggle = useEditorStore((s) => s.toggleCategoryKeyframe);
  const paths = PATHS[category];

  const targets = useMemo(() => {
    const engaged = engagedPaths(clip, clip.keyframes, paths, defaults());
    return engaged.length > 0 ? engaged : paths;
  }, [clip, paths]);

  const active = targets.length > 0 && targets.every((p) => hasKeyframeAt(clip.keyframes, p, frame));
  const animatedCount = paths.filter((p) => clip.keyframes[p]?.length).length;

  return (
    <button
      className="kf-diamond category-kf"
      onClick={() => toggle(clip.id, targets, frame, LABEL[category])}
      title={
        active
          ? `Remove keyframes here (${targets.length} ${targets.length === 1 ? 'property' : 'properties'})`
          : `Keyframe ${targets.length} adjusted ${targets.length === 1 ? 'property' : 'properties'} at the playhead`
      }
      aria-pressed={active}
    >
      <KeyframeDiamond active={active} size={11} />
      {animatedCount > 0 && <span className="category-kf-count mono">{animatedCount}</span>}
    </button>
  );
}
