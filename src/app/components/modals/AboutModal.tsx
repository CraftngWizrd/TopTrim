import { Modal } from '../common/Modal';

export function AboutModal({ onClose }: { onClose(): void }) {
  return (
    <Modal
      title="About TopTrim"
      onClose={onClose}
      width={400}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="about-wordmark">TopTrim</div>
      <div className="about-version mono">v2.0.0</div>
      <p className="about-body">
        A free video editor with no watermark, no subscription, and no account. Every feature — including transcription,
        background removal, noise reduction and stabilisation — runs locally on this machine.
      </p>
      <p className="about-body">
        Nothing you import, edit or export is sent anywhere. The app works fully offline after first launch.
      </p>
      <div className="about-facts">
        <div>
          <span>Export watermark</span>
          <span className="mono">None</span>
        </div>
        <div>
          <span>Resolution cap</span>
          <span className="mono">None</span>
        </div>
        <div>
          <span>Account required</span>
          <span className="mono">No</span>
        </div>
        <div>
          <span>Network access</span>
          <span className="mono">Model download only</span>
        </div>
      </div>
    </Modal>
  );
}
