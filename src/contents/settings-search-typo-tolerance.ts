import type { PlasmoCSConfig } from "plasmo"

import { SETTINGS_SEARCH_ITEMS, resolveSettingRoute, type SettingsSearchItem } from "~constants"
import { t } from "~utils/i18n"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle",
}

const FALLBACK_CLASS = "gh-settings-typo-fallback"
const FALLBACK_STYLE_ID = "gh-settings-typo-fallback-style"
const GLOBAL_SEARCH_RESULTS_LISTBOX_ID = "settings-search-results-listbox"
const MIN_QUERY_LENGTH = 3
const RESULT_LIMIT = 6

interface RankedSettingResult {
  item: SettingsSearchItem
  score: number
}

const normalizeValue = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim()

const toWords = (value: string): string[] =>
  normalizeValue(value)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)

const getBoundedDamerauLevenshteinDistance = (
  source: string,
  target: string,
  maxDistance: number,
): number => {
  const sourceLength = source.length
  const targetLength = target.length

  if (source === target) return 0
  if (Math.abs(sourceLength - targetLength) > maxDistance) return maxDistance + 1

  const prevPrevRow = new Array(targetLength + 1).fill(0)
  const prevRow = new Array(targetLength + 1)
  const currentRow = new Array(targetLength + 1)

  for (let columnIndex = 0; columnIndex <= targetLength; columnIndex += 1) {
    prevRow[columnIndex] = columnIndex
  }

  for (let rowIndex = 1; rowIndex <= sourceLength; rowIndex += 1) {
    currentRow[0] = rowIndex
    let rowBest = currentRow[0]

    for (let columnIndex = 1; columnIndex <= targetLength; columnIndex += 1) {
      const cost = source[rowIndex - 1] === target[columnIndex - 1] ? 0 : 1
      let value = Math.min(
        prevRow[columnIndex] + 1,
        currentRow[columnIndex - 1] + 1,
        prevRow[columnIndex - 1] + cost,
      )

      if (
        rowIndex > 1 &&
        columnIndex > 1 &&
        source[rowIndex - 1] === target[columnIndex - 2] &&
        source[rowIndex - 2] === target[columnIndex - 1]
      ) {
        value = Math.min(value, prevPrevRow[columnIndex - 2] + 1)
      }

      currentRow[columnIndex] = value
      rowBest = Math.min(rowBest, value)
    }

    if (rowBest > maxDistance) return maxDistance + 1

    for (let columnIndex = 0; columnIndex <= targetLength; columnIndex += 1) {
      prevPrevRow[columnIndex] = prevRow[columnIndex]
      prevRow[columnIndex] = currentRow[columnIndex]
    }
  }

  return prevRow[targetLength]
}

const getLocalizedSettingTitle = (item: SettingsSearchItem): string => {
  const fallback = item.title || item.settingId.replace(/[-_]/g, " ")
  const translated = t(item.settingId)
  return translated && translated !== item.settingId ? translated : fallback
}

const getSettingSearchText = (item: SettingsSearchItem): string =>
  [item.settingId, item.title, getLocalizedSettingTitle(item), ...(item.keywords || [])]
    .filter(Boolean)
    .join(" ")

const scoreSetting = (item: SettingsSearchItem, query: string): number => {
  const normalizedQuery = normalizeValue(query)
  if (normalizedQuery.length < MIN_QUERY_LENGTH) return 0

  const queryWords = toWords(normalizedQuery)
  if (queryWords.length === 0) return 0

  const text = normalizeValue(getSettingSearchText(item))
  const words = toWords(text)
  let totalScore = 0

  for (const queryWord of queryWords) {
    let bestWordScore = 0

    if (text.includes(queryWord)) {
      bestWordScore = Math.max(bestWordScore, 120)
    }

    for (const candidateWord of words) {
      if (candidateWord === queryWord) {
        bestWordScore = Math.max(bestWordScore, 220)
        continue
      }

      if (candidateWord.startsWith(queryWord) || queryWord.startsWith(candidateWord)) {
        bestWordScore = Math.max(bestWordScore, 160)
        continue
      }

      if (candidateWord.includes(queryWord)) {
        bestWordScore = Math.max(bestWordScore, 120)
        continue
      }

      const maxDistance = queryWord.length >= 8 ? 2 : 1
      if (queryWord.length < 4 || Math.abs(candidateWord.length - queryWord.length) > maxDistance) {
        continue
      }

      const distance = getBoundedDamerauLevenshteinDistance(queryWord, candidateWord, maxDistance)
      if (distance <= maxDistance) {
        bestWordScore = Math.max(bestWordScore, 95 - distance * 18)
      }
    }

    if (bestWordScore === 0) return 0
    totalScore += bestWordScore
  }

  return totalScore - Math.min(40, getLocalizedSettingTitle(item).length)
}

