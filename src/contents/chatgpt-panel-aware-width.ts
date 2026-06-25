import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://chatgpt.com/*"],
  run_at: "document_idle",
}

const STYLE_ID = "gh-chatgpt-panel-aware-width"
const OPHEL_PAGE_WIDTH_STYLE_ID = "gh-page-width-styles"
const CHATGPT_WIDTH_SELECTORS = [
  '[class*="thread-content-max-width"]',
  '[style*="--thread-content-max-width"]',
]
const MIN_VISIBLE_PANEL_WIDTH = 120
const PANEL_GAP_PX = 16
const NARROW_SCREEN_BREAKPOINT = 480

interface PanelReservation {
  left: number
  right: number
}

function getOrCreateStyle(): HTMLStyleElement {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement("style")
    style.id = STYLE_ID
    document.head.appendChild(style)
  }

  // Keep this style after Ophel's page-width style so equal-specificity !important rules win.
  if (style.nextSibling && document.head.contains(style)) {
    document.head.appendChild(style)
  }

  return style
}

function clearPanelAwareStyle(): void {
  const style = document.getElementById(STYLE_ID)
  if (style) style.textContent = ""
}

function walkRoots(root: ParentNode, visit: (root: ParentNode) => void): void {
  visit(root)

  const elements = root.querySelectorAll?.("*") || []
  elements.forEach((element) => {
    const shadowRoot = (element as HTMLElement).shadowRoot
    if (shadowRoot) {
      walkRoots(shadowRoot, visit)
    }
  })
}

function findMainPanel(): HTMLElement | null {
  let panel: HTMLElement | null = null

  walkRoots(document, (root) => {
    if (panel) return
    const candidate = root.querySelector?.(".gh-main-panel")
    if (candidate instanceof HTMLElement) {
      panel = candidate
    }
  })

  return panel
}

function getVisiblePanelReservation(): PanelReservation | null {
  const panel = findMainPanel()
  if (!panel || !panel.isConnected) return null

  const rect = panel.getBoundingClientRect()
  const visibleLeft = Math.max(0, rect.left)
  const visibleRight = Math.min(window.innerWidth, rect.right)
  const visibleWidth = Math.max(0, visibleRight - visibleLeft)

  // Ignore the small Auto Snap peek handle/retracted state; only reserve for an open panel.
  if (visibleWidth < MIN_VISIBLE_PANEL_WIDTH || rect.height < 120) {
    return null
  }

  const panelCenter = visibleLeft + visibleWidth / 2
  const isLeftPanel = panelCenter < window.innerWidth / 2

  if (isLeftPanel) {
    return { left: Math.ceil(visibleRight), right: 0 }
  }

  return { left: 0, right: Math.ceil(window.innerWidth - visibleLeft) }
}

function getConfiguredPageWidth(): string {
  const pageWidthStyle = document.getElementById(OPHEL_PAGE_WIDTH_STYLE_ID)
  const css = pageWidthStyle?.textContent || ""
  const maxWidthMatch = css.match(/max-width:\s*([^!;{}]+)\s*!important/i)

  // Prefer Ophel's active Page Widening value when present; otherwise respect ChatGPT's native variable.
  return maxWidthMatch?.[1]?.trim() || "var(--thread-content-max-width, 100%)"
}

function buildPanelAwareCss(reservation: PanelReservation): string {
  const configuredWidth = getConfiguredPageWidth()
  const reservedLeft = Math.max(0, Math.ceil(reservation.left))
  const reservedRight = Math.max(0, Math.ceil(reservation.right))
  const safeWidth = `calc(100vw - ${reservedLeft}px - ${reservedRight}px - ${PANEL_GAP_PX * 2}px)`
  const marginLeft = reservedLeft > 0 ? `${reservedLeft + PANEL_GAP_PX}px` : "auto"
  const marginRight = reservedRight > 0 ? `${reservedRight + PANEL_GAP_PX}px` : "auto"
  const selector = CHATGPT_WIDTH_SELECTORS.join(",\n")

  return `
@media (min-width: ${NARROW_SCREEN_BREAKPOINT + 1}px) {
  ${selector} {
    max-width: min(${configuredWidth}, ${safeWidth}) !important;
    margin-left: ${marginLeft} !important;
    margin-right: ${marginRight} !important;
  }
}
`.trim()
}

let pendingUpdate = false

function updatePanelAwareWidth(): void {
  pendingUpdate = false

  if (!document.head || window.innerWidth <= NARROW_SCREEN_BREAKPOINT) {
    clearPanelAwareStyle()
    return
  }

  const reservation = getVisiblePanelReservation()
  if (!reservation) {
    clearPanelAwareStyle()
    return
  }

  getOrCreateStyle().textContent = buildPanelAwareCss(reservation)
}

function scheduleUpdate(): void {
  if (pendingUpdate) return
  pendingUpdate = true
  window.requestAnimationFrame(updatePanelAwareWidth)
}

function startPanelAwareWidth(): void {
  scheduleUpdate()

  window.addEventListener("resize", scheduleUpdate)
  window.addEventListener("ophel:locateOutline", scheduleUpdate)
  window.addEventListener("ophel:locateConversation", scheduleUpdate)

  const observer = new MutationObserver(scheduleUpdate)
  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  })

  // Dragging, Auto Snap peek/retract, and panel resize use direct DOM style writes.
  // A light interval keeps the host page layout in sync with those non-React updates.
  window.setInterval(scheduleUpdate, 500)
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startPanelAwareWidth, { once: true })
} else {
  startPanelAwareWidth()
}
