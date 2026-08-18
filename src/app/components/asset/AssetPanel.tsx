import { useUIStore } from '../../stores/uiStore';
import { MediaTab } from './MediaTab';
import { AudioTab } from './AudioTab';
import { TextTab } from './TextTab';
import { EffectsTab, FiltersTab, StickersTab, TransitionsTab } from './LibraryTabs';
import { CaptionsTab } from './CaptionsTab';
import { AdjustmentTab } from './AdjustmentTab';

export function AssetPanel() {
  const tab = useUIStore((s) => s.assetTab);

  switch (tab) {
    case 'media':
      return <MediaTab />;
    case 'audio':
      return <AudioTab />;
    case 'text':
      return <TextTab />;
    case 'stickers':
      return <StickersTab />;
    case 'effects':
      return <EffectsTab />;
    case 'transitions':
      return <TransitionsTab />;
    case 'filters':
      return <FiltersTab />;
    case 'captions':
      return <CaptionsTab />;
    case 'adjustment':
      return <AdjustmentTab />;
    default:
      return null;
  }
}
