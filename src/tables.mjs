import { readFile } from 'node:fs/promises';

// 交接资料的读取、格式校验与类型化。CSV 约定见 fixtures/format.json 与 README。

export function parseTable(content, fields, table) {
  const lines = content.trimEnd().split(/\r?\n/);
  const header = lines.shift().split(',');
  if (header.length !== fields.length || header.some((field, index) => field !== fields[index])) {
    throw new Error(`${table} 的表头与格式约定不一致`);
  }
  return lines.map((line, index) => {
    const cells = line.split(',');
    if (cells.length !== fields.length || line.includes('"')) {
      throw new Error(`${table} 第 ${index + 2} 行不是约定的字段格式`);
    }
    return Object.fromEntries(fields.map((field, position) => [field, cells[position]]));
  });
}

export function checkLinks(tables, links) {
  for (const [table, field, target, key] of links) {
    const keys = new Set(tables[target].map(row => row[key]));
    for (const row of tables[table]) {
      const value = row[field];
      if (value !== '' && value !== '-' && !keys.has(value)) {
        throw new Error(`${table}.${field} 的 ${value} 在 ${target}.${key} 中无对应记录`);
      }
    }
  }
}

export async function loadRawTables(source = new URL('../fixtures/', import.meta.url)) {
  const format = JSON.parse(await readFile(new URL('format.json', source), 'utf8'));
  const tables = {};
  for (const [name, fields] of Object.entries(format.tables)) {
    const content = await readFile(new URL(`${name}.csv`, source), 'utf8');
    tables[name] = parseTable(content, fields, name);
    if (tables[name].length === 0) {
      throw new Error(`${name} 没有交接记录`);
    }
  }
  checkLinks(tables, format.links);
  return { format, tables };
}

function toNumber(value, label) {
  if (value === '' || Number.isNaN(Number(value))) {
    throw new Error(`${label} 不是约定数值: ${value}`);
  }
  return Number(value);
}

function toBoolean(value, label) {
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${label} 不是约定布尔值: ${value}`);
  }
  return value === 'true';
}

function oneOf(value, options, label) {
  if (!options.includes(value)) {
    throw new Error(`${label} 不是约定取值: ${value}`);
  }
  return value;
}

function toList(value) {
  // 多值字段用竖线分隔；`-` 与空串表示不适用
  return value === '' || value === '-' ? [] : value.split('|');
}

const CLASSES = ['', 'forest', 'open'];

export function coerceTables(raw) {
  const tables = {
    cells: raw.cells.map(row => ({
      cell: row.cell,
      area_ha: toNumber(row.area_ha, `cells.${row.cell}.area_ha`),
      stratum: row.stratum,
      zone_v1: row.zone_v1,
      zone_v2: row.zone_v2,
      published_zone: row.published_zone,
      revision_known: toNumber(row.revision_known, `cells.${row.cell}.revision_known`),
    })),
    plots: raw.plots.map(row => ({
      plot: row.plot,
      cell: row.cell,
      year: toNumber(row.year, `plots.${row.plot}.year`),
      class: oneOf(row.class, CLASSES, `plots.${row.plot}.class`),
      design_weight: toNumber(row.design_weight, `plots.${row.plot}.design_weight`),
      paired: toBoolean(row.paired, `plots.${row.plot}.paired`),
      response: oneOf(row.response, ['ok', 'inaccessible'], `plots.${row.plot}.response`),
      known_year: toNumber(row.known_year, `plots.${row.plot}.known_year`),
    })),
    imagery: raw.imagery.map(row => ({
      product: row.product,
      cell: row.cell,
      year: toNumber(row.year, `imagery.${row.product}.${row.cell}.year`),
      class: oneOf(row.class, ['forest', 'open'], `imagery.${row.product}.${row.cell}.class`),
      coverage: toNumber(row.coverage, `imagery.${row.product}.${row.cell}.coverage`),
    })),
    'field-options': raw['field-options'].map(row => ({
      route: row.route,
      cells: toList(row.cells),
      window: row.window,
      hours: toNumber(row.hours, `field-options.${row.route}.hours`),
      paired_access: toBoolean(row.paired_access, `field-options.${row.route}.paired_access`),
    })),
    effort: raw.effort.map(row => ({
      window: row.window,
      hours: toNumber(row.hours, `effort.${row.window}.hours`),
      reserved_cells: toList(row.reserved_cells),
    })),
    certificates: raw.certificates.map(row => ({
      letter: row.letter,
      zone: row.zone,
      known_year: toNumber(row.known_year, `certificates.${row.letter}.known_year`),
      scope: oneOf(row.scope, ['shared', 'current'], `certificates.${row.letter}.scope`),
      status: oneOf(row.status, ['signed', 'pending'], `certificates.${row.letter}.status`),
      ci_max_width: toNumber(row.ci_max_width, `certificates.${row.letter}.ci_max_width`),
    })),
    'validation-plots': raw['validation-plots'].map(row => ({
      sample: row.sample,
      product: row.product,
      cell: row.cell,
      year: toNumber(row.year, `validation-plots.${row.sample}.year`),
      observed_class: oneOf(row.observed_class, ['forest', 'open'], `validation-plots.${row.sample}.observed_class`),
      predicted_class: oneOf(row.predicted_class, ['forest', 'open'], `validation-plots.${row.sample}.predicted_class`),
    })),
  };
  for (const row of tables.imagery) {
    if (row.coverage < 0 || row.coverage > 1) {
      throw new Error(`imagery.${row.product}.${row.cell}.coverage 超出 [0,1]: ${row.coverage}`);
    }
  }
  const cellIds = new Set(tables.cells.map(row => row.cell));
  for (const row of tables['field-options']) {
    for (const cell of row.cells) {
      if (!cellIds.has(cell)) {
        throw new Error(`field-options.${row.route} 的 ${cell} 在 cells 中无对应记录`);
      }
    }
  }
  for (const row of tables.effort) {
    for (const cell of row.reserved_cells) {
      if (!cellIds.has(cell)) {
        throw new Error(`effort.${row.window} 的 ${cell} 在 cells 中无对应记录`);
      }
    }
  }
  return tables;
}

export async function loadTables(source) {
  const { format, tables } = await loadRawTables(source);
  return { format, tables: coerceTables(tables) };
}
