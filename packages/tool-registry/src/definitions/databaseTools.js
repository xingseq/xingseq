/**
 * 数据库工具定义
 * @author Lioe Squieu
 * @created 2025-11-09
 */

/**
 * 数据库工具
 */
export const databaseTools = [
  {
    type: 'function',
    function: {
      name: 'query_database',
      description: '执行安全的数据库查询操作（仅限SELECT语句）。用于查询项目、对话、模型等数据',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'SQL查询语句（仅支持SELECT）'
          },
          database: {
            type: 'string',
            description: '数据库名称，可选值：conversations（对话数据库）、main（主数据库），默认为main',
            enum: ['conversations', 'main'],
            default: 'main'
          },
          params: {
            type: 'array',
            items: { type: 'string' },
            description: '查询参数数组，用于参数化查询（可选）'
          },
          limit: {
            type: 'integer',
            description: '返回结果的最大数量，默认为50，最大不超过500',
            default: 50
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_table_schema',
      description: '获取数据库表的结构信息，包括字段名、类型等',
      parameters: {
        type: 'object',
        properties: {
          table_name: {
            type: 'string',
            description: '表名称'
          },
          database: {
            type: 'string',
            description: '数据库名称，可选值：conversations、main，默认为main',
            enum: ['conversations', 'main'],
            default: 'main'
          }
        },
        required: ['table_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_database_tables',
      description: '列出指定数据库中的所有表名',
      parameters: {
        type: 'object',
        properties: {
          database: {
            type: 'string',
            description: '数据库名称，可选值：conversations、main，默认为main',
            enum: ['conversations', 'main'],
            default: 'main'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_conversations',
      description: '查询对话历史记录，可按项目ID、时间范围等条件筛选',
      parameters: {
        type: 'object',
        properties: {
          project_id: {
            type: 'string',
            description: '项目ID，用于筛选特定项目的对话（可选）'
          },
          start_date: {
            type: 'string',
            description: '开始时间，格式：YYYY-MM-DD（可选）'
          },
          end_date: {
            type: 'string',
            description: '结束时间，格式：YYYY-MM-DD（可选）'
          },
          keyword: {
            type: 'string',
            description: '搜索关键词，在标题中搜索（可选）'
          },
          limit: {
            type: 'integer',
            description: '返回结果的最大数量，默认为20',
            default: 20
          },
          offset: {
            type: 'integer',
            description: '分页偏移量，默认为0',
            default: 0
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_conversation_detail',
      description: '获取指定对话的详细内容，包括完整的消息记录',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'string',
            description: '对话ID'
          },
          include_messages: {
            type: 'boolean',
            description: '是否包含消息详情，默认为true',
            default: true
          }
        },
        required: ['conversation_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_projects',
      description: '查询项目列表，可按名称、类型等筛选',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '搜索关键词，在项目名称和描述中搜索（可选）'
          },
          type: {
            type: 'string',
            description: '项目类型筛选（可选）'
          },
          limit: {
            type: 'integer',
            description: '返回结果的最大数量，默认为50',
            default: 50
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_statistics',
      description: '查询统计信息，如对话数量、项目数量、使用情况等',
      parameters: {
        type: 'object',
        properties: {
          stat_type: {
            type: 'string',
            description: '统计类型：conversation_count（对话数量）、project_count（项目数量）、daily_usage（每日使用量）',
            enum: ['conversation_count', 'project_count', 'daily_usage']
          },
          project_id: {
            type: 'string',
            description: '项目ID，用于获取特定项目的统计（可选）'
          },
          date_range: {
            type: 'integer',
            description: '日期范围（天数），默认为30天',
            default: 30
          }
        },
        required: ['stat_type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'insert_record',
      description: '向数据库表中插入新记录。支持插入单条或多条记录',
      parameters: {
        type: 'object',
        properties: {
          table_name: {
            type: 'string',
            description: '表名称'
          },
          database: {
            type: 'string',
            description: '数据库名称，可选值：conversations、main，默认为main',
            enum: ['conversations', 'main'],
            default: 'main'
          },
          data: {
            type: 'object',
            description: '要插入的数据，键为字段名，值为字段值。例如：{"name": "项目1", "type": "demo"}'
          },
          batch_data: {
            type: 'array',
            items: { type: 'object' },
            description: '批量插入的数据数组，每个元素是一个包含字段名和值的对象（可选）'
          }
        },
        required: ['table_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_record',
      description: '更新数据库表中的记录。可根据条件更新一条或多条记录',
      parameters: {
        type: 'object',
        properties: {
          table_name: {
            type: 'string',
            description: '表名称'
          },
          database: {
            type: 'string',
            description: '数据库名称，可选值：conversations、main，默认为main',
            enum: ['conversations', 'main'],
            default: 'main'
          },
          data: {
            type: 'object',
            description: '要更新的数据，键为字段名，值为新的字段值'
          },
          where: {
            type: 'object',
            description: '更新条件，键为字段名，值为匹配值。例如：{"id": "123"}'
          },
          where_clause: {
            type: 'string',
            description: '自定义WHERE子句（可选），如："id > 100 AND name LIKE \'%test%\'"'
          }
        },
        required: ['table_name', 'data']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_record',
      description: '删除数据库表中的记录。注意：这是物理删除，数据将无法恢复',
      parameters: {
        type: 'object',
        properties: {
          table_name: {
            type: 'string',
            description: '表名称'
          },
          database: {
            type: 'string',
            description: '数据库名称，可选值：conversations、main，默认为main',
            enum: ['conversations', 'main'],
            default: 'main'
          },
          where: {
            type: 'object',
            description: '删除条件，键为字段名，值为匹配值。例如：{"id": "123"}'
          },
          where_clause: {
            type: 'string',
            description: '自定义WHERE子句（可选），如："id > 100"'
          }
        },
        required: ['table_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_table',
      description: '创建新的数据库表。支持定义字段、类型、约束等',
      parameters: {
        type: 'object',
        properties: {
          table_name: {
            type: 'string',
            description: '表名称'
          },
          database: {
            type: 'string',
            description: '数据库名称，可选值：conversations、main，默认为main',
            enum: ['conversations', 'main'],
            default: 'main'
          },
          columns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: '字段名'
                },
                type: {
                  type: 'string',
                  description: '字段类型，如：TEXT, INTEGER, REAL, BLOB等'
                },
                constraints: {
                  type: 'string',
                  description: '字段约束，如：PRIMARY KEY, NOT NULL, UNIQUE, DEFAULT value等（可选）'
                }
              },
              required: ['name', 'type']
            },
            description: '表字段定义数组'
          },
          if_not_exists: {
            type: 'boolean',
            description: '如果表已存在是否跳过创建，默认为true',
            default: true
          }
        },
        required: ['table_name', 'columns']
      }
    }
  }
]
