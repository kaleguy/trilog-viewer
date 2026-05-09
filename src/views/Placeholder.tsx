interface Props {
  title: string;
}

export function Placeholder({ title }: Props) {
  return (
    <div style={{ padding: 32, color: 'var(--text-muted, #888)' }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h2>
      <p style={{ marginTop: 8, fontSize: 14 }}>Not implemented yet.</p>
    </div>
  );
}
