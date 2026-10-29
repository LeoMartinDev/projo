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

export const SpeedIcon = ({ size = 22 }: IconProps) => (
  <svg {...svg(size)} strokeWidth={1.6}>
    <path d="M4.2 17.5a8.5 8.5 0 1 1 15.6 0" />
    <path d="M12 14l3.5-4.5" />
    <circle cx="12" cy="14" r="1.2" fill="currentColor" stroke="none" />
  </svg>
)

export const QualityIcon = ({ size = 22 }: IconProps) => (
  <svg {...svg(size)} strokeWidth={1.6}>
    <path d="M4 7.5h8.5M16.5 7.5H20M4 16.5h3.5M11.5 16.5H20" />
    <circle cx="14.5" cy="7.5" r="2" />
    <circle cx="9.5" cy="16.5" r="2" />
  </svg>
)

export const ChaptersIcon = ({ size = 22 }: IconProps) => (
  <svg {...svg(size)} strokeWidth={1.6}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" strokeWidth={2.4} />
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

export const AirPlayIcon = ({ size = 20 }: IconProps) => (
  <svg {...svg(size)} strokeWidth={1.6}>
    <path d="M6 17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1" />
    <path d="M12 15l5 6H7z" fill="currentColor" stroke="none" />
  </svg>
)

export const PictureInPictureIcon = ({ size = 20 }: IconProps) => (
  <svg {...svg(size)} strokeWidth={1.6}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" stroke="none" />
  </svg>
)
