import * as React from 'react'
import { Cancel01Icon, Search01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { cn } from '#/lib/utils'

interface SearchInputProps extends Omit<React.ComponentProps<'input'>, 'type'> {
  onClear?: () => void
}

function SearchInput({
  className,
  value,
  defaultValue,
  onChange,
  onClear,
  ...props
}: SearchInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  const isControlled = value !== undefined
  const [internalValue, setInternalValue] = React.useState(
    defaultValue !== undefined ? String(defaultValue) : '',
  )

  const displayValue = isControlled ? String(value) : internalValue
  const hasValue = displayValue.length > 0

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (!isControlled) {
      setInternalValue(event.target.value)
    }
    onChange?.(event)
  }

  function handleClear() {
    if (!isControlled) {
      setInternalValue('')
    }
    // Fire onChange with an empty value so consumers can update their state
    if (onChange && inputRef.current) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set
      nativeInputValueSetter?.call(inputRef.current, '')
      inputRef.current.dispatchEvent(new Event('input', { bubbles: true }))
    }
    onClear?.()
    inputRef.current?.focus()
  }

  return (
    <div
      data-slot="search-input"
      className={cn(
        'flex h-9 w-full items-center gap-2 rounded-sm border border-input bg-background px-3 text-sm',
        'transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30',
        'has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50',
        className,
      )}
    >
      <HugeiconsIcon
        icon={Search01Icon}
        size={16}
        className="shrink-0 text-muted-foreground"
      />
      <input
        ref={inputRef}
        type="search"
        data-slot="search-input-field"
        value={isControlled ? value : internalValue}
        defaultValue={isControlled ? undefined : defaultValue}
        onChange={handleChange}
        className={cn(
          'flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground',
          '[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
        )}
        {...props}
      />
      {hasValue && (
        <button
          type="button"
          data-slot="search-input-clear"
          onClick={handleClear}
          className={cn(
            'shrink-0 rounded-sm text-muted-foreground transition-colors',
            'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
          )}
          aria-label="Clear search"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </button>
      )}
    </div>
  )
}

export { SearchInput }
export type { SearchInputProps }
