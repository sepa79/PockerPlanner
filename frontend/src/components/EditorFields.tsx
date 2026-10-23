import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function EditorInput({ label, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { name: string; label: string; error?: string }) {
  return <div className="pp-field"><label htmlFor={`field-${props.name}`}>{label}</label>
    <input {...props} ref={input => { input?.setCustomValidity(error ?? '') }} id={`field-${props.name}`} aria-invalid={Boolean(error)} aria-describedby={error ? `${props.name}-error` : props['aria-describedby']} />
    {error && <span id={`${props.name}-error`} className="pp-field-error">{error}</span>}
  </div>
}

export function EditorArea({ label, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { name: string; label: string }) {
  return <div className="pp-field"><label htmlFor={`field-${props.name}`}>{label}</label><textarea {...props} id={`field-${props.name}`} /></div>
}

export function EditorSelect({ name, label, value, options, onChange, required = false }: {
  name: string; label: string; value: string; options: { id: string; name: string }[]; onChange: (value: string) => void; required?: boolean
}) {
  return <div className="pp-field"><label htmlFor={`field-${name}`}>{label}</label>
    <select id={`field-${name}`} name={name} value={value} required={required} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
  </div>
}
