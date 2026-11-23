// 独立样方检查影像产品的类别偏差，并把影像显示的"变化"与地面配对证据对账：
// 分清哪些地块林冠真的变了，哪些只是新旧产品口径不同。

export function productBias(validationPlots) {
  const byProduct = new Map();
  for (const row of validationPlots) {
    if (!byProduct.has(row.product)) {
      byProduct.set(row.product, {
        product: row.product,
        n: 0,
        correct: 0,
        observedForest: 0,
        observedOpen: 0,
        falseOpen: 0,
        falseForest: 0,
      });
    }
    const stats = byProduct.get(row.product);
    stats.n += 1;
    if (row.observed_class === row.predicted_class) {
      stats.correct += 1;
    }
    if (row.observed_class === 'forest') {
      stats.observedForest += 1;
      if (row.predicted_class === 'open') {
        stats.falseOpen += 1;
      }
    }
    if (row.observed_class === 'open') {
      stats.observedOpen += 1;
      if (row.predicted_class === 'forest') {
        stats.falseForest += 1;
      }
    }
  }
  return [...byProduct.values()].map(stats => ({
    ...stats,
    // 观测为森林却被判为 open 的比例（夸大"森林转 open"的主要来源）
    falseOpenRate: stats.observedForest > 0 ? stats.falseOpen / stats.observedForest : null,
    falseForestRate: stats.observedOpen > 0 ? stats.falseForest / stats.observedOpen : null,
  }));
}

export function reconcileCells(cells, imagery, groundByCell, reportYear, baselineYear) {
  const imageryByCellYear = new Map(imagery.map(row => [`${row.cell}|${row.year}`, row]));
  return cells.map(cell => {
    const ground = groundByCell.get(cell.cell);
    const base = imageryByCellYear.get(`${cell.cell}|${baselineYear}`);
    const curr = imageryByCellYear.get(`${cell.cell}|${reportYear}`);
    const apparentChange = base && curr ? base.class !== curr.class : null;
    const coverageGaps = [base, curr]
      .filter(row => row && row.coverage < 1)
      .map(row => ({ product: row.product, year: row.year, coverage: row.coverage }));

    let verdict;
    if (!cell.enrolledV1) {
      verdict = '新入区现况';
    } else if (!ground.change.measured) {
      verdict = '地面未知';
    } else if (ground.change.changedWeight > 0) {
      verdict = '地面确认变化';
    } else {
      verdict = '地面确认稳定';
    }

    let note = null;
    if (apparentChange === true && verdict === '地面确认稳定') {
      note = '影像显示变化但地面配对稳定，属新旧产品口径差异';
    } else if (apparentChange === true && verdict === '地面确认变化') {
      note = '影像与地面均显示变化，变化幅度以地面配对为准';
    } else if (apparentChange === false && verdict === '地面确认变化') {
      note = '影像未显示变化但地面配对确认变化';
    } else if (apparentChange === true && verdict === '地面未知') {
      note = '影像显示变化但无地面证据，不能据影像单独确认';
    }

    return {
      cell: cell.cell,
      verdict,
      note,
      imageryBase: base ? { product: base.product, class: base.class, coverage: base.coverage } : null,
      imageryCurrent: curr ? { product: curr.product, class: curr.class, coverage: curr.coverage } : null,
      apparentChange,
      coverageGaps,
      groundChange: ground.change.measured ? { low: ground.change.low, high: ground.change.high } : null,
    };
  });
}
