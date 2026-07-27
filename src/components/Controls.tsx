import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  X,
} from 'lucide-react'
import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
  useState,
} from 'react'

export function Button({
  children,
  variant = 'secondary',
  loading,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  loading?: boolean
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`button ${variant} ${className}`}
    >
      {loading && <LoaderCircle className="spin" size={15} />}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  children: ReactNode
}) {
  return (
    <button {...props} className={`icon-button ${className}`} title={label} aria-label={label}>
      {children}
    </button>
  )
}

export function Field({
  label,
  description,
  children,
  inline = false,
  className = '',
}: {
  label: string
  description?: string
  children: ReactNode
  inline?: boolean
  className?: string
}) {
  return (
    <label className={`field ${inline ? 'inline' : ''} ${className}`}>
      <span className="field-copy">
        <span className="field-label">{label}</span>
        {description && <span className="field-description">{description}</span>}
      </span>
      {children}
    </label>
  )
}

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & {
  prefix?: ReactNode
  suffix?: ReactNode
}

export function TextInput({
  prefix,
  suffix,
  ...props
}: TextInputProps) {
  return (
    <span className="input-shell">
      {prefix}
      <input {...props} />
      {suffix}
    </span>
  )
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="text-area" {...props} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select-shell">
      <select {...props} />
      <ChevronDown size={14} />
    </span>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <span className="toggle-wrap">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <label htmlFor={id} className="toggle" aria-label={label}>
        <span />
      </label>
    </span>
  )
}

export function Section({
  title,
  icon,
  children,
  defaultOpen = true,
  badge,
  className,
}: {
  title: string
  icon?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  badge?: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section
      className={`accordion-section ${open ? 'open' : ''} ${className ?? ''}`.trim()}
    >
      <button className="accordion-header" onClick={() => setOpen((value) => !value)}>
        <span>
          {icon}
          <strong>{title}</strong>
          {badge}
        </span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open && <div className="accordion-content">{children}</div>}
    </section>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
      <span className="empty-icon" style={{ marginBottom: '12px' }}>{icon}</span>
      <strong style={{ fontSize: '16px', color: 'var(--text-main)', marginBottom: '4px' }}>{title}</strong>
      <p style={{ fontSize: '13px', maxWidth: '360px', marginBottom: '16px' }}>{description}</p>
      {action}
    </div>
  )
}

export function StatusPill({
  status,
  children,
}: {
  status: 'running' | 'starting' | 'stopped' | 'error' | 'stopping' | 'success' | 'warning' | 'danger' | 'neutral' | 'info'
  children: ReactNode
}) {
  const isOk = status === 'running' || status === 'success'
  const isWarn = status === 'warning' || status === 'starting' || status === 'stopping'
  const Icon = isOk ? CircleCheck : isWarn ? CircleAlert : CircleAlert
  return (
    <span className={`status-pill ${status}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>
      <Icon size={12} />
      {children}
    </span>
  )
}

export function Tag({
  children,
  color = 'neutral',
}: {
  children: ReactNode
  color?: 'neutral' | 'purple' | 'green' | 'blue' | 'amber'
}) {
  return <span className={`tag ${color}`}>{children}</span>
}

export function Notice({
  kind = 'info',
  children,
  onClose,
}: {
  kind?: 'info' | 'warning' | 'danger' | 'success'
  children: ReactNode
  onClose?: () => void
}) {
  return (
    <div className={`notice ${kind}`} style={{ padding: '10px 14px', borderRadius: '6px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', background: kind === 'danger' ? 'rgba(239, 68, 68, 0.15)' : 'var(--panel-2)', color: kind === 'danger' ? 'var(--red)' : 'var(--text-main)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <CircleAlert size={16} />
        <div>{children}</div>
      </div>
      {onClose && (
        <IconButton label="Dismiss" onClick={onClose}>
          <X size={14} />
        </IconButton>
      )}
    </div>
  )
}
