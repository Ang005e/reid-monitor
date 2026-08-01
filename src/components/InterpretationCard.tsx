import type { Interpretation, ViewMode } from '@/types';

/**
 * One rule-engine finding, rendered for the active audience.
 * Community mode: plain language + what to do + who to tell.
 * Engineer mode: adds the technical detail and implicated channels.
 */
export function InterpretationCard({
  item,
  mode,
}: {
  item: Interpretation;
  mode: ViewMode;
}) {
  return (
    <div className={`card sev-${item.severity}`}>
      <div className="card-head">
        <span className={`sev-badge sev-badge-${item.severity}`}>{item.severity}</span>
        <span className="card-title">{item.title}</span>
      </div>

      {mode === 'engineer' ? (
        <>
          <p className="card-body mono">{item.engineerDetail}</p>
          <p className="card-meta">channels: {item.channels.join(', ')}</p>
        </>
      ) : (
        <>
          <p className="card-body">{item.communityMessage}</p>
          <div className="guidance">
            <div>
              <span className="guidance-label">What to do</span>
              <p>{item.action}</p>
            </div>
            <div>
              <span className="guidance-label">Who to tell</span>
              <p>{item.notifyWho}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
