import { useRef, useState } from 'react'
import { motion } from 'motion/react'

import { supabase, supabaseConfigured } from '../../lib/api.js'
import { useAuth } from '../auth/authState.js'
import { SectionHead } from '../console/ui.jsx'
import { isEmail, useReveal } from './helpers.js'

const CATEGORIES = [
  { value: 'developer', label: 'Developer — I want early access' },
  { value: 'advertiser', label: 'Advertiser — I want to place something' },
  { value: 'other', label: 'Something else' },
]

const CAPS = {
  name: 80,
  email: 200,
  subject: 150,
  message: 500,
}

const DEFAULT_MESSAGE =
  'What are you building, and what would you like to know?'

function Contact() {
  const reveal = useReveal()
  const { user } = useAuth()
  const [state, setState] = useState('idle') // idle | submitting | success | error
  const [form, setForm] = useState({
    name: user?.email ? user.email.split('@')[0] : '',
    email: user?.email || '',
    subject: '',
    category: 'developer',
    message: DEFAULT_MESSAGE,
  })
  const [error, setError] = useState('')
  // Synchronous submit lock; see handleSubmit.
  const inFlight = useRef(false)

  const resetForm = () => {
    setForm({
      name: '',
      email: user?.email || '',
      subject: '',
      category: 'developer',
      message: DEFAULT_MESSAGE,
    })
  }

  const setField = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }))
    setError('')
  }

  const validate = () => {
    // Trim before testing. A field containing only spaces is truthy, so an
    // untrimmed check would accept it and then store an empty string.
    const name = form.name.trim()
    const email = form.email.trim()
    const subject = form.subject.trim()
    const message = form.message.trim()

    if (!name) return 'Tell us who you are.'
    if (name.length > CAPS.name) {
      return `That name is too long (${CAPS.name} characters max).`
    }
    if (!isEmail(email)) {
      return 'Add an email address we could reach you on.'
    }
    if (email.length > CAPS.email) {
      return 'Email address is too long.'
    }
    if (!subject) return 'Give the message a one-line subject.'
    if (subject.length > CAPS.subject) {
      return `That subject is too long (${CAPS.subject} characters max).`
    }
    if (!message) return 'Write something we can read.'
    if (message.length > CAPS.message) {
      return `That message is too long (${CAPS.message} characters max).`
    }
    return ''
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const err = validate()
    if (err) {
      setError(err)
      return
    }

    // `disabled` on the submit button is not sufficient on its own: setState
    // is asynchronous, so two clicks landing in the same tick both observe
    // state === 'idle' and both would insert. A ref flips synchronously, so
    // the second submit is refused outright.
    if (inFlight.current) return
    inFlight.current = true

    setState('submitting')
    setError('')

    try {
      if (!supabaseConfigured) {
        setError('Messages cannot be sent right now. Please try again later.')
        setState('error')
        return
      }

      const { error: submitError } = await supabase
        .from('contact_submissions')
        .insert({
          name: form.name.trim(),
          email: form.email.trim(),
          subject: form.subject.trim(),
          category: form.category,
          message: form.message.trim(),
          user_id: user?.id ?? null,
        })

      if (submitError) {
        console.error('contact submission failed:', submitError.message)
        setError('Couldn\'t send your message. Please try again.')
        setState('error')
        return
      }

      resetForm()
      setState('success')
    } catch (e) {
      console.error('contact submission threw:', e)
      setError('Couldn\'t send your message. Please try again.')
      setState('error')
    } finally {
      inFlight.current = false
    }
  }

  if (state === 'success') {
    return (
      <motion.section
        className="block conv__block"
        id="contact"
        aria-label="Contact"
        {...reveal}
      >
        <SectionHead
          level="h2"
          index="14"
          label="Contact"
          title="Say hello."
          body="Developer early access, advertiser interest, or anything else."
        />
        <div className="form conv__form">
          <div className="form__head">
            <h3 className="form__title">Message</h3>
            <span className="form__tag">Delivered</span>
          </div>
          <p className="form__ok" aria-live="polite">
            Message received.
            <span aria-hidden="true"> </span>
            Your message has been sent to the CLIRevenue team.
          </p>
        </div>
      </motion.section>
    )
  }

  return (
    <motion.section
      className="block conv__block"
      id="contact"
      aria-label="Contact"
      {...reveal}
    >
      <SectionHead
        level="h2"
        index="14"
        label="Contact"
        title="Say hello."
        body="Developer early access, advertiser interest, or anything else. One address and one message — that is the whole form."
      />

      <form className="form conv__form" onSubmit={handleSubmit} noValidate>
        <div className="form__head">
          <h3 className="form__title">Message</h3>
          <span className="form__tag">New message</span>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="field__input"
              type="text"
              name="name"
              value={form.name}
              onChange={setField('name')}
              placeholder="Jane Doe"
              autoComplete="name"
              maxLength={CAPS.name}
            />
          </label>

          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="field__input"
              type="email"
              name="email"
              value={form.email}
              onChange={setField('email')}
              placeholder="you@studio.dev"
              autoComplete="email"
              maxLength={CAPS.email}
            />
          </label>
        </div>

        <label className="field">
          <span className="field__label">Subject</span>
          <input
            className="field__input"
            type="text"
            name="subject"
            value={form.subject}
            onChange={setField('subject')}
            placeholder="Quick question about publisher keys"
            maxLength={CAPS.subject}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field__label">You are a</span>
            <select
              className="field__input field__input--select"
              name="category"
              value={form.category}
              onChange={setField('category')}
            >
              {CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span className="field__label">Message</span>
          <textarea
            className="field__input field__input--area"
            name="message"
            rows={4}
            value={form.message}
            onChange={setField('message')}
            placeholder={DEFAULT_MESSAGE}
            maxLength={CAPS.message}
          />
        </label>

        <p className="form__error" aria-live="assertive">
          {error}
        </p>

        <p className="form__info">
          Official contact: <span className="form__email">clirevenue@gmail.com</span>.
        </p>

        <button
          className="btn btn--primary"
          type="submit"
          disabled={state === 'submitting'}
        >
          Send message
        </button>
      </form>
    </motion.section>
  )
}

export default Contact
