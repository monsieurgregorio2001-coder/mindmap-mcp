const p = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
export const Logo = () => (
  <svg {...p} width={18} height={18}>
    <circle cx="3.5" cy="8" r="2" fill="currentColor" />
    <path d="M5.5 8h3M8.5 8l3-4M8.5 8l3 4" />
    <circle cx="12.5" cy="3.5" r="1.4" />
    <circle cx="12.5" cy="12.5" r="1.4" />
  </svg>
);
export const Search = () => (
  <svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </svg>
);
export const Plus = () => (
  <svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);
export const Sun = () => (
  <svg {...p}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
  </svg>
);
export const Moon = () => (
  <svg {...p}>
    <path d="M13 9.5A5.5 5.5 0 016.5 3 5.5 5.5 0 1013 9.5z" />
  </svg>
);
export const More = () => (
  <svg {...p}>
    <circle cx="3.5" cy="8" r=".6" fill="currentColor" />
    <circle cx="8" cy="8" r=".6" fill="currentColor" />
    <circle cx="12.5" cy="8" r=".6" fill="currentColor" />
  </svg>
);
export const Back = () => (
  <svg {...p}>
    <path d="M10 3L5 8l5 5" />
  </svg>
);
export const Panel = () => (
  <svg {...p}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M10 3v10" />
  </svg>
);
export const Help = () => (
  <svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.2 6.3a1.9 1.9 0 113 1.5c-.7.5-1.2.8-1.2 1.6M8 11.4v.1" />
  </svg>
);
