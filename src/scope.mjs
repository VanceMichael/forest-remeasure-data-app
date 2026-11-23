// 年度边界与面积归属：区分共有（两年均在区）、新入区、跨区小班，
// 同一版报告内跨区小班只按 published_zone 归属一次，避免重复记区。

export function buildScope(tables) {
  const years = tables.plots.map(row => row.year);
  const reportYear = Math.max(...years);
  const baselineYear = Math.min(...years);
  const warnings = [];

  const cells = tables.cells.map(row => {
    const enrolledV1 = row.zone_v1 !== '-';
    const enrolledV2 = row.zone_v2 !== '-';
    const cell = {
      ...row,
      enrolledV1,
      enrolledV2,
      newlyEnrolled: !enrolledV1 && enrolledV2,
      crossZone: enrolledV1 && enrolledV2 && row.zone_v1 !== row.zone_v2,
      // 复核得知时间晚于报告年度：边界仍处复议，本年按发布口径归属
      disputed: row.revision_known > reportYear,
    };
    if ((enrolledV1 || enrolledV2) && row.published_zone !== row.zone_v1 && row.published_zone !== row.zone_v2) {
      warnings.push(`${row.cell} 的 published_zone=${row.published_zone} 与登记边界不一致`);
    }
    if (enrolledV2 && row.published_zone !== row.zone_v2 && !cell.disputed) {
      warnings.push(`${row.cell} 发布归属 ${row.published_zone} 不同于当年边界 ${row.zone_v2}，但无复议记录`);
    }
    return cell;
  });

  const inShared = cell => cell.enrolledV1 && cell.enrolledV2;
  const inCurrent = cell => cell.enrolledV2;
  const zones = [...new Set(cells.filter(cell => cell.enrolledV2 || cell.enrolledV1).map(cell => cell.published_zone))]
    .filter(zone => zone !== '-')
    .sort();

  const scopes = {
    'project-shared': cells.filter(inShared),
    'project-current': cells.filter(inCurrent),
  };
  for (const zone of zones) {
    scopes[`zone-${zone}-shared`] = cells.filter(cell => inShared(cell) && cell.published_zone === zone);
    scopes[`zone-${zone}-current`] = cells.filter(cell => inCurrent(cell) && cell.published_zone === zone);
  }

  const areaOf = list => list.reduce((sum, cell) => sum + cell.area_ha, 0);
  const zoneSharedArea = zones.reduce((sum, zone) => sum + areaOf(scopes[`zone-${zone}-shared`]), 0);
  const zoneCurrentArea = zones.reduce((sum, zone) => sum + areaOf(scopes[`zone-${zone}-current`]), 0);
  const areaCheck = {
    sharedArea: areaOf(scopes['project-shared']),
    currentArea: areaOf(scopes['project-current']),
    zoneSharedArea,
    zoneCurrentArea,
    // 分区有效面积合计必须等于项目区口径面积，否则存在重复记区或漏记
    doubleCounted: zoneSharedArea !== areaOf(scopes['project-shared']) || zoneCurrentArea !== areaOf(scopes['project-current']),
  };
  if (areaCheck.doubleCounted) {
    warnings.push('分区有效面积合计与项目区口径不一致，存在重复记区或漏记');
  }

  return { reportYear, baselineYear, cells, zones, scopes, areaCheck, warnings };
}
