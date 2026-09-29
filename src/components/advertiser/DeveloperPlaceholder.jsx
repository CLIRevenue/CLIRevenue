import { useAuth } from '../../components/auth/authState.js'
import { navigateApp } from '../../hooks/useAppRoute.js'

export default function DeveloperPlaceholder() {
  const { signOut } = useAuth()
  return (
    <section className="adv-shell" aria-label="Developer placeholder retired">
      <div className="adv-shell__inner adv-shell__inner--narrow">
        <p className="eyebrow eyebrow--plain">Developer</p>
        <h2 className="block__title">Developer dashboard moved.</h2>
        <p className="block__body">This placeholder is retired; the real developer app now owns this route.</p>
        <button type="button" className="btn btn--ghost" onClick={() => navigateApp('/app/developer')}>
          Open developer dashboard
        </button>
        <p className="form__note">
          <button type="button" className="adv-link" onClick={() => signOut().then(() => navigateApp('/'))}>
            Log out
          </button>
        </p>
      </div>
    </section>
  )
}
