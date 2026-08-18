import { Icon } from './common/Icon';
import { useUIStore, type AssetTab } from '../stores/uiStore';

/**
 * Horizontal tab bar in the conventional editor order. It spans the LEFT PANEL width only —
 * never the full window (Section 5.2).
 */
const TABS: { id: AssetTab; label: string; icon: string }[] = [
  { id: 'media', label: 'Media', icon: 'film' },
  { id: 'audio', label: 'Audio', icon: 'music' },
  { id: 'text', label: 'Text', icon: 'type' },
  { id: 'stickers', label: 'Stickers', icon: 'star' },
  { id: 'effects', label: 'Effects', icon: 'effect' },
  { id: 'transitions', label: 'Transitions', icon: 'transition' },
  { id: 'filters', label: 'Filters', icon: 'filter' },
  { id: 'captions', label: 'Captions', icon: 'captions' },
  { id: 'adjustment', label: 'Adjustment', icon: 'sliders' },
];

export function AssetTabBar() {
  const assetTab = useUIStore((s) => s.assetTab);
  const setAssetTab = useUIStore((s) => s.setAssetTab);

  return (
    <div className="asset-tabbar" role="tablist" aria-label="Asset library">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={assetTab === t.id}
          className={`asset-tab${assetTab === t.id ? ' is-active' : ''}`}
          onClick={() => setAssetTab(t.id)}
          title={t.label}
        >
          <Icon name={t.icon} size={16} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
