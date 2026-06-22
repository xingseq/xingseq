/**
 * AI画画工具定义 - 允许AI调用生图API
 * @author Lioe Squieu
 * @created 2025-11-16
 */

export const aiDrawTools = [
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: '使用AI生成图片。支持腾讯混元生图API的多种模型和艺术风格。适用场景：根据用户描述创作图片、生成插画、设计素材等。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '图片描述提示词，详细描述想要生成的图片内容、风格、构图等。提示词越详细，生成的图片越准确。'
          },
          model: {
            type: 'string',
            enum: ['hunyuan-rapid', 'hunyuan-light', 'hunyuan-lite'],  // , 'hunyuan-async'
            description: '生图模型选择：\n- hunyuan-rapid: 精简版，支持30种艺术风格，速度快\n- hunyuan-light: 轻量版，支持27种艺术风格，质量高\n- hunyuan-lite: 极速版，支持5种基础风格，速度最快\n默认使用hunyuan-rapid' // \n- hunyuan-async: 异步版，支持18种风格，适合批量生成
          },
          style: {
            type: 'string',
            description: '艺术风格编号（可选）。不同模型支持不同风格：\n\nhunyuan-rapid支持的风格(30种)：\n1-宫崎骏风格, 2-新海诚风格, 3-水彩画, 4-像素艺术, 5-赛博朋克, 6-莫奈风格, 7-毕加索风格, 8-穆夏风格, 9-油画, 10-儿童绘本, 11-美式漫画, 12-扁平插画, 13-日系动漫, 14-中国古典, 15-剪纸艺术, 16-水墨画, 17-概念艺术, 18-波普艺术, 19-未来主义, 20-蒸汽朋克, 21-赛璐珞, 22-涂鸦艺术, 23-哥特风格, 24-梦幻风格, 25-极简主义, 26-巴洛克风格, 27-洛可可风格, 28-超现实主义, 29-抽象艺术, 30-立体主义\n\nhunyuan-light支持的风格(27种)：\n101-水墨画, 102-概念艺术, 103-油画, 104-水彩画, 105-像素风格, 106-印象派, 107-2.5D人像, 108-日系动漫, 109-唯美古风, 201-写实风格, 202-3D渲染, 203-卡通画, 204-素描, 301-黑白老照片, 302-黑白素描, 401-赛博朋克, 402-科幻风格, 501-暗黑风格, 502-洛丽塔风格, 601-未来主义, 603-蒸汽波, 701-低面建模, 702-像素风格, 801-插画风格, 802-日漫风格, 803-儿童绘本\n\nhunyuan-lite支持的风格(5种)：\n1-油画, 2-水彩画, 3-素描, 4-卡通, 5-写实\n\n留空表示使用默认风格' // hunyuan-async支持的风格(18种)：\n101-日漫动画风格, 102-水墨画, 103-莫奈油画风格, 104-儿童绘本插画, 105-3D渲染风格, 106-青花瓷, 107-赛博朋克, 108-2.5D头像, 109-唯美古风, 110-概念艺术, 111-像素艺术, 112-印象派, 113-波普艺术, 114-素描, 115-手绘, 116-扁平风插画, 117-黑白素描, 118-赛璐珞\n\n
          },
          resolution: {
            type: 'string',
            description: '图片分辨率，格式为"宽:高"（如"1024:1024"）。\n\n支持的固定分辨率(hunyuan-light)：\n- 768:768 (1:1正方形)\n- 768:1024 (3:4竖版)\n- 1024:768 (4:3横版)\n- 1024:1024 (1:1正方形)\n- 576:1024 (9:16竖版)\n- 1024:576 (16:9横版)\n- 720:1280 (9:16竖版)\n- 1280:720 (16:9横版)\n\n或使用自定义分辨率（需指定宽高比和边长）。默认为"1024:1024"' // 和hunyuan-async
          },
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
            description: '宽高比（可选）。用于动态计算分辨率。如果指定了固定resolution，则此参数无效。'
          },
          size: {
            type: 'number',
            description: '边长大小（可选），单位像素。配合aspect_ratio使用。\n支持的值：160, 200, 225, 256, 512, 520, 608, 768, 1024, 1080, 1280, 1600, 1620, 1920, 2048, 2400, 2560, 2592, 3440, 3840, 4096。\n默认1024'
          }
        },
        required: ['prompt']
      }
    }
  }
  // {
  //   type: 'function',
  //   function: {
  //     name: 'query_image_job',
  //     description: '查询异步生图任务的状态和结果。用于hunyuan-async模型提交任务后查询进度。',
  //     parameters: {
  //       type: 'object',
  //       properties: {
  //         job_id: {
  //           type: 'string',
  //           description: '任务ID，由generate_image返回（当使用hunyuan-async模型时）'
  //         }
  //       },
  //       required: ['job_id']
  //     }
  //   }
  // }
]
