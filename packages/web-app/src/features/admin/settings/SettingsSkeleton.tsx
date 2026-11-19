import './settings.css'

/** A Settings tab while its values load. */
export const SettingsSkeleton = () => (
  <section className="settings-section" aria-hidden="true">
    <span className="skeleton settings-skeleton" />
    <span className="skeleton settings-skeleton" />
  </section>
)
