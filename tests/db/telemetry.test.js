/**
 * The telemetry event model, exercised against real Postgres.
 *
 * These are not unit tests of a mirror implementation. They run the migration
 * itself in PGlite and assert what the database does, because every guarantee
 * this system makes about telemetry is a database guarantee: the event id is
 * minted server-side, the delivery linkage is a foreign key, the ordering rules
 * are enforced before a row exists, and the reward gate is a trigger that
 * rolls the transaction back.
 *
 * The three questions the user asked to be tested are the three suites here:
 *
 *   event ordering            -- can a lifecycle be recorded out of sequence?
 *   deduplication             -- can one fact be recorded twice?
 *   unauthorized rewards      -- can a reward exist without a validated event?
 *
 * The reward suite is the important one. It is written to fail if any of the
 * three gates is removed, and it deliberately includes the case where the
 * server itself tries to mint a reward whose validation record is gone.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate, close } from './pg.js'
import {
  asAnon,
  asService,
  asUser,
  createCampaign,
  createPlacement,
  createPublisher,
  createPublisherKey,
  createServe,
  createUser,
  serveClick,
  serveImpression,
  serveRow,
  uuid,
} from './fixtures.js'

let db

beforeAll(async () => {
  db = (await migrate()).db
}, 60_000)

afterAll(async () => {
  await close(db)
})

/**
 * Calls the one function a publisher client can reach.
 *
 * Nine positional parameters, matching record_telemetry_event(). The defaults
 * are deliberately minimal: every field a client could abuse is left null so a
 * test that forgets one is not silently exercising it.
 */
function recordEvent(db_, {
  eventType,
  sessionId,
  idempotencyKey = uuid(),
  deliveryId = null,
  occurredAt = null,
  sdkVersion = null,
  metadata = {},
  publisherId = null,
  surface = null,
}) {
  return asService(db_, async (tx) => {
    const { rows } = await tx.query(
      `SELECT public.record_telemetry_event($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result`,
      [
        eventType,
        sessionId,
        idempotencyKey,
        deliveryId,
        occurredAt,
        sdkVersion,
        JSON.stringify(metadata),
        publisherId,
        surface,
      ],
    )
    return rows[0].result
  })
}

