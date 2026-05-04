export interface StagePlotPlaceholderProps {
  title: string;
  subtitle: string;
}

export function StagePlotPlaceholder({ title, subtitle }: StagePlotPlaceholderProps) {
  return (
    <svg viewBox="0 0 720 420" role="img" aria-label={title} style={{ width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="shell-grid" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(153, 186, 146, 0.34)" />
          <stop offset="100%" stopColor="rgba(105, 169, 209, 0.18)" />
        </linearGradient>
      </defs>
      <rect
        x="32"
        y="32"
        width="656"
        height="356"
        rx="28"
        fill="rgba(17, 25, 20, 0.92)"
        stroke="rgba(64, 96, 80, 0.88)"
      />
      <path
        d="M92 332C144 244 208 202 278 202C354 202 394 270 460 270C532 270 580 220 628 132"
        fill="none"
        stroke="url(#shell-grid)"
        strokeWidth="16"
        strokeLinecap="round"
      />
      <circle cx="188" cy="146" r="24" fill="rgba(214, 169, 90, 0.88)" />
      <circle cx="312" cy="256" r="22" fill="rgba(153, 186, 146, 0.88)" />
      <circle cx="492" cy="194" r="22" fill="rgba(105, 169, 209, 0.88)" />
      <circle cx="598" cy="276" r="20" fill="rgba(213, 106, 101, 0.88)" />
      <text x="92" y="92" fill="#F4F8F2" fontFamily="var(--font-family-display)" fontSize="24" fontWeight="600">
        {title}
      </text>
      <text x="92" y="122" fill="#B7C2BA" fontFamily="var(--font-family-mono)" fontSize="14" fontWeight="500">
        {subtitle}
      </text>
    </svg>
  );
}
