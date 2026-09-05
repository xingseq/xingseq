import React from 'react'

/**
 * 线性图标集
 *
 * 全部为 24×24 viewBox、stroke=currentColor 的单色描边图标，
 * 取代原先的 emoji（emoji 在不同平台字号基线不一，观感杂乱）。
 * 尺寸由 props.size 控制，颜色跟随父级 color。
 *
 * @param {object} props
 * @param {string} props.name 图标名，见 PATHS
 * @param {number} [props.size=16] 边长（px）
 */

// 每个图标 = 一组 <path d>（统一 round 端点，1.6 描边）
const PATHS = {
  // 子应用
  chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  bot: [
    'M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2',
    'M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z',
    'M10 10h4v4h-4z'
  ],
  mail: [
    'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    'm3.5 8 8.5 5.5L20.5 8'
  ],
  grid: ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],

  // 管理 / 商店 / 设置
  layers: ['m12 3 9 5-9 5-9-5z', 'm3 13 9 5 9-5'],
  store: [
    'M6 2h12l2 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z',
    'M4 6h16',
    'M15 10a3 3 0 0 1-6 0'
  ],
  settings: [
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'
  ],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-5', 'M12 8h.01'],

  // 操作
  refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 3.5V9h-5.5'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  stop: ['M7 7h10v10H7z'],
  play: ['m9 5 10 7-10 7z'],
  download: ['M12 3v11', 'm7.5 10 4.5 4.5 4.5-4.5', 'M4 20h16'],
  trash: [
    'M4 7h16',
    'M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2',
    'm6 7 1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12',
    'M10 11v6M14 11v6'
  ],
  sidebar: ['M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M10 4v16'],
  alert: ['m12 4 9 16H3z', 'M12 10v4', 'M12 17h.01'],
  close: ['M6 6l12 12M18 6 6 18'],
  plus: ['M12 5v14M5 12h14'],
  sparkle: ['m12 3 2.2 6.3L20.5 12l-6.3 2.2L12 21l-2.2-6.8L3.5 12l6.3-2.7z']
}

export default function Icon({ name, size = 16, className = '', ...rest }) {
  const paths = PATHS[name] || PATHS.grid
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}