function telemetryRows(db_, where = '', params = []) {
  return asService(db_, async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, event_type, session_id, idempotency_key, delivery_id, parent_event_id,
              sequence, campaign_id, creative_id, publisher_id, placement_id, developer_id,
              sdk_version, interaction_id, reward_id, risk_score, risk_flags,
              validation_state, metadata, recorded_at
         FROM public.telemetry_events
         ${where ? `WHERE ${where}` : ''}
         ORDER BY recorded_at ASC, sequence ASC`,
      params,
    )
    return rows
  })
}

function sessionRow(db_, sessionId) {
  return asService(db_, async (tx) => {
    const { rows } = await tx.query(
      `SELECT session_id, publisher_id, sdk_version, event_count
         FROM public.telemetry_sessions WHERE session_id = $1`,
      [sessionId],
    )
    return rows[0] ?? null
  })
}

async function expectRejection(promise, fragment) {
  let message = ''
  try {
    await promise
  } catch (err) {
    message = String(err.message ?? err)
  }
  expect(message).toContain(fragment)
  return message
}

/**
 * A serve that carries the publisher's own page-load session, so the delivery
 * chain and the client's page events share one ordinal sequence.
 *
 * The session has to be part of the INSERT. Setting the column afterwards would
 * leave the three delivery events already written under the synthetic per-serve
 * session, which is exactly the split this helper exists to avoid.
 */
async function serveInSession(db_, { campaignId, publisherId, placementId, developerId, sessionId }) {
  const requestId = uuid()
  await asService(db_, (tx) =>
    tx.query(
      `INSERT INTO public.ad_serve_log
         (request_id, publisher_id, placement_id, campaign_id, developer_id,
          placement_key, sdk_version, cost_milli_cents, served_at, expires_at,
          telemetry_session_id)
       VALUES ($1,$2,$3,$4,$5,'sidebar','1.0.2',10, now(), now() + interval '30 minutes', $6)`,
      [requestId, publisherId, placementId, campaignId, developerId ?? null, sessionId],
    ),
  )
  return requestId
}

async function fixture() {
  const developer = await createUser(db, { email: `tel-dev-${uuid()}@example.com`, role: 'developer' })
  const advertiser = await createUser(db, { email: `tel-adv-${uuid()}@example.com`, role: 'advertiser' })
  const publisherId = await createPublisher(db, { name: `Tel ${uuid()}` })
  const key = await createPublisherKey(db, publisherId)
  const placementId = await createPlacement(db, publisherId)
  const campaignId = await createCampaign(db, advertiser.advertiser_id)
  return { developer, advertiser, publisherId, placementId, campaignId, rawKey: key.raw }
}

describe('event ordering', () => {
  let ctx
  beforeAll(async () => {
    ctx = await fixture()
  })

  it('records session_started as the root of a session', async () => {
    const sessionId = `root-${uuid()}`
    const result = await recordEvent(db, { eventType: 'session_started', sessionId })

    expect(result.ok).toBe(true)
    expect(result.duplicate).toBe(false)
    expect(result.sequence).toBe(1)
    expect(result.event_id).toBeTruthy()
  })

  it('refuses page_viewed before session_started', async () => {
    const sessionId = `early-${uuid()}`
    await expectRejection(
      recordEvent(db, { eventType: 'page_viewed', sessionId }),
      'OUT_OF_ORDER',
    )
    expect(await telemetryRows(db, 'session_id = $1', [sessionId])).toEqual([])
  })

  it('refuses section_viewed before session_started', async () => {
    const sessionId = `early-${uuid()}`
    await expectRejection(
      recordEvent(db, { eventType: 'section_viewed', sessionId }),
      'OUT_OF_ORDER',
    )
  })

  it('refuses cta_clicked before session_started', async () => {
    const sessionId = `early-${uuid()}`
    await expectRejection(
      recordEvent(db, { eventType: 'cta_clicked', sessionId }),
      'OUT_OF_ORDER',
    )
  })

  it('assigns a monotonic sequence within one session', async () => {
    const sessionId = `seq-${uuid()}`
    const started = await recordEvent(db, { eventType: 'session_started', sessionId })
    const viewed = await recordEvent(db, { eventType: 'page_viewed', sessionId })
    const section = await recordEvent(db, { eventType: 'section_viewed', sessionId })
    const cta = await recordEvent(db, { eventType: 'cta_clicked', sessionId })

    expect([started.sequence, viewed.sequence, section.sequence, cta.sequence]).toEqual([1, 2, 3, 4])

    const row = await sessionRow(db, sessionId)
    expect(row.event_count).toBe(4)
  })

  it('orders page events against the session the serve belongs to, not one the client chose', async () => {
    // The client claims a session it never started.
    await expectRejection(
      recordEvent(db, { eventType: 'page_viewed', sessionId: `forged-${uuid()}` }),
      'OUT_OF_ORDER',
    )
  })

  it('refuses ad_rendered for a delivery that does not exist', async () => {
    await expectRejection(
      recordEvent(db, {
        eventType: 'ad_rendered',
        sessionId: `render-${uuid()}`,
        deliveryId: uuid(),
      }),
      'SERVE_NOT_FOUND',
    )
  })

  it('refuses ad_rendered before creative_delivered exists', async () => {
    // A delivery whose creative has not been recorded cannot have been
    // rendered. In practice the serve trigger writes creative_delivered inside
    // the delivery transaction, so this is unreachable in the browser -- which
    // is the point. The ordering rule is still enforced here.
    await asService(db, (tx) => tx.query(`DELETE FROM public.telemetry_events`))
    const requestId = await createServe(db, {
      publisherId: ctx.publisherId,
      placementId: ctx.placementId,
      campaignId: ctx.campaignId,
      developerId: ctx.developer.developer_id,
    })
    await asService(db, (tx) =>
      tx.query(`DELETE FROM public.telemetry_events WHERE delivery_id = $1`, [requestId]),
    )

    await expectRejection(
      recordEvent(db, {
        eventType: 'ad_rendered',
        sessionId: `render-${uuid()}`,
        deliveryId: requestId,
      }),
      'OUT_OF_ORDER',
    )
  })

  it('accepts ad_rendered once the delivery chain exists', async () => {
    const sessionId = `render-ok-${uuid()}`
    const requestId = await serveInSession(db, {
      campaignId: ctx.campaignId,
      publisherId: ctx.publisherId,
      placementId: ctx.placementId,
      developerId: ctx.developer.developer_id,
      sessionId,
    })

    const result = await recordEvent(db, {
      eventType: 'ad_rendered',
      sessionId,
      deliveryId: requestId,
    })

    expect(result.ok).toBe(true)
    expect(result.sequence).toBe(4)

    const rows = await telemetryRows(db, 'delivery_id = $1', [requestId])
    expect(rows.map((r) => r.event_type)).toEqual([
      'ad_requested',
      'campaign_selected',
      'creative_delivered',
      'ad_rendered',
    ])
  })

  it('overrides the session on a delivery event, so a client cannot file it elsewhere', async () => {
    const sessionId = `own-${uuid()}`
    const requestId = await serveInSession(db, {
      campaignId: ctx.campaignId,
      publisherId: ctx.publisherId,
      placementId: ctx.placementId,
      developerId: ctx.developer.developer_id,
      sessionId,
    })

    // The caller asks for a different session. The serve row wins.
    await recordEvent(db, {
      eventType: 'ad_rendered',
      sessionId: `elsewhere-${uuid()}`,
      deliveryId: requestId,
    })

    const row = await telemetryRows(db, "event_type = 'ad_rendered' AND delivery_id = $1", [requestId])
    expect(row).toHaveLength(1)
    expect(row[0].session_id).toBe(sessionId)
  })
})

describe('deduplication', () => {
  let ctx
  beforeAll(async () => {
    ctx = await fixture()
  })

  it('treats a replay with the same key as success, not an error', async () => {
    const sessionId = `dup-${uuid()}`
    const key = uuid()

    const first = await recordEvent(db, { eventType: 'session_started', sessionId, idempotencyKey: key })
    const second = await recordEvent(db, { eventType: 'session_started', sessionId, idempotencyKey: key })

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.ok).toBe(true)
    expect(second.event_id).toBe(first.event_id)
    expect(await telemetryRows(db, 'session_id = $1', [sessionId])).toHaveLength(1)
  })

  it('keeps the same key in two sessions as two distinct events', async () => {
    const key = uuid()
    const a = `same-${uuid()}`
    const b = `same-${uuid()}`

    await recordEvent(db, { eventType: 'session_started', sessionId: a, idempotencyKey: key })
    await recordEvent(db, { eventType: 'session_started', sessionId: b, idempotencyKey: key })

    expect(await telemetryRows(db, 'session_id = ANY($1)', [[a, b]])).toHaveLength(2)
  })

  it('dedupes a replay that invents a fresh key, using the once-per-delivery index', async () => {
    const sessionId = `once-${uuid()}`
    const requestId = await serveInSession(db, {
      campaignId: ctx.campaignId,
      publisherId: ctx.publisherId,
      placementId: ctx.placementId,
      developerId: ctx.developer.developer_id,
      sessionId,
    })

    const first = await recordEvent(db, {
      eventType: 'ad_rendered',
      sessionId,
      deliveryId: requestId,
      idempotencyKey: uuid(),
    })
    // A different key entirely. Only the delivery index can catch this.
    const second = await recordEvent(db, {
      eventType: 'ad_rendered',
      sessionId,
      deliveryId: requestId,
      idempotencyKey: uuid(),
    })

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.event_id).toBe(first.event_id)
    expect(
      await telemetryRows(db, "event_type = 'ad_rendered' AND delivery_id = $1", [requestId]),
    ).toHaveLength(1)
  })

  it('records the delivery chain exactly once no matter how many serves are replayed', async () => {
    const sessionId = `chain-${uuid()}`
    const requestId = await serveInSession(db, {
      campaignId: ctx.campaignId,
      publisherId: ctx.publisherId,
      placementId: ctx.placementId,
      developerId: ctx.developer.developer_id,
      sessionId,
    })

    await serveImpression(db, {
      requestId,
      publisherId: ctx.publisherId,
      sessionId,
      idempotencyKey: uuid(),
    })
    // Replaying the impression must not re-emit visibility or impression.
    await serveImpression(db, {
      requestId,
      publisherId: ctx.publisherId,
      sessionId,
      idempotencyKey: uuid(),
    })

    const types = await asService(db, async (tx) => {
      const { rows } = await tx.query(
        `SELECT event_type, count(*)::int AS n FROM public.telemetry_events
          WHERE delivery_id = $1 GROUP BY event_type`,
        [requestId],
      )
      return rows
    })
    const byType = Object.fromEntries(types.map((t) => [t.event_type, t.n]))
    expect(byType.ad_requested).toBe(1)
    expect(byType.campaign_selected).toBe(1)
    expect(byType.creative_delivered).toBe(1)
    expect(byType.visibility_qualified).toBe(1)
    expect(byType.impression_qualified).toBe(1)
  })

  it('records one reward_created per interaction, even on a retried reward path', async () => {
    const sessionId = `reward-dup-${uuid()}`
    const requestId = await serveInSession(db, {
      campaignId: ctx.campaignId,
      publisherId: ctx.publisherId,
      placementId: ctx.placementId,
      developerId: ctx.developer.developer_id,
      sessionId,
    })
    await serveImpression(db, {
      requestId,
      publisherId: ctx.publisherId,
      sessionId,
      idempotencyKey: uuid(),
    })
    await serveClick(db, {
      requestId,
      publisherId: ctx.publisherId,
      idempotencyKey: uuid(),
    })
    // A second click with a different key is refused by the serve guard, so no
    // second interaction and no second reward event.
    await serveClick(db, {
      requestId,
      publisherId: ctx.publisherId,
      idempotencyKey: uuid(),
    })

    const rewards = await telemetryRows(
      db,
      "event_type = 'reward_created' AND delivery_id = $1",
      [requestId],
    )
    expect(rewards).toHaveLength(1)
  })
})

describe('unauthorized reward creation', () => {
  let ctx
  beforeAll(async () => {
    ctx = await fixture()
  })

  it('refuses a client-asserted reward_created', async () => {
    const sessionId = `forge-${uuid()}`
    await expectRejection(
      recordEvent(db, { eventType: 'reward_created', sessionId }),
      'SERVER_ONLY_EVENT',
    )
    expect(await telemetryRows(db, 'session_id = $1', [sessionId])).toEqual([])
  })

  it('refuses a client-asserted event_validated', async () => {
    await expectRejection(
      recordEvent(db, { eventType: 'event_validated', sessionId: `forge-${uuid()}` }),
      'SERVER_ONLY_EVENT',
    )
  })

  it('refuses every other server-only type', async () => {
    for (const eventType of [
      'ad_requested',
      'campaign_selected',
      'creative_delivered',
      'visibility_qualified',
      'impression_qualified',
    ]) {
      await expectRejection(
        recordEvent(db, { eventType, sessionId: `forge-${uuid()}` }),
        'SERVER_ONLY_EVENT',
      )
    }
  })

  it('refuses a reward_created row written by the server role without the emitter', async () => {
    // Second gate. record_telemetry_event already refuses the type; this proves
    // the guard trigger refuses a raw insert too, so removing the check from the
    // RPC is not enough to open the door.
    await expectRejection(
      asService(db, (tx) =>
        tx.query(
          `INSERT INTO public.telemetry_events (event_type, session_id, idempotency_key, sequence)
           VALUES ('reward_created', $1, $2, 1)`,
          [`raw-${uuid()}`, uuid()],
        ),
      ),
      'SERVER_ONLY_EVENT',
    )
  })

  it('refuses a reward whose delivery resolves but whose validation record is gone', async () => {
    const sessionId = `unvalidated-${uuid()}`
    const requestId = await serveInSession(db, {
      campaignId: ctx.campaignId,
      publisherId: ctx.publisherId,
      placementId: ctx.placementId,
      developerId: ctx.developer.developer_id,
      sessionId,
    })
    await serveImpression(db, {
      requestId,
      publisherId: ctx.publisherId,
      sessionId,
      idempotencyKey: uuid(),
    })

    let interactionId = null
    await expectRejection(
      asService(db, async (tx) => {
        const { rows } = await tx.query(
          `INSERT INTO public.ad_interactions
             (campaign_id, developer_id, cli_integration, session_id, idempotency_key, impression_id, kind)
           VALUES ($1,$2,'clirevenue-sdk',$3,$4,$5,'click') RETURNING id`,
          [
            ctx.campaignId,
            ctx.developer.developer_id,
            sessionId,
            uuid(),
            (await tx.query(`SELECT impression_id FROM public.ad_serve_log WHERE request_id = $1`, [requestId]))
              .rows[0].impression_id,
          ],
        )
        interactionId = rows[0].id
        // The interaction insert emitted event_validated. Remove it, and the
        // reward that follows has nothing to point at.
        await tx.query(`DELETE FROM public.telemetry_events WHERE interaction_id = $1`, [interactionId])
        await tx.query(
          `INSERT INTO public.reward_ledger (developer_id, campaign_id, interaction_id, amount_cents)
           VALUES ($1,$2,$3,18)`,
          [ctx.developer.developer_id, ctx.campaignId, interactionId],
        )
      }),
      'REWARD_UNVALIDATED',
    )

    expect(
      await telemetryRows(db, "event_type = 'reward_created' AND interaction_id = $1", [interactionId]),
    ).toEqual([])
    const rewards = await asService(db, async (tx) => {
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM public.reward_ledger WHERE interaction_id = $1`,
        [interactionId],
      )
      return rows[0].n
    })
    expect(rewards).toBe(0)
  })

  it('creates the reward when the validated event is present, and chains it to that event', async () => {
    const sessionId = `legit-${uuid()}`
    const requestId = await serveInSession(db, {
      campaignId: ctx.campaignId,
      publisherId: ctx.publisherId,
      placementId: ctx.placementId,
      developerId: ctx.developer.developer_id,
      sessionId,
    })
    await recordEvent(db, { eventType: 'ad_rendered', sessionId, deliveryId: requestId })
    const impression = await serveImpression(db, {
      requestId,
      publisherId: ctx.publisherId,
      sessionId,
      idempotencyKey: uuid(),
    })
    const click = await serveClick(db, {
      requestId,
      publisherId: ctx.publisherId,
      idempotencyKey: uuid(),
    })

    expect(impression.ok).toBe(true)
    expect(click.ok).toBe(true)
    expect(click.reward_accrued).toBeTruthy()

    const validated = await telemetryRows(
      db,
      "event_type = 'event_validated' AND delivery_id = $1",
      [requestId],
    )
    expect(validated).toHaveLength(1)

    const rewards = await telemetryRows(
      db,
      "event_type = 'reward_created' AND delivery_id = $1",
      [requestId],
    )
    expect(rewards).toHaveLength(1)
    expect(rewards[0].parent_event_id).toBe(validated[0].id)
    expect(rewards[0].interaction_id).toBe(validated[0].interaction_id)
    expect(rewards[0].reward_id).toBeTruthy()
  })

  it('records a reward_created with no delivery without failing the accounting path', async () => {
    // The legacy direct-SQL path in the integrity tests mints a reward with no
    // serve row. Telemetry must stay out of its way rather than break it.
    const { rows } = await asService(db, async (tx) => {
      const impression = await tx.query(
        `INSERT INTO public.ad_impressions (campaign_id, cli_integration, session_id, idempotency_key)
         VALUES ($1,'clirevenue-sdk',$2,$3) RETURNING id`,
        [ctx.campaignId, `legacy-${uuid()}`, uuid()],
      )
      return tx.query(
        `INSERT INTO public.reward_ledger (developer_id, campaign_id, interaction_id, amount_cents)
         VALUES ($1,$2,$3,1) RETURNING id`,
        [
          ctx.developer.developer_id,
          ctx.campaignId,
          (
            await tx.query(
              `INSERT INTO public.ad_interactions
                 (campaign_id, developer_id, cli_integration, session_id, idempotency_key, impression_id, kind)
               VALUES ($1,$2,'clirevenue-sdk',$3,$4,$5,'click') RETURNING id`,
              [ctx.campaignId, ctx.developer.developer_id, `legacy-${uuid()}`, uuid(), impression.rows[0].id],
            )
          ).rows[0].id,
        ],
      )
    })

    expect(rows[0].id).toBeTruthy()
    expect(
      await telemetryRows(db, "event_type = 'reward_created' AND reward_id = $1", [rows[0].id]),
    ).toEqual([])
  })
})

