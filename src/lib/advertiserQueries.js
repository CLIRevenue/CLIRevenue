import { supabase } from './api.js'

/**
 * Support queries, straight against Postgres.
 *
 * Every read and every write here is scoped by the row level policies in
 * 20261015000000_advertiser_queries.sql: an advertiser may SELECT and
 * INSERT only their own rows, may not UPDATE them at all — an advertiser
 * must never be able to edit the answer they are shown — and admin
 * SELECT/UPDATE goes through public.jwt_is_admin(). So there is no
 * advertiser id to send and none is stored: profile_id is the user's own
 * auth uid, and the policy is the ownership check.
 *
 * Nothing here trusts the client for ownership. That is the whole reason
 * it talks to the database directly instead of through an Edge Function.
 */

const TABLE = 'advertiser_queries'

export const QUERY_CATEGORIES = [
  { id: 'general', label: 'General' },
  { id: 'billing', label: 'Billing' },
  { id: 'campaign', label: 'Campaigns' },
  { id: 'sdk', label: 'SDK' },
  { id: 'account', label: 'Account' },
  { id: 'bug', label: 'Something is broken' },
]

const COLUMNS =
  'id, profile_id, user_email, phone, company_name, subject, body, screenshots, status, admin_reply, replied_at, category, created_at, updated_at'

function queryError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

/**
 * A missing table is the single most likely reason a support request
 * silently vanishes, and it is the one reason a generic "try again" is
 * actively harmful: retrying will never work, because the table is in a
 * migration file that nobody has run. So it gets its own sentence and the
 * command that fixes it.
 *
 * PostgREST reports a missing relation two ways depending on whether the
 * schema cache has caught up — 42P01 from the database, PGRST205 from the
 * cache — and both are matched.
 */
const MISSING_TABLE = /42P01|PGRST205|does not exist|not found in the schema cache/i

export const MIGRATION_HINT =
  'The support table has not been created yet. Run `supabase db push` (or apply ' +
  'supabase/migrations/20261015000000_advertiser_queries.sql).'

function friendly(err, fallback) {
  if (MISSING_TABLE.test(err?.code || '') || MISSING_TABLE.test(err?.message || '')) {
    return MIGRATION_HINT
  }
  return fallback
}

function normalize(row) {
  if (!row) return null
  return {
    id: row.id,
    profileId: row.profile_id,
    email: row.user_email,
    phone: row.phone || '',
    company: row.company_name || '',
    subject: row.subject,
    body: row.body,
    screenshots: Array.isArray(row.screenshots) ? row.screenshots : [],
    status: row.status,
    reply: row.admin_reply || '',
    repliedAt: row.replied_at || null,
    category: row.category,
    createdAt: row.created_at,
  }
}

export async function fetchQueries({ limit = 25 } = {}) {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw queryError(error.code, friendly(error, 'Could not load your support requests.'))
  return (data || []).map(normalize)
}

/** The admin's view: every advertiser's query, newest first. */
export async function fetchAllQueries({ limit = 100 } = {}) {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw queryError(error.code, friendly(error, 'Could not load support requests.'))
  return (data || []).map(normalize)
}

/**
 * Files the user attached. The bytes are uploaded separately by the caller;
 * what lands here is the path each one will be readable at, which is what
 * the admin panel renders. An empty array is fine and is the common case.
 */
export async function createQuery(input) {
  const session = await supabase.auth.getUser()
  const userId = session.data?.user?.id
  if (!userId) throw queryError('NOT_SIGNED_IN', 'Sign in before opening a support request.')

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      profile_id: userId,
      user_email: session.data.user.email || input.email || '',
      phone: input.phone || null,
      company_name: input.company || null,
      subject: input.subject.trim(),
      body: input.body.trim(),
      category: input.category || 'general',
      screenshots: input.screenshots || [],
    })
    .select(COLUMNS)
    .single()
  if (error) throw queryError(error.code, friendly(error, 'Could not send your request. Try again in a moment.'))
  return normalize(data)
}

/** Admin only. The RLS policy is the gate; the UI is not. */
export async function replyToQuery(id, reply) {
  const text = String(reply || '').trim()
  if (!text) throw queryError('EMPTY_REPLY', 'Write a reply before sending it.')

  const { data, error } = await supabase
    .from(TABLE)
    .update({ admin_reply: text, status: 'answered', replied_at: new Date().toISOString() })
    .eq('id', id)
    .select(COLUMNS)
    .single()
  if (error) throw queryError(error.code, 'Could not save that reply.')
  return normalize(data)
}

export async function closeQuery(id) {
  const { error } = await supabase.from(TABLE).update({ status: 'closed' }).eq('id', id)
  if (error) throw queryError(error.code, 'Could not close that request.')
}

/**
 * What the bell shows. Two sources, deliberately merged here rather than
 * in the component: answers to the advertiser's own queries, which are
 * the thing a person is actually waiting on, and any query still open
 * with no answer after a day, which is the thing worth nudging them
 * about. Performance insights are rendered by the caller from data it
 * already has — inventing them here would be inventing numbers.
 */
export async function fetchNotifications() {
  const queries = await fetchQueries({ limit: 50 })
  const answered = queries.filter((q) => q.reply)
  const waiting = queries.filter((q) => !q.reply && q.status !== 'closed')
  return {
    answered,
    waiting,
    unread: answered.length,
    queries,
  }
}
