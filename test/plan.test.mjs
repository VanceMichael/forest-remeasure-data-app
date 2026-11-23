import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTables } from '../src/tables.mjs';
import { buildScope } from '../src/scope.mjs';
import { cellGroundEstimate, scopeEstimate } from '../src/estimate.mjs';
import { evaluateCertificates } from '../src/certify.mjs';
import { planSurvey } from '../src/plan.mjs';

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
const certificateChecks = evaluateCertificates(tables.certificates, scopeEstimates, scope.reportYear);

test('补测建议分清能补足认证与只能降低不确定性的调查', () => {
  const plan = planSurvey(tables, scope, groundByCell, certificateChecks);
  const byRoute = new Map(plan.options.map(option => [option.route, option]));

  const r1 = byRoute.get('R1');
  assert.equal(r1.classification, '可补足正式认证');
  assert.equal(r1.recommended, true);
  assert.equal(r1.fits, true);
  assert.deepEqual(r1.reservedMissing, []);

  const r2 = byRoute.get('R2');
  assert.equal(r2.classification, '只能降低不确定性');
  assert.equal(r2.recommended, true);

  const r3 = byRoute.get('R3');
  assert.equal(r3.classification, '无新增关键证据');
  assert.equal(r3.recommended, false);
  assert.deepEqual(r3.reservedMissing, ['C2']);
  assert.equal(r3.needsReview, true);

  assert.deepEqual(plan.combination, ['R1', 'R2']);
  assert.equal(plan.firstChoice, 'R1');
});

test('路线不含的地块不能当作完成复测', () => {
  const options = [{
    route: 'R9', cells: ['C1'], window: 'early', hours: 2, paired_access: true,
  }];
  const plan = planSurvey({ ...tables, 'field-options': options }, scope, groundByCell, certificateChecks);
  const [r9] = plan.options;
  // C3 不在路线上，即使 paired_access=true 也不算补足证据
  assert.equal(r9.classification, '无新增关键证据');
  assert.equal(r9.recommended, false);
});

test('超出窗口工时的路线不可行', () => {
  const options = [{
    route: 'R8', cells: ['C3'], window: 'late', hours: 9, paired_access: true,
  }];
  const plan = planSurvey({ ...tables, 'field-options': options }, scope, groundByCell, certificateChecks);
  const [r8] = plan.options;
  assert.equal(r8.fits, false);
  assert.equal(r8.recommended, false);
});
