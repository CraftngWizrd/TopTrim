import { useEditorStore } from '../../stores/editorStore';
import { useContextMenu } from '../common/ContextMenu';
import { Icon } from '../common/Icon';
import { RULER_H, type trackLayout } from '../../../engine/timelineRenderer';
import { bandOf } from '../../../engine/trackOrder';
import type { Track, TrackKind } from '../../../types/project';

const TRACK_ICON: Record<TrackKind, string> = {
  video: 'camera',
  audio: 'music',
  text: 'type',
  sticker: 'star',
  effect: 'film',
};

/** 60px label column, aligned row-for-row with the canvas lanes. */
/** Is there a sibling in the same band to swap with in that direction? */
function canMove(tracks: Track[], track: Track, delta: number): boolean {
  const band = bandOf(track);
  const siblings = tracks.filter((t) => bandOf(t) === band);
  const index = siblings.findIndex((t) => t.id === track.id);
  const target = index + delta;
  return target >= 0 && target < siblings.length;
}

export function TrackLabels({
  layout,
  scrollY,
}: {
  layout: ReturnType<typeof trackLayout>;
  /** Kept in lockstep with the canvas so labels never drift off their lanes. */
  scrollY: number;
}) {
  const tracks = useEditorStore((s) => s.state.tracks);
  const patchTrack = useEditorStore((s) => s.patchTrack);
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const moveTrack = useEditorStore((s) => s.moveTrack);
  const contextMenu = useContextMenu();

  return (
    <div className="tl-labels">
      {/* Matches the ruler, which does not scroll. */}
      <div className="tl-labels-spacer" style={{ height: RULER_H }} />

      <div className="tl-labels-scroll" style={{ transform: `translateY(${-scrollY}px)` }}>
        {tracks.map((track, i) => (
        <div
          key={track.id}
          className={`tl-label${track.locked ? ' is-locked' : ''}${track.hidden ? ' is-hidden' : ''}${track.isMain ? ' is-main' : ''}`}
          style={{ height: layout.heights[i] }}
          onContextMenu={contextMenu([
            {
              label: 'Move up',
              // The main track anchors the stack, and a track cannot leave its
              // band — audio stays below, overlays above.
              disabled: !!track.isMain || !canMove(tracks, track, -1),
              onSelect: () => moveTrack(track.id, -1),
            },
            {
              label: 'Move down',
              disabled: !!track.isMain || !canMove(tracks, track, 1),
              onSelect: () => moveTrack(track.id, 1),
            },
            { separator: true },
            { label: track.hidden ? 'Show track' : 'Hide track', onSelect: () => patchTrack(track.id, { hidden: !track.hidden }) },
            { label: track.locked ? 'Unlock track' : 'Lock track', onSelect: () => patchTrack(track.id, { locked: !track.locked }) },
            { label: track.muted ? 'Unmute track' : 'Mute track', onSelect: () => patchTrack(track.id, { muted: !track.muted }) },
            { separator: true },
            {
              label: track.isMain ? 'Delete track (main)' : 'Delete track',
              danger: true,
              disabled: tracks.length <= 1 || !!track.isMain,
              onSelect: () => removeTrack(track.id),
            },
          ])}
          title={track.isMain ? `${track.name} — the main track, anchored between overlays and audio` : track.name}
        >
          <Icon name={TRACK_ICON[track.kind]} size={12} className="tl-label-icon" />
          <span className="tl-label-name" title={track.name}>
            {track.name}
          </span>
          <button
            className={`tl-label-btn${track.hidden ? ' is-off' : ''}`}
            onClick={() => patchTrack(track.id, { hidden: !track.hidden })}
            aria-label={track.hidden ? 'Show track' : 'Hide track'}
          >
            <Icon name={track.hidden ? 'eye-off' : 'eye'} size={11} />
          </button>
          <button
            className={`tl-label-btn${track.locked ? ' is-on' : ''}`}
            onClick={() => patchTrack(track.id, { locked: !track.locked })}
            aria-label={track.locked ? 'Unlock track' : 'Lock track'}
          >
            <Icon name={track.locked ? 'lock' : 'unlock'} size={11} />
            </button>
          </div>
        ))}

        {/*
          No "add track" button by design. Tracks appear when you drag a clip
          past the edge of its band and retire when their last clip leaves, so
          the stack always matches what is on the timeline. A manual button
          alongside that produced empty rows the auto-prune then removed, which
          is exactly the inconsistency this replaces.
        */}
        <div className="tl-track-hint">Drag a clip past the top for a new track</div>
      </div>
    </div>
  );
}
