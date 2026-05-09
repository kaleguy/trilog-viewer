import { X } from 'lucide-react';
import { APP_VERSION } from '../version';
import './AboutModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AboutModal({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="about-backdrop" onClick={onClose}>
      <div className="about-panel" onClick={(e) => e.stopPropagation()}>
        <div className="about-header">
          <h2>TriLog Viewer</h2>
          <button className="about-close" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p className="about-version">Version {APP_VERSION}</p>

        <p className="about-body">
          An offline desktop viewer for TriLog journal exports. Open a
          {' '}<code>journal.db</code> bundle from the iPhone app and browse
          your mood, energy, activity, notes, weather, cycles, and
          moon-phase history laid out for the bigger screen.
        </p>

        <p className="about-body">
          Built with Tauri 2 + React + Vite.
        </p>

        <p className="about-license">
          Released under the <strong>MIT License</strong>. The viewer
          stores nothing; it only reads the bundle you point it at.
        </p>
      </div>
    </div>
  );
}
