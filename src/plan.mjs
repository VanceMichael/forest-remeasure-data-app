// 补测规划：按通行窗口、路线总工时（含共同路线到场时间）、既定复测样方与
// 最紧缺的报告证据比较各路线，分清哪些能补足正式认证、哪些只能降低不确定性。

const RANK = { 可补足正式认证: 0, 只能降低不确定性: 1, 无新增关键证据: 2 };

export function planSurvey(tables, scope, groundByCell, certificateChecks) {
  const effortByWindow = new Map(tables.effort.map(row => [row.window, row]));

  // 最紧缺的证据：让证书失去支持的未实测地块
  const blocking = new Set();
  for (const check of certificateChecks) {
    if (!check.supported) {
      for (const cell of check.unmeasuredCells) {
        blocking.add(cell);
      }
    }
  }
  const unknown = new Set(
    scope.cells
      .filter(cell => {
        const ground = groundByCell.get(cell.cell);
        return !ground.change.measured || !ground.current.measured;
      })
      .map(cell => cell.cell),
  );
  const disputed = new Set(scope.cells.filter(cell => cell.disputed).map(cell => cell.cell));
  const measured = new Set(scope.cells.filter(cell => !unknown.has(cell.cell)).map(cell => cell.cell));

  const options = tables['field-options'].map(option => {
    const budget = effortByWindow.get(option.window);
    if (!budget) {
      throw new Error(`field-options.${option.route} 的窗口 ${option.window} 无工时记录`);
    }
    // 路线工时已含共同路线到场时间，直接与窗口工时比较
    const fits = option.hours <= budget.hours;
    // 既定复测样方必须保留，取消其安排需另审
    const reservedMissing = budget.reserved_cells.filter(cell => !option.cells.includes(cell));
    const needsReview = reservedMissing.length > 0;
    // 路线不含的地块不能当作完成复测
    const onRouteUnknown = option.cells.filter(cell => unknown.has(cell));
    const onRouteBlocking = option.cells.filter(cell => blocking.has(cell));
    const onRouteDisputed = option.cells.filter(cell => disputed.has(cell));
    const onRouteMeasured = option.cells.filter(cell => measured.has(cell));

    let classification = '无新增关键证据';
    if (option.paired_access && onRouteBlocking.length > 0) {
      classification = '可补足正式认证';
    } else if (onRouteUnknown.length > 0) {
      classification = '只能降低不确定性';
    }

    const reasons = [`工时 ${option.hours} 与 ${option.window} 窗口 ${budget.hours} 比较：${fits ? '可行' : '超出'}`];
    if (reservedMissing.length > 0) {
      reasons.push(`未含既定复测样方 ${reservedMissing.join('、')}，采用需另审`);
    } else if (budget.reserved_cells.length > 0) {
      reasons.push(`保留既定复测样方 ${budget.reserved_cells.join('、')}`);
    }
    if (classification === '可补足正式认证') {
      reasons.push(`覆盖未实测地块 ${onRouteBlocking.join('、')} 且可配对复测，能补足证书需要的变化证据`);
    } else if (classification === '只能降低不确定性') {
      reasons.push(`覆盖 ${onRouteUnknown.join('、')} 但${option.paired_access ? '不阻断证书' : 'paired_access=false，只能提供现况证据'}`);
    } else {
      reasons.push(`路线地块 ${onRouteMeasured.join('、')} 已有有效实测`);
    }
    if (onRouteDisputed.length > 0) {
      reasons.push(`含复议中地块 ${onRouteDisputed.join('、')}，结果可能同时影响两个分区的口径`);
    }

    return {
      route: option.route,
      window: option.window,
      hours: option.hours,
      windowHours: budget.hours,
      fits,
      pairedAccess: option.paired_access,
      cells: option.cells,
      reservedMissing,
      needsReview,
      classification,
      recommended: fits && !needsReview && classification !== '无新增关键证据',
      reasons,
    };
  });

  // 组合：先认证后降不确定，同窗口工时累计不得超出
  const usedByWindow = new Map();
  const combination = [];
  for (const option of [...options].filter(item => item.recommended).sort((a, b) => RANK[a.classification] - RANK[b.classification])) {
    const used = usedByWindow.get(option.window) ?? 0;
    const budget = effortByWindow.get(option.window).hours;
    if (used + option.hours <= budget) {
      combination.push(option.route);
      usedByWindow.set(option.window, used + option.hours);
    }
  }

  return { options, combination, firstChoice: combination[0] ?? null };
}
