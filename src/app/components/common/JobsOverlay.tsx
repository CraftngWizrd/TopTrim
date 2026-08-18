import { useEffect, useState } from 'react';
import { useUIStore, type Job } from '../../stores/uiStore';
import { Icon } from './Icon';

/**
 * Background work — storyboard extraction, AI passes, export — reports here.
 * Never a blocking modal (Section 9).
 *
 * Anything that can be stopped gets a cancel button, and anything with a
 * measurable size reports percentage, counts and a time estimate, so a long
 * job is never an opaque spinner.
 */
export function JobsOverlay() {
  const jobs = useUIStore((s) => s.jobs);
  const clearJob = useUIStore((s) => s.clearJob);
  const list = Object.values(jobs);

  // Ticks the ETA forward while a timed job is running.
  const [, tick] = useState(0);
  const hasTimed = list.some((j) => j.startedAt && !j.done && !j.error);
  useEffect(() => {
    if (!hasTimed) return;
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, [hasTimed]);

  if (list.length === 0) return null;

  return (
    <div className="jobs-overlay">
      {list.map((job) => (
        <JobCard key={job.id} job={job} onDismiss={() => clearJob(job.id)} />
      ))}
    </div>
  );
}

function JobCard({ job, onDismiss }: { job: Job; onDismiss(): void }) {
  const running = !job.done && !job.error;
  const stats = describe(job);

  return (
    <div className="job-card">
      <div className="job-head">
        <Icon
          name={job.error ? 'info' : job.done ? 'check' : 'settings'}
          size={13}
          className={running ? 'spin' : ''}
          style={job.error ? { color: 'var(--danger)' } : job.done ? { color: 'var(--accent)' } : undefined}
        />
        <span>{job.label}</span>
        {running && job.progress >= 0 && (
          <span className="job-pct mono">{Math.round(job.progress * 100)}%</span>
        )}
        <button className="icon-btn job-dismiss" onClick={onDismiss} aria-label="Dismiss">
          <Icon name="x" size={11} />
        </button>
      </div>

      <div className={`job-detail${job.error ? ' job-error' : ''}`}>{job.error ?? job.detail}</div>

      {running && (
        <>
          <div className={`job-bar${job.progress < 0 ? ' is-indeterminate' : ''}`}>
            <div
              className="job-bar-fill"
              style={job.progress >= 0 ? { width: `${Math.round(job.progress * 100)}%` } : undefined}
            />
          </div>

          <div className="job-foot">
            <span className="job-stats mono">{stats}</span>
            {job.onCancel && (
              <button
                className="job-cancel"
                onClick={() => {
                  job.onCancel?.();
                  onDismiss();
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** "12 / 40 · 18s elapsed · ~24s left" — only the parts that are actually known. */
function describe(job: Job): string {
  const parts: string[] = [];

  if (job.total_count !== undefined && job.done_count !== undefined) {
    parts.push(`${job.done_count} / ${job.total_count}`);
  }

  if (job.startedAt) {
    const elapsed = (Date.now() - job.startedAt) / 1000;
    parts.push(`${formatSeconds(elapsed)} elapsed`);

    // An estimate is only worth showing once there is enough progress for it
    // to mean anything — early guesses swing wildly and read as noise.
    if (job.progress > 0.05 && job.progress < 1) {
      const remaining = elapsed / job.progress - elapsed;
      parts.push(`~${formatSeconds(remaining)} left`);
    }
  }

  return parts.join(' · ');
}

function formatSeconds(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '—';
  if (s < 60) return `${Math.max(1, Math.round(s))}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}
