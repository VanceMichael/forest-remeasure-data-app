import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTables } from '../src/tables.mjs';
import { buildScope } from '../src/scope.mjs';
import { cellGroundEstimate, scopeEstimate } from '../src/estimate.mjs';

const { tables } = await loadTables(new URL('../fixtures/', import.meta.url));
const scope = buildScope(tables);
const groundByCell = new Map(
  scope.cells.map(cell => [cell.cell, cellGroundEstimate(cell, tables.plots, scope.reportYear, scope.baselineYear)]),
);

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('配对样方给出变化证据：C1 稳定、C2 确有变化', () => {
  const c1 = groundByCell.get('C1');
  assert.equal(c1.change.measured, true);
  assert.equal(c1.pairs.length, 5);
  close(c1.change.low, 0);
  close(c1.change.high, 0);
  const c2 = groundByCell.get('C2');
  assert.equal(c2.pairs.length, 5);
  close(c2.change.changedWeight, 3);
  close(c2.change.low, 3 / 13);
  close(c2.change.high, 3 / 13);
});

test('现况用当年全部有效记录，不论是否配对', () => {
  const c4 = groundByCell.get('C4');
  close(c4.current.low, 7 / 12);
  const c5 = groundByCell.get('C5');
  close(c5.current.low, 0.75);
});

test('未实测地块区间为全宽且标记未确认，不用整区平均填补', () => {
  const c3 = groundByCell.get('C3');
  assert.equal(c3.change.measured, false);
  assert.equal(c3.current.measured, false);
  assert.deepEqual([c3.change.low, c3.change.high], [0, 1]);
  assert.deepEqual([c3.current.low, c3.current.high], [0, 1]);
  assert.deepEqual(c3.groundUnknowns.map(item => item.plot), ['S3', 'S7']);
});

test('范围合计按面积加权并保留未实测地块的未知全宽', () => {
  const sharedW = scopeEstimate(scope.scopes['zone-W-shared'], groundByCell, 'change');
  close(sharedW.low, (70 * 3) / 13 / 200);
  close(sharedW.high, (70 * 3 / 13 + 90) / 200);
  close(sharedW.width, 0.45);
  assert.deepEqual(sharedW.unmeasuredCells, ['C3']);
  const currentE = scopeEstimate(scope.scopes['zone-E-current'], groundByCell, 'current');
  close(currentE.low, (35 * 7 / 12 + 32 * 0.75) / 67);
  close(currentE.width, 0);
});

test('paired 标记仍须核对两年记录：缺年或未响应的配对按未知加宽区间', () => {
  const cell = { cell: 'X', area_ha: 10 };
  const plots = [
    { plot: 'P1', cell: 'X', year: 1, class: 'forest', design_weight: 1, paired: true, response: 'ok', known_year: 1 },
    { plot: 'P2', cell: 'X', year: 1, class: 'forest', design_weight: 1, paired: true, response: 'ok', known_year: 1 },
    { plot: 'P2', cell: 'X', year: 2, class: 'open', design_weight: 1, paired: true, response: 'ok', known_year: 2 },
    { plot: 'P3', cell: 'X', year: 2, class: '', design_weight: 2, paired: false, response: 'inaccessible', known_year: 2 },
  ];
  const estimate = cellGroundEstimate(cell, plots, 2, 1);
  assert.equal(estimate.pairs.length, 1);
  assert.equal(estimate.incompletePairs.length, 1);
  close(estimate.change.low, 1 / 2);
  close(estimate.change.high, 1);
  assert.equal(estimate.current.measured, true);
  close(estimate.current.low, 0);
  close(estimate.current.high, 2 / 3);
  assert.equal(estimate.groundUnknowns.length, 1);
});

test('非配对样方不进入变化证据，但计入现况', () => {
  const cell = { cell: 'Y', area_ha: 5 };
  const plots = [
    { plot: 'Q1', cell: 'Y', year: 1, class: 'forest', design_weight: 1, paired: false, response: 'ok', known_year: 1 },
    { plot: 'Q1', cell: 'Y', year: 2, class: 'open', design_weight: 1, paired: false, response: 'ok', known_year: 2 },
  ];
  const estimate = cellGroundEstimate(cell, plots, 2, 1);
  assert.equal(estimate.change.measured, false);
  close(estimate.current.low, 0);
  close(estimate.current.high, 0);
});
