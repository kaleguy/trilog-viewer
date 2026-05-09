import { X } from 'lucide-react';
import './MetricsCustomize.css';

interface MetricItem {
  id: string;
  label: string;
}

interface Props {
  open: boolean;
  metrics: MetricItem[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
  onClose: () => void;
}

export function MetricsCustomize({ open, metrics, hidden, onChange, onClose }: Props) {
  if (!open) return null;
  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div className="metrics-customize-backdrop" onClick={onClose}>
      <div className="metrics-customize-panel" onClick={(e) => e.stopPropagation()}>
        <div className="metrics-customize-header">
          <h2>Show Metrics</h2>
          <button type="button" className="metrics-customize-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="metrics-customize-hint">
          Toggle which rows appear in the grid. All on by default.
        </p>
        <ul className="metrics-customize-list">
          {metrics.map((m) => {
            const visible = !hidden.has(m.id);
            return (
              <li key={m.id}>
                <label className="metrics-customize-row">
                  <span>{m.label}</span>
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() => toggle(m.id)}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
