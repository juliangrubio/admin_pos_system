"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export interface ComboboxOption {
  value: string
  label: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  required?: boolean
  disabled?: boolean
  className?: string
}

// Búsqueda sin distinguir mayúsculas ni tildes ("limon" encuentra "Limón")
const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

// Select con buscador (Popover + Command). Imita al <select> nativo: `value` es el id
// elegido ('' = nada) y `onChange` recibe el id de la opción seleccionada.
function Combobox({
  options,
  value,
  onChange,
  placeholder = "Seleccionar...",
  searchPlaceholder = "Buscar...",
  emptyText = "Sin resultados.",
  required,
  disabled,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const listId = React.useId()
  const selected = options.find((option) => option.value === value)

  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            disabled={disabled}
            className="flex w-full items-center justify-between gap-2 rounded border bg-white p-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={cn("truncate", !selected && "text-gray-500")}>
              {selected ? selected.label : placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="z-[60] w-(--radix-popover-trigger-width) min-w-56 p-0"
        >
          <Command
            filter={(_value, search, keywords) =>
              normalize((keywords ?? []).join(" ")).includes(normalize(search)) ? 1 : 0
            }
          >
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList id={listId}>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label]}
                    onSelect={() => {
                      onChange(option.value)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate">{option.label}</span>
                    <Check
                      className={cn(
                        "ml-auto",
                        option.value === value ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {/* Un botón no puede ser `required`: este input oculto conserva la validación nativa del formulario */}
      {required && (
        <input
          tabIndex={-1}
          autoComplete="off"
          required
          value={value}
          onChange={() => {}}
          className="pointer-events-none absolute inset-0 -z-10 opacity-0"
        />
      )}
    </div>
  )
}

export { Combobox }
