import { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { SelectField, Toggle } from '../common/Controls';
import { usePlatform } from '../../hooks/usePlatform';
import { setPreferMultiThread } from '../../../engine/ffmpegHost';

interface Settings {
  whisperModel: 'tiny' | 'base' | 'small';
  hardwareDecode: boolean;
  proxyEditing: boolean;
  autoSaveEnabled: boolean;
  storyboardDensity: 'low' | 'normal' | 'high';
  multiThreadFfmpeg: boolean;
}

const DEFAULTS: Settings = {
  whisperModel: 'base',
  hardwareDecode: true,
  proxyEditing: false,
  autoSaveEnabled: true,
  storyboardDensity: 'normal',
  multiThreadFfmpeg: false,
};

export function SettingsModal({ onClose }: { onClose(): void }) {
  const platform = usePlatform();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  useEffect(() => {
    let alive = true;
    void platform.getSetting<Settings>('preferences').then((s) => {
      if (!alive || !s) return;
      const merged = { ...DEFAULTS, ...s };
      setSettings(merged);
      setPreferMultiThread(merged.multiThreadFfmpeg);
    });
    return () => {
      alive = false;
    };
  }, [platform]);

  const patch = (p: Partial<Settings>) => {
    const next = { ...settings, ...p };
    setSettings(next);
    if (p.multiThreadFfmpeg !== undefined) setPreferMultiThread(p.multiThreadFfmpeg);
    void platform.setSetting('preferences', next);
  };

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      width={440}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="section-label" style={{ marginTop: 8 }}>
        Transcription
      </div>
      <SelectField
        label="Whisper model"
        value={settings.whisperModel}
        options={[
          { label: 'Tiny — fastest, ~75 MB', value: 'tiny' as const },
          { label: 'Base — balanced, ~145 MB', value: 'base' as const },
          { label: 'Small — most accurate, ~480 MB', value: 'small' as const },
        ]}
        onChange={(whisperModel) => patch({ whisperModel })}
      />
      <p className="settings-note">
        Models download once on first use and are cached locally. Nothing is uploaded — transcription runs on this
        machine.
      </p>

      <div className="section-label" style={{ marginTop: 16 }}>
        Performance
      </div>
      <Toggle label="Hardware decoding" checked={settings.hardwareDecode} onChange={(v) => patch({ hardwareDecode: v })} />
      <Toggle label="Proxy editing" checked={settings.proxyEditing} onChange={(v) => patch({ proxyEditing: v })} />
      <Toggle
        label="Multi-threaded ffmpeg"
        checked={settings.multiThreadFfmpeg}
        onChange={(v) => patch({ multiThreadFfmpeg: v })}
      />
      <p className="settings-note">
        Off by default. The multi-threaded core encodes faster but does not always hand control back when a command
        finishes — when that happens, thumbnails and exports hang instead of completing. Turn it on only if it behaves
        on your machine.
      </p>
      <SelectField
        label="Storyboard density"
        value={settings.storyboardDensity}
        options={[
          { label: 'Low — fewer thumbnails', value: 'low' as const },
          { label: 'Normal', value: 'normal' as const },
          { label: 'High — most detail', value: 'high' as const },
        ]}
        onChange={(storyboardDensity) => patch({ storyboardDensity })}
      />

      <div className="section-label" style={{ marginTop: 16 }}>
        Project
      </div>
      <Toggle label="Auto-save every 30s" checked={settings.autoSaveEnabled} onChange={(v) => patch({ autoSaveEnabled: v })} />
    </Modal>
  );
}
