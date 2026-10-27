/**
 * Sub-One 分流模板规划
 *
 * 输入：最终输出的节点名列表（已过滤、已去重）+ 预设名
 * 输出：与平台无关的 TemplatePlan，各平台渲染器只做语法翻译
 */
import {
    CATEGORIES,
    type CategoryDef,
    DIRECT,
    GROUP_NAMES,
    PRESETS,
    type TemplatePreset
} from './catalog';
import { matchRegion, REGIONS } from './regions';

export interface PlanGroup {
    name: string;
    type: 'select' | 'url-test';
    /** 成员：节点名、其他策略组名或 DIRECT（不会出现 REJECT） */
    members: string[];
}

export interface PlanRule {
    id: string;
    /** 策略组名，或 DIRECT / REJECT */
    target: string;
    geosite: string[];
    geoip: string[];
    bm7: string[];
}

export interface TemplatePlan {
    preset: TemplatePreset;
    nodeNames: string[];
    /** 输出顺序即策略组顺序 */
    groups: PlanGroup[];
    /** 输出顺序即匹配顺序（渲染器可把 IP 类规则后置） */
    rules: PlanRule[];
    /** 兜底目标（MATCH / FINAL / route.final） */
    final: string;
}

/** 至少识别出这么多个地区才生成地区组，否则只保留平铺节点 */
const MIN_REGION_GROUPS = 2;

export function buildPlan(nodeNames: string[], preset: TemplatePreset): TemplatePlan {
    const names = [...new Set(nodeNames)];
    const hasNodes = names.length > 0;

    // 地区分组（按 REGIONS 顺序输出）
    const byRegion = new Map<string, string[]>();
    for (const name of names) {
        const region = matchRegion(name);
        if (!region) continue;
        if (!byRegion.has(region)) byRegion.set(region, []);
        byRegion.get(region)!.push(name);
    }
    const regionGroups: PlanGroup[] =
        byRegion.size >= MIN_REGION_GROUPS
            ? REGIONS.filter((r) => byRegion.has(r.name)).map((r) => ({
                  name: r.name,
                  type: 'url-test' as const,
                  members: byRegion.get(r.name)!
              }))
            : [];
    const regionNames = regionGroups.map((g) => g.name);

    const autoGroups = hasNodes ? [GROUP_NAMES.auto] : [];
    const selectGroup: PlanGroup = {
        name: GROUP_NAMES.select,
        type: 'select',
        members: [...autoGroups, ...regionNames, ...names, DIRECT]
    };

    // 分类组的候选：有地区组时只列组，节点太少时直接列节点
    const categoryCandidates = [
        GROUP_NAMES.select,
        ...autoGroups,
        ...(regionNames.length > 0 ? regionNames : names)
    ];

    const categoryIds = new Set(PRESETS[preset]);
    const categories = CATEGORIES.filter((c) => categoryIds.has(c.id));

    const categoryGroups: PlanGroup[] = categories
        .filter((c): c is CategoryDef & { group: string } => Boolean(c.group))
        .map((c) => ({
            name: c.group,
            type: 'select',
            members: c.preferDirect ? [DIRECT, ...categoryCandidates] : [...categoryCandidates, DIRECT]
        }));

    const groups: PlanGroup[] = [selectGroup];
    if (hasNodes) {
        groups.push({ name: GROUP_NAMES.auto, type: 'url-test', members: names });
    }
    groups.push(...categoryGroups);
    groups.push({
        name: GROUP_NAMES.final,
        type: 'select',
        members: [GROUP_NAMES.select, DIRECT, ...autoGroups, ...regionNames]
    });
    groups.push(...regionGroups);

    const rules: PlanRule[] = categories.map((c) => ({
        id: c.id,
        target: c.group || c.target || GROUP_NAMES.select,
        geosite: c.geosite,
        geoip: c.geoip,
        bm7: c.bm7
    }));

    return { preset, nodeNames: names, groups, rules, final: GROUP_NAMES.final };
}
