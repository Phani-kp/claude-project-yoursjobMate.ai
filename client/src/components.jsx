export const StatusBadge = ({ status }) => <span className={`badge s-${status}`}>{status}</span>;

export function MatchBadge({ score }) {
  const tone = score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low';
  return <span className={`match m-${tone}`} title="Match score">{score}%</span>;
}

export function Stat({ label, value, hint }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`card modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
