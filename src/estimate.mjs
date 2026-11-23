// 地面证据估计：变化只认有效配对样方，现况用当年全部有效记录；
// 区间按设计权重与未响应状态计——未知部分按比例点并吞入区间，不做整区平均替代。

export function isValidResponse(row) {
  return row.response === 'ok' && row.class !== '';
}

export function cellGroundEstimate(cell, plots, reportYear, baselineYear) {
  const rows = plots.filter(row => row.cell === cell.cell && row.known_year <= reportYear);
  const byPlot = new Map();
  for (const row of rows) {
    if (!byPlot.has(row.plot)) {
      byPlot.set(row.plot, new Map());
    }
    byPlot.get(row.plot).set(row.year, row);
  }

  // 变化证据：paired 样方仍须核对两年是否确有可配记录，否则按未知计入区间
  let pairWeight = 0;
  let changedWeight = 0;
  let unknownPairWeight = 0;
  const pairs = [];
  const incompletePairs = [];
  for (const [plot, byYear] of byPlot) {
    const plotRows = [...byYear.values()];
    if (!plotRows.some(row => row.paired)) {
      continue;
    }
    const base = byYear.get(baselineYear);
    const curr = byYear.get(reportYear);
    const weight = (curr ?? base ?? plotRows[0]).design_weight;
    if (base && curr && isValidResponse(base) && isValidResponse(curr)) {
      const changed = base.class !== curr.class;
      pairWeight += weight;
      if (changed) {
        changedWeight += weight;
      }
      pairs.push({ plot, from: base.class, to: curr.class, weight, changed });
    } else {
      const reasons = [];
      if (!base) reasons.push(`缺少年度 ${baselineYear} 记录`);
      else if (!isValidResponse(base)) reasons.push(`年度 ${baselineYear} 记录无效`);
      if (!curr) reasons.push(`缺少年度 ${reportYear} 记录`);
      else if (!isValidResponse(curr)) reasons.push(`年度 ${reportYear} 记录无效`);
      unknownPairWeight += weight;
      incompletePairs.push({ plot, weight, 原因: reasons.join('；') });
    }
  }

  // 现况证据：报告年度全部有效记录（不论是否配对）
  let totalWeight = 0;
  let forestWeight = 0;
  let unknownWeight = 0;
  for (const row of rows) {
    if (row.year !== reportYear) {
      continue;
    }
    if (isValidResponse(row)) {
      totalWeight += row.design_weight;
      if (row.class === 'forest') {
        forestWeight += row.design_weight;
      }
    } else {
      unknownWeight += row.design_weight;
    }
  }

  // 地面未知必须可追：所有无效记录单列
  const groundUnknowns = rows
    .filter(row => !isValidResponse(row))
    .map(row => ({
      plot: row.plot,
      year: row.year,
      response: row.response,
      class: row.class,
      说明: row.class !== '' ? '记录类别但响应为 inaccessible，不计入地面证据' : '类别未知',
    }));

  const pairDenom = pairWeight + unknownPairWeight;
  const changeMeasured = pairWeight > 0;
  const change = changeMeasured
    ? { low: changedWeight / pairDenom, high: (changedWeight + unknownPairWeight) / pairDenom, measured: true }
    : { low: 0, high: 1, measured: false };

  const currentDenom = totalWeight + unknownWeight;
  const currentMeasured = totalWeight > 0;
  const current = currentMeasured
    ? { low: forestWeight / currentDenom, high: (forestWeight + unknownWeight) / currentDenom, measured: true }
    : { low: 0, high: 1, measured: false };

  return {
    cell: cell.cell,
    change: { ...change, pairWeight, changedWeight, unknownPairWeight },
    current: { ...current, forestWeight, totalWeight, unknownWeight },
    pairs,
    incompletePairs,
    groundUnknowns,
    validRows: rows.filter(isValidResponse).length,
  };
}

// 范围合计：按面积加权的区间并；未实测地块保留 [0,1] 全宽并点名
export function scopeEstimate(scopeCells, groundByCell, kind) {
  const totalArea = scopeCells.reduce((sum, cell) => sum + cell.area_ha, 0);
  if (totalArea === 0) {
    return null;
  }
  let low = 0;
  let high = 0;
  let coveredArea = 0;
  const measuredCells = [];
  const unmeasuredCells = [];
  for (const cell of scopeCells) {
    const estimate = groundByCell.get(cell.cell)[kind];
    low += cell.area_ha * estimate.low;
    high += cell.area_ha * estimate.high;
    if (estimate.measured) {
      measuredCells.push(cell.cell);
      coveredArea += cell.area_ha;
    } else {
      unmeasuredCells.push(cell.cell);
    }
  }
  return {
    kind,
    area: totalArea,
    coveredArea,
    low: low / totalArea,
    high: high / totalArea,
    width: (high - low) / totalArea,
    measuredCells,
    unmeasuredCells,
  };
}
