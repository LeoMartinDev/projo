import type { ReactNode } from 'react'

/** Admin-only stroke icons, drawn like `shared/ui/icons.tsx` (24 grid, 1.6 stroke, round caps). */
const Icon = ({ size = 18, children }: { size?: number; children: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
)

type IconProps = { size?: number }

/** Artboard `AdminAccounts`, sidebar entry "Comptes". */
export const UsersIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M17.5 14.5A6 6 0 0 1 21 20" />
  </Icon>
)

export const ReviewIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M4 13.5V6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v7" />
    <path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" />
  </Icon>
)

export const SearchIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </Icon>
)

export const CopyIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Icon>
)

export const KeyIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 20}>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
  </Icon>
)

export const LinkIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
)

export const GlobeIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 20}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </Icon>
)

/** Sidebar entry "Updates" (§15): an arrow into a tray. */
export const UpdateIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </Icon>
)

/** Sidebar entry "Tableau de bord" (§15): four tiles. */
export const DashboardIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <rect x="4" y="4" width="7" height="8" rx="1.5" />
    <rect x="13" y="4" width="7" height="5" rx="1.5" />
    <rect x="13" y="11" width="7" height="9" rx="1.5" />
    <rect x="4" y="14" width="7" height="6" rx="1.5" />
  </Icon>
)

/** "Fichiers en attente": an hourglass. */
export const PendingIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M7 4h10M7 20h10" />
    <path d="M8 4c0 4 8 4.5 8 8s-8 4-8 8M16 4c0 4-8 4.5-8 8s8 4 8 8" />
  </Icon>
)

/** "Manquants": a file with a dashed outline. */
export const MissingIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path
      d="M14 4H7.5A1.5 1.5 0 0 0 6 5.5v13A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V8z"
      strokeDasharray="2.5 2.5"
    />
    <path d="M10 12l4 4M14 12l-4 4" />
  </Icon>
)

/** "Jobs": stacked bars of a queue. */
export const JobsIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <rect x="4" y="5" width="16" height="4" rx="1.5" />
    <rect x="4" y="10.5" width="11" height="4" rx="1.5" />
    <rect x="4" y="16" width="7" height="4" rx="1.5" />
  </Icon>
)

/** "Notifications": a bell. */
export const BellIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Icon>
)

/** "Playback": a play triangle in a frame. */
export const PlaybackIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <path d="M10.5 9.5v5l4-2.5z" />
  </Icon>
)

/** "Intros and credits": skip forward. */
export const SkipIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M5 6.5v11l8-5.5z" />
    <path d="M13 6.5v11l6-5.5z" />
  </Icon>
)

/** "Metadata": a tag. */
export const TagIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <path d="M4 12.2V5.5A1.5 1.5 0 0 1 5.5 4h6.7l7.3 7.3a1.5 1.5 0 0 1 0 2.1l-6.1 6.1a1.5 1.5 0 0 1-2.1 0z" />
    <circle cx="8.5" cy="8.5" r="1.3" />
  </Icon>
)

/** "Server": two stacked units. */
export const ServerIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <rect x="4" y="4.5" width="16" height="6.5" rx="1.5" />
    <rect x="4" y="13" width="16" height="6.5" rx="1.5" />
    <path d="M7.5 7.75h.01M7.5 16.25h.01" />
  </Icon>
)

/** Database export. */
export const DatabaseIcon = ({ size }: IconProps) => (
  <Icon size={size ?? 18}>
    <ellipse cx="12" cy="6" rx="7" ry="2.5" />
    <path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
  </Icon>
)
