import { buildScope } from './scope.mjs';
import { cellGroundEstimate, scopeEstimate } from './estimate.mjs';
import { productBias, reconcileCells } from './validation.mjs';
import { evaluateCertificates, checkPublicConclusion } from './certify.mjs';
import { planSurvey } from './plan.mjs';

const r4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
const intervalOf = estimate => [r4(estimate.low), r4(estimate.high)];

function describeEstimate(estimate) {
  if (!estimate) {
    return null;
  }
  return {
    面积_ha: estimate.area,
    有覆盖面积_ha: estimate.coveredArea,
    区间: intervalOf(estimate),
    区间宽度: r4(estimate.width),
    未实测地块: estimate.unmeasuredCells,
  };
}

export function buildReport(tables) {
  const scope = buildScope(tables);
  const { reportYear, baselineYear } = scope;
  const groundByCell = new Map(
    scope.cells.map(cell => [cell.cell, cellGroundEstimate(cell, tables.plots, reportYear, baselineYear)]),
  );

  // 各口径范围的估计：共有口径给可比变化，当年口径给现况（含新入区）
  const scopeEstimates = new Map();
  for (const [key, cells] of Object.entries(scope.scopes)) {
    scopeEstimates.set(key, {
      cells: cells.map(cell => cell.cell),
      change: key.endsWith('-shared') ? scopeEstimate(cells, groundByCell, 'change') : null,
      current: key.endsWith('-current') ? scopeEstimate(cells, groundByCell, 'current') : null,
    });
  }
  // 有覆盖的共同区域子口径：复议期间可发布的部分
  const coveredShared = new Map();
  for (const [key, cells] of Object.entries(scope.scopes)) {
    if (!key.endsWith('-shared')) {
      continue;
    }
    const covered = cells.filter(cell => groundByCell.get(cell.cell).change.measured);
    coveredShared.set(key, covered.length > 0 ? scopeEstimate(covered, groundByCell, 'change') : null);
  }

  // 影像产品核查与地块对账
  const bias = productBias(tables['validation-plots']);
  const reconciliation = reconcileCells(scope.cells, tables.imagery, groundByCell, reportYear, baselineYear);

  // 认证核查与公开结论核查
  const certificateChecks = evaluateCertificates(tables.certificates, scopeEstimates, reportYear);
  const excludedFromPublic = scope.scopes['project-shared']
    .filter(cell => !groundByCell.get(cell.cell).change.measured)
    .map(cell => ({
      cell: cell.cell,
      原因: cell.disputed ? '边界复议中且无有效地面实测' : '无有效地面实测',
    }));
  const publicConclusion = checkPublicConclusion(coveredShared.get('project-shared'), excludedFromPublic);

  // 补测规划
  const survey = planSurvey(tables, scope, groundByCell, certificateChecks);

  // 未实测层：区间只能依赖可解释假设，不能用整区平均写成已确认
  const biasByProduct = new Map(bias.map(item => [item.product, item]));
  const unmeasuredLayers = {};
  for (const cell of scope.cells) {
    const ground = groundByCell.get(cell.cell);
    if (ground.change.measured && ground.current.measured) {
      continue;
    }
    const imageryRows = tables.imagery.filter(row => row.cell === cell.cell);
    const currentImagery = imageryRows.find(row => row.year === reportYear);
    const assumptions = [];
    if (currentImagery) {
      const stats = biasByProduct.get(currentImagery.product);
      assumptions.push(
        `若采信 ${currentImagery.product} 覆盖部分（覆盖率 ${currentImagery.coverage}）的类别 ${currentImagery.class}，需假设该产品在本地分类可信`,
      );
      if (stats) {
        assumptions.push(`独立样方仅 ${stats.n} 条，产品偏差率是小样本估计，只能作为背景不能作为确认`);
      }
      if (currentImagery.coverage < 1) {
        assumptions.push('影像未覆盖部分类别未知，不能由覆盖部分外推');
      }
    } else {
      assumptions.push('该层无当年影像产品记录');
    }
    assumptions.push('不能用整区平均或其他层结果把该层写成已确认');
    unmeasuredLayers[cell.cell] = {
      设计区间: [0, 1],
      已确认: false,
      假设: assumptions,
      影像背景: imageryRows.map(row => ({ product: row.product, year: row.year, class: row.class, coverage: row.coverage })),
    };
  }

  // 可追溯缺口
  const imageryGaps = tables.imagery
    .filter(row => row.coverage < 1)
    .map(row => ({ product: row.product, cell: row.cell, year: row.year, coverage: row.coverage }));
  const groundUnknowns = scope.cells.flatMap(cell =>
    groundByCell.get(cell.cell).groundUnknowns.map(item => ({ cell: cell.cell, ...item })),
  );
  const disputedCells = scope.cells
    .filter(cell => cell.disputed)
    .map(cell => ({
      cell: cell.cell,
      zone_v1: cell.zone_v1,
      zone_v2: cell.zone_v2,
      published_zone: cell.published_zone,
      revision_known: cell.revision_known,
    }));

  // 结论速览：多少地块真变了，哪些只是口径
  const overview = {
    地面确认变化地块: reconciliation.filter(item => item.verdict === '地面确认变化').map(item => item.cell),
    影像变化但属分类器口径: reconciliation
      .filter(item => item.verdict === '地面确认稳定' && item.apparentChange === true)
      .map(item => item.cell),
    地面未知地块: reconciliation.filter(item => item.verdict === '地面未知').map(item => item.cell),
    地面确认稳定地块: reconciliation.filter(item => item.verdict === '地面确认稳定').map(item => item.cell),
    新入区地块: reconciliation.filter(item => item.verdict === '新入区现况').map(item => item.cell),
  };

  // 面积归属与核对
  const attribution = scope.cells.map(cell => ({
    cell: cell.cell,
    area_ha: cell.area_ha,
    stratum: cell.stratum,
    zone_v1: cell.zone_v1,
    zone_v2: cell.zone_v2,
    published_zone: cell.published_zone,
    标记: [
      ...(cell.newlyEnrolled ? ['新入区'] : []),
      ...(cell.crossZone ? ['跨区小班'] : []),
      ...(cell.disputed ? ['边界复议中'] : []),
    ],
  }));

  // 签发依据：回看签发版用过的产品、样方与面积归属
  const basis = {
    影像产品: [...new Set(tables.imagery.map(row => row.product))].sort().map(product => ({
      product,
      years: [...new Set(tables.imagery.filter(row => row.product === product).map(row => row.year))].sort(),
    })),
    独立检查样方数: tables['validation-plots'].length,
    地面样方: {
      有效记录数: scope.cells.reduce((sum, cell) => sum + groundByCell.get(cell.cell).validRows, 0),
      配对样方: scope.cells.flatMap(cell => groundByCell.get(cell.cell).pairs.map(pair => pair.plot)),
      配对不完整: scope.cells.flatMap(cell => groundByCell.get(cell.cell).incompletePairs),
      未响应: groundUnknowns.map(item => ({ plot: item.plot, year: item.year, response: item.response })),
    },
    面积归属口径: '同一版报告按 published_zone 归属跨区小班，避免面积重复记给两个区',
    面积归属: attribution.map(item => ({ cell: item.cell, published_zone: item.published_zone })),
  };

  // 不受影响的可用结果
  const usable = [];
  for (const zone of scope.zones) {
    const cert = certificateChecks.find(check => check.zone === zone);
    if (cert && cert.supported) {
      usable.push({ 范围: `${zone} 分区${cert.scope === 'shared' ? '共有变化' : '现况'}`, 说明: `${cert.letter} 证据支持，可${cert.status === 'signed' ? '维持' : '签发'}` });
    }
    const covered = coveredShared.get(`zone-${zone}-shared`);
    if (covered && covered.area > 0 && covered.area < (scopeEstimates.get(`zone-${zone}-shared`)?.change?.area ?? 0)) {
      usable.push({
        范围: `${zone} 分区有覆盖共同区`,
        说明: `仅 ${covered.measuredCells.join('、')} 的变化结果可发布，复议中的地块不计入`,
      });
    }
  }
  if (publicConclusion.publishable) {
    usable.push({ 范围: '项目区有覆盖共同区变化', 说明: '公开结论可发布，排除项见公开结论核查' });
  }

  const zoneSections = {};
  for (const zone of scope.zones) {
    zoneSections[zone] = {
      共有变化: describeEstimate(scopeEstimates.get(`zone-${zone}-shared`)?.change),
      共有变化_有覆盖: describeEstimate(coveredShared.get(`zone-${zone}-shared`)),
      当年现况: describeEstimate(scopeEstimates.get(`zone-${zone}-current`)?.current),
    };
  }

  const newlyEnrolled = {};
  for (const cell of scope.cells.filter(item => item.newlyEnrolled)) {
    newlyEnrolled[cell.cell] = {
      面积_ha: cell.area_ha,
      现况区间: intervalOf(groundByCell.get(cell.cell).current),
      备注: '今年并入区域，计入全期现况，不计入共有比较',
    };
  }

  return {
    报告年度: reportYear,
    结论速览: overview,
    面积归属: attribution,
    面积核对: {
      共有口径面积_ha: scope.areaCheck.sharedArea,
      当年口径面积_ha: scope.areaCheck.currentArea,
      分区共有合计_ha: scope.areaCheck.zoneSharedArea,
      分区当年合计_ha: scope.areaCheck.zoneCurrentArea,
      重复记区: scope.areaCheck.doubleCounted,
    },
    共同区可比变化: {
      项目区: describeEstimate(scopeEstimates.get('project-shared')?.change),
      项目区_有覆盖: describeEstimate(coveredShared.get('project-shared')),
      分区: Object.fromEntries(scope.zones.map(zone => [zone, zoneSections[zone].共有变化])),
    },
    现况: {
      项目区: describeEstimate(scopeEstimates.get('project-current')?.current),
      分区: Object.fromEntries(scope.zones.map(zone => [zone, zoneSections[zone].当年现况])),
      新入区: newlyEnrolled,
    },
    影像产品核查: {
      产品偏差: bias.map(item => ({
        ...item,
        falseOpenRate: item.falseOpenRate === null ? null : r4(item.falseOpenRate),
        falseForestRate: item.falseForestRate === null ? null : r4(item.falseForestRate),
      })),
      地块对账: reconciliation.map(item => ({
        ...item,
        groundChange: item.groundChange ? intervalOf(item.groundChange) : null,
      })),
    },
    未实测层: unmeasuredLayers,
    可追溯缺口: {
      影像缺边: imageryGaps,
      地面未知: groundUnknowns,
      争议边界: disputedCells,
    },
    认证核查: certificateChecks.map(check => ({ ...check, width: check.width === null ? null : r4(check.width) })),
    公开结论核查: {
      ...publicConclusion,
      estimate: describeEstimate(publicConclusion.estimate),
    },
    补测建议: survey,
    签发依据: basis,
    不受影响的可用结果: usable,
    警告: scope.warnings,
  };
}
