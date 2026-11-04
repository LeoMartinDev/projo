import type { AvatarColor } from '@projo/shared/api/auth'

import './shell.css'

export const Avatar = ({
  name,
  color,
  size = 'medium',
}: {
  name: string
  color: AvatarColor
  size?: 'medium' | 'large' | 'xlarge' | 'tile'
}) => (
  <span className={`avatar avatar--${color} avatar--${size}`} aria-hidden="true">
    {(name.trim()[0] ?? '?').toLocaleUpperCase()}
  </span>
)
