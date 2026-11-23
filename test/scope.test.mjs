import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTables } from '../src/tables.mjs';
import { buildScope } from '../src/scope.mjs';

const { tables } = await loadTables(new URL('../fixtures/', import.meta.url));

test('报告年度与地块分组：共有、新入区、跨区复议', () => {
  const scope = buildScope(tables);
  assert.equal(scope.reportYear, 2);
  assert.equal(scope.baselineYear, 1);
  assert.deepEqual(scope.scopes['project-shared'].map(cell => cell.cell), ['C1', 'C2', 'C3', 'C5']);
  assert.deepEqual(scope.scopes['project-current'].map(cell => cell.cell), ['C1', 'C2', 'C3', 'C4', 'C5']);
  const byCell = new Map(scope.cells.map(cell => [cell.cell, cell]));
  assert.equal(byCell.get('C4').newlyEnrolled, true);
  assert.equal(byCell.get('C3').crossZone, true);
  assert.equal(byCell.get('C3').disputed, true);
  assert.equal(byCell.get('C4').disputed, false);
});

test('跨区小班按发布口径只归属一次，分区面积合计不重复记区', () => {
  const scope = buildScope(tables);
  assert.deepEqual(scope.scopes['zone-W-shared'].map(cell => cell.cell), ['C1', 'C2', 'C3']);
  assert.deepEqual(scope.scopes['zone-E-shared'].map(cell => cell.cell), ['C5']);
  assert.deepEqual(scope.scopes['zone-E-current'].map(cell => cell.cell), ['C4', 'C5']);
  assert.equal(scope.areaCheck.sharedArea, 232);
  assert.equal(scope.areaCheck.currentArea, 267);
  assert.equal(scope.areaCheck.doubleCounted, false);
  assert.deepEqual(scope.warnings, []);
});
