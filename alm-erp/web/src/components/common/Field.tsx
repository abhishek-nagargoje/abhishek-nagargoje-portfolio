import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldProps {
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: ReactNode;
  className?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string; required?: boolean }) => ReactNode;
}

/** Label + control + hint/error, wired for screen readers. */
export function Field({ label, required, error, hint, className, children }: FieldProps) {
  const id = useId();
  const describedBy = [error ? `${id}-err` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className ?? ''}`}>
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden>*</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, required })}
      {hint && !error && <span id={`${id}-hint`} className="field-hint">{hint}</span>}
      {error && <span id={`${id}-err`} className="field-error" role="alert">{error}</span>}
    </div>
  );
}

type Opt = string | { value: string | number; label: string };

export function TextField({ label, required, error, hint, className, ...input }: Omit<FieldProps, 'children'> & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} required={required} error={error} hint={hint} className={className}>
      {(p) => <input className="input" {...p} {...input} />}
    </Field>
  );
}

export function TextAreaField({ label, required, error, hint, className, ...input }: Omit<FieldProps, 'children'> & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} required={required} error={error} hint={hint} className={className}>
      {(p) => <textarea className="textarea" {...p} {...input} />}
    </Field>
  );
}

export function SelectField({ label, required, error, hint, className, options, placeholder, ...select }:
  Omit<FieldProps, 'children'> & SelectHTMLAttributes<HTMLSelectElement> & { options: readonly Opt[]; placeholder?: string }) {
  return (
    <Field label={label} required={required} error={error} hint={hint} className={className}>
      {(p) => (
        <select className="select" {...p} {...select}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) =>
            typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>,
          )}
        </select>
      )}
    </Field>
  );
}
