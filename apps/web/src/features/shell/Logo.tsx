import './shell.css'

/** `projo.` wordmark of the artboards. */
export const Logo = ({ subtitle }: { subtitle?: string }) => (
  <span className="logo">
    <span className="logo__word">
      projo<span className="logo__dot">.</span>
    </span>
    {subtitle === undefined ? undefined : <span className="logo__subtitle">{subtitle}</span>}
  </span>
)
