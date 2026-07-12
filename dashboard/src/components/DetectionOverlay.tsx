import { useEffect, useState, type RefObject } from 'react'

export interface DetectionBox {
  box: [number, number, number, number]
  label: string
  confidence: number
}

type MediaElement = HTMLImageElement | HTMLVideoElement

const percent = (value: number) => `${Math.round(value * 10000) / 100}%`

export function DetectionOverlay({
  mediaRef,
  boxes,
}: {
  mediaRef: RefObject<MediaElement | null>
  boxes: DetectionBox[]
}) {
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 })

  useEffect(() => {
    const media = mediaRef.current
    if (!media) return

    const measure = () => {
      const intrinsicWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
      const intrinsicHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
      if (!intrinsicWidth || !intrinsicHeight || !media.clientWidth || !media.clientHeight) return
      const scale = Math.min(media.clientWidth / intrinsicWidth, media.clientHeight / intrinsicHeight)
      const width = intrinsicWidth * scale
      const height = intrinsicHeight * scale
      setRect({
        left: media.offsetLeft + (media.clientWidth - width) / 2,
        top: media.offsetTop + (media.clientHeight - height) / 2,
        width,
        height,
      })
    }

    measure()
    media.addEventListener('load', measure)
    media.addEventListener('loadedmetadata', measure)
    media.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(media)
    return () => {
      observer?.disconnect()
      media.removeEventListener('load', measure)
      media.removeEventListener('loadedmetadata', measure)
      media.removeEventListener('resize', measure)
    }
  }, [mediaRef])

  if (!boxes.length || rect.width <= 0) return null

  return (
    <div
      className="pointer-events-none absolute"
      style={rect}
      data-testid="live-detection-overlay"
      aria-hidden="true"
    >
      {boxes.map(({ box: [x1, y1, x2, y2], label, confidence }, index) => (
        <div
          key={`${label}-${index}`}
          className="absolute border-2 border-emerald-400 shadow-[0_0_0_1px_rgba(0,0,0,0.7)]"
          style={{
            left: percent(x1),
            top: percent(y1),
            width: percent(x2 - x1),
            height: percent(y2 - y1),
          }}
        >
          <span className="absolute -top-px left-0 -translate-y-full whitespace-nowrap rounded-t-sm bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-950 shadow-sm">
            {label} {Math.round(confidence * 100)}%
          </span>
        </div>
      ))}
    </div>
  )
}
