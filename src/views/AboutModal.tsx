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
        <button className="about-close" type="button" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div className="about-brand">
          <div className="about-dots" aria-hidden>
            <span className="about-dot about-dot-mood" />
            <span className="about-dot about-dot-energy" />
            <span className="about-dot about-dot-activity" />
          </div>
          <h2 className="about-title">
            <span className="about-title-tri">Tri</span>
            <span className="about-title-log">Log</span>
            <span className="about-title-viewer"> Viewer</span>
          </h2>
          <span className="about-version-pill">v{APP_VERSION}</span>
        </div>

        <p className="about-body">
          An offline desktop viewer for TriLog journal exports. Open a
          {' '}<code>journal.db</code> bundle from the iPhone app and browse
          your mood, energy, activity, notes, weather, cycles, and
          moon-phase history laid out for the bigger screen.
        </p>

        <div className="about-meta">
          <div className="about-meta-row">
            <span className="about-meta-label">Built with</span>
            <span className="about-meta-value">Tauri 2 · React · Vite</span>
          </div>
          <div className="about-meta-row">
            <span className="about-meta-label">License</span>
            <span className="about-meta-value">MIT</span>
          </div>
          <div className="about-meta-row">
            <span className="about-meta-label">Privacy</span>
            <span className="about-meta-value">Read-only · no telemetry</span>
          </div>
        </div>
      </div>
    </div>
  );
}
