/* =============================================================
   CLIRevenue — developer and advertiser entry points
   -------------------------------------------------------------
   The two conversion surfaces. Each is a headline, one primary
   action, and a form that opens in place. Demo only: no account, no
   billing, no network — submissions confirm locally and send nothing.
   ============================================================= */

import { useId, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { SectionHead } from '../console/ui.jsx'
import { isEmail, useReveal } from './helpers.js'

const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }
const FLAT = { duration: 0 }

const TOOLS = [
  { value: '', label: 'Not sure yet' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'copilot-cli', label: 'GitHub Copilot CLI' },
  { value: 'gemini-cli', label: 'Gemini CLI' },
  { value: 'other', label: 'Something else' },
]

const BUDGETS = [
  { value: '', label: 'Not decided yet' },
  { value: 'under-5k', label: 'Under $5,000' },
  { value: '5-25k', label: '$5,000 to $25,000' },
  { value: '25-100k', label: '$25,000 to $100,000' },
  { value: 'over-100k', label: 'Over $100,000' },
]

const DEV_PROMISE = [
  { key: 'No account', body: 'No password, no login, no profile to maintain.' },
  { key: 'No payment', body: 'Nothing is bought or sold on this page.' },
  { key: 'No transmission', body: 'There is no backend, so the form cannot send anything.' },
]

const ADV_PROMISE = [
  { key: 'No purchase', body: 'No inventory is reserved and no campaign is bought.' },
  { key: 'No billing', body: 'No card, no invoice, no insertion order.' },
  { key: 'No transmission', body: 'There is no backend, so the form cannot send anything.' },
]

function PromiseList({ items }) {
  return (
    <ul className="conv__promise">
      {items.map((item) => (
        <li key={item.key}>
          <span className="conv__promise-key">{item.key}</span>
          <span className="conv__promise-body">{item.body}</span>
        </li>
      ))}
    </ul>
  )
}

