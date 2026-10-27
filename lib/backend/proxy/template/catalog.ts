/**
 * Sub-One 分流模板目录
 *
 * 统一分类模型：一个分类 = 一组规则集 → 一个策略组（或直接 DIRECT / REJECT）。
 * 各平台渲染器共用这份目录，只负责把它翻译成各自的语法。
 *
 * 规则集来源（只引用 URL，规则内容由客户端自行下载，不随 Sub-One 分发）：
 * - geosite / geoip：MetaCubeX/meta-rules-dat（mihomo 用 meta 分支，sing-box 用 sing 分支）
 * - bm7：blackmatrix7/ios_rule_script 的 rule/<Client>/<Name>/<Name>.list（Surge 系、Loon、QX）
 */

export type TemplateName = 'none' | 'minimal' | 'balanced' | 'full';
export type TemplatePreset = Exclude<TemplateName, 'none'>;

export const TEMPLATE_NAMES: TemplateName[] = ['none', 'minimal', 'balanced', 'full'];
export const DEFAULT_TEMPLATE: TemplateName = 'balanced';

export const DIRECT = 'DIRECT';
export const REJECT = 'REJECT';

export const GROUP_NAMES = {
    select: '🚀 节点选择',
    auto: '♻️ 自动选择',
    final: '🐟 漏网之鱼'
} as const;

export interface CategoryDef {
    id: string;
    /** 有值时生成同名 select 策略组；否则规则直接指向 target */
    group?: string;
    /** 无 group 时规则的直接目标 */
    target?: typeof DIRECT | typeof REJECT | typeof GROUP_NAMES.select;
    /** 策略组默认直连（DIRECT 排第一） */
    preferDirect?: boolean;
    /** MetaCubeX geosite 名（域名类规则集） */
    geosite: string[];
    /** MetaCubeX geoip 名（IP 类规则集） */
    geoip: string[];
    /** blackmatrix7 规则名；空数组表示 iOS 系客户端不生成该分类（由 FINAL 兜底） */
    bm7: string[];
}

/** 顺序即规则匹配顺序 */
export const CATEGORIES: CategoryDef[] = [
    { id: 'private', target: DIRECT, geosite: ['private'], geoip: ['private'], bm7: ['Lan'] },
    { id: 'ads', target: REJECT, geosite: ['category-ads-all'], geoip: [], bm7: ['Advertising'] },
    {
        id: 'ai',
        group: '🤖 AI 服务',
        geosite: ['category-ai-!cn'],
        geoip: [],
        bm7: ['OpenAI', 'Claude', 'Gemini', 'Copilot']
    },
    { id: 'telegram', group: '📲 Telegram', geosite: ['telegram'], geoip: ['telegram'], bm7: ['Telegram'] },
    { id: 'youtube', group: '📹 YouTube', geosite: ['youtube'], geoip: [], bm7: ['YouTube'] },
    { id: 'google', group: '🔍 谷歌服务', geosite: ['google'], geoip: ['google'], bm7: ['Google'] },
    { id: 'github', group: '🐱 GitHub', geosite: ['github'], geoip: [], bm7: ['GitHub'] },
    {
        id: 'streaming',
        group: '🎬 流媒体',
        geosite: ['netflix', 'disney', 'hbo', 'spotify'],
        geoip: ['netflix'],
        bm7: ['Netflix', 'Disney', 'HBO', 'Spotify']
    },
    {
        id: 'social',
        group: '🌐 社交媒体',
        geosite: ['twitter', 'facebook', 'instagram', 'tiktok'],
        geoip: ['twitter', 'facebook'],
        bm7: ['Twitter', 'Facebook', 'Instagram', 'TikTok']
    },
    {
        id: 'microsoft',
        group: 'Ⓜ️ 微软服务',
        preferDirect: true,
        geosite: ['microsoft'],
        geoip: [],
        bm7: ['Microsoft']
    },
    { id: 'apple', group: '🍎 苹果服务', preferDirect: true, geosite: ['apple'], geoip: [], bm7: ['Apple'] },
    { id: 'cn', target: DIRECT, geosite: ['cn'], geoip: ['cn'], bm7: ['China'] },
    // geolocation-!cn 的文本版过大（jsDelivr 拒绝分发），iOS 系不生成，交给 FINAL
    { id: 'non-cn', target: GROUP_NAMES.select, geosite: ['geolocation-!cn'], geoip: [], bm7: [] }
];

export const PRESETS: Record<TemplatePreset, string[]> = {
    minimal: ['private', 'cn', 'non-cn'],
    balanced: ['private', 'ai', 'telegram', 'youtube', 'google', 'github', 'cn', 'non-cn'],
    full: CATEGORIES.map((c) => c.id)
};

export function isTemplateName(value: unknown): value is TemplateName {
    return typeof value === 'string' && (TEMPLATE_NAMES as string[]).includes(value);
}

/** 测速参数（url-test 组） */
export const URL_TEST = {
    url: 'https://www.gstatic.com/generate_204',
    interval: 300,
    tolerance: 50
} as const;
