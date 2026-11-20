export function Progress({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="progress" aria-live="polite">
      <div className="spinner" aria-hidden />
      <h2>{title}</h2>
      <ol>
        {steps.map((s, i) => (
          <li key={i} className={i === steps.length - 1 ? 'current' : 'done'}>
            {i === steps.length - 1 ? '…' : '✓'} {s}
          </li>
        ))}
      </ol>
      <p className="muted small">
        Es werden nur kostenlose, öffentliche Dienste genutzt (OpenStreetMap, Wikivoyage, OSRM). Beim ersten Mal kann das
        etwas dauern, danach greift der Cache.
      </p>
    </div>
  );
}
