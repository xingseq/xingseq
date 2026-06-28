import React, { useEffect, useState } from 'react'

/**
 * 安全确认弹窗（带倒计时进度条）
 */
export default function ConfirmDialog({ pendingConfirm, onConfirm }) {
  const [countdownLeft, setCountdownLeft] = useState(0)
  const [countdownTotal, setCountdownTotal] = useState(0)

  useEffect(() => {
    if (!pendingConfirm || !pendingConfirm.countdown) return
    const total = pendingConfirm.countdown
    setCountdownTotal(total)
    setCountdownLeft(total)
    const start = Date.now()
    const timer = setInterval(() => {
      const left = Math.max(0, total - Math.floor((Date.now() - start) / 1000))
      setCountdownLeft(left)
      if (left <= 0) {
        clearInterval(timer)
        onConfirm(null) // 倒计时结束，后端将自动执行，关闭弹窗
      }
    }, 250)
    return () => {
      clearInterval(timer)
      setCountdownTotal(0)
      setCountdownLeft(0)
    }
  }, [pendingConfirm])

  if (!pendingConfirm) return null

  return (
    <div className="confirm-overlay">
      <div className="confirm-dialog">
        <h3>安全确认</h3>
        <p>工具 <strong>{pendingConfirm.toolName}</strong> 请求执行：</p>
        <pre className="confirm-args">{JSON.stringify(pendingConfirm.args, null, 2)}</pre>
        <div className="confirm-actions">
          <button className="btn-allow" onClick={() => onConfirm(true)}>允许执行</button>
          <button className="btn-deny" onClick={() => onConfirm(false)}>拒绝</button>
        </div>
        {countdownTotal > 0 && (
          <div className="confirm-progress">
            <div
              className="confirm-progress-bar"
              key={pendingConfirm.confirmId}
              style={{ animationDuration: `${countdownTotal}s` }}
            />
          </div>
        )}
        <p className="confirm-hint">
          {countdownLeft > 0 ? `${countdownLeft} 秒后将自动执行` : '正在自动执行…'}
        </p>
      </div>
    </div>
  )
}
