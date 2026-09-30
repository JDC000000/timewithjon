// src/lib/jobs/jobs/materialise-done.ts — AD-8: locked -> done once the end has passed (joined follow the host).
// §6: every transition writes audit_log, in the same statement as the change (review T4.2.00 M7).
import { q } from '@/lib/db';
import { registerJob } from '../registry';

const AUDIT_DONE = `insert into audit_log (actor, action, request_id, detail)
  select 'system', 'done', id, '{"from_status":"locked","to_status":"done"}'::jsonb from moved`;

registerJob({
  name: 'materialise-done',
  async run(now) {
    await q(
      `with moved as (
         update request set status = 'done'
          where status = 'locked' and joined_to_request_id is null and locked_ends_at <= $1
          returning id)
       ${AUDIT_DONE}`,
      [now],
    );
    await q(
      `with moved as (
         update request r set status = 'done' from request h
          where r.joined_to_request_id = h.id and r.status = 'locked' and h.status = 'done'
          returning r.id)
       ${AUDIT_DONE}`,
    );
  },
});
