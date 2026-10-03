package be.nexai.floatingpi

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.view.View

/**
 * De zwevende Pi-behuizing: tekent één beeld uit de sprite-sheet (120 beelden, 12 per rij) en schuift
 * elke 75 ms een beeld door, zodat hij in 9 s een volledige draai maakt (zoals in de app).
 * Geen allocaties per beeld, enkel een bronrechthoek die verschuift.
 */
@SuppressLint("ViewConstructor")
internal class BubbleView(context: Context, private val sheet: Bitmap) : View(context) {
  companion object {
    const val FRAMES = 120
    const val COLS = 12
    const val FRAME_MS = 75L
  }

  private val rows = (FRAMES + COLS - 1) / COLS
  private val frameW = sheet.width / COLS
  private val frameH = sheet.height / rows
  private val src = Rect()
  private val dst = Rect()
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
  private val markerFill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val markerEdge = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    color = 0xFF050508.toInt()
  }
  private val marker = Path()
  private var frame = 0
  private var playing = false

  /** 0 = geen markering (alles in orde). Anders de kleur van het ruitje rechtsboven. */
  var statusColor: Int = 0
    set(value) {
      field = value
      invalidate()
    }

  private val tick = object : Runnable {
    override fun run() {
      if (!playing) return
      frame = (frame + 1) % FRAMES
      invalidate()
      postDelayed(this, FRAME_MS)
    }
  }

  fun play() {
    if (playing) return
    playing = true
    postDelayed(tick, FRAME_MS)
  }

  fun pause() {
    playing = false
    removeCallbacks(tick)
  }

  override fun onDetachedFromWindow() {
    pause()
    super.onDetachedFromWindow()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val col = frame % COLS
    val row = frame / COLS
    src.set(col * frameW, row * frameH, (col + 1) * frameW, (row + 1) * frameH)
    dst.set(0, 0, width, height)
    canvas.drawBitmap(sheet, src, dst, paint)
    if (statusColor != 0) {
      // Ruitje (zoals de statusmarkering in de app), rechtsboven op de behuizing.
      val r = width * 0.1f
      val cx = width * 0.84f
      val cy = height * 0.2f
      marker.reset()
      marker.moveTo(cx, cy - r)
      marker.lineTo(cx + r, cy)
      marker.lineTo(cx, cy + r)
      marker.lineTo(cx - r, cy)
      marker.close()
      markerFill.color = statusColor
      markerEdge.strokeWidth = width * 0.035f
      canvas.drawPath(marker, markerEdge)
      canvas.drawPath(marker, markerFill)
    }
  }
}

/** Het doel onderaan het scherm waar je de bubbel naartoe sleept om hem te sluiten. */
@SuppressLint("ViewConstructor")
internal class CloseTargetView(context: Context) : View(context) {
  private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val cross = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
  }

  var active = false
    set(value) {
      if (field == value) return
      field = value
      invalidate()
    }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val cx = width / 2f
    val cy = height / 2f
    val r = (minOf(width, height) / 2f) * (if (active) 0.96f else 0.8f)
    fill.color = if (active) 0xE6FF2A1F.toInt() else 0xCC0E0E16.toInt()
    ring.color = if (active) 0xFFFFD9D2.toInt() else 0x66F2F2F0
    ring.strokeWidth = width * 0.03f
    cross.color = 0xFFF2F2F0.toInt()
    cross.strokeWidth = width * 0.045f
    canvas.drawCircle(cx, cy, r, fill)
    canvas.drawCircle(cx, cy, r, ring)
    val d = r * 0.36f
    canvas.drawLine(cx - d, cy - d, cx + d, cy + d, cross)
    canvas.drawLine(cx - d, cy + d, cx + d, cy - d, cross)
  }
}
