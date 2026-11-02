"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { format, parse, isValid } from "date-fns"
import { es } from "date-fns/locale"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface DatePickerProps {
  value: string // YYYY-MM-DD
  onChange: (date: string) => void
  placeholder?: string
  className?: string
  minDate?: string // YYYY-MM-DD
  maxDate?: string // YYYY-MM-DD
}

function DatePicker({ value, onChange, placeholder = "DD/MM/AAAA", className, minDate, maxDate }: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  const parseDate = (str: string) => {
    if (!str) return undefined
    const d = parse(str, "yyyy-MM-dd", new Date())
    return isValid(d) ? d : undefined
  }

  const selected = parseDate(value)
  const minDateParsed = minDate ? parseDate(minDate) : undefined
  const maxDateParsed = maxDate ? parseDate(maxDate) : undefined

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      onChange(format(date, "yyyy-MM-dd"))
      setOpen(false)
    }
  }

  const isDateDisabled = (date: Date) => {
    if (minDateParsed && date < minDateParsed) return true
    if (maxDateParsed && date > maxDateParsed) return true
    return false
  }

  const label = selected ? format(selected, "dd/MM/yyyy") : placeholder

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("flex gap-2 items-center font-normal", className)}
        >
          <CalendarIcon size={16} />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          locale={es}
          defaultMonth={selected}
          disabled={isDateDisabled}
        />
      </PopoverContent>
    </Popover>
  )
}

interface DateRangePickerProps {
  startDate: string
  endDate: string
  onStartDateChange: (date: string) => void
  onEndDateChange: (date: string) => void
  className?: string
  minDate?: string // YYYY-MM-DD, restricción global mínima
  maxDate?: string // YYYY-MM-DD, restricción global máxima
}

export function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  className,
  minDate,
  maxDate,
}: DateRangePickerProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <DatePicker
        value={startDate}
        onChange={onStartDateChange}
        placeholder="Desde"
        minDate={minDate}
        maxDate={maxDate}
      />
      <span className="text-gray-400">–</span>
      <DatePicker
        value={endDate}
        onChange={onEndDateChange}
        placeholder="Hasta"
        maxDate={maxDate}
      />
    </div>
  )
}
