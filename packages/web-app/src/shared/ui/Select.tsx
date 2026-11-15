import { type KeyboardEvent, type ReactNode, useEffect, useId, useState } from 'react'

import { Field } from './controls.tsx'
import { CheckIcon, ChevronDownIcon } from './icons.tsx'
import { useElement } from './use-element.ts'

export type SelectOption<T extends string> = { value: T; label: string }
export type SelectGroup<T extends string> = { group: string; options: readonly SelectOption<T>[] }
export type SelectItem<T extends string> = SelectOption<T> | SelectGroup<T>

const gap = 6
const margin = 8
const tallest = 320

const SelectChevron = () => (
  <span className="field__chevron" aria-hidden="true">
    <ChevronDownIcon />
  </span>
)

const flatten = <T extends string>(items: readonly SelectItem<T>[]): SelectOption<T>[] =>
  items.flatMap((item) => ('group' in item ? item.options : [item]))

/** Puts the list under its field or chip (above when there is more room there), at least as wide. */
const place = (list: HTMLElement, trigger: HTMLElement) => {
  const anchor = trigger.closest('.field, .chip') ?? trigger
  const rect = anchor.getBoundingClientRect()
  const below = window.innerHeight - rect.bottom - gap - margin
  const above = rect.top - gap - margin
  const down = below >= Math.min(list.scrollHeight, tallest) || below >= above
  list.style.minWidth = `${rect.width}px`
  list.style.maxHeight = `${Math.max(Math.min(tallest, down ? below : above), 120)}px`
  list.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - list.offsetWidth - margin))}px`
  list.style.top = down ? `${rect.bottom + gap}px` : 'auto'
  list.style.bottom = down ? 'auto' : `${window.innerHeight - rect.top + gap}px`
}

const optionsOf = (list: HTMLElement) => [
  ...list.querySelectorAll<HTMLButtonElement>('[role="option"]'),
]

const focusOption = (option: HTMLElement | undefined) => {
  option?.focus({ preventScroll: true })
  option?.scrollIntoView({ block: 'nearest' })
}

const nextOption = (key: string, items: HTMLButtonElement[], index: number) => {
  const last = items.length - 1
  if (key === 'ArrowDown') return items[Math.min(index + 1, last)]
  if (key === 'ArrowUp') return items[Math.max(index - 1, 0)]
  if (key === 'Home' || key === 'PageUp') return items[0]
  if (key === 'End' || key === 'PageDown') return items[last]
  if (key.length !== 1 || !/\S/.test(key)) return undefined
  const letter = key.toLocaleLowerCase()
  return [...items.slice(index + 1), ...items.slice(0, index + 1)].find((item) =>
    item.textContent.toLocaleLowerCase().startsWith(letter),
  )
}

type SelectProps<T extends string> = {
  id: string
  label: string
  value: T
  options: readonly SelectItem<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  /** Text of the closed control when it differs from the chosen option's label. */
  display?: string
}

/** The trigger and its listbox popover, drawn like the app's menus. Use `SelectField`. */
const SelectControl = <T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  display,
  className,
}: SelectProps<T> & { className: string }) => {
  const listId = useId()
  const [trigger, triggerRef] = useElement<HTMLButtonElement>()
  const [list, listRef] = useElement<HTMLDivElement>()
  const [open, setOpen] = useState(false)
  const selected = flatten(options).find((option) => option.value === value)

  useEffect(() => {
    if (list === undefined || trigger === undefined) return
    const onToggle = (event: Event) => {
      const opened = event instanceof ToggleEvent && event.newState === 'open'
      setOpen(opened)
      if (!opened) return
      place(list, trigger)
      const items = optionsOf(list)
      focusOption(items.find((item) => item.getAttribute('aria-selected') === 'true') ?? items[0])
    }
    const reposition = (event: Event) => {
      if (event.target instanceof Node && list.contains(event.target)) return
      if (list.matches(':popover-open')) place(list, trigger)
    }
    list.addEventListener('toggle', onToggle)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      list.removeEventListener('toggle', onToggle)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [list, trigger])

  const close = () => {
    list?.hidePopover()
    trigger?.focus()
  }

  const choose = (next: T) => {
    close()
    if (next !== value) onChange(next)
  }

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault()
      close()
      return
    }
    const items = optionsOf(event.currentTarget)
    const target = nextOption(
      event.key,
      items,
      items.findIndex((item) => item === document.activeElement),
    )
    if (target === undefined) return
    event.preventDefault()
    focusOption(target)
  }

  const renderOption = (option: SelectOption<T>) => (
    <button
      key={option.value}
      type="button"
      role="option"
      tabIndex={-1}
      className="listbox__option"
      aria-selected={option.value === value}
      onPointerMove={(event) => {
        if (document.activeElement !== event.currentTarget)
          event.currentTarget.focus({ preventScroll: true })
      }}
      onClick={() => choose(option.value)}
    >
      <span className="listbox__label">{option.label}</span>
      {option.value === value ? (
        <span className="listbox__check" aria-hidden="true">
          <CheckIcon size={15} stroke={2.6} />
        </span>
      ) : undefined}
    </button>
  )

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={className}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        popoverTarget={listId}
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          list?.showPopover()
        }}
      >
        {display ?? selected?.label ?? ' '}
      </button>
      <div
        ref={listRef}
        id={listId}
        className="listbox"
        role="listbox"
        aria-label={label}
        popover="auto"
        onKeyDown={onListKeyDown}
      >
        {options.map((item) =>
          'group' in item ? (
            <div key={item.group} className="listbox__group" role="group" aria-label={item.group}>
              <span className="listbox__heading" aria-hidden="true">
                {item.group}
              </span>
              {item.options.map(renderOption)}
            </div>
          ) : (
            renderOption(item)
          ),
        )}
      </div>
    </>
  )
}

/**
 * The app's select: a field (or a pill-shaped chip) that opens a list styled like the app's menus,
 * never the browser's native list. Options can be grouped.
 */
export const SelectField = <T extends string>({
  label,
  icon,
  compact = false,
  chip = false,
  active = false,
  trail,
  ...select
}: SelectProps<T> & {
  icon?: ReactNode
  /** Label kept for screen readers only, smaller field. */
  compact?: boolean
  /** A pill-shaped control (filter bars on tablets) instead of a field. */
  chip?: boolean
  /** Chip only: marks a filter that narrows the list. */
  active?: boolean
  /** Shown before the chevron (a saved mark, a spinner). */
  trail?: ReactNode
}) =>
  chip ? (
    <div className="chip" data-active={active}>
      {icon === undefined ? undefined : (
        <span className="chip__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <label className="visually-hidden" htmlFor={select.id}>
        {label}
      </label>
      <SelectControl {...select} label={label} className="chip__trigger" />
      <SelectChevron />
    </div>
  ) : (
    <Field
      id={select.id}
      label={label}
      compact={compact}
      {...(icon === undefined ? {} : { icon })}
      trail={
        <>
          {trail}
          <SelectChevron />
        </>
      }
    >
      <SelectControl {...select} label={label} className="field__input select__trigger" />
    </Field>
  )
