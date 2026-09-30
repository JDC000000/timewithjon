// src/ui/Tick.tsx (T1.1b.U4): the pack's ✓ (gen.py CK). Every picked/selected state shows it next to the ink edge and
// the fill, so colour is never the only cue (site.css shows .ck only in the selected state).
export function Tick() {
  return (
    <svg className="ck" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M1.5 6.5l3 3 6-7.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
