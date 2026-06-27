/**
 * @xingseq/electron-shell
 * Electron preload 脚本
 *
 * 通过 contextBridge 把少量安全信息暴露给前端，
 * 当前版本仅做环境标识，业务请求仍走 HTTP/SSE。
 */

const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform
})
