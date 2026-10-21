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
  'id, profile_id, user_email, phone, company_name, subject, body, screenshots, status, admin_reply, replied_at, subscriber_read_at, category, created_at, updated_at'

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
    readAt: row.subscriber_read_at || null,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

  // The id is chosen here, not by the database, because the upload paths
  // embed it (<uid>/<query id>/<uuid>.<ext>) and the retention purge joins
  // on that second segment. The id must also be answerable for RLS later.
  const id = crypto.randomUUID()
  const screenshots = input.files?.length
    ? await uploadScreenshots(userId, id, input.files)
    : []

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id,
      profile_id: userId,
      user_email: session.data.user.email || input.email || '',
      phone: input.phone || null,
      company_name: input.company || null,
      subject: input.subject.trim(),
      body: input.body.trim(),
      category: input.category || 'general',
      screenshots,
    })
    .select(COLUMNS)
    .single()
  if (error) throw queryError(error.code, friendly(error, 'Could not send your request. Try again in a moment.'))
  return normalize(data)
}

/**
 * Whether the caller's own email is on the admin allowlist.
 *
 * This exists because every admin read in this console is filtered by
 * public.jwt_is_admin(), and RLS filtering is silent: if the email is not
 * on public.admin_emails the policy simply does not match and the query
 * returns zero rows with no error. An admin looking at an empty
 * "Advertiser queries" tab cannot tell that apart from genuinely having no
 * queries, and will spend an hour looking for a bug in the wrong place.
 *
 * The function is GRANT EXECUTE'd to authenticated by 000017, so asking it
 * directly is both possible and cheap.
 */
export async function checkAdminAccess() {
  const { data, error } = await supabase.rpc('jwt_is_admin')
  if (error) return { admin: false, reason: error.message }
  return { admin: data === true, reason: '' }
}

/**
 * The caller's own role row. Used alongside checkAdminAccess() to tell the
 * difference between "your profile is not admin" and "your profile is admin
 * but the allowlist is empty" — only the second one is bootstrapable, and
 * only the second one gets a button instead of a SQL console instruction.
 */
export async function fetchMyRole() {
  const { data, error } = await supabase.from('profiles').select('role').eq('id', (await supabase.auth.getUser()).data.user?.id).maybeSingle()
  if (error) return { role: null, error: error.message }
  return { role: data?.role ?? null, error: null }
}

/**
 * Bootstrap the admin allowlist for the signed-in account.
 *
 * The first admin cannot bootstrap through requireAdmin: that function reads
 * public.admin_emails, which is empty until somebody puts an email in it,
 * and the only way to put an email in it is to be an admin. This route
 * breaks that cycle by accepting the call when the table is empty and the
 * caller's profile already says 'admin'. It is idempotent: once the table
 * has a row the server answers 409 and the caller falls back to the SQL
 * console, where further admins are supposed to be added by a human.
 */
export async function bootstrapAdminAllowlist() {
  // The route is /admin/bootstrap, not the function root: supabase.functions.invoke
  // appends the function name to its own URL, so passing 'admin' alone lands on
  // POST /admin, which the handler answers with 405. The bootstrap branch is
  // keyed on the `bootstrap` segment, so the path has to carry it.
  const { data, error } = await supabase.functions.invoke('admin/bootstrap', {
    body: '{}',
    method: 'POST',
  })
  if (error) throw queryError('BOOTSTRAP_FAILED', error.message || 'Could not bootstrap the admin allowlist.')
  return data
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
    // Unread is a DB fact now (subscribers stamp read time through
    // mark_queries_read), not tab state — which is why the red dot
    // survives a refresh.
    unread: answered.filter((q) => !q.readAt).length,
    queries,
  }
}

/**
 * Stamp read receipts. Called with an id array after opening one
 * notification, or with nothing at all for "mark all as read". Resolved
 * against the signed-in user server-side, so a caller cannot mark somebody
 * else's rows and cannot re-touch rows that are already read. Returns how
 * many rows were stamped, which the bell mostly ignores — the optimistic
 * UI update and the next fetch disagree never.
 */
export async function markQueriesRead(ids) {
  const { data, error } = await supabase.rpc('mark_queries_read', {
    p_ids: Array.isArray(ids) && ids.length ? ids : null,
  })
  if (error) throw queryError(error.code, friendly(error, 'Could not mark that as read. Try again in a moment.'))
  return typeof data === 'number' ? data : 0
}

/**
 * Screenshots: attach, upload, and issue short-lived read links.
 *
 * Storage contract: private bucket `support-screenshots`, every object under
 * `<auth uid>/<query id>/<uuid>.<ext>`. Storage RLS lets a signed-in user
 * write only into their own folder and read their own folder — admins read
 * anything via jwt_is_admin(). Retention is enforced DB-side by
 * public.purge_support_screenshots(): once a query has been answered for 12
 * hours an hourly cron removes its objects from storage. Nothing here needs
 * the service key, so the browser keeps holding only the publishable key.
 */

const SUPPORT_BUCKET = 'support-screenshots'
const SUPPORT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const SUPPORT_MAX_BYTES = 5 * 1024 * 1024

export async function uploadScreenshots(userId, queryId, files) {
  if (!userId) throw queryError('NOT_SIGNED_IN', 'Sign in before attaching screenshots.')
  const uploaded = []
  for (const file of files) {
    if (!SUPPORT_TYPES.has(file.type)) {
      throw queryError('UNSUPPORTED_FILE', `"${file.name}" is not a JPG, PNG, WEBP or GIF image.`)
    }
    if (file.size > SUPPORT_MAX_BYTES) {
      throw queryError('FILE_TOO_LARGE', `"${file.name}" is over the 5 MB attachment limit.`)
    }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
    const path = `${userId}/${queryId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(SUPPORT_BUCKET).upload(path, file, { contentType: file.type })
    if (error) throw queryError(error.name || 'UPLOAD_FAILED', friendly(error, 'A screenshot could not upload. Try again, or send fewer files.'))
    uploaded.push(path)
  }
  return uploaded
}

/**
 * Turn stored screenshot values into what a viewer can click. Values are one
 * of two shapes: a storage path ("<uid>/<uuid>.<ext>", signed now, TTL 1h) or
 * a legacy bare filename recorded before any upload existed — those get url
 * null and render as plain text, since the bytes were never stored.
 */
export async function screenshotLinks(values) {
  return Promise.all(
    values.map(async (value) => {
      const name = value.split('/').pop() || value
      if (!value.includes('/')) return { value, name, url: null }
      try {
        const { data } = await supabase.storage.from(SUPPORT_BUCKET).createSignedUrl(value, 3600)
        return { value, name, url: data?.signedUrl || null }
      } catch {
        return { value, name, url: null }
      }
    })
  )
}

/**
 * Admin: flag/unflag a query as important. Flagged queries sort to the top
 * of the console list and are pinned there, and their attachments ride the
 * extended retention window (48h after the answer instead of 12h) — that is
 * a DB-side contract in purge_support_screenshots(), not a client promise.
 */
export async function flagQuery(id, important) {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ important: Boolean(important) })
    .eq('id', id)
    .select(COLUMNS)
    .single()
  if (error) throw queryError(error.code, 'Could not update that request.')
  return normalize(data)
}

/**
 * Admin: delete a query outright. The row goes for both sides (the
 * advertiser's bell reads the same table) and no reply can be written into
 * nothing. Attachments do not dangle: the purge matches objects to queries
 * by path, and an object whose query row no longer exists will simply be
 * removed on the next hourly sweep.
 */
export async function deleteQuery(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) throw queryError(error.code, 'Could not delete that request.')
}

