// src/app/_landing/SendAStory.tsx — the landing's #story block (T1.9.U1; pack v2.2 s01 #story; the header's
// "Send a story" jumps here). stories@ forwards to
// Jon's Gmail; there is NO auto-reply, so the page promises none (creative v1.4).
import { SEND_A_STORY } from '@/content';
import { STORIES_DOMAIN } from '@/content/ui/landing';
import { CopyAddress } from './CopyAddress';
import { noWidow } from './text';

export function SendAStory() {
  const address = SEND_A_STORY.address(STORIES_DOMAIN);
  return (
    <section className="section" id="story" aria-labelledby="st-h">
      <div className="wrap">
        <h2 className="h1" id="st-h">
          {SEND_A_STORY.title}
        </h2>
        <p className="body measure" style={{ marginTop: 'var(--s4)' }}>
          {noWidow(SEND_A_STORY.body)}
        </p>
        <div className="copyrow">
          <a className="addr" href={`mailto:${address}`}>
            {address}
          </a>
          <CopyAddress address={address} />
        </div>
      </div>
    </section>
  );
}
