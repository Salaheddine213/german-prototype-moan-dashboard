/**
 * Neutral brand mark for the German Electricity Market Analytics dashboard:
 * a stylised lightning bolt inside a rounded square. Renders in currentColor
 * so it follows the surrounding theme.
 */
export default function BirdviewMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M13 2 4.5 13.5H11L9.5 22 19.5 9.5H12.5L13 2Z" />
    </svg>
  )
}