import { X } from 'lucide-react';
import './SettingsModal.css';

export interface ViewerSettings {
  showCycles: boolean;
  showWeather: boolean;
  showMoonPhases: boolean;
}

interface Props {
  open: boolean;
  settings: ViewerSettings;
  onChange: (next: ViewerSettings) => void;
  onClose: () => void;
}

const TOGGLES: { key: keyof ViewerSettings; label: string; hint: string }[] = [
  {
    key: 'showCycles',
    label: 'Show cycles',
    hint: 'Color the day columns with cycle phase markers from your journal.',
  },
  {
    key: 'showWeather',
    label: 'Show weather',
    hint: 'Overlay temperature / precip glyphs from the weather cache.',
  },
  {
    key: 'showMoonPhases',
    label: 'Show moon phases',
    hint: 'Tiny moon icon in the day footer.',
  },
];

export function SettingsModal({ open, settings, onChange, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Viewer Settings</h2>
          <button className="settings-close" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="settings-note">
          Defaults come from the iOS app's settings stored in the bundle.
          Changes here only affect the viewer.
        </p>

        <ul className="settings-list">
          {TOGGLES.map((t) => (
            <li key={t.key}>
              <label className="setting-row">
                <div className="setting-text">
                  <span className="setting-label">{t.label}</span>
                  <span className="setting-hint">{t.hint}</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings[t.key]}
                  onChange={(e) => onChange({ ...settings, [t.key]: e.target.checked })}
                />
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
