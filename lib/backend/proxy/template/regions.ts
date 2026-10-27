/**
 * Sub-One 地区识别
 *
 * 地区正则改编自 powerfullz/override-rules (MIT License, Copyright (c) 2025 powerfullz)
 * https://github.com/powerfullz/override-rules/blob/41a6157/src/catalog/countries.ts
 * 详见仓库根目录 THIRD_PARTY_NOTICES.md
 */

export interface RegionDef {
    /** 策略组名称 (中文 + emoji) */
    name: string;
    pattern: RegExp;
    exclude?: RegExp;
}

// 节点代号写法：HK、HK01、HK-01、HK_01_IPLC 等；用 \b 防止 "plus" 命中 "US"
const code = (c: string) => `\\b(?:${c}|${c.toLowerCase()})(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b`;

// 全大写的机场/国家三字码加词边界，防止 "ROCKET" 命中 ROC、"SCAN" 命中 CAN
const terms = (...items: string[]) =>
    new RegExp(items.map((t) => (/^[A-Z]{3}$/.test(t) ? `\\b${t}\\b` : t)).join('|'));

/** 按优先级排序：节点名命中多个地区时取第一个（如 "法兰克福" 先命中德国） */
export const REGIONS: RegionDef[] = [
    {
        name: '🇭🇰 香港节点',
        pattern: terms(
            '香港', '港', code('HK'), 'Hong Kong', 'HongKong', 'hongkong', 'HONG KONG', 'HONGKONG',
            '深港', 'HKG', '九龙', 'Kowloon', '新界', '沙田', '荃湾', '葵涌', '🇭🇰'
        ),
        exclude: /港澳台/
    },
    {
        name: '🇹🇼 台湾节点',
        pattern: terms('台', '新北', '彰化', code('TW'), 'Taiwan', 'TAIWAN', 'TWN', 'TPE', 'ROC', '🇹🇼', '🇼🇸'),
        exclude: /平台|后台|前台|舞台|台州|台山/
    },
    {
        name: '🇸🇬 新加坡节点',
        pattern: terms('新加坡', '坡', '狮城', code('SG'), 'Singapore', 'SINGAPORE', 'SIN', '🇸🇬')
    },
    {
        name: '🇯🇵 日本节点',
        pattern: terms(
            '日本', '川日', '东京', '大阪', '泉日', '埼玉', '沪日', '深日', code('JP'), 'Japan', 'JAPAN',
            'JPN', 'NRT', 'HND', 'KIX', 'TYO', 'OSA', '关西', 'Kansai', 'KANSAI', '🇯🇵'
        )
    },
    {
        name: '🇰🇷 韩国节点',
        pattern: terms('韩国', '韩', '韓', '春川', 'Chuncheon', '首尔', code('KR'), 'Korea', 'KOREA', 'KOR', 'ICN', '🇰🇷')
    },
    {
        name: '🇺🇸 美国节点',
        pattern: terms(
            '美国', '美', '波特兰', '达拉斯', '德克萨斯', '俄勒冈', '凤凰城', '费利蒙', '硅谷', '拉斯维加斯',
            '洛杉矶', '圣何塞', '圣克拉拉', '西雅图', '芝加哥', '纽约', '亚特兰大', '迈阿密', '华盛顿',
            code('US'), 'United States', 'UnitedStates', 'UNITED STATES', 'USA', 'America', 'AMERICA',
            'JFK', 'EWR', 'IAD', 'ATL', 'ORD', 'MIA', 'NYC', 'LAX', 'SFO', 'SEA', 'DFW', 'SJC', '🇺🇸'
        ),
        exclude: /美属|亚美尼亚|圣多美|普林西比/
    },
    {
        name: '🇨🇦 加拿大节点',
        pattern: terms(
            '加拿大', '渥太华', '温哥华', '卡尔加里', '蒙特利尔', 'Montreal', code('CA'), 'Canada', 'CANADA',
            'CAN', 'YVR', 'YYZ', 'YUL', '🇨🇦'
        )
    },
    {
        name: '🇬🇧 英国节点',
        pattern: terms(
            '英国', '伦敦', '曼彻斯特', 'Manchester', code('UK'), 'Britain', 'United Kingdom', 'UNITED KINGDOM',
            'England', 'GBR', 'LHR', 'MAN', '🇬🇧'
        )
    },
    {
        name: '🇩🇪 德国节点',
        pattern: terms('德国', '德', '柏林', '法兰克福', '慕尼黑', 'Munich', code('DE'), 'Germany', 'GERMANY', 'DEU', 'MUC', '🇩🇪'),
        exclude: /瓜德罗普/
    },
    {
        name: '🇫🇷 法国节点',
        pattern: terms('法国', '法', '巴黎', '马赛', 'Marseille', code('FR'), 'France', 'FRANCE', 'FRA', 'CDG', 'MRS', '🇫🇷'),
        exclude: /法属|布基纳法索|法罗/
    },
    {
        name: '🇦🇺 澳大利亚节点',
        pattern: terms('澳洲', '澳大利亚', code('AU'), 'Australia', '🇦🇺')
    },
    {
        name: '🇷🇺 俄罗斯节点',
        pattern: terms('俄罗斯', '俄', code('RU'), 'Russia', '🇷🇺'),
        exclude: /埃塞俄比亚|白俄罗斯/
    },
    {
        name: '🇹🇭 泰国节点',
        pattern: terms('泰国', '泰', code('TH'), 'Thailand', '🇹🇭'),
        exclude: /巴泰/
    },
    {
        name: '🇮🇳 印度节点',
        pattern: terms('印度', code('IN'), 'India', '🇮🇳'),
        exclude: /印度洋|印度尼西亚/
    },
    {
        name: '🇲🇾 马来西亚节点',
        pattern: terms('马来西亚', '马来', code('MY'), 'Malaysia', '🇲🇾')
    }
];

/** 返回节点所属地区的策略组名，未识别返回 undefined */
export function matchRegion(nodeName: string): string | undefined {
    for (const region of REGIONS) {
        if (region.pattern.test(nodeName) && !region.exclude?.test(nodeName)) {
            return region.name;
        }
    }
    return undefined;
}
