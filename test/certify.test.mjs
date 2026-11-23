import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTables } from '../src/tables.mjs';
import { buildScope } from '../src/scope.mjs';
import { cellGroundEstimate, scopeEstimate } from '../src/estimate.mjs';
import { evaluateCertificates, checkPublicConclusion } from '../src/certify.mjs';

const { tables } = await loadTables(new URL('../fixtures/', import.meta.url));
const scope = buildScope(tables);
const groundByCell = new Map(
  scope.cells.map(cell => [cell.cell, cellGroundEstimate(cell, tables.plots, scope.reportYear, scope.baselineYear)]),
);
const scopeEstimates = new Map(
  Object.entries(scope.scopes).map(([key, cells]) => [key, {
    change: key.endsWith('-shared') ? scopeEstimate(cells, groundByCell, 'change') : null,
    current: key.endsWith('-current') ? scopeEstimate(cells, groundByCell, 'current') : null,
  }]),
);

test('分区证书按区间宽度核查：V1 超宽需暂停，V2 有支持可签发', () => {
  const checks = evaluateCertificates(tables.certificates, scopeEstimates, scope.reportYear);
  const byLetter = new Map(checks.map(check => [check.letter, check]));
  const v1 = byLetter.get('V1');
  assert.equal(v1.supported, false);
  assert.equal(v1.action, '暂停');
  assert.ok(Math.abs(v1.width - 0.45) < 1e-9);
  assert.deepEqual(v1.unmeasuredCells, ['C3']);
  const v2 = byLetter.get('V2');
  assert.equal(v2.supported, true);
  assert.equal(v2.action, '可签发');
  assert.ok(Math.abs(v2.width - 0) < 1e-9);
});

test('公开结论只发布有覆盖的共同区域，未实测地块列出而不计入', () => {
  const covered = scope.scopes['project-shared'].filter(cell => groundByCell.get(cell.cell).change.measured);
  const coveredEstimate = scopeEstimate(covered, groundByCell, 'change');
  const excluded = [{ cell: 'C3', 原因: '边界复议中且无有效地面实测' }];
  const conclusion = checkPublicConclusion(coveredEstimate, excluded);
  assert.equal(conclusion.publishable, true);
  assert.ok(Math.abs(conclusion.estimate.low - (70 * 3 / 13) / 142) < 1e-9);
  assert.equal(conclusion.estimate.area, 142);
  assert.deepEqual(conclusion.excluded.map(item => item.cell), ['C3']);
});

test('未到期证书不判定', () => {
  const future = [{ letter: 'V9', zone: 'W', known_year: 3, scope: 'shared', status: 'pending', ci_max_width: 0.3 }];
  const [check] = evaluateCertificates(future, scopeEstimates, scope.reportYear);
  assert.equal(check.action, '尚未到期');
  assert.equal(check.supported, false);
});
