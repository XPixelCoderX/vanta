const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

export function ScanMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M20 2.5 37.5 20 20 37.5 2.5 20Z" stroke="currentColor" strokeWidth="1.1" opacity=".5" />
      <path d="M20 8.5 31.5 20 20 31.5 8.5 20Z" stroke="currentColor" strokeWidth="1.1" opacity=".8" />
      <path d="M20 14 26 20 20 26 14 20Z" fill="currentColor" opacity=".9" />
      <path d="M20 0v6M20 34v6M0 20h6M34 20h6" stroke="currentColor" strokeWidth="1" opacity=".55" />
    </svg>
  );
}

export function ArrowUpRight({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

export function ArrowRight({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

export function SoundOn({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 9.5v5h3.2L12 19V5L7.2 9.5H4Z" />
      <path d="M15.5 9a4.4 4.4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </svg>
  );
}

export function SoundOff({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 9.5v5h3.2L12 19V5L7.2 9.5H4Z" />
      <path d="m16 10 4 4M20 10l-4 4" />
    </svg>
  );
}

export function PauseIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M9 5v14M15 5v14" />
    </svg>
  );
}

export function PlayIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="m8 5 11 7-11 7V5Z" />
    </svg>
  );
}

export function CloseIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function RestartIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 4v6h6" />
      <path d="M4.6 13a8 8 0 1 0 1.9-7.2L4 10" />
    </svg>
  );
}

export function ExitIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M14 4H5v16h9M10 12h11M17 8l4 4-4 4" />
    </svg>
  );
}

export function HandIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10m0-4.5a1.5 1.5 0 0 1 3 0V10m0-3.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7-6.2 7H10c-2 0-3.3-1.2-4-2.6L4.6 14a1.6 1.6 0 0 1 2.8-1.5L8 13.5" />
    </svg>
  );
}

export function ScanIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="12" r="5.4" opacity=".65" />
      <circle cx="12" cy="12" r="9" opacity=".35" strokeDasharray="2 4" />
      <path d="M12 12 19 5" />
    </svg>
  );
}

export function HeadphonesIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14h3v6H5.5A1.5 1.5 0 0 1 4 18.5V14ZM20 14h-3v6h1.5a1.5 1.5 0 0 0 1.5-1.5V14Z" />
    </svg>
  );
}

export function PinIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  );
}

export function InfoIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </svg>
  );
}

export function MenuIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
