import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import './SettingsModal.css';

export interface ViewerSettings {
  // Mood Chart strips
  showCycles: boolean;
  showWeather: boolean;
  showMoonPhases: boolean;
  // Appearance
  showLifeCalendar: boolean;
  // 'YYYY-MM-DD' or '' if unset.
  birthdate: string;
  // Years past this age get dimmed in the Life Calendar; null = no
  // shading. Number is age (column index), not calendar year.
  lifeFocusHorizonYears: number | null;
}

interface Props {
  open: boolean;
  settings: ViewerSettings;
  onChange: (next: ViewerSettings) => void;
  onClose: () => void;
}

interface ToggleDef {
  key: 'showCycles' | 'showWeather' | 'showMoonPhases' | 'showLifeCalendar';
  label: string;
  hint: string;
}

const MOOD_TOGGLES: ToggleDef[] = [
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

function parseBirthdate(s: string): { y: string; m: string; d: string } {
  if (!s) return { y: '', m: '', d: '' };
  const [y, m, d] = s.split('-');
  return {
    y: y ?? '',
    m: m ? String(Number(m)) : '',
    d: d ? String(Number(d)) : '',
  };
}

function joinBirthdate(y: string, m: string, d: string): string {
  if (!y || !m || !d) return '';
  const yy = Number(y);
  const mm = Number(m);
  const dd = Number(d);
  const today = new Date();
  if (
    !Number.isInteger(yy) || yy < 1900 || yy > today.getFullYear() ||
    !Number.isInteger(mm) || mm < 1 || mm > 12 ||
    !Number.isInteger(dd) || dd < 1 || dd > 31
  ) return '';
  const candidate = new Date(yy, mm - 1, dd);
  if (
    candidate.getFullYear() !== yy ||
    candidate.getMonth() !== mm - 1 ||
    candidate.getDate() !== dd ||
    candidate.getTime() > today.getTime()
  ) return '';
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function SettingsModal({ open, settings, onChange, onClose }: Props) {
  // Local draft for the birthdate inputs. We need this because typing
  // a single digit (e.g. "1" in year) produces an invalid date and
  // joinBirthdate returns '' — if we stored only the joined value,
  // every keystroke would clear the field on the next render.
  // The draft keeps what the user is typing visible; we only push
  // back into `settings.birthdate` when all three parts form a real
  // date (or when they're cleared back to empty).
  const [draft, setDraft] = useState(() => parseBirthdate(settings.birthdate));

  // Re-sync when the underlying setting changes from outside (e.g. a
  // new bundle opens with a different stored birthdate).
  useEffect(() => {
    setDraft(parseBirthdate(settings.birthdate));
  }, [settings.birthdate]);

  if (!open) return null;

  const setBirthdatePart = (part: 'y' | 'm' | 'd', value: string) => {
    const next = { ...draft, [part]: value };
    setDraft(next);
    const joined = joinBirthdate(next.y, next.m, next.d);
    if (joined) {
      onChange({ ...settings, birthdate: joined });
    } else if (next.y === '' && next.m === '' && next.d === '') {
      // All three cleared — clear the persisted value too.
      onChange({ ...settings, birthdate: '' });
    }
    // Otherwise leave the persisted value alone; user is mid-typing.
  };

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
          Mood Chart toggles seed from the iOS app's settings stored in the
          bundle. Changes here only affect the viewer.
        </p>

        <div className="settings-section">
          <h3 className="settings-section-title">Mood Chart</h3>
          <ul className="settings-list">
            {MOOD_TOGGLES.map((t) => (
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

        <div className="settings-section">
          <h3 className="settings-section-title">Appearance</h3>
          <ul className="settings-list">
            <li>
              <label className="setting-row">
                <div className="setting-text">
                  <span className="setting-label">Show Life Calendar tab</span>
                  <span className="setting-hint">A 100-year × 52-week grid of your life. Off by default.</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.showLifeCalendar}
                  onChange={(e) => onChange({ ...settings, showLifeCalendar: e.target.checked })}
                />
              </label>
            </li>
            {settings.showLifeCalendar && (
              <>
                <li>
                  <div className="setting-row stacked">
                    <div className="setting-text">
                      <span className="setting-label">Birthdate</span>
                      <span className="setting-hint">Used to anchor the Life Calendar grid.</span>
                    </div>
                    <div className="setting-bd-inputs">
                      <input
                        type="number"
                        placeholder="YYYY"
                        value={draft.y}
                        min={1900}
                        max={new Date().getFullYear()}
                        onChange={(e) => setBirthdatePart('y', e.target.value)}
                      />
                      <span className="bd-sep">/</span>
                      <input
                        type="number"
                        placeholder="MM"
                        value={draft.m}
                        min={1}
                        max={12}
                        onChange={(e) => setBirthdatePart('m', e.target.value)}
                      />
                      <span className="bd-sep">/</span>
                      <input
                        type="number"
                        placeholder="DD"
                        value={draft.d}
                        min={1}
                        max={31}
                        onChange={(e) => setBirthdatePart('d', e.target.value)}
                      />
                    </div>
                  </div>
                </li>
                <li>
                  <div className="setting-row stacked">
                    <div className="setting-text">
                      <span className="setting-label">Focus horizon (years)</span>
                      <span className="setting-hint">
                        Years past this age get dimmed so the active years stand out. Leave empty for no shading.
                      </span>
                    </div>
                    <div className="setting-bd-inputs">
                      <input
                        type="number"
                        placeholder="e.g. 75"
                        value={settings.lifeFocusHorizonYears ?? ''}
                        min={1}
                        max={99}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') {
                            onChange({ ...settings, lifeFocusHorizonYears: null });
                            return;
                          }
                          const n = Number(raw);
                          onChange({
                            ...settings,
                            lifeFocusHorizonYears:
                              Number.isInteger(n) && n > 0 && n <= 99 ? n : null,
                          });
                        }}
                      />
                    </div>
                  </div>
                </li>
              </>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
