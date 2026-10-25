/** Player-only icons, drawn like the artboard `Player` (24 grid, round caps). */

type IconProps = { size?: number }

const svg = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
})

export const NextEpisodeIcon = ({ size = 22 }: IconProps) => (
  <svg {...svg(size)}>
    <path d="M5.5 5v14l10-7z" fill="currentColor" stroke="none" />
    <path d="M18.5 5v14" strokeWidth={2} />
  </svg>
)

export const EpisodesIcon = ({ size = 22 }: IconProps) => (
  <svg {...svg(size)} strokeWidth={1.6}>
    <rect x="3" y="7" width="14" height="12" rx="2" />
    <path d="M7 4h12a2 2 0 0 1 2 2v10" />
  </svg>
)

export const SubtitlesIcon = ({ size = 22 }: IconProps) => (
  <svg {...svg(size)} strokeWidth={1.6}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 12.5h3M12.5 12.5H17M7 15.5h6" />
  </svg>
)

/** Fullscreen corners of the artboard (stroke 1.75). */
export const CornersIcon = ({ size = 20 }: IconProps) => (
  <svg {...svg(size)} strokeWidth={1.75}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
)

export const CornersInIcon = ({ size = 20 }: IconProps) => (
  <svg {...svg(size)} strokeWidth={1.75}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </svg>
)

export const MinusIcon = ({ size = 18 }: IconProps) => (
  <svg {...svg(size)} strokeWidth={1.8}>
    <path d="M5 12h14" />
  </svg>
)

export const PlusSmallIcon = ({ size = 18 }: IconProps) => (
  <svg {...svg(size)} strokeWidth={1.8}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const PictureInPictureIcon = ({ size = 20 }: IconProps) => (
  <svg {...svg(size)} strokeWidth={1.6}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" stroke="none" />
  </svg>
)
