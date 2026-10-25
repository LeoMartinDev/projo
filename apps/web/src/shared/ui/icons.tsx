import type { ReactNode } from 'react'

/** Stroke icons drawn like the artboards (24 grid, 1.6 stroke, round caps). */
const Icon = ({
  size = 18,
  stroke = 1.6,
  children,
}: {
  size?: number
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

type IconProps = { size?: number; stroke?: number }

export const PlayIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />
  </Icon>
)

export const PauseIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
  </Icon>
)

export const BackIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
)

export const ChevronRightIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M9 5l7 7-7 7" />
  </Icon>
)

export const ChevronUpIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M5 15l7-7 7 7" />
  </Icon>
)

export const CloseIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
)

export const CheckIcon = ({ size, stroke }: IconProps) => (
  <Icon size={size ?? 18} {...(stroke === undefined ? {} : { stroke })}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
)

export const PlusIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const SyncIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
    <path d="M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" />
    <path d="M20 20v-4h-4" />
  </Icon>
)

export const MoreVerticalIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <circle cx="12" cy="5" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="19" r="1.2" fill="currentColor" />
  </Icon>
)

export const MoreIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" />
  </Icon>
)

export const FolderIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
  </Icon>
)

export const FilmIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </Icon>
)

export const TvIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <rect x="3" y="5" width="18" height="12" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Icon>
)

export const LayersIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </Icon>
)

export const VolumeIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
  </Icon>
)

export const MutedIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </Icon>
)

export const FullscreenIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
)

export const ExitFullscreenIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </Icon>
)

export const Rewind10Icon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
    <path d="M4 4v4.5h4.5" />
  </Icon>
)

export const Forward10Icon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5" />
    <path d="M20 4v4.5h-4.5" />
  </Icon>
)

export const AlertIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17.5v.01" />
  </Icon>
)

export const LogoutIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Icon>
)

export const SettingsIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" />
  </Icon>
)

export const ArrowUpIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
)

export const ArrowRightIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18} stroke={2}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
)

export const ChevronDownIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18} stroke={2}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
)

export const EyeIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18} stroke={1.7}>
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
    <circle cx="12" cy="12" r="2.8" />
  </Icon>
)

export const EyeOffIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18} stroke={1.7}>
    <path d="M3 3l18 18" />
    <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.9M6.6 6.6C4 8.3 2.5 12 2.5 12s3.5 6 9.5 6c1.6 0 3-.4 4.3-1" />
  </Icon>
)

export const UserIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 20} stroke={1.7}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20a8 8 0 0 1 16 0" />
  </Icon>
)

export const LockIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 20} stroke={1.7}>
    <rect x="5" y="11" width="14" height="9" rx="2.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
)

export const ShieldIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 20} stroke={1.7}>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
  </Icon>
)
