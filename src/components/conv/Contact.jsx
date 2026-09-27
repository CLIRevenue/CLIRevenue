/* =============================================================
   CLIRevenue — contact
   -------------------------------------------------------------
   The restrained way in. No address is published anywhere in this
   repository, so the channel is a form; nothing is transmitted,
   because there is nowhere to transmit it to.
   ============================================================= */

import { useState } from 'react'
import { motion } from 'motion/react'

import { SectionHead } from '../console/ui.jsx'
import { isEmail, useReveal } from './helpers.js'

const WHO = [
  { value: 'developer', label: 'Developer — I want early access' },
  { value: 'advertiser', label: 'Advertiser — I want to place something' },
  { value: 'other', label: 'Something else' },
]

function Contact() {
  const reveal = useReveal()
  const [form, setForm] = useState({ email: '', who: 'developer', message: '' })
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const update = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }))
    setError('')
    setSent(false)
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!isEmail(form.email)) {
      setError('Add an email address we could reach you on.')
      return
    }
    if (!form.message.trim()) {
      setError('Write a line or two so there is something to answer.')
      return
    }
    setError('')
    setSent(true)
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
        index="13"
        label="Contact"
        title="Say hello."
        body="Developer early access, advertiser interest, or anything else. One address and one message — that is the whole form."
      />

      <form className="form conv__form" onSubmit={handleSubmit} noValidate>
        <div className="form__head">
          <h3 className="form__title">Message</h3>
          <span className="form__tag">No inbox wired up</span>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="field__input"
              type="email"
              name="email"
              value={form.email}
              onChange={update('email')}
              placeholder="you@studio.dev"
              autoComplete="email"
            />
          </label>

          <label className="field">
            <span className="field__label">You are a</span>
            <select
              className="field__input field__input--select"
              name="who"
              value={form.who}
              onChange={update('who')}
            >
              {WHO.map((option) => (
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
            onChange={update('message')}
            placeholder="What are you building, and what would you like to know?"
          />
        </label>

        <p className="form__error" aria-live="assertive">
          {error}
        </p>

        <button className="btn btn--primary" type="submit">
          Send message
        </button>

        <p className="form__note">
          No inbox is wired up yet. Nothing you write leaves this browser tab.
        </p>

        {sent ? (
          <p className="form__ok" aria-live="polite">
            Held in this tab only. This prototype has no backend — your message was not
            transmitted, stored, or read by anyone but you.
          </p>
        ) : null}
      </form>
    </motion.section>
  )
}

export default Contact
