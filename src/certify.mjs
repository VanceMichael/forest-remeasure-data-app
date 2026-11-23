// 签发前核查：分区证书按"认证宽度 = 比例点区间宽度"判定是否有支持；
// 项目区公开结论只发布有覆盖的共同区域结果，未实测与复议中的地块单独列出。

export function evaluateCertificates(certificates, scopeEstimates, reportYear) {
  return certificates.map(cert => {
    const estimand = cert.scope === 'shared' ? 'change' : 'current';
    const estimate = scopeEstimates.get(`zone-${cert.zone}-${cert.scope}`)?.[estimand] ?? null;
    if (cert.known_year > reportYear) {
      return {
        letter: cert.letter,
        zone: cert.zone,
        scope: cert.scope,
        status: cert.status,
        ci_max_width: cert.ci_max_width,
        width: null,
        supported: false,
        action: '尚未到期',
        unmeasuredCells: [],
        reason: `证书得知时间 ${cert.known_year} 晚于报告年度 ${reportYear}`,
      };
    }
    if (!estimate) {
      return {
        letter: cert.letter,
        zone: cert.zone,
        scope: cert.scope,
        status: cert.status,
        ci_max_width: cert.ci_max_width,
        width: null,
        supported: false,
        action: cert.status === 'signed' ? '暂停' : '暂缓签发',
        unmeasuredCells: [],
        reason: '对应口径范围没有可估计的记录',
      };
    }
    const supported = estimate.width <= cert.ci_max_width;
    const action = cert.status === 'signed'
      ? (supported ? '维持' : '暂停')
      : (supported ? '可签发' : '暂缓签发');
    const reasons = [
      `区间宽度 ${estimate.width.toFixed(4)} 与上限 ${cert.ci_max_width} 比较：${supported ? '未超过' : '超过'}`,
    ];
    if (estimate.unmeasuredCells.length > 0) {
      reasons.push(`范围内含未实测地块 ${estimate.unmeasuredCells.join('、')}，区间含未知全宽`);
    }
    return {
      letter: cert.letter,
      zone: cert.zone,
      scope: cert.scope,
      status: cert.status,
      ci_max_width: cert.ci_max_width,
      width: estimate.width,
      supported,
      action,
      unmeasuredCells: estimate.unmeasuredCells,
      reason: reasons.join('；'),
    };
  });
}

export function checkPublicConclusion(coveredShared, excludedCells) {
  const caveats = excludedCells.map(item => `${item.cell}：${item.原因}`);
  const publishable = coveredShared !== null && coveredShared.unmeasuredCells.length === 0 && coveredShared.area > 0;
  return {
    publishable,
    口径: '有覆盖的共同区域',
    estimate: coveredShared,
    excluded: excludedCells,
    caveats: [
      ...caveats,
      '公开结论只包含有覆盖的共同区域，未实测与复议中的地块不计入、不确认为无变化',
    ],
  };
}
