/**
 * Signup profile field catalog + deterministic validation.
 * Shared by the signup form and (field names) by the account pages so the
 * two always agree on what exists and what is required.
 *
 * Validation is pure: given the current values it returns the current
 * errors. Because the form derives errors from live values, correcting an
 * error re-enables submission on the next render with no stale state.
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const COMMON_FIELDS = [
  { name: 'full_name', label: 'Full name', required: true, autoComplete: 'name', section: 'profile' },
  { name: 'phone', label: 'Phone', autoComplete: 'tel', type: 'tel', inputMode: 'tel', section: 'profile' },
  { name: 'address', label: 'Address', autoComplete: 'street-address', section: 'profile' },
  { name: 'city', label: 'City', autoComplete: 'address-level2', section: 'profile' },
  { name: 'state', label: 'State / region', autoComplete: 'address-level1', section: 'profile' },
  { name: 'country', label: 'Country', autoComplete: 'country-name', section: 'profile' },
]

export const ADVERTISER_FIELDS = [
  { name: 'company_name', label: 'Company name', required: true, autoComplete: 'organization', section: 'company' },
  { name: 'company_website', label: 'Company website', type: 'url', inputMode: 'url', autoComplete: 'url', placeholder: 'https://example.com', section: 'company' },
  { name: 'industry', label: 'Industry', section: 'company' },
  { name: 'company_size', label: 'Company size', placeholder: 'e.g. 1-10', section: 'company' },
  { name: 'company_description', label: 'Company description', area: true, section: 'company' },
  { name: 'hear_about_us', label: 'How did you hear about us?', section: 'company' },
]

export const DEVELOPER_FIELDS = [
  { name: 'developer_name', label: 'Developer / studio name', required: true, autoComplete: 'organization', section: 'developer' },
  { name: 'developer_type', label: 'Developer type', placeholder: 'e.g. indie, studio, hobbyist', section: 'developer' },
  { name: 'website', label: 'Website', type: 'url', inputMode: 'url', autoComplete: 'url', placeholder: 'https://example.com', section: 'developer' },
  { name: 'apps_description', label: 'Apps / products description', area: true, section: 'developer' },
  { name: 'app_count', label: 'Approximate app count', type: 'number', inputMode: 'numeric', min: 0, section: 'developer' },
  { name: 'platforms', label: 'Platforms used', placeholder: 'e.g. CLI, web, mobile', section: 'developer' },
  { name: 'experience_level', label: 'Experience level', placeholder: 'e.g. new, 1-3 years, senior', section: 'developer' },
  { name: 'hear_about_us', label: 'How did you hear about us?', section: 'developer' },
]

export function roleFields(role) {
  if (role === 'advertiser') return ADVERTISER_FIELDS
  if (role === 'developer') return DEVELOPER_FIELDS
  return []
}

/** Every field name the signup form can hold. */
export function allFieldNames() {
  return [
    ...COMMON_FIELDS.map((f) => f.name),
    ...ADVERTISER_FIELDS.map((f) => f.name),
    ...DEVELOPER_FIELDS.map((f) => f.name),
  ]
}

function isEmpty(v) {
  return v === undefined || v === null || String(v).trim() === ''
}

/**
 * Deterministic validation for the whole form. Returns a map of
 * field -> message. Step 1 checks credentials only; step 2 checks role
 * selection and role-specific fields. Called with live values on every
 * render, so errors evaporate the moment the input becomes valid.
 */
export function validateSignup({ step, email, password, confirm, role, values, privacyConsent, termsConsent }) {
  const errors = {}

  if (step >= 1) {
    if (isEmpty(email)) errors.email = 'Email is required.'
    else if (!EMAIL_RE.test(String(email).trim())) errors.email = 'Enter a valid email address.'

    if (isEmpty(password)) errors.password = 'Password is required.'
    else if (String(password).length < 6) errors.password = 'Password must be at least 6 characters.'

    if (isEmpty(confirm)) errors.confirm = 'Confirm your password.'
    else if (!isEmpty(password) && password !== confirm) errors.confirm = 'Passwords do not match.'
  }

  if (step >= 2) {
    if (role !== 'advertiser' && role !== 'developer') {
      errors.role = 'Pick Advertiser or Developer.'
    }
    for (const field of [...COMMON_FIELDS, ...roleFields(role)]) {
      if (!field.required) continue
      if (isEmpty(values[field.name])) {
        errors[field.name] = `${field.label} is required.`
      }
    }
    // format checks for optional-but-typed fields
    for (const key of ['company_website', 'website']) {
      const v = values[key]
      if (!isEmpty(v) && !/^https?:\/\/\S+\.\S+/i.test(String(v).trim())) {
        errors[key] = 'Include the full URL, e.g. https://example.com'
      }
    }
    const ac = values.app_count
    if (!isEmpty(ac) && (!/^\d+$/.test(String(ac).trim()) || Number(ac) < 0)) {
      errors.app_count = 'Enter a whole number of 0 or more.'
    }

    if (step >= 2 && !privacyConsent) {
      errors.privacyConsent = 'You must agree to the Privacy Policy.'
    }
    if (step >= 2 && !termsConsent) {
      errors.termsConsent = 'You must agree to the Terms & Conditions.'
    }
  }

  return errors
}

/**
 * Shape the collected form values into per-table payloads for persistence.
 * Empty strings are dropped so untouched columns stay NULL. Only known
 * column names survive — nothing free-form reaches the database.
 */
export function buildProfilePayloads(values, role) {
  const pick = (names) => {
    const out = {}
    for (const name of names) {
      const v = values[name]
      if (isEmpty(v)) continue
      out[name] = name === 'app_count' ? Number(String(v).trim()) : String(v).trim()
    }
    return out
  }
  return {
    profiles: pick(COMMON_FIELDS.map((f) => f.name)),
    advertisers: pick(ADVERTISER_FIELDS.map((f) => f.name)),
    developer_accounts: pick(DEVELOPER_FIELDS.map((f) => f.name)),
    role,
  }
}
