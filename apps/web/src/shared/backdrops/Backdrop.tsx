import './backdrops.css'

export type BackdropImage = 'dunes' | 'mountains' | 'ocean' | 'city' | 'forest' | 'lighthouse'

/** Decorative illustration filling its positioned parent, darkened for the text over it. */
export const Backdrop = ({ image, shade }: { image: BackdropImage; shade: 'hero' | 'split' }) => (
  <div className={`backdrop backdrop--${shade}`} aria-hidden="true">
    <div className={`backdrop__image backdrop__image--${image}`} />
  </div>
)
