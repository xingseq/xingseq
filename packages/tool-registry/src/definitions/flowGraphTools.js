/**
 * 星序图工具定义 - 允许AI创建和执行星序图
 * @author Lioe Squieu
 * @created 2025-11-16
 */

export const flowGraphTools = [
  {
    type: 'function',
    function: {
      name: 'list_available_flow_nodes',
      description: '查询可用于星序图的节点类型列表。在创建星序图之前，应先调用此工具了解有哪些可用的节点类型。返回所有节点类型（如输入、输出、AI对话、自定义模型等），以及可用于 customModelNode 的自定义AI模型列表。',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: '按分类筛选节点（可选）。可选值："基础"、"AI"、"数据处理"、"控制流"'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_mixed_flow_graph',
      description: '创建混合类型星序图，支持串联多种不同类型的节点。【重要】需要显式添加 inputNode 和 outputNode 作为星序图的入口和出口，系统不会自动添加。如果星序图作为子流程使用，可以省略 inputNode/outputNode，执行引擎会自动处理入口和出口。适用场景：复杂的多步骤处理流程，需要组合不同类型的AI能力。注意：创建前应先调用 list_available_flow_nodes 了解可用的节点类型。',
      parameters: {
        type: 'object',
        properties: {
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['inputNode', 'customModelNode', 'aiDrawToolNode', 'aiChatNode', 'imageResultProcessorNode', 'imageDisplayNode', 'filterNode', 'transformNode', 'mergeTextNode', 'delayNode', 'toolCallNode', 'fileToolNode', 'directoryToolNode', 'databaseToolNode', 'commandToolNode', 'conditionNode', 'switchNode', 'aggregateNode', 'textTemplateNode', 'codeNode', 'httpRequestNode', 'webSearchNode', 'contextSetNode', 'contextGetNode', 'subFlowNode', 'loopControlNode', 'forEachNode', 'outputNode'],
                  description: '节点类型。【重要】需要显式添加 inputNode(入口) 和 outputNode(出口)。AI节点：customModelNode(自定义AI模型,需modelId)、aiChatNode(AI对话)、aiDrawToolNode(AI绘图)、webSearchNode(联网搜索)。数据处理：filterNode(过滤)、transformNode(转换)、mergeTextNode(合并文本)、textTemplateNode(模板,config.template支持{{input}}占位符)、codeNode(JS代码处理节点,【❌常见错误】禁止写input1/input2变量名,会报错未定义!禁止硬编码固定文本!【✅正确写法】用input变量获取主输入(=inputs.input1),多输入用inputs.input2;必须处理上游数据!示例:return `处理:${input}`;错误示例:return "固定文本"或const x=input1;)、aggregateNode(聚合多输入)。上下文共享：contextSetNode(写入,config.key指定键名)、contextGetNode(读取,config.key指定键名)。控制流：conditionNode(条件分支,config.conditionDescription)、switchNode(多路分支,config.cases数组含output和description)、loopControlNode(【⚠️仅用于重试/条件循环,不是数组遍历器!】config.maxIterations最大次数,输出端口loop/exit【exit必须连接!】【❌严重错误:在codeNode中用inputs._context访问循环状态是错的!_context只在配置contextBindings.read时才存在】)、forEachNode(【✅遍历数组请用这个!】config.subGraphId指定子流程,自动遍历数组每个元素调用子流程,config.ignoreErrors可选)、delayNode(延时)、subFlowNode(子流程,config.graphId指定要执行的星序图ID,config.maxIterations限制最大迭代次数)。工具调用：fileToolNode(文件)、directoryToolNode(目录)、databaseToolNode(数据库)、commandToolNode(命令)、toolCallNode(通用工具,【⚠️模板语法限制】只支持{{input}}或{{input.xxx}}!❌禁止{{inputs.input1.xxx}}!❌禁止{{input.arr[0]}}!【⚠️字段名必须完全匹配】如上游输出targetGroupId则必须用{{input.targetGroupId}}而不是{{input.targetGroup}})。图片：imageResultProcessorNode(处理结果)、imageDisplayNode(显示)。注意：所有节点都可在config中配置contextBindings实现跨分支状态共享'
                },
                label: {
                  type: 'string',
                  description: '节点标签（可选），用于标识节点功能'
                },
                modelId: {
                  type: 'string',
                  description: '自定义模型ID（仅当type为customModelNode时需要）'
                },
                config: {
                  type: 'object',
                  description: '节点配置。常用配置：customModelNode无需额外config；aiChatNode可配systemPrompt/temperature；aiDrawToolNode配toolName/toolArgs；textTemplateNode配template(如"结果:{{input}}")；【codeNode配置-请严格遵守】config.code中可用变量:input(主输入,不是input1!)、inputs.input2(第二输入,不是input2!)、parseJSON(解析函数)、crypto(加密模块,如crypto.createHash)、path(路径模块)、Buffer(缓冲区)、readFileStream(受限的文件流读取,只读,限制在项目目录内)。【❌错误示例会导致流程执行失败】{code:"const x=input1;return x;"}(input1未定义)、{code:"return \"固定结果\";"}(硬编码,数据流中断)。【✅正确示例】{code:"return `处理:${input}`;"}、{code:"const a=inputs.input1;const b=inputs.input2;return a+b;"}、{code:"return input.map(x=>x.id);"}。【⚠️输入数据类型处理-极易出错】输入可能是字符串或对象,必须防御性处理!❌错误:const name=inputs.input1;(如果是对象会变成[object Object])。✅正确:const name=(typeof inputs.input1==="object"&&inputs.input1?.targetGroup)?inputs.input1.targetGroup:(inputs.input1||"");【⚠️工具调用结果处理】不要假设固定结构!❌错误:if(result.success&&result.data)。✅正确:const data=result?.data||result?.graphs||result;兼容多种返回格式；conditionNode配conditionDescription(自然语言条件)；switchNode配{cases:[{output:"分支1",description:"条件描述"}]}；contextSetNode/contextGetNode配{key:"数据键名"}。跨分支共享可用contextBindings:{read:["要读取的key"],write:{"目标key":"输出字段名"}}，read指定的key会注入到inputs._context，write会将指定输出字段存入共享状态'
                }
              },
              required: ['type']
            },
            description: '节点配置列表，按执行顺序排列。【重要】第一个节点应为 inputNode，最后一个节点应为 outputNode。例如：[{type: "inputNode", label: "输入"}, {type: "customModelNode", modelId: "model-1", label: "文本处理"}, {type: "aiDrawToolNode", label: "生成图片"}, {type: "outputNode", label: "输出"}]'
          },
          name: {
            type: 'string',
            description: '星序图名称（可选）。默认为"混合处理流程"'
          },
          description: {
            type: 'string',
            description: '星序图描述（可选）。说明星序图的用途、使用方法、注意事项等'
          },
          initial_input: {
            type: 'string',
            description: '初始输入值（可选）。设置输入节点的默认值'
          },
          group_id: {
            type: 'string',
            description: '分组ID（可选）。创建时直接归入指定分组，避免后续移动操作'
          }
        },
        required: ['nodes']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_linear_flow_graph',
      description: '创建线性星序图，将多个AI自定义模型节点串联起来。适用场景：多步骤处理流程（如文本处理流水线、内容优化流程等）。每个节点的输出会作为下一个节点的输入。注意：创建前应先调用 list_available_flow_nodes 获取可用的模型ID列表。',
      parameters: {
        type: 'object',
        properties: {
          model_ids: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: '自定义模型ID列表，按执行顺序排列。每个ID对应一个自定义AI模型配置。例如：["model-summary", "model-polish", "model-translate"]'
          },
          labels: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: '节点标签列表（可选），与model_ids一一对应。用于标识每个节点的功能。例如：["总结", "润色", "翻译"]'
          },
          name: {
            type: 'string',
            description: '星序图名称（可选）。默认为"线性AI处理流程"'
          },
          description: {
            type: 'string',
            description: '星序图描述（可选）。说明星序图的用途、使用方法、注意事项等'
          },
          initial_input: {
            type: 'string',
            description: '初始输入值（可选）。设置输入节点的默认值'
          },
          group_id: {
            type: 'string',
            description: '分组ID（可选）。创建时直接归入指定分组，避免后续移动操作'
          }
        },
        required: ['model_ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_parallel_flow_graph',
      description: '创建并行星序图，多个AI模型节点同时处理同一输入，各自独立输出。适用场景：同一内容需要多种不同处理（如翻译成多种语言、多角度分析、A/B测试等）。',
      parameters: {
        type: 'object',
        properties: {
          model_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '自定义模型ID列表，每个模型将并行处理输入。例如：["translator-en", "translator-jp", "translator-kr"]'
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: '节点标签列表（可选），与model_ids一一对应。例如：["英译", "日译", "韩译"]'
          },
          name: {
            type: 'string',
            description: '星序图名称（可选）。默认为"并行AI处理流程"'
          },
          description: {
            type: 'string',
            description: '星序图描述（可选）。说明星序图的用途、使用方法、注意事项等'
          },
          initial_input: {
            type: 'string',
            description: '初始输入值（可选）'
          },
          group_id: {
            type: 'string',
            description: '分组ID（可选）。创建时直接归入指定分组，避免后续移动操作'
          }
        },
        required: ['model_ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_tree_flow_graph',
      description: '创建树形/分支星序图，输入分发到多个分支，每个分支可以有多个串联节点。适用场景：分治处理（如将任务拆分给不同专业模型处理）、对比实验（不同处理流程对比）。',
      parameters: {
        type: 'object',
        properties: {
          branch_count: {
            type: 'number',
            description: '分支数量。例如：3 表示3个并行分支'
          },
          models_per_branch: {
            type: 'number',
            description: '每个分支的AI模型节点数量。例如：2 表示每个分支串联2个模型'
          },
          model_ids: {
            type: 'array',
            items: {
              type: 'array',
              items: { type: 'string' }
            },
            description: '二维数组，每个分支的模型ID列表。例如：[["summary", "polish"], ["translate", "review"]]'
          },
          labels: {
            type: 'array',
            items: {
              type: 'array',
              items: { type: 'string' }
            },
            description: '二维数组，每个分支的节点标签（可选）。例如：[["总结", "润色"], ["翻译", "审校"]]'
          },
          name: {
            type: 'string',
            description: '星序图名称（可选）。默认为"树形AI处理流程"'
          },
          description: {
            type: 'string',
            description: '星序图描述（可选）。说明星序图的用途、使用方法、注意事项等'
          },
          initial_input: {
            type: 'string',
            description: '初始输入值（可选）'
          },
          group_id: {
            type: 'string',
            description: '分组ID（可选）。创建时直接归入指定分组，避免后续移动操作'
          }
        },
        required: ['branch_count', 'models_per_branch']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_custom_flow_graph',
      description: '创建完全自定义的星序图，可以定义任意节点和连接关系。这是最灵活的星序图创建方式，支持复杂的分支、合并、循环等结构。【重要】需要显式添加 inputNode 和 outputNode 作为星序图的入口和出口，系统不会自动添加。如果星序图作为子流程使用，可以省略 inputNode/outputNode，执行引擎会自动处理入口和出口。',
      parameters: {
        type: 'object',
        properties: {
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '节点唯一标识符' },
                type: {
                  type: 'string',
                  enum: ['inputNode', 'outputNode', 'customModelNode', 'aiChatNode', 'aiDrawToolNode', 'imageResultProcessorNode', 'imageDisplayNode', 'filterNode', 'transformNode', 'mergeTextNode', 'delayNode', 'toolCallNode', 'fileToolNode', 'directoryToolNode', 'databaseToolNode', 'commandToolNode', 'conditionNode', 'switchNode', 'aggregateNode', 'textTemplateNode', 'codeNode', 'httpRequestNode', 'webSearchNode', 'contextSetNode', 'contextGetNode', 'subFlowNode', 'loopControlNode', 'forEachNode'],
                  description: '节点类型。【重要】需要显式添加 inputNode(入口) 和 outputNode(出口)，子流程可省略。subFlowNode(子流程,config.graphId指定星序图ID,config.maxIterations限制迭代次数)；loopControlNode(【⚠️仅用于重试/条件循环,不是数组遍历器!】config.maxIterations最大次数,输出端口loop/exit【exit必须连接!】【❌inputs._context访问循环状态是错的!只在配置contextBindings.read时才存在】)；forEachNode(【✅遍历数组请用这个!】config.subGraphId指定子流程,自动遍历数组每个元素调用子流程,config.ignoreErrors可选)；toolCallNode(工具调用,【⚠️模板语法限制】只支持{{input}}或{{input.xxx}}格式!❌禁止{{inputs.input1.xxx}}!❌禁止{{input.arr[0]}}!【⚠️字段名必须完全匹配】如上游输出targetGroupId则必须用{{input.targetGroupId}}而不是{{input.targetGroup}})；contextSetNode(写入共享数据,config.key)/contextGetNode(读取共享数据,config.key)用于跨分支数据共享；codeNode(JS代码节点,【重要】代码中用input获取主输入=inputs.input1,多输入用inputs.input2;禁止硬编码!)。所有节点都可在config中配置contextBindings实现跨分支状态共享'
                },
                x: { type: 'number', description: '节点X坐标' },
                y: { type: 'number', description: '节点Y坐标' },
                label: { type: 'string', description: '节点标签（可选）' },
                modelId: { type: 'string', description: '模型ID（仅customModelNode需要）' },
                value: { type: 'string', description: '默认值（仅inputNode使用）' },
                config: { type: 'object', description: '节点配置。contextSetNode/contextGetNode需配{key:"数据键"}；【codeNode说明-常见错误】不能写input1/input2变量名(会报错未定义)！config.code可用变量:input(主输入,不是input1)、inputs.input1、inputs.input2、parseJSON。【错误示例】{code:"const x=input1"}报错、{code:"return \"固定值\""}数据流中断。【正确示例】{code:"return `结果:${input}`"}、{code:"return inputs.input1+inputs.input2"}。【⚠️输入数据类型-极易出错】输入可能是对象!❌错误:const name=inputs.input1(对象会变[object Object])。✅正确:const name=(typeof inputs.input1==="object")?inputs.input1.targetGroup||inputs.input1.name||"":inputs.input1;【⚠️工具结果处理】不假设固定结构!const data=result?.data||result?.graphs||result；conditionNode配conditionDescription；switchNode配cases数组。跨分支共享用contextBindings:{read:["key"],write:{"目标key":"输出字段"}}' }
              },
              required: ['id', 'type', 'x', 'y']
            },
            description: '节点配置列表'
          },
          connections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string', description: '源节点ID' },
                target: { type: 'string', description: '目标节点ID' },
                sourceHandle: { type: 'string', description: '源节点输出端口（如value、response、output、result等）' },
                targetHandle: { type: 'string', description: '目标节点输入端口。单输入节点用 input；多输入节点用 input1/input2/input3（如 codeNode, textTemplateNode, mergeTextNode, aggregateNode）' }
              },
              required: ['source', 'target']
            },
            description: '连接配置列表，定义节点间的数据流向'
          },
          name: {
            type: 'string',
            description: '星序图名称（可选）。默认为"自定义星序图"'
          },
          description: {
            type: 'string',
            description: '星序图描述（可选）。说明星序图的用途、使用方法、注意事项等'
          },
          initial_input: {
            type: 'string',
            description: '初始输入值（可选）。设置 inputNode 的默认值，优先级高于节点配置中的 value'
          },
          group_id: {
            type: 'string',
            description: '分组ID（可选）。创建时直接归入指定分组，避免后续移动操作'
          }
        },
        required: ['nodes', 'connections']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_flow_graph',
      description: '执行指定的星序图。支持通过星序图ID或名称查找星序图。星序图会按照节点连接关系依次执行，最终返回所有输出节点的结果。',
      parameters: {
        type: 'object',
        properties: {
          graph_id: {
            type: 'string',
            description: '星序图ID或名称。可以传入星序图的唯一ID（如"graph-1771252633277"），也可以传入星序图的名称（如"递归任务分解器"）进行查找'
          },
          input_data: {
            type: 'string',
            description: '输入数据（可选）。如果提供，会注入到星序图的输入节点中'
          }
        },
        required: ['graph_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_flow_graph',
      description: '删除指定的星序图。支持通过星序图ID或名称查找星序图。注意：此操作不可撤销，删除后星序图数据将无法恢复。',
      parameters: {
        type: 'object',
        properties: {
          graph_id: {
            type: 'string',
            description: '要删除的星序图ID或名称'
          }
        },
        required: ['graph_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_flow_graphs',
      description: '获取已保存的星序图列表（按更新时间倒序）。返回每个星序图的ID、名称、分组ID和创建/更新时间。可用于查看已有星序图或获取星序图ID以便执行或删除。⚠️ 安全提示：删除操作前必须明确指定 group_id="ungrouped" 获取未分组星序图，避免误删所有星序图。⚠️ 性能提示：不传 group_id 时默认仅返回最近更新的 20 条（total/truncated 字段会标记是否截断），如需精准发现/复用请优先使用 search_similar_flow_graphs。返回数据结构：{count, total, truncated, graphs: [{id, name, description, group_id, created_at, updated_at}], filter, hint?, message}',
      parameters: {
        type: 'object',
        properties: {
          group_id: {
            type: 'string',
            description: '可选的分组ID过滤。传 "ungrouped" 获取未分组的星序图，传具体分组ID获取该分组内的星序图，不传则获取所有星序图。⚠️ 删除场景必须明确指定 group_id，避免误删'
          },
          limit: {
            type: 'number',
            description: '可选，返回结果数量上限。不传 group_id 时默认 20；显式传入则覆盖默认（最大 100）。'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_flow_graph',
      description: '根据ID或名称获取星序图详情。支持两种查找方式：1) 通过星序图ID（如"graph-1771252633277"）；2) 通过星序图名称（如"递归任务分解器"）。返回星序图的完整信息，包括节点、连接线和元数据。优先按ID查找，未找到时自动按名称查找。',
      parameters: {
        type: 'object',
        properties: {
          graph_id: {
            type: 'string',
            description: '星序图ID或名称。可以传入星序图的唯一ID（如"graph-1771252633277"），也可以传入星序图的名称（如"递归任务分解器"）进行查找'
          }
        },
        required: ['graph_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_similar_flow_graphs',
      description: '根据任务描述搜索相似的可复用星序图。在规划子任务后，可以使用此工具查找之前完成过的类似任务的星序图，实现复用而不是每次都从头设计。返回匹配的星序图列表及相似度分数。',
      parameters: {
        type: 'object',
        properties: {
          task_description: {
            type: 'string',
            description: '任务描述，用于搜索相似的星序图。例如："写一首诗"、"数据处理和转换"、"文件备份"'
          },
          limit: {
            type: 'number',
            description: '返回结果数量限制（可选），默认为5'
          },
          min_score: {
            type: 'number',
            description: '最低相似度分数（可选），范围0-1，默认为0.3。低于此分数的结果不会返回'
          }
        },
        required: ['task_description']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_flow_graph',
      description: '更新已有星序图。支持通过星序图ID或名称查找星序图。支持两种更新模式：1) 整体替换：提供完整的 nodes/edges 数组替换原有数据；2) 节点级更新：通过 node_updates 按节点ID更新特定节点的内容，无需获取和传递整个星序图。',
      parameters: {
        type: 'object',
        properties: {
          graph_id: {
            type: 'string',
            description: '要更新的星序图ID或名称'
          },
          name: {
            type: 'string',
            description: '新的星序图名称（可选）'
          },
          description: {
            type: 'string',
            description: '新的星序图描述（可选）'
          },
          nodes: {
            type: 'array',
            description: '新的节点配置列表（可选）。如果提供，将替换原有所有节点。与 node_updates 互斥'
          },
          edges: {
            type: 'array',
            description: '新的连接线配置列表（可选）。如果提供，将替换原有连接线'
          },
          node_updates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                node_id: {
                  type: 'string',
                  description: '要更新的节点ID'
                },
                label: {
                  type: 'string',
                  description: '新的节点标签（可选）'
                },
                config: {
                  type: 'object',
                  description: '节点配置更新（可选）。会与现有配置合并，可更新 systemPrompt、temperature、template、code、conditionDescription 等'
                },
                data: {
                  type: 'object',
                  description: '节点数据更新（可选）。会与现有数据合并'
                }
              },
              required: ['node_id']
            },
            description: '节点级更新列表（可选）。按节点ID更新特定节点的内容，无需传递完整节点数组。与 nodes 参数互斥'
          },
          metadata: {
            type: 'object',
            description: '新的元数据（可选）'
          }
        },
        required: ['graph_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'duplicate_flow_graph',
      description: '复制星序图。支持通过星序图ID或名称查找星序图。创建一个已有星序图的副本，可以指定新名称。',
      parameters: {
        type: 'object',
        properties: {
          graph_id: {
            type: 'string',
            description: '要复制的星序图ID或名称'
          },
          new_name: {
            type: 'string',
            description: '副本的名称（可选）。默认为"原名称 (副本)"'
          }
        },
        required: ['graph_id']
      }
    }
  },
  // ==================== 执行记录工具 ====================
  {
    type: 'function',
    function: {
      name: 'get_execution_history',
      description: '获取星序图的执行记录，支持分层返回以优化信息获取效率。三层信息架构：1) metadata - 元数据层（执行概况，轻量快速）；2) summary - 结构化摘要（错误/性能/数据流摘要，默认，平衡）；3) full - 原始日志（完整数据，向后兼容）。推荐先用 metadata 或 summary 级别快速了解执行情况，再按需获取详细信息。',
      parameters: {
        type: 'object',
        properties: {
          execution_id: {
            type: 'string',
            description: '执行记录ID（由 execute_flow_graph 工具返回的 execution_id）。如果提供，将返回该次执行的详情'
          },
          graph_id: {
            type: 'string',
            description: '星序图ID（可选）。如果提供，将返回该星序图的所有执行记录列表'
          },
          detail_level: {
            type: 'string',
            enum: ['metadata', 'summary', 'full'],
            description: '详细级别（可选）。metadata=仅元数据（执行状态、耗时、节点统计）；summary=元数据+结构化摘要（默认，包含错误和性能分析）；full=完整数据（向后兼容，包含原始日志）'
          },
          include_summaries: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['errors', 'performance', 'data_flow']
            },
            description: '要包含的摘要类型（可选，仅 summary/full 级别生效）。errors=错误摘要（节点错误聚合、错误类型分析）；performance=性能摘要（慢节点排名、循环统计）；data_flow=数据流摘要（输入输出预览、关键节点追踪）'
          },
          log_filter: {
            type: 'object',
            description: '日志过滤条件（可选，仅 full 级别生效）',
            properties: {
              levels: {
                type: 'array',
                items: { type: 'string' },
                description: '日志级别过滤，如 ["error", "warning"]'
              },
              node_ids: {
                type: 'array',
                items: { type: 'string' },
                description: '只返回特定节点的日志'
              },
              limit: {
                type: 'number',
                description: '最多返回多少条日志，默认100'
              }
            }
          },
          limit: {
            type: 'number',
            description: '返回记录数量限制（可选）。默认返回最近20条记录'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_node_execution_detail',
      description: '获取指定节点在某次执行中的详细信息。当需要深入分析特定节点的执行情况时使用，返回该节点的输入、输出、执行日志和耗时。适用场景：定位具体节点的问题、查看节点的数据转换细节。',
      parameters: {
        type: 'object',
        properties: {
          execution_id: {
            type: 'string',
            description: '执行记录ID（必填）'
          },
          node_id: {
            type: 'string',
            description: '节点ID（必填）'
          }
        },
        required: ['execution_id', 'node_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'filter_execution_logs',
      description: '按条件过滤执行日志，获取日志的子集。当只需要查看特定类型的日志（如错误日志）或特定节点的日志时使用，避免返回大量无关日志。',
      parameters: {
        type: 'object',
        properties: {
          execution_id: {
            type: 'string',
            description: '执行记录ID（必填）'
          },
          levels: {
            type: 'array',
            items: { type: 'string' },
            description: '日志级别过滤（可选），如 ["error", "warning", "info"]'
          },
          node_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '节点ID过滤（可选），只返回指定节点的日志'
          },
          keyword: {
            type: 'string',
            description: '关键词搜索（可选），在日志内容中搜索'
          },
          limit: {
            type: 'number',
            description: '返回数量限制（可选），默认100条'
          }
        },
        required: ['execution_id']
      }
    }
  },
  // ==================== 分组管理工具 ====================
  {
    type: 'function',
    function: {
      name: 'create_flow_graph_group',
      description: '创建星序图分组。用于将相关的星序图组织在一起，便于管理和查找。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '分组名称（必填）'
          },
          description: {
            type: 'string',
            description: '分组描述（可选）。说明该分组的用途、包含的星序图类型等'
          },
          color: {
            type: 'string',
            description: '分组颜色（可选）。十六进制颜色代码，如 "#6366f1"、"#10b981"、"#f59e0b" 等。默认为 "#6366f1"'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_flow_graph_group',
      description: '更新星序图分组信息。可修改分组名称、描述、颜色等。',
      parameters: {
        type: 'object',
        properties: {
          group_id: {
            type: 'string',
            description: '分组ID'
          },
          name: {
            type: 'string',
            description: '新的分组名称（可选）'
          },
          description: {
            type: 'string',
            description: '新的分组描述（可选）'
          },
          color: {
            type: 'string',
            description: '新的分组颜色（可选）'
          }
        },
        required: ['group_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_flow_graph_group',
      description: '删除星序图分组。可选择是否同时删除分组内的星序图。',
      parameters: {
        type: 'object',
        properties: {
          group_id: {
            type: 'string',
            description: '要删除的分组ID'
          },
          delete_graphs: {
            type: 'boolean',
            description: '是否同时删除分组内的星序图。默认为 false（只将星序图移出分组，不删除）'
          }
        },
        required: ['group_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_flow_graph_groups',
      description: '获取所有星序图分组列表。返回每个分组的基本信息和包含的星序图数量（但不包含具体星序图ID列表）。返回数据结构：{groups: [{id, name, description, color, graph_count, created_at, updated_at}], count, message}。注意：若需获取未分组的星序图，请使用 list_flow_graphs 工具并传入 group_id="ungrouped" 参数。',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_flow_graph_group',
      description: '获取分组详情，包括分组信息和包含的星序图数量。',
      parameters: {
        type: 'object',
        properties: {
          group_id: {
            type: 'string',
            description: '分组ID'
          }
        },
        required: ['group_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_flow_graph_to_group',
      description: '将星序图移动到指定分组。也可以将星序图移出分组（设置 group_id 为 null）。',
      parameters: {
        type: 'object',
        properties: {
          graph_id: {
            type: 'string',
            description: '星序图ID'
          },
          group_id: {
            type: 'string',
            description: '目标分组ID。传 null 或空字符串表示移出分组'
          }
        },
        required: ['graph_id']
      }
    }
  }
]
