/**
 * 文档工具定义 - 让AI读取和更新项目文档
 * @created 2026-01-10
 * @updated 2026-01-24 - 添加智能知识库查询工具
 */

export const documentationTools = [
  // ========== 文档探索工具 ==========
  {
    type: 'function',
    function: {
      name: 'explore_docs',
      description: `智能文档探索工具。在文档目录中查找和提取相关文档内容。
【适用场景】
- 查找项目功能的使用方法
- 了解某个功能如何实现
- 查询配置方法和参数说明
- 排查问题和故障诊断
- 查找最佳实践和示例代码

【作用域】
- 不指定 scope 时：查询主项目的 docs/ 目录
- 指定 scope 为子应用名时：查询该子应用的 doc/开发文档/ 目录
- 指定 scope 为子项目时：使用 "子项目/项目名" 格式，查询 docs/子项目/项目名/ 目录
- 指定 scope 为绝对路径时：直接在该目录下搜索文档

工具内部使用专门的文档探索 Agent，能够通过语义理解定位文档，返回精简、相关的内容片段。`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '查询内容，描述你想了解的功能、配置或问题。例如："循环节点怎么配置"、"AI对话工具如何使用"、"星序图执行失败怎么排查"'
          },
          scope: {
            type: 'string',
            description: `查询范围。可选值：
- 留空：查询主项目文档
- 子应用名称（如 "agent-manager"）：查询该子应用的文档
- 子项目格式（如 "子项目/AI博客" 或简写 "AI博客"）：查询 docs/子项目/项目名/ 目录
- 绝对路径（如 "/Users/.../docs"）：直接在该目录下搜索文档`
          },
          depth: {
            type: 'string',
            enum: ['shallow', 'normal', 'deep'],
            description: `探索深度，根据问题复杂度权衡选择：
- shallow: 浅层探索。快速浏览目录和标题，适合简单确认类问题（如"有没有XX文档"）
- normal: 常规探索（默认）。阅读相关文档并提取关键片段，适合大多数查询
- deep: 深度探索。跨文档关联分析，追溯引用链，适合复杂问题排查或需要全面理解的场景`
          }
        },
        required: ['query']
      }
    }
  },
 
  // ========== 原有文档工具 ==========
  {
    type: 'function',
    function: {
      name: 'read_flow_graph_documentation',
      description: '读取星序图设计规范文档。在创建星序图前调用此工具了解节点类型、配置规范、最佳实践和示例。',
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            enum: ['overview', 'node_types', 'usage', 'examples', 'best_practices', 'full'],
            description: `要读取的文档章节:
- overview: 概述和功能特性
- node_types: 所有支持的节点类型详细说明
- usage: 工具调用格式和参数说明
- examples: 实战示例（文本转图片、智能内容生产等）
- best_practices: 注意事项和最佳实践
- full: 完整文档（包含所有章节）`
          }
        },
        required: ['section']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_markdown_document',
      description: `读取指定的 Markdown 文档内容。支持使用 docs/error-handling.md#某章节 这种 doc_reference 格式读取指定章节，便于精确查看错误处理等细分文档。`,
      parameters: {
        type: 'object',
        properties: {
          doc_reference: {
            type: 'string',
            description: '文档引用，例如 "docs/error-handling.md#流程执行器的-ai-错误重试机制"，路径相对项目根目录。'
          },
          max_length: {
            type: 'number',
            description: '可选，限制返回内容的最大字符数，超出会被截断。'
          }
        },
        required: ['doc_reference']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_node_config_schema',
      description: '读取星序图节点配置的完整定义（flowNodes.json），包含每个节点的输入输出端口、默认配置等详细信息。',
      parameters: {
        type: 'object',
        properties: {
          nodeType: {
            type: 'string',
            description: '要查询的节点类型，如 textTemplateNode、aiChatNode 等。留空则返回所有节点配置。'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'append_experience_documentation',
      description: '向经验文档追加使用经验、最佳实践或问题解决方案。用于积累和总结AI使用过程中的经验教训。',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['flow_graph', 'ai_chat', 'tools', 'troubleshooting', 'best_practices', 'general'],
            description: `经验分类:
- flow_graph: 星序图相关经验
- ai_chat: AI对话相关经验
- tools: 工具使用经验
- troubleshooting: 问题排查经验
- best_practices: 最佳实践
- general: 通用经验`
          },
          title: {
            type: 'string',
            description: '经验标题，简洁描述经验要点'
          },
          content: {
            type: 'string',
            description: '经验内容详情，支持Markdown格式'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '相关标签，便于后续检索'
          }
        },
        required: ['category', 'title', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_experience_documentation',
      description: '读取已积累的使用经验文档，可按分类或关键词检索。',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['flow_graph', 'ai_chat', 'tools', 'troubleshooting', 'best_practices', 'general', 'all'],
            description: '要读取的经验分类，选择 all 读取全部'
          },
          keyword: {
            type: 'string',
            description: '搜索关键词，可选'
          }
        },
        required: ['category']
      }
    }
  }
];