const searchTypoTolerantSettings = (query: string): RankedSettingResult[] =>
  SETTINGS_SEARCH_ITEMS.map((item) => ({ item, score: scoreSetting(item, query) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, RESULT_LIMIT)

const walkShadowRoots = (root: ParentNode, visit: (root: ParentNode) => void): void => {
  visit(root)
  root.querySelectorAll?.("*").forEach((element) => {
    const shadowRoot = (element as HTMLElement).shadowRoot
    if (shadowRoot) walkShadowRoots(shadowRoot, visit)
  })
}

const findSettingsSearchInput = (): HTMLInputElement | null => {
  let input: HTMLInputElement | null = null
  walkShadowRoots(document, (root) => {
    if (input) return
    const candidate = root.querySelector(
      `input[aria-controls="${GLOBAL_SEARCH_RESULTS_LISTBOX_ID}"], input[placeholder*="settings" i], input[placeholder*="设置" i]`,
    )
    if (candidate instanceof HTMLInputElement) input = candidate
  })
  return input
}

const findResultsListbox = (input: HTMLInputElement): HTMLElement | null => {
  const root = input.getRootNode() as ParentNode
  const listbox = root.querySelector?.(`#${GLOBAL_SEARCH_RESULTS_LISTBOX_ID}`)
  return listbox instanceof HTMLElement ? listbox : null
}

const hasNativeSettingsResults = (listbox: HTMLElement): boolean => {
  const text = (listbox.textContent || "").toLowerCase()
  if (/no matching|无匹配|没有匹配/.test(text)) return false
  return Array.from(listbox.querySelectorAll('[role="option"]')).some(
    (option) => !option.closest(`.${FALLBACK_CLASS}`),
  )
}

const ensureFallbackStyles = (root: ParentNode): void => {
  if (!(root instanceof ShadowRoot || root instanceof Document)) return
  if (root.getElementById?.(FALLBACK_STYLE_ID)) return

  const style = document.createElement("style")
  style.id = FALLBACK_STYLE_ID
  style.textContent = `
    .${FALLBACK_CLASS} {
      margin: 6px 8px 8px;
      padding: 8px;
      border: 1px dashed var(--gh-border, rgba(148, 163, 184, 0.45));
      border-radius: 12px;
      background: color-mix(in srgb, var(--gh-primary, #4285f4) 6%, var(--gh-bg, #ffffff));
    }
    .${FALLBACK_CLASS}__title {
      margin: 0 0 6px;
      color: var(--gh-text-secondary, #6b7280);
      font-size: 12px;
      font-weight: 600;
    }
    .${FALLBACK_CLASS}__item {
      appearance: none;
      display: block;
      width: 100%;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--gh-text, #111827);
      cursor: pointer;
      font: inherit;
      padding: 7px 8px;
      text-align: left;
    }
    .${FALLBACK_CLASS}__item:hover,
    .${FALLBACK_CLASS}__item:focus-visible {
      background: color-mix(in srgb, var(--gh-primary, #4285f4) 12%, transparent);
      outline: none;
    }
    .${FALLBACK_CLASS}__path {
      color: var(--gh-text-secondary, #6b7280);
      display: block;
      font-size: 11px;
      margin-top: 2px;
    }
  `

  if (root instanceof ShadowRoot) {
    root.appendChild(style)
  } else {
    document.head.appendChild(style)
  }
}

const clearFallback = (listbox: HTMLElement): void => {
  listbox.querySelectorAll(`.${FALLBACK_CLASS}`).forEach((node) => node.remove())
}

const renderFallback = (input: HTMLInputElement): void => {
  const listbox = findResultsListbox(input)
  if (!listbox) return

  clearFallback(listbox)

  const query = input.value.trim()
  if (query.length < MIN_QUERY_LENGTH || hasNativeSettingsResults(listbox)) return

  const matches = searchTypoTolerantSettings(query)
  if (matches.length === 0) return

  const root = input.getRootNode() as ParentNode
  ensureFallbackStyles(root)

  const wrapper = document.createElement("div")
  wrapper.className = FALLBACK_CLASS
  wrapper.setAttribute("role", "group")

  const title = document.createElement("p")
  title.className = `${FALLBACK_CLASS}__title`
  title.textContent = "Typo-tolerant settings matches"
  wrapper.appendChild(title)

  matches.forEach(({ item }) => {
    const route = resolveSettingRoute(item.settingId)
    const button = document.createElement("button")
    button.type = "button"
    button.className = `${FALLBACK_CLASS}__item`
    button.setAttribute("role", "option")
    button.textContent = getLocalizedSettingTitle(item)

    const path = document.createElement("span")
    path.className = `${FALLBACK_CLASS}__path`
    path.textContent = [route?.page, route?.subTab, item.settingId].filter(Boolean).join(" / ")
    button.appendChild(path)

    button.addEventListener("click", () => {
      window.dispatchEvent(
        new CustomEvent("ophel:navigateSettingsPage", {
          detail: {
            page: route?.page,
            subTab: route?.subTab,
            settingId: item.settingId,
          },
        }),
      )
    })

    wrapper.appendChild(button)
  })

  listbox.appendChild(wrapper)
}

let pending = false

const scheduleRender = (): void => {
  if (pending) return
  pending = true
  window.requestAnimationFrame(() => {
    pending = false
    const input = findSettingsSearchInput()
    if (input) renderFallback(input)
  })
}

const startSettingsSearchTypoTolerance = (): void => {
  scheduleRender()

  document.addEventListener(
    "input",
    (event) => {
      if (event.target instanceof HTMLInputElement) {
        scheduleRender()
      }
    },
    true,
  )

  document.addEventListener("keydown", scheduleRender, true)

  const observer = new MutationObserver(scheduleRender)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-expanded", "class", "style"],
  })
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startSettingsSearchTypoTolerance, { once: true })
} else {
  startSettingsSearchTypoTolerance()
}