function Reveal({ id, open, detail, children }) {
  return (
    <div className="conv__reveal" id={id}>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="panel"
            className="conv__reveal__panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={detail}
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function EntryPoints() {
  const reveal = useReveal()
  const reduced = useReducedMotion()
  const detail = reduced ? FLAT : SPRING
  const devPanel = useId()
  const advPanel = useId()

  const [devOpen, setDevOpen] = useState(false)
  const [dev, setDev] = useState({ email: '', tool: '' })
  const [devError, setDevError] = useState('')
  const [devDone, setDevDone] = useState(false)

  const [advOpen, setAdvOpen] = useState(false)
  const [adv, setAdv] = useState({
    name: '',
    company: '',
    email: '',
    product: '',
    budget: '',
  })
  const [advError, setAdvError] = useState('')
  const [advDone, setAdvDone] = useState(false)

  const updateDev = (key) => (event) => {
    setDev((prev) => ({ ...prev, [key]: event.target.value }))
    setDevError('')
    setDevDone(false)
  }

  const submitDev = (event) => {
    event.preventDefault()
    if (!isEmail(dev.email)) {
      setDevError('Add an email address so the invite has somewhere to go.')
      return
    }
    setDevError('')
    setDevDone(true)
  }

  const updateAdv = (key) => (event) => {
    setAdv((prev) => ({ ...prev, [key]: event.target.value }))
    setAdvError('')
    setAdvDone(false)
  }

  const submitAdv = (event) => {
    event.preventDefault()
    if (!adv.name.trim() || !adv.company.trim()) {
      setAdvError('Name and company are required.')
      return
    }
    if (!isEmail(adv.email)) {
      setAdvError('Add a work email address we could reply to.')
      return
    }
    if (!adv.product.trim()) {
      setAdvError('One line on the product, so we know what the placement is for.')
      return
    }
    setAdvError('')
    setAdvDone(true)
  }

  return (
    <>
      <motion.section
        className="block conv__block conv__block--first"
        id="developers"
        aria-label="For developers"
        {...reveal}
      >
        <div className="conv__entry">
          <div className="conv__entry__lead">
            <SectionHead
              level="h2"
              index="08"
              label="For developers"
              title="Turn the attention you already give to AI coding tools into a share of the advertising revenue."
              body="A sponsored slot sits beside the output of the tool you are already reading. Interact with it and a reward accrues. Early access starts on the waitlist below."
            />
            <button
              type="button"
              className="btn btn--primary conv__cta"
              aria-expanded={devOpen}
              aria-controls={devPanel}
              onClick={() => setDevOpen((open) => !open)}
            >
              Join the developer waitlist
            </button>
          </div>

          <div className="conv__entry__side">
            <p className="conv__side-label">What this form is</p>
            <PromiseList items={DEV_PROMISE} />
          </div>
        </div>

        <Reveal id={devPanel} open={devOpen} detail={detail}>
          <form className="form conv__form" onSubmit={submitDev} noValidate>
            <div className="form__head">
              <h3 className="form__title">Developer waitlist</h3>
              <span className="form__tag">Demo waitlist</span>
            </div>

            <div className="field-row">
              <label className="field">
                <span className="field__label">Email</span>
                <input
                  className="field__input"
                  type="email"
                  name="dev-email"
                  value={dev.email}
                  onChange={updateDev('email')}
                  placeholder="you@studio.dev"
                  autoComplete="email"
                />
              </label>

              <label className="field">
                <span className="field__label">Tool you use (optional)</span>
                <select
                  className="field__input field__input--select"
                  name="dev-tool"
                  value={dev.tool}
                  onChange={updateDev('tool')}
                >
                  {TOOLS.map((tool) => (
                    <option key={tool.value} value={tool.value}>
                      {tool.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="form__error" aria-live="assertive">
              {devError}
            </p>

            <button className="btn btn--primary" type="submit">
              Join the waitlist
            </button>

            <p className="form__note">
              Demo waitlist. No authentication and no payment. Nothing you type is sent
              anywhere.
            </p>

            {devDone ? (
              <p className="form__ok" aria-live="polite">
                On the waitlist for this session only. This prototype has no backend — the
                address you typed was not transmitted or stored, and it disappears when you
                reload.
              </p>
            ) : null}
          </form>
        </Reveal>
      </motion.section>

      <motion.section
        className="block conv__block"
        id="advertisers"
        aria-label="For advertisers"
        {...reveal}
      >
        <div className="conv__entry">
          <div className="conv__entry__lead">
            <SectionHead
              level="h2"
              index="09"
              label="For advertisers"
              title="Reach developers directly inside the tools where they already build."
              body="One placement, in the moment a developer is already reading output from an AI coding tool. This form collects what would be needed to scope inventory, format and budget with you. Nothing is purchased here."
            />
            <button
              type="button"
              className="btn btn--primary conv__cta"
              aria-expanded={advOpen}
              aria-controls={advPanel}
              onClick={() => setAdvOpen((open) => !open)}
            >
              Register advertiser interest
            </button>
          </div>

          <div className="conv__entry__side">
            <p className="conv__side-label">What this form is</p>
            <PromiseList items={ADV_PROMISE} />
          </div>
        </div>

        <Reveal id={advPanel} open={advOpen} detail={detail}>
          <form className="form conv__form" onSubmit={submitAdv} noValidate>
            <div className="form__head">
              <h3 className="form__title">Advertiser interest</h3>
              <span className="form__tag">Lead capture only</span>
            </div>

            <div className="field-row">
              <label className="field">
                <span className="field__label">Name</span>
                <input
                  className="field__input"
                  type="text"
                  name="adv-name"
                  value={adv.name}
                  onChange={updateAdv('name')}
                  placeholder="Ada Lovelace"
                  autoComplete="name"
                />
              </label>

              <label className="field">
                <span className="field__label">Company</span>
                <input
                  className="field__input"
                  type="text"
                  name="adv-company"
                  value={adv.company}
                  onChange={updateAdv('company')}
                  placeholder="Northwind Labs"
                  autoComplete="organization"
                />
              </label>
            </div>

            <label className="field">
              <span className="field__label">Work email</span>
              <input
                className="field__input"
                type="email"
                name="adv-email"
                value={adv.email}
                onChange={updateAdv('email')}
                placeholder="you@company.com"
                autoComplete="email"
              />
            </label>

            <label className="field">
              <span className="field__label">Product or company</span>
              <textarea
                className="field__input field__input--area"
                name="adv-product"
                rows={3}
                value={adv.product}
                onChange={updateAdv('product')}
                placeholder="One line on what you are building and who it is for."
              />
            </label>

            <label className="field">
              <span className="field__label">Approximate budget (optional)</span>
              <select
                className="field__input field__input--select"
                name="adv-budget"
                value={adv.budget}
                onChange={updateAdv('budget')}
              >
                {BUDGETS.map((budget) => (
                  <option key={budget.value} value={budget.value}>
                    {budget.label}
                  </option>
                ))}
              </select>
            </label>

            <p className="form__error" aria-live="assertive">
              {advError}
            </p>

            <button className="btn btn--primary" type="submit">
              Send interest
            </button>

            <p className="form__note">
              Interest form only. No campaign purchasing, no billing, no ad server.
            </p>

            {advDone ? (
              <p className="form__ok" aria-live="polite">
                Interest recorded for this session only. Nothing was transmitted or stored,
                and no campaign was created.
              </p>
            ) : null}
          </form>
        </Reveal>
      </motion.section>
    </>
  )
}

export default EntryPoints
