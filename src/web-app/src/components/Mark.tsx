/** NSIN mark: a roof (home) and a rising signal, drawn in the four Google colours.
 *  Same mark as the landing site (nsin-google-landing/src/components/ui.tsx); keep the two in sync. */
export default function Mark({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="#1a73e8" />
      <path d="M18 26 32 13l14 13" fill="none" stroke="#fbbc04" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 40 32 23l18 17" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="25" cy="46" r="4.5" fill="#ea4335" />
      <circle cx="39" cy="46" r="4.5" fill="#34a853" />
    </svg>
  );
}
