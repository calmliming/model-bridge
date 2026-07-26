#!/usr/bin/env node
/**
 * 图片生成测试工具
 * 用法：node tools/test-image-gen.js [prompt]
 *
 * 需要：
 * 1. 后端服务运行在 localhost:3000
 * 2. 已创建 API Key（在管理后台）
 * 3. 已添加 OpenAI OAuth 账户
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配置
const API_BASE = process.env.MODEL_BRIDGE_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.MODEL_BRIDGE_API_KEY || 'YOUR_API_KEY_HERE';
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

// 默认提示词
const DEFAULT_PROMPT = 'A small orange cat sitting on a blue cushion, digital art style';

async function generateImage(prompt) {
  console.log('📸 开始生成图片...');
  console.log(`提示词: ${prompt}`);
  console.log('');

  const requestBody = {
    model: 'gpt-image-2',
    prompt: prompt,
    n: 1,
    size: '1024x1024',
    quality: 'standard',
    response_format: 'b64_json'
  };

  try {
    const response = await fetch(`${API_BASE}/v1/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ 图片生成成功！');
    console.log('');

    // 打印元数据
    if (result.usage) {
      console.log('📊 使用统计:');
      console.log(`  - 输入 tokens: ${result.usage.input_tokens || 0}`);
      console.log(`  - 输出 tokens: ${result.usage.output_tokens || 0}`);
      console.log(`  - 图片数量: ${result.usage.images || 1}`);
      console.log('');
    }

    // 保存图片
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

    result.data.forEach((item, index) => {
      const filename = `image_${timestamp}_${index + 1}.png`;
      const filepath = path.join(OUTPUT_DIR, filename);

      if (item.b64_json) {
        const imageBuffer = Buffer.from(item.b64_json, 'base64');
        fs.writeFileSync(filepath, imageBuffer);
        console.log(`💾 已保存: ${filepath}`);

        if (item.revised_prompt) {
          console.log(`   修订提示词: ${item.revised_prompt}`);
        }
      } else if (item.url) {
        console.log(`🔗 图片 URL: ${item.url}`);
      }
    });

    console.log('');
    console.log('🎉 完成！');

  } catch (error) {
    console.error('❌ 错误:', error.message);

    if (error.message.includes('fetch is not defined')) {
      console.error('');
      console.error('💡 提示: 需要 Node.js 18+ 或安装 node-fetch');
      console.error('   npm install node-fetch@2');
    }

    if (API_KEY === 'YOUR_API_KEY_HERE') {
      console.error('');
      console.error('💡 提示: 请设置环境变量或修改脚本中的 API_KEY');
      console.error('   export MODEL_BRIDGE_API_KEY="mb-xxxxx"');
    }

    process.exit(1);
  }
}

// 主函数
async function main() {
  const prompt = process.argv.slice(2).join(' ') || DEFAULT_PROMPT;

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Model Bridge - 图片生成测试工具');
  console.log('═══════════════════════════════════════════');
  console.log('');

  await generateImage(prompt);
}

main();
