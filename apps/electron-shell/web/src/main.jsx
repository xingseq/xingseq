import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// macOS 下窗口开了 vibrancy（毛玻璃），页面底色须透明才能透出来；
// 该标记同时用于控制侧栏顶部红绿灯让位的留白。
if (window.electronAPI?.platform === 'darwin') {
  document.documentElement.classList.add('vibrancy')
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
