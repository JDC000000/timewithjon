// src/ui/Field.tsx (T1.1a.U1): the pack's .field. A visible label, an optional persistent help line (never
// placeholder-only instructions) and an error line; on error the control gets aria-invalid (R1-08, R1-18).
import type { CSSProperties, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

type Base = {
  id: string;
  label: ReactNode;
  /** inline hint inside the label (pack s10: "Your email <span class=hint>So I can send the invite.</span>") */
  hint?: ReactNode;
  /** persistent help line under the label (pack a3b "Before 60") */
  help?: ReactNode;
  error?: string | null;
  className?: string;
  /** extra pack classes on the control itself (pack a1b: 'input code-in') */
  inputClassName?: string;
  style?: CSSProperties;
};
type InputField = Base & { multiline?: false } & Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'id' | 'className' | 'style'
  >;
type AreaField = Base & { multiline: true } & Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'id' | 'className' | 'style'
  >;
export type FieldProps = InputField | AreaField;

/** ids a Field hands its control: `${id}-h` (help) and `${id}-e` (error) */
export function describedBy(id: string, help: boolean, extra?: string): string {
  return [extra, help ? `${id}-h` : null, `${id}-e`].filter(Boolean).join(' ');
}

export function Field(props: FieldProps) {
  const { id, label, hint, help, error, className, inputClassName, style, ...control } = props;
  const aria = {
    id,
    'aria-describedby': describedBy(id, help != null, control['aria-describedby']),
    'aria-invalid': error ? true : undefined,
  };
  return (
    <div className={cx('field', error && 'bad', className)} style={style}>
      <label htmlFor={id}>
        {label}
        {hint != null && (
          <>
            {' '}
            <span className="hint">{hint}</span>
          </>
        )}
      </label>
      {help != null && (
        <p className="help" id={`${id}-h`} style={{ marginTop: 'var(--s1)' }}>
          {help}
        </p>
      )}
      {control.multiline ? (
        <textarea className={cx('textarea', inputClassName)} {...omitMultiline(control)} {...aria} />
      ) : (
        <input className={cx('input', inputClassName)} {...omitMultiline(control)} {...aria} />
      )}
      <p className="err" id={`${id}-e`} hidden={!error}>
        {error}
      </p>
    </div>
  );
}

function omitMultiline<T extends { multiline?: boolean }>(c: T): Omit<T, 'multiline'> {
  const { multiline, ...rest } = c;
  void multiline;
  return rest;
}

/** A .field around a group control (stepper, radios): label + hint spans whose ids the group points at. */
export function FieldGroup({
  id,
  label,
  hint,
  className,
  style,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  style?: CSSProperties;
  children: (ids: { labelId: string; hintId: string | undefined }) => ReactNode;
}) {
  const hintId = hint != null ? `${id}-h` : undefined;
  return (
    <div className={cx('field', className)} style={style}>
      <span className="label" id={`${id}-l`}>
        {label}
      </span>
      {hint != null && (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
      {children({ labelId: `${id}-l`, hintId })}
    </div>
  );
}
