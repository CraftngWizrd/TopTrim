/**
 * DataTransfer MIME types for library drags.
 *
 * Kept in one place because both ends have to agree exactly, and because the
 * TYPE is what the timeline reads during `dragover` to decide what the drop
 * would do — the payload itself is unreadable until `drop` fires.
 */
export const DND_ASSET = 'application/x-toptrim-asset';
export const DND_EFFECT = 'application/x-toptrim-effect';
export const DND_TRANSITION = 'application/x-toptrim-transition';
export const DND_FILTER = 'application/x-toptrim-filter';
export const DND_STICKER = 'application/x-toptrim-sticker';
export const DND_TEXT_PRESET = 'application/x-toptrim-text';
