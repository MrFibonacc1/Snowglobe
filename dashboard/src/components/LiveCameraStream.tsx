import { useEffect, useRef } from 'react'
import { cameraStreamUrl } from '../api'

export function LiveCameraStream({
  cameraId,
  onFrame,
}: {
  cameraId: string
  onFrame: (frame: Blob) => void
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const samplingRef = useRef(false)

  useEffect(() => {
    const timer = setInterval(() => {
      const image = imageRef.current
      if (!image?.naturalWidth || samplingRef.current) return
      samplingRef.current = true
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) {
        samplingRef.current = false
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        samplingRef.current = false
        if (blob) onFrame(blob)
      }, 'image/jpeg', 0.85)
    }, 500)
    return () => clearInterval(timer)
  }, [cameraId, onFrame])

  return (
    <img
      ref={imageRef}
      src={cameraStreamUrl(cameraId)}
      crossOrigin="anonymous"
      alt="live camera preview"
      className="max-h-72 w-full rounded-lg border object-contain"
    />
  )
}
