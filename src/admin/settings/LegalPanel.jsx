import { useState } from 'react';
import { Eye, FilePen, RotateCcw, ScrollText } from 'lucide-react';
import defaultPolicy from '../../../docs/PRIVACY_POLICY.md?raw';
import PrivacyPolicyView from '../../components/PrivacyPolicyView';
import { Badge, Button, Card, CardBody, CardHeader, Modal } from '../ui';

/* Legal: the privacy policy customers open from the app (sign-in sheet,
 * profile, Deferred Tikkie home). Empty means the standard PackPerks
 * policy. */
export default function LegalPanel({ draft, canEdit }) {
  const text = draft.settings.privacyPolicyText || '';
  const custom = text.trim().length > 0;
  const [preview, setPreview] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const words = custom ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="st-stack">
      <Card>
        <CardHeader
          title="Privacy policy"
          icon={ScrollText}
          subtitle="What customers read when they open “Privacy policy” in the app."
          actions={(
            <>
              <Badge tone={custom ? 'primary' : 'neutral'}>{custom ? 'Written for this venue' : 'Standard PackPerks policy'}</Badge>
              <Button size="sm" icon={Eye} onClick={() => setPreview(true)}>Preview</Button>
            </>
          )}
        />
        <CardBody>
          {custom ? (
            <>
              <label className="ui-field__label" htmlFor="set-privacy">Policy text</label>
              <textarea
                id="set-privacy"
                className="ui-textarea st-policy"
                rows={18}
                disabled={!canEdit}
                value={text}
                onChange={e => draft.update('privacyPolicyText', e.target.value, 'Privacy policy')}
              />
              <div className="st-policy__foot">
                <span className="st-hint">
                  {words.toLocaleString('en-GB')} words · # for headings, **bold**, and - for lists. Published with the rest of your settings.
                </span>
                {canEdit && (
                  <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => setConfirmReset(true)}>
                    Use the standard policy
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="st-policy-empty">
              <p className="st-modal-text">
                This venue shows the standard PackPerks privacy policy. Write your own when the venue
                processes data differently, for example with its own data controller or retention period.
              </p>
              {canEdit && (
                <Button
                  variant="primary"
                  icon={FilePen}
                  onClick={() => draft.update('privacyPolicyText', defaultPolicy, 'Privacy policy')}
                >
                  Start from the standard policy
                </Button>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {preview && (
        <PrivacyPolicyView text={custom ? text : null} onClose={() => setPreview(false)} />
      )}

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Go back to the standard policy?"
        subtitle="Your text is removed from the draft. Publish to make it final."
        icon={RotateCcw}
        iconTone="amber"
        footer={(
          <>
            <Button variant="outline" onClick={() => setConfirmReset(false)}>Keep my text</Button>
            <Button
              variant="primary"
              onClick={() => {
                draft.update('privacyPolicyText', '', 'Privacy policy');
                setConfirmReset(false);
              }}
            >
              Use the standard policy
            </Button>
          </>
        )}
      >
        <p className="st-modal-text">Customers will see the PackPerks policy that ships with the app.</p>
      </Modal>
    </div>
  );
}
