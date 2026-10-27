/**
 * Sub-One 分流模板入口
 */
import type { ConvertOptions } from '../types';
import { isTemplateName, type TemplatePreset } from './catalog';
import type { RuleSourceOptions } from './sources';

export * from './catalog';
export * from './plan';
export * from './regions';
export * from './sources';

/** 从转换选项中取出要应用的预设；none / 未设置 / 非法值返回 undefined（只输出节点） */
export function resolvePreset(options: ConvertOptions = {}): TemplatePreset | undefined {
    const name = options.template;
    if (!isTemplateName(name) || name === 'none') return undefined;
    return name;
}

export function ruleSourceOptions(options: ConvertOptions = {}): RuleSourceOptions {
    return { cdn: options.ruleCdn, customTemplate: options.ruleCdnTemplate };
}
