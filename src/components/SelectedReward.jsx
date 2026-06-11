import './SelectedReward.css';
import { rewardImageStyle } from '../utils/imageTransform';

export default function SelectedReward({ reward, isUnlocked, claimed }) {
  return (
    <article
      className={[
        'selected-reward',
        isUnlocked ? 'selected-reward--unlocked' : '',
        claimed ? 'selected-reward--claimed' : '',
      ].join(' ')}
      aria-label={`Selected reward: ${reward.name}`}
    >
      <div className="selected-reward__image-wrap">
        <img
          src={reward.image}
          alt={reward.name}
          className="selected-reward__image"
          style={rewardImageStyle(reward)}
          loading="eager"
        />
        {isUnlocked && (
          <span className="selected-reward__badge" aria-label={claimed ? 'Claimed' : 'Ready'}>
            {claimed ? '🎉' : '✓'}
          </span>
        )}
      </div>
      <div className="selected-reward__info">
        <h2 className="selected-reward__name">{reward.name}</h2>
        <p className="selected-reward__desc">{reward.description}</p>
        <div className="selected-reward__tags">
          {isUnlocked ? (
            <>
              <span className="selected-reward__tag selected-reward__tag--green">
                {claimed ? 'CLAIMED' : 'FREE'}
              </span>
              {reward.tags.filter(t => t !== 'FREE' && t !== 'PICK IT').map((tag) => (
                <span key={tag} className="selected-reward__tag">{tag}</span>
              ))}
            </>
          ) : (
            reward.tags.filter(t => t !== 'PICK IT').map((tag) => (
              <span key={tag} className="selected-reward__tag">{tag}</span>
            ))
          )}
        </div>
      </div>
    </article>
  );
}
