import React, { useEffect, useRef, useMemo } from 'react'
import hljs from 'highlight.js/lib/core'

// 注册常用语言（按需加载，控制打包体积）
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import markdown from 'highlight.js/lib/languages/markdown'
import bash from 'highlight.js/lib/languages/bash'
import python from 'highlight.js/lib/languages/python'
import yaml from 'highlight.js/lib/languages/yaml'
import sql from 'highlight.js/lib/languages/sql'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('css', css)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('python', python)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('sql', sql)

// 扩展名 → 语言映射
const EXT_MAP = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'css',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  md: 'markdown', mdx: 'markdown',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  py: 'python',
  yml: 'yaml', yaml: 'yaml',
  sql: 'sql'
}

function detectLanguage(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return EXT_MAP[ext] || null
}

/**
 * 文件查看器：语法高亮 + 行号
 */
export default function FileViewer({ selectedFile, fileContent, onClose }) {
  const codeRef = useRef(null)

  const language = useMemo(() => {
    if (!selectedFile) return null
    return detectLanguage(selectedFile.name)
  }, [selectedFile])

  const highlighted = useMemo(() => {
    if (!fileContent) return ''
    if (language) {
      try {
        return hljs.highlight(fileContent, { language }).value
      } catch { /* fallback */ }
    }
    return hljs.highlightAuto(fileContent).value
  }, [fileContent, language])

  const lineCount = useMemo(() => {
    if (!fileContent) return 0
    return fileContent.split('\n').length
  }, [fileContent])

  if (!selectedFile) {
    return (
      <div className="content-empty">
        <div className="content-empty-icon">📄</div>
        <div>在左侧选择文件以查看内容</div>
      </div>
    )
  }

  return (
    <>
      <div className="content-header">
        <span className="content-title" title={selectedFile.path}>
          {selectedFile.name}
          {language && <span className="content-lang">{language}</span>}
        </span>
        <button onClick={onClose} title="关闭">×</button>
      </div>
      <div className="content-body code-viewer">
        <div className="line-numbers" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i + 1}>{i + 1}</span>
          ))}
        </div>
        <pre className="code-content">
          <code
            ref={codeRef}
            className={language ? `hljs language-${language}` : 'hljs'}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      </div>
    </>
  )
}
