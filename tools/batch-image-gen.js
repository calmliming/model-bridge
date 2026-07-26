#!/usr/bin/env node
/**
 * 批量图片生成工具
 * 用法：node tools/batch-image-gen.js prompts.txt
 *
 * prompts.txt 格式：每行一个提示词
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配置
const API_BASE = process.env.MODEL_BRIDGE_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.MODEL_BRIDGE_API_KEY || 'YOUR_API_KEY_HERE';
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const CONCURRENT_LIMIT = 3; // 并发数量
const DELAY_MS = 1000; // 请求间延迟（毫秒）

// 睡眠函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function generateImage(prompt, index) {
  const requestBody = {
    model: 'gpt-image-2',
    prompt: prompt,
    n: 1,
    size: '1024x1024',
    quality: 'standard',
    response_format: 'b64_json'
  };

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

  return await response.json();
}

async function processBatch(prompts) {
  console.log(`📋 共 ${prompts.length} 个任务`);
  console.log(`⚙️  并发数: ${CONCURRENT_LIMIT}`);
  console.log(`⏱️  延迟: ${DELAY_MS}ms`);
  console.log('');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const results = {
    success: 0,
    failed: 0,
    total: prompts.length
  };

  for (let i = 0; i < prompts.length; i += CONCURRENT_LIMIT) {
    const batch = prompts.slice(i, i + CONCURRENT_LIMIT);
    const batchPromises = batch.map(async (prompt, batchIndex) => {
      const globalIndex = i + batchIndex;
      const taskNum = globalIndex + 1;

      try {
        console.log(`[${taskNum}/${prompts.length}] 处理中: ${prompt.substring(0, 50)}...`);

        const result = await generateImage(prompt, globalIndex);

        // 保存图片
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `batch_${timestamp}_${String(taskNum).padStart(3, '0')}.png`;
        const filepath = path.join(OUTPUT_DIR, filename);

        if (result.data && result.data[0]?.b64_json) {
          const imageBuffer = Buffer.from(result.data[0].b64_json, 'base64');
          fs.writeFileSync(filepath, imageBuffer);

          // 保存元数据
          const metaPath = filepath.replace('.png', '.json');
          fs.writeFileSync(metaPath, JSON.stringify({
            prompt: prompt,
            revised_prompt: result.data[0].revised_prompt,
            model: result.model,
            size: result.size,
            quality: result.quality,
            usage: result.usage,
            created: result.created
          }, null, 2));

          console.log(`  ✅ 成功: ${filename}`);
          results.success++;
        } else {
          throw new Error('响应中没有图片数据');
        }

      } catch (error) {
        console.log(`  ❌ 失败: ${error.message}`);
        results.failed++;

        // 记录失败的提示词
        const errorLog = path.join(OUTPUT_DIR, 'failed.txt');
        fs.appendFileSync(errorLog, `${prompt}\n错误: ${error.message}\n---\n`);
      }
    });

    await Promise.all(batchPromises);

    // 批次间延迟
    if (i + CONCURRENT_LIMIT < prompts.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('📊 批量处理完成');
  console.log(`  成功: ${results.success} / ${results.total}`);
  console.log(`  失败: ${results.failed} / ${results.total}`);
  console.log(`  输出目录: ${OUTPUT_DIR}`);
  console.log('═══════════════════════════════════════════');
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Model Bridge - 批量图片生成工具');
  console.log('═══════════════════════════════════════════');
  console.log('');

  const inputFile = process.argv[2];

  if (!inputFile) {
    console.error('❌ 用法: node batch-image-gen.js <prompts.txt>');
    console.error('');
    console.error('prompts.txt 格式示例:');
    console.error('  A red apple on a wooden table');
    console.error('  A blue car driving on a highway');
    console.error('  A sunset over the ocean');
    process.exit(1);
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`❌ 文件不存在: ${inputFile}`);
    process.exit(1);
  }

  if (API_KEY === 'YOUR_API_KEY_HERE') {
    console.error('❌ 请设置 API Key:');
    console.error('   export MODEL_BRIDGE_API_KEY="mb-xxxxx"');
    console.error('   或修改脚本中的 API_KEY 变量');
    process.exit(1);
  }

  // 读取提示词
  const content = fs.readFileSync(inputFile, 'utf-8');
  const prompts = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  if (prompts.length === 0) {
    console.error('❌ 文件中没有有效的提示词');
    process.exit(1);
  }

  await processBatch(prompts);
}

main().catch(error => {
  console.error('');
  console.error('❌ 未处理的错误:', error);
  process.exit(1);
});
