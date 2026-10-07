// Bulletproof toggle switch: a real <button> + <span> knob, no native checkbox,
// no `appearance:none`, no ::before on a replaced element. Renders identically
// everywhere (some Android Chrome builds ignore appearance:none on checkboxes).
export function Switch({
  checked,
  onChange,
  disabled,
  ariaLabel,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={className ? `ck-switch ${className}` : "ck-switch"}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <span className="ck-switch-knob" aria-hidden="true" />
    </button>
  );
}
