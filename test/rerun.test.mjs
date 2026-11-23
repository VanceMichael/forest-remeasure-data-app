import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { loadTables } from '../src/tables.mjs';
import { buildReport } from '../src/report.mjs';

const fixtureDir = new URL('../fixtures/', import.meta.url);
const FILES = ['cells.csv', 'plots.csv', 'imagery.csv', 'field-options.csv', 'effort.csv', 'certificates.csv', 'validation-plots.csv', 'format.json'];

async function stagedFixtures(modify) {
  const dir = await mkdtemp(join(tmpdir(), 'rerun-'));
  for (const name of FILES) {
    let content = await readFile(new URL(name, fixtureDir), 'utf8');
    content = modify(name, content);
    await writeFile(join(dir, name), content);
  }
  return dir;
}

test('测绘员提交边界确认与复测回执后重跑，结论随之更新', async () => {
  const dir = await stagedFixtures((name, content) => {
    if (name === 'cells.csv') {
      // C3 边界确认：复议结束，发布口径改为 E
      return content.replace('C3,90,slopes,W,E,W,3', 'C3,90,slopes,W,E,E,2');
    }
    if (name === 'plots.csv') {
      // C3 复测回执：原未响应样方补测到位，另新增一对配对样方
      return content
        .replace('S3,C3,1,open,5,false,inaccessible,1', 'S3,C3,1,open,5,false,ok,1')
        .replace('S7,C3,2,,5,false,inaccessible,2', 'S7,C3,2,open,5,false,ok,2')
        .trimEnd() + '\nS8,C3,1,forest,4,true,ok,1\nS8,C3,2,open,4,true,ok,2\n';
    }
    return content;
  });
  try {
    const { tables } = await loadTables(new URL(`${pathToFileURL(dir).href}/`));
    const report = buildReport(tables);

    // C3 不再复议中，地面未知清空
    assert.deepEqual(report.可追溯缺口.争议边界, []);
    assert.deepEqual(report.结论速览.地面未知地块, []);
    assert.deepEqual(report.结论速览.地面确认变化地块.sort(), ['C2', 'C3']);

    // 面积归属重排：C3 改归 E，两个分区的结论都随之改变
    const attribution = new Map(report.面积归属.map(item => [item.cell, item.published_zone]));
    assert.equal(attribution.get('C3'), 'E');
    assert.equal(report.面积核对.重复记区, false);
    assert.equal(report.现况.分区.E.面积_ha, 157);
    assert.equal(report.共同区可比变化.分区.W.面积_ha, 110);

    // V1 的 W 共有变化区间收窄到 0，证书从暂停转为维持
    const byLetter = new Map(report.认证核查.map(check => [check.letter, check]));
    assert.equal(byLetter.get('V1').action, '维持');
    assert.equal(byLetter.get('V1').width, 0);
    assert.equal(byLetter.get('V2').action, '可签发');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('仅复测回执而边界仍复议时，只解决当前归属区的口径', async () => {
  const dir = await stagedFixtures((name, content) => {
    if (name === 'plots.csv') {
      return content
        .replace('S3,C3,1,open,5,false,inaccessible,1', 'S3,C3,1,open,5,false,ok,1')
        .replace('S7,C3,2,,5,false,inaccessible,2', 'S7,C3,2,open,5,false,ok,2')
        .trimEnd() + '\nS8,C3,1,forest,4,true,ok,1\nS8,C3,2,open,4,true,ok,2\n';
    }
    return content;
  });
  try {
    const { tables } = await loadTables(new URL(`${pathToFileURL(dir).href}/`));
    const report = buildReport(tables);

    // 边界仍复议：C3 仍按 W 归属，争议标记保留
    assert.deepEqual(report.可追溯缺口.争议边界.map(item => item.cell), ['C3']);
    const attribution = new Map(report.面积归属.map(item => [item.cell, item.published_zone]));
    assert.equal(attribution.get('C3'), 'W');

    // W 的证书转为可维持，E 的现况口径不受影响
    const byLetter = new Map(report.认证核查.map(check => [check.letter, check]));
    assert.equal(byLetter.get('V1').action, '维持');
    assert.equal(report.现况.分区.E.面积_ha, 67);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
