import type { ReactNode } from 'react'

/** Stroke icons of the spectator screens (artboards `Home`, `Series`, `MobileHome`): 24 grid. */
const Icon = ({
  size,
  stroke = 1.75,
  children,
}: {
  size: number
  stroke?: number
  children: ReactNode
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
)

type IconProps = { size?: number }

export const SearchIcon = ({ size = 20 }: IconProps) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </Icon>
)

export const HomeIcon = ({ size = 22 }: IconProps) => (
  <Icon size={size}>
    <path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
  </Icon>
)

export const BookmarkIcon = ({ size = 22 }: IconProps) => (
  <Icon size={size}>
    <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" />
  </Icon>
)

export const InfoIcon = ({ size = 20 }: IconProps) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </Icon>
)

export const ChevronLeftIcon = ({ size = 16 }: IconProps) => (
  <Icon size={size} stroke={2}>
    <path d="M15 6l-6 6 6 6" />
  </Icon>
)

export const ChevronRightSmallIcon = ({ size = 16 }: IconProps) => (
  <Icon size={size} stroke={2}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
)

export const ChevronDownSmallIcon = ({ size = 18 }: IconProps) => (
  <Icon size={size} stroke={2}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
)

/** "From the beginning". */
export const RestartIcon = ({ size = 18 }: IconProps) => (
  <Icon size={size}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4v4h4" />
  </Icon>
)

/** "Marquer comme vu" on cards (artboard `Home`). */
export const SeenIcon = ({ size = 18 }: IconProps) => (
  <Icon size={size} stroke={1.8}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </Icon>
)

/** Watched episode (artboard `Series`). */
export const CheckCircleIcon = ({ size = 20 }: IconProps) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.3l2.7 2.7L16 9.5" />
  </Icon>
)

export const AddIcon = ({ size = 18 }: IconProps) => (
  <Icon size={size} stroke={1.8}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const AddedIcon = ({ size = 18 }: IconProps) => (
  <Icon size={size} stroke={2}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Icon>
)

export const RemoveIcon = ({ size = 18 }: IconProps) => (
  <Icon size={size} stroke={1.8}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
)

export const FilterIcon = ({ size = 18 }: IconProps) => (
  <Icon size={size}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
)

export const PencilIcon = ({ size = 18 }: IconProps) => (
  <Icon size={size}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="M13.5 6.5l4 4" />
  </Icon>
)

export const TrashIcon = ({ size = 18 }: IconProps) => (
  <Icon size={size}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />
  </Icon>
)

export const SwitchProfileIcon = ({ size = 18 }: IconProps) => (
  <Icon size={size}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 19a6 6 0 0 1 12 0" />
    <path d="M16 6h5M19 3l2 3-2 3" />
  </Icon>
)

export const DevicesIcon = ({ size = 18 }: IconProps) => (
  <Icon size={size}>
    <rect x="3" y="5" width="13" height="10" rx="1.5" />
    <path d="M7 19h5" />
    <rect x="17" y="9" width="4" height="10" rx="1" />
  </Icon>
)

export const SlidersIcon = ({ size = 18 }: IconProps) => (
  <Icon size={size}>
    <path d="M5 4v16M12 4v16M19 4v16" />
    <circle cx="5" cy="14" r="2" fill="currentColor" />
    <circle cx="12" cy="8" r="2" fill="currentColor" />
    <circle cx="19" cy="16" r="2" fill="currentColor" />
  </Icon>
)

export const StarIcon = ({ size = 14 }: IconProps) => (
  <Icon size={size} stroke={0}>
    <path
      d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
      fill="currentColor"
    />
  </Icon>
)

export const LockSmallIcon = ({ size = 14 }: IconProps) => (
  <Icon size={size} stroke={2}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
)
