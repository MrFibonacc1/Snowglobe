// Minimal inline icon set (stroke-based) so we avoid an icon dependency.
type P = { size?: number }
const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const IconGrid = ({ size }: P) => (
  <svg {...base(size)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></svg>
)
export const IconCamera = ({ size }: P) => (
  <svg {...base(size)}><path d="M2 7.5A1.5 1.5 0 0 1 3.5 6h2l1.2-1.8A1 1 0 0 1 7.5 4h5a1 1 0 0 1 .8.4L14.5 6h2A1.5 1.5 0 0 1 18 7.5v9A1.5 1.5 0 0 1 16.5 18h-13A1.5 1.5 0 0 1 2 16.5z" /><circle cx="8" cy="11.5" r="3" /><path d="M18 9l4-2v10l-4-2" /></svg>
)
export const IconPlug = ({ size }: P) => (
  <svg {...base(size)}><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v5" /></svg>
)
export const IconBolt = ({ size }: P) => (
  <svg {...base(size)}><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>
)
export const IconList = ({ size }: P) => (
  <svg {...base(size)}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
)
export const IconPlus = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>
)
export const IconTrash = ({ size }: P) => (
  <svg {...base(size)}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
)
export const IconCheck = ({ size }: P) => (
  <svg {...base(size)}><path d="M20 6 9 17l-5-5" /></svg>
)
export const IconEye = ({ size }: P) => (
  <svg {...base(size)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
)
export const IconArrow = ({ size }: P) => (
  <svg {...base(size)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
export const IconClose = ({ size }: P) => (
  <svg {...base(size)}><path d="M6 6l12 12M18 6 6 18" /></svg>
)
export const IconUpload = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 16V4M7 9l5-5 5 5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" /></svg>
)
export const IconImage = ({ size }: P) => (
  <svg {...base(size)}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
)
export const IconFlask = ({ size }: P) => (
  <svg {...base(size)}><path d="M9 3h6M10 3v6l-5 9a1.5 1.5 0 0 0 1.3 2.2h11.4A1.5 1.5 0 0 0 19 18l-5-9V3" /><path d="M7.5 14h9" /></svg>
)
