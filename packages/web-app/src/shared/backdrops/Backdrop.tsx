import './backdrops.css'

export type BackdropImage = 'dunes' | 'mountains' | 'ocean' | 'city' | 'forest' | 'lighthouse'

export const Backdrop = ({ image, shade }: { image: BackdropImage; shade: 'hero' | 'split' }) => (
  <div className={`backdrop backdrop--${shade}`} aria-hidden="true">
    <div className={`backdrop__image backdrop__image--${image}`} />
  </div>
)
