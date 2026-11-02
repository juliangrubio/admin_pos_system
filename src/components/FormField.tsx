interface FormFieldProps {
  label: string
  htmlFor?: string
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export default function FormField({ label, htmlFor, hint, children, className }: FormFieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className='block text-sm font-medium mb-1'>
        {label}
      </label>
      {children}
      {hint && <p className='text-xs text-gray-500 mt-1'>{hint}</p>}
    </div>
  )
}

export const inputClass = 'w-full p-2 border rounded text-sm disabled:bg-gray-100 disabled:text-gray-500'
export const selectClass = 'w-full p-2 border rounded text-sm bg-white disabled:bg-gray-100 disabled:text-gray-500'
export const filterSelectClass = 'px-3 py-2 border rounded-lg text-sm bg-white'
