/**
 * 工具定义汇总 - 导出所有工具定义
 * @author Lioe Squieu
 * @created 2025-11-09
 */

import { fileTools } from './fileTools.js'
import { directoryTools } from './directoryTools.js'
import { fileManagementTools } from './fileManagementTools.js'
import { commandTools } from './commandTools.js'
import { databaseTools } from './databaseTools.js'
import { aiChatTools } from './aiChatTools.js'
import { aiDrawTools } from './aiDrawTools.js'
import { flowGraphTools } from './flowGraphTools.js'
import { customModelTools } from './customModelTools.js'
import { documentationTools } from './documentationTools.js'
import { subAppTools } from './subAppTools.js'
import { agentTools } from './agentTools.js'
import { searchTools } from './searchTools.js'
import { authorizationTools } from './authorizationTools.js'
import { timerTools } from './timerTools.js'
import { emailTools } from './emailTools.js'
import { mockEmailTools } from './mockEmailTools.js'
import { zhmmTools } from './zhmmTools.js'

/**
 * 获取工具组概览（轻量级，用于首次加载）
 */
export function getToolGroupsOverview() {
  return [
    {
      type: 'function',
      function: {
        name: 'load_tool_group',
        description: '按需加载指定的工具组。当你需要使用某类工具时，先调用此函数加载对应的工具组，然后才能使用该组内的具体工具。',
        parameters: {
          type: 'object',
          properties: {
            group: {
              type: 'string',
              enum: ['file', 'directory', 'fileManagement', 'command', 'database', 'aiChat', 'aiDraw', 'flowGraph', 'customModel', 'documentation', 'subApp', 'agent', 'authorization', 'timer', 'email', 'mockEmail', 'zhmm'],
              description: '要加载的工具组:\n- file: 文件操作工具(读取、写入、替换文件内容等)\n- directory: 目录操作工具(列出目录、创建目录等)\n- fileManagement: 文件管理工具(删除、移动、复制文件等)\n- command: 命令执行工具(执行系统命令)\n- database: 数据库查询工具(查询项目、对话等数据)\n- aiChat: AI对话和联网搜索工具(开启AI子对话、使用web_search搜索实时信息)\n- aiDraw: AI画画工具(生成AI图片)\n- flowGraph: 星序图工具(创建和执行AI处理星序图)\n- customModel: 自定义AI模型工具(创建、查询、更新和删除自定义AI模型配置)\n- documentation: 文档工具(读取项目文档和配置规范)\n- subApp: 子应用工具(调用已注册的子应用CLI，如png-to-ico图片转换等)\n- agent: Agent管理工具(启动、停止、监控AI Agent，执行多Agent工作流)\n- authorization: 授权管理工具(查询当前授权状态、重新加载安全路径配置)\n- timer: 定时器工具(设置定时任务、cron周期任务，到期通知Agent)\n- email: 邮件工具(主动发送邮件，通过邮件助手的SMTP通道)\n- mockEmail: 虚拟邮箱测试工具(仅在 XINGSEQ_VIRTUAL_MAILBOX=1 模式下可用，用于离线测试邮件相关星序图)\n- zhmm: 个人信息检索打包工具(搜索个人信息并生成加密ZIP，配合邮件附件远程获取)'
            }
          },
          required: ['group']
        }
      }
    }
  ]
}

/**
 * 获取所有可用工具
 */
export function getAllTools() {
  return [
    ...fileTools,
    ...directoryTools,
    ...fileManagementTools,
    ...commandTools,
    ...databaseTools,
    ...aiChatTools,
    ...aiDrawTools,
    ...flowGraphTools,
    ...customModelTools,
    ...documentationTools,
    ...subAppTools,
    ...agentTools,
    ...searchTools,
    ...authorizationTools,
    ...timerTools,
    ...emailTools,
    ...mockEmailTools,
    ...zhmmTools
  ]
}

/**
 * 根据工具组名称获取工具
 */
export function getToolsByGroup(groupName) {
  const groups = {
    file: fileTools,
    directory: directoryTools,
    fileManagement: fileManagementTools,
    command: commandTools,
    database: databaseTools,
    aiChat: [...aiChatTools, ...searchTools],
    aiDraw: aiDrawTools,
    flowGraph: [
      ...flowGraphTools,
      // 自动包含文档查询工具，让星序图 AI 能查询文档
      ...documentationTools.filter(t => [
        'explore_docs',
        'read_node_config_schema',
        'read_experience_documentation',
        'append_experience_documentation'
      ].includes(t.function.name))
    ],
    customModel: customModelTools,
    documentation: documentationTools,
    subApp: subAppTools,
    agent: agentTools,
    authorization: authorizationTools,
    timer: timerTools,
    email: emailTools,
    zhmm: zhmmTools
  }
  return groups[groupName] || []
}

/**
 * 根据名称获取工具定义
 */
export function getToolByName(name) {
  const allTools = getAllTools()
  return allTools.find(tool => tool.function.name === name)
}

/**
 * 获取工具分组
 */
export function getToolGroups() {
  return {
    file: {
      name: '文件操作',
      tools: fileTools
    },
    directory: {
      name: '目录操作',
      tools: directoryTools
    },
    fileManagement: {
      name: '文件管理',
      tools: fileManagementTools
    },
    command: {
      name: '命令执行',
      tools: commandTools
    },
    database: {
      name: '数据库查询',
      tools: databaseTools
    },
    aiChat: {
      name: 'AI对话/联网搜索',
      tools: [...aiChatTools, ...searchTools]
    },
    aiDraw: {
      name: 'AI画画',
      tools: aiDrawTools
    },
    flowGraph: {
      name: '星序图',
      tools: flowGraphTools
    },
    customModel: {
      name: '自定义AI模型',
      tools: customModelTools
    },
    documentation: {
      name: '文档查询',
      tools: documentationTools
    },
    subApp: {
      name: '子应用',
      tools: subAppTools
    },
    agent: {
      name: 'Agent管理',
      tools: agentTools
    },
    authorization: {
      name: '授权管理',
      tools: authorizationTools
    },
    timer: {
      name: '定时器',
      tools: timerTools
    },
    email: {
      name: '邮件',
      tools: emailTools
    },
    mockEmail: {
      name: '虚拟邮箱(测试)',
      tools: mockEmailTools
    },
    zhmm: {
      name: '个人信息检索',
      tools: zhmmTools
    }
  }
}

// 导出各类工具
export {
  fileTools,
  directoryTools,
  fileManagementTools,
  commandTools,
  databaseTools,
  aiChatTools,
  aiDrawTools,
  flowGraphTools,
  customModelTools,
  documentationTools,
  subAppTools,
  agentTools,
  searchTools,
  authorizationTools,
  timerTools,
  emailTools,
  mockEmailTools,
  zhmmTools
}
