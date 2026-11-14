export type SegmentedOption<T extends string> = { value: T; label: string }

const sizeClass = (count: number) => (count === 3 ? ' seg--3' : count === 4 ? ' seg--4' : '')

/**
 * Two to four pill-shaped options with a sliding indicator. `role` says what picking one does:
 * `radio` sets a value (radiogroup), `toggle` filters what the page shows (pressed buttons), `tab`
 * switches the panel under it (tablist).
 */
export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  role = 'radio',
  label,
  labelledBy,
  disabled = false,
  className,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  role?: 'radio' | 'toggle' | 'tab'
  /** Accessible name of the group, when no visible label names it (`labelledBy`). */
  label?: string
  labelledBy?: string
  disabled?: boolean
  className?: string
}) => (
  <div
    className={`seg${sizeClass(options.length)}${className === undefined ? '' : ` ${className}`}`}
    role={role === 'radio' ? 'radiogroup' : role === 'tab' ? 'tablist' : 'group'}
    {...(label === undefined ? {} : { 'aria-label': label })}
    {...(labelledBy === undefined ? {} : { 'aria-labelledby': labelledBy })}
    data-active={options.findIndex((option) => option.value === value)}
  >
    <span className="seg__indicator" aria-hidden="true" />
    {options.map((option) => {
      const current = option.value === value
      return (
        <button
          key={option.value}
          type="button"
          className="seg__option"
          disabled={disabled}
          {...(role === 'radio'
            ? { role: 'radio', 'aria-checked': current }
            : role === 'tab'
              ? { role: 'tab', 'aria-selected': current }
              : { 'aria-pressed': current })}
          onClick={() => {
            if (!current) onChange(option.value)
          }}
        >
          {option.label}
        </button>
      )
    })}
  </div>
)
