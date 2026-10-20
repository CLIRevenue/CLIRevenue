import { fetchAdminDevelopers } from '../../lib/adminApi.js'

export default function AdminPublishers() {
  return (
    <div className="adm-empty">
      <div className="adm-empty__label">No developers found.</div>
      <div className="adm-note adm-note--lead">
        <p className="adm-note__body">Migrated to developers.</p>
      </div>
    </div>
  )
}