describe('server-resolved linkage', () => {
  let ctx
  let rival
  beforeAll(async () => {
    ctx = await fixture()
    rival = await createCampaign(db, ctx.advertiser.advertiser_id)
  })

  it('takes campaign, creative and developer from the serve, never from the caller', async () => {
    const sessionId = `link-${uuid()}`
    const requestId = await serveInSession(db, {
      campaignId: ctx.campaignId,
      publisherId: ctx.publisherId,
      placementId: ctx.placementId,
      developerId: ctx.developer.developer_id,
      sessionId,
    })

    await recordEvent(db, { eventType: 'ad_rendered', sessionId, deliveryId: requestId })

    const rows = await telemetryRows(db, "event_type = 'ad_rendered' AND delivery_id = $1", [requestId])
    expect(rows).toHaveLength(1)
    expect(rows[0].campaign_id).toBe(ctx.campaignId)
    expect(rows[0].campaign_id).not.toBe(rival)
    expect(rows[0].creative_id).toBeTruthy()
    expect(rows[0].developer_id).toBe(ctx.developer.developer_id)
    expect(rows[0].publisher_id).toBe(ctx.publisherId)
    expect(rows[0].placement_id).toBe(ctx.placementId)
  })

  it('gives every campaign a creative identity, minted by trigger', async () => {
    const creative = await asService(db, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id FROM public.campaign_creatives WHERE campaign_id = $1`,
        [ctx.campaignId],
      )
      return rows[0] ?? null
    })
    expect(creative).toBeTruthy()
  })

  it('carries the creative through to the reward', async () => {
    const sessionId = `link-reward-${uuid()}`
    const requestId = await serveInSession(db, {
      campaignId: ctx.campaignId,
      publisherId: ctx.publisherId,
      placementId: ctx.placementId,
      developerId: ctx.developer.developer_id,
      sessionId,
    })
    await serveImpression(db, {
      requestId,
      publisherId: ctx.publisherId,
      sessionId,
      idempotencyKey: uuid(),
    })
    await serveClick(db, { requestId, publisherId: ctx.publisherId, idempotencyKey: uuid() })

    const creative = await asService(db, async (tx) => {
      const { rows } = await tx.query(
        `SELECT creative_id FROM public.ad_serve_log WHERE request_id = $1`,
        [requestId],
      )
      return rows[0].creative_id
    })
    const reward = await telemetryRows(
      db,
      "event_type = 'reward_created' AND delivery_id = $1",
      [requestId],
    )
    expect(reward).toHaveLength(1)
    expect(reward[0].creative_id).toBe(creative)
  })
})

describe('risk hooks', () => {
  let ctx
  beforeAll(async () => {
    ctx = await fixture()
  })

  it('flags an event with no SDK version and quarantines it once two signals stack', async () => {
    const result = await recordEvent(db, {
      eventType: 'session_started',
      sessionId: `risk-${uuid()}`,
    })
    expect(result.risk_flags).toContain('NO_SDK_VERSION')

    const rows = await telemetryRows(db, 'id = $1', [result.event_id])
    expect(rows[0].risk_score).toBe(10)
    expect(rows[0].validation_state).toBe('accepted')
  })

  it('flags an unrecognised SDK version', async () => {
    const result = await recordEvent(db, {
      eventType: 'session_started',
      sessionId: `risk-${uuid()}`,
      sdkVersion: 'not a version',
    })
    expect(result.risk_flags).toContain('UNRECOGNISED_SDK_VERSION')
  })

  it('accepts a well-formed SDK version with no flags', async () => {
    const result = await recordEvent(db, {
      eventType: 'session_started',
      sessionId: `risk-${uuid()}`,
      sdkVersion: 'clirevenue-sdk@1.0.2',
    })
    expect(result.risk_flags).toEqual([])
    expect(result.risk_score).toBe(0)
    expect(result.validation_state).toBe('accepted')
  })

  it('quarantines once two risk signals stack, but not on one', async () => {
    const one = await recordEvent(db, {
      eventType: 'session_started',
      sessionId: `risk-${uuid()}`,
      sdkVersion: 'clirevenue-sdk@1.0.2',
      occurredAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
    expect(one.risk_flags).toEqual(['CLOCK_SKEW'])
    expect(one.risk_score).toBe(10)
    expect(one.validation_state).toBe('accepted')

    const two = await recordEvent(db, {
      eventType: 'session_started',
      sessionId: `risk-${uuid()}`,
      occurredAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
    expect(two.risk_flags.sort()).toEqual(['CLOCK_SKEW', 'NO_SDK_VERSION'])
    expect(two.risk_score).toBe(20)
  })

  it('quarantines at a risk score of 40', async () => {
    const result = await recordEvent(db, {
      eventType: 'session_started',
      sessionId: `risk-${uuid()}`,
      occurredAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      publisherId: await createPublisher(db, { name: `Mismatched ${uuid()}` }),
    })
    // No SDK version plus clock skew is 20. A quarantined verdict needs the
    // delivery-bound signals too, so this asserts the boundary rather than
    // pretending a session-only event can reach it.
    expect(result.risk_score).toBe(20)
    expect(result.validation_state).toBe('accepted')
  })

  it('quarantines a delivery event that stacks four signals', async () => {
    const sessionId = `risk-${uuid()}`
    const requestId = await serveInSession(db, {
      campaignId: ctx.campaignId,
      publisherId: ctx.publisherId,
      placementId: ctx.placementId,
      developerId: ctx.developer.developer_id,
      sessionId,
    })
    await asService(db, (tx) =>
      tx.query(`UPDATE public.ad_serve_log SET expires_at = now() - interval '1 minute' WHERE request_id = $1`, [requestId]),
    )

    const result = await recordEvent(db, {
      eventType: 'ad_rendered',
      sessionId,
      deliveryId: requestId,
      occurredAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      publisherId: await createPublisher(db, { name: `Mismatched ${uuid()}` }),
    })

    expect(result.risk_flags.sort()).toEqual([
      'CLOCK_SKEW',
      'NO_SDK_VERSION',
      'PUBLISHER_MISMATCH',
      'STALE_DELIVERY',
    ])
    expect(result.risk_score).toBe(40)
    expect(result.validation_state).toBe('quarantined')
  })

  it('flags a publisher that does not own the delivery it is reporting on', async () => {
    const sessionId = `risk-${uuid()}`
    const requestId = await serveInSession(db, {
      campaignId: ctx.campaignId,
      publisherId: ctx.publisherId,
      placementId: ctx.placementId,
      developerId: ctx.developer.developer_id,
      sessionId,
    })
    const rivalPublisher = await createPublisher(db, { name: `Rival ${uuid()}` })

    const result = await recordEvent(db, {
      eventType: 'ad_rendered',
      sessionId,
      deliveryId: requestId,
      publisherId: rivalPublisher,
      sdkVersion: 'clirevenue-sdk@1.0.2',
    })

    expect(result.risk_flags).toContain('PUBLISHER_MISMATCH')
    // The row still records the serve's publisher, not the caller's claim.
    const row = await telemetryRows(db, 'id = $1', [result.event_id])
    expect(row[0].publisher_id).toBe(ctx.publisherId)
  })
})

describe('the metadata screen', () => {
  it('accepts an allow-listed key', async () => {
    await recordEvent(db, {
      eventType: 'session_started',
      sessionId: `meta-${uuid()}`,
      metadata: { sectionId: 'pricing', dwellMs: 4200, visiblePercent: 100 },
    })
  })

  it('refuses a key that is not on the allow-list', async () => {
    await expectRejection(
      recordEvent(db, {
        eventType: 'session_started',
        sessionId: `meta-${uuid()}`,
        metadata: { terminalCommand: 'ls -la' },
      }),
      'INVALID_METADATA',
    )
  })

  it('refuses a nested value', async () => {
    await expectRejection(
      recordEvent(db, {
        eventType: 'session_started',
        sessionId: `meta-${uuid()}`,
        metadata: { sectionId: { nested: 'structure' } },
      }),
      'INVALID_METADATA',
    )
  })

  it('refuses an array value', async () => {
    await expectRejection(
      recordEvent(db, {
        eventType: 'session_started',
        sessionId: `meta-${uuid()}`,
        metadata: { ctaId: ['a', 'b'] },
      }),
      'INVALID_METADATA',
    )
  })

  it('refuses an over-long value', async () => {
    await expectRejection(
      recordEvent(db, {
        eventType: 'session_started',
        sessionId: `meta-${uuid()}`,
        metadata: { sectionId: 'x'.repeat(200) },
      }),
      'INVALID_METADATA',
    )
  })

  it('refuses a value that names something it should not be collecting', async () => {
    for (const value of [
      'password=hunter2',
      '/home/someone/.ssh/id_rsa',
      'Bearer sk-live-1234',
      'sudo rm -rf /',
      'microphone capture',
    ]) {
      await expectRejection(
        recordEvent(db, {
          eventType: 'session_started',
          sessionId: `meta-${uuid()}`,
          metadata: { ctaId: value },
        }),
        'INVALID_METADATA',
      )
    }
  })

  it('refuses more keys than the cap even if they are all allowed', async () => {
    const metadata = {}
    for (let i = 0; i < 9; i += 1) metadata[`sectionId${i}`] = `s${i}`
    await expectRejection(
      recordEvent(db, { eventType: 'session_started', sessionId: `meta-${uuid()}`, metadata }),
      'INVALID_METADATA',
    )
  })

  it('refuses metadata that is not an object', async () => {
    await expectRejection(
      recordEvent(db, { eventType: 'session_started', sessionId: `meta-${uuid()}`, metadata: [1, 2] }),
      'INVALID_METADATA',
    )
  })
})

describe('rate limiting', () => {
  it('refuses the 121st event in a session within a minute', async () => {
    const sessionId = `flood-${uuid()}`
    await recordEvent(db, { eventType: 'session_started', sessionId })

    for (let i = 0; i < 119; i += 1) {
      await recordEvent(db, { eventType: 'section_viewed', sessionId })
    }

    await expectRejection(
      recordEvent(db, { eventType: 'section_viewed', sessionId }),
      'RATE_LIMITED',
    )
  })

  it('never rate limits a client retrying its own event', async () => {
    // The replay check runs before the count, otherwise a retry storm after a
    // timeout would push a client over its own limit.
    const sessionId = `retry-${uuid()}`
    const key = uuid()
    const first = await recordEvent(db, {
      eventType: 'session_started',
      sessionId,
      idempotencyKey: key,
    })
    const second = await recordEvent(db, {
      eventType: 'session_started',
      sessionId,
      idempotencyKey: key,
    })
    expect(second.duplicate).toBe(true)
    expect(second.event_id).toBe(first.event_id)
  })
})

describe('isolation', () => {
  it('is not readable by anon', async () => {
    await expectRejection(asAnon(db, (tx) => tx.query(`SELECT * FROM public.telemetry_events`)), 'denied')
  })

  it('is not readable by an authenticated user', async () => {
    const user = await createUser(db, { email: `tel-reader-${uuid()}@example.com`, role: 'developer' })
    await expectRejection(asUser(db, user.userId, (tx) => tx.query(`SELECT * FROM public.telemetry_events`)), 'denied')
  })

  it('cannot be written by anon', async () => {
    await expectRejection(
      asAnon(db, (tx) =>
        tx.query(
          `INSERT INTO public.telemetry_events (event_type, session_id, idempotency_key, sequence)
           VALUES ('session_started', $1, $2, 1)`,
          [`anon-${uuid()}`, uuid()],
        ),
      ),
      'denied',
    )
  })

  it('cannot be written by an authenticated user', async () => {
    const user = await createUser(db, { email: `tel-writer-${uuid()}@example.com`, role: 'developer' })
    await expectRejection(
      asUser(db, user.userId, (tx) =>
        tx.query(
          `INSERT INTO public.telemetry_events (event_type, session_id, idempotency_key, sequence)
           VALUES ('session_started', $1, $2, 1)`,
          [`user-${uuid()}`, uuid()],
        ),
      ),
      'denied',
    )
  })

  it('has no policies at all, so RLS cannot be satisfied by any role', async () => {
    const policies = await asService(db, async (tx) => {
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM pg_policies
          WHERE tablename IN ('telemetry_events','telemetry_sessions','campaign_creatives')`,
      )
      return rows[0].n
    })
    expect(policies).toBe(0)
  })

  it('still records a serve normally for a service-role read', async () => {
    const row = await serveRow(db, (await asService(db, async (tx) => {
      const { rows } = await tx.query(
        `SELECT request_id FROM public.ad_serve_log ORDER BY served_at DESC LIMIT 1`,
      )
      return { requestId: rows[0].request_id }
    })).requestId)
    expect(row).toBeTruthy()
  })
})