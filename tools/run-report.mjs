import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTables } from '../src/tables.mjs';
import { buildReport } from '../src/report.mjs';

// 用法：node tools/run-report.mjs [--dir 资料目录]
// 默认读取 fixtures/；测绘员提交新边界确认或复测回执后，更新 CSV 重跑即可。

const args = process.argv.slice(2);
let source = new URL('../fixtures/', import.meta.url);
const flag = args.indexOf('--dir');
if (flag !== -1 && args[flag + 1]) {
  source = new URL(`${pathToFileURL(resolve(args[flag + 1])).href}/`);
}

const { tables } = await loadTables(source);
console.log(JSON.stringify(buildReport(tables), null, 2));
