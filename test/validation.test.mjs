import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTables } from '../src/tables.mjs';
import { buildScope } from '../src/scope.mjs';
import { cellGroundEstimate } from '../src/estimate.mjs';
import { productBias, reconcileCells } from '../src/validation.mjs';

const { tables } = await loadTables(new URL('../fixtures/', import.meta.url));
const scope = buildScope(tables);
const groundByCell = new Map(
  scope.cells.map(cell => [cell.cell, cellGroundEstimate(cell, tables.plots, scope.reportYear, scope.baselineYear)]),
);

test('独立样方给出各产品的类别偏差', () => {
  const bias = productBias(tables['validation-plots']);
  const byProduct = new Map(bias.map(item => [item.product, item]));
  assert.equal(byProduct.get('I1').n, 4);
  assert.equal(byProduct.get('I1').correct, 2);
  assert.ok(Math.abs(byProduct.get('I1').falseOpenRate - 1 / 3) < 1e-9);
  assert.equal(byProduct.get('I1').falseForestRate, 1);
  assert.equal(byProduct.get('I2').correct, 3);
  assert.ok(Math.abs(byProduct.get('I2').falseOpenRate - 1 / 2) < 1e-9);
  assert.equal(byProduct.get('I2').falseForestRate, 0);
});

test('影像显示的变化与地面证据对账：分清真变化与口径差异', () => {
  const reconciliation = reconcileCells(scope.cells, tables.imagery, groundByCell, scope.reportYear, scope.baselineYear);
  const byCell = new Map(reconciliation.map(item => [item.cell, item]));
  assert.equal(byCell.get('C1').verdict, '地面确认稳定');
  assert.equal(byCell.get('C1').apparentChange, true);
  assert.match(byCell.get('C1').note, /口径差异/);
  assert.equal(byCell.get('C2').verdict, '地面确认变化');
  assert.equal(byCell.get('C3').verdict, '地面未知');
  assert.deepEqual(byCell.get('C3').coverageGaps.map(gap => gap.coverage), [0.7, 0.5]);
  assert.equal(byCell.get('C4').verdict, '新入区现况');
  assert.equal(byCell.get('C5').verdict, '地面确认稳定');
  assert.equal(byCell.get('C5').apparentChange, false);
});
