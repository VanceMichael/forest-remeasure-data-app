import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTables } from '../src/tables.mjs';
import { buildReport } from '../src/report.mjs';

const { tables } = await loadTables(new URL('../fixtures/', import.meta.url));
const report = buildReport(tables);

test('报告可序列化且覆盖签发所需的各栏目', () => {
  const text = JSON.stringify(report);
  assert.ok(text.length > 0);
  for (const key of ['结论速览', '面积归属', '面积核对', '共同区可比变化', '现况', '影像产品核查', '未实测层', '可追溯缺口', '认证核查', '公开结论核查', '补测建议', '签发依据', '不受影响的可用结果', '警告']) {
    assert.ok(key in report, `缺少栏目 ${key}`);
  }
});

test('结论速览分清真变化与口径差异', () => {
  assert.deepEqual(report.结论速览.地面确认变化地块, ['C2']);
  assert.deepEqual(report.结论速览.影像变化但属分类器口径, ['C1']);
  assert.deepEqual(report.结论速览.地面未知地块, ['C3']);
  assert.deepEqual(report.结论速览.新入区地块, ['C4']);
});

test('认证核查给出需暂停与可签发的证书', () => {
  const byLetter = new Map(report.认证核查.map(check => [check.letter, check]));
  assert.equal(byLetter.get('V1').action, '暂停');
  assert.equal(byLetter.get('V2').action, '可签发');
});

test('未实测层标记未确认并列出依赖的假设', () => {
  const c3 = report.未实测层.C3;
  assert.equal(c3.已确认, false);
  assert.deepEqual(c3.设计区间, [0, 1]);
  assert.ok(c3.假设.some(item => item.includes('不能用整区平均')));
});

test('可追溯缺口列出影像缺边、地面未知与争议边界', () => {
  assert.ok(report.可追溯缺口.影像缺边.some(gap => gap.product === 'I2' && gap.cell === 'C3' && gap.coverage === 0.5));
  assert.ok(report.可追溯缺口.地面未知.some(item => item.plot === 'S7' && item.class === ''));
  assert.deepEqual(report.可追溯缺口.争议边界.map(item => item.cell), ['C3']);
});

test('签发依据可回看产品、样方与面积归属', () => {
  assert.deepEqual(report.签发依据.影像产品.map(item => item.product), ['I1', 'I2']);
  assert.ok(report.签发依据.地面样方.配对样方.includes('S1'));
  const attribution = new Map(report.签发依据.面积归属.map(item => [item.cell, item.published_zone]));
  assert.equal(attribution.get('C3'), 'W');
  assert.equal(report.面积核对.重复记区, false);
});

test('公开结论与可用结果只含有覆盖部分', () => {
  assert.equal(report.公开结论核查.publishable, true);
  assert.deepEqual(report.公开结论核查.excluded.map(item => item.cell), ['C3']);
  assert.ok(report.不受影响的可用结果.some(item => item.范围.includes('E 分区')));
});
