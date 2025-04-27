'use strict';
const fs = require('fs');
const path = require('path');

// --- 配置 --- >
const ITEM_CN_FILE = 'Item.csv';
const ITEM_EN_FILE = 'item-en.csv'; // 假设英文文件名是这个
const OUTPUT_FILE = 'furniture_cn_en.csv';

const SKIP_LINES = 2; // 两个文件都需要跳过的标题行数
const ITEM_ID_INDEX = 0;       // ItemID 在两个文件中的列索引
const NAME_CN_INDEX = 1;       // 中文名 (Singular) 在 Item.csv 中的列索引
const NAME_EN_INDEX = 1;       // 英文名 (Singular) 在 item-en.csv 中的列索引
const TYPE_ID_INDEX = 16;      // ItemUICategory 在 Item.csv 中的列索引

// 要提取的目标类型 ItemUICategory ID 列表
const TARGET_TYPE_IDS = new Set([
    // 原有的家具 ID
    '57', '65', '66', '67', '68', '69', '70', '71', '72',
    '73', '74', '75', '76', '77', '78', '79', '80', '95',
    // 新增的鱼类 ID
    '47'
]);

// 类型 ID 到描述的映射
const itemTypeMapping = new Map([
    // 原有的家具映射
    ['57', '椅子 (Seating)'],
    ['65', '房屋外部 - 屋顶 (Housing Exterior - Roof)'],
    ['66', '房屋外部 - 外墙 (Housing Exterior - Walls)'],
    ['67', '房屋外部 - 窗户 (Housing Exterior - Windows)'],
    ['68', '房屋外部 - 门 (Housing Exterior - Door)'],
    ['69', '房屋外部 - 烟囱 (Housing Exterior - Chimney)'],
    ['70', '房屋外部 - 遮蓬/附加物 (Housing Exterior - Placard/Roof Decor)'],
    ['71', '房屋外部 - 门牌 (Housing Exterior - Placard)'],
    ['72', '房屋外部 - 围墙 (Housing Exterior - Fence)'],
    ['73', '房屋内部 - 内墙 (Housing Interior - Interior Wall)'],
    ['74', '房屋内部 - 地板 (Housing Interior - Flooring)'],
    ['75', '房屋内部 - 照明 (Housing Interior - Ceiling Light)'],
    ['76', '庭具 - 植物 (Outdoor Furnishing - Plant/Tree)'],
    ['77', '桌子 (Table)'],
    ['78', '摆设/照明 (Tabletop/Lighting)'],
    ['79', '壁挂装饰 (Wall-mounted)'],
    ['80', '地毯 (Rug)'],
    ['95', '壁挂装饰 (Wall-mounted)'],
    // 新增的鱼类映射
    ['47', '鱼类 (Fish)']
]);
// --- 配置 < ---

/**
 * 解析CSV文本，能处理带引号的字段、字段内的换行符和逗号，以及转义引号("").
 * @param {string} csvText - 完整的CSV文本内容.
 * @returns {string[][]} 一个包含记录的数组，每个记录是包含字段的数组.
 */
function parseCsvTextRobust(csvText) {
    const records = [];
    let currentRecord = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;
    // 标准化换行符为 \n
    const text = csvText.replace(/\r\n|\r/g, '\n');
    const len = text.length;

    while (i < len) {
        const char = text[i];

        if (inQuotes) {
            if (char === '"') {
                // 检查是否为转义引号 ("" -> ")
                if (i + 1 < len && text[i + 1] === '"') {
                    currentField += '"';
                    i++; // 跳过第二个引号
                } else {
                    inQuotes = false; // 引号字段结束
                }
            } else {
                currentField += char; // 引号内的普通字符
            }
        } else { // 不在引号内
            if (char === '"') {
                // 如果字段为空，则开始引号字段
                if (currentField === '') {
                    inQuotes = true;
                } else {
                    // 引号出现在字段中间，按标准可能无效，但我们将其视为普通字符
                    currentField += char;
                }
            } else if (char === ',') {
                // 字段结束
                currentRecord.push(currentField);
                currentField = ''; // 为下一个字段重置
            } else if (char === '\n') {
                // 记录结束
                currentRecord.push(currentField);
                records.push(currentRecord);
                currentRecord = [];
                currentField = ''; // 为下一条记录重置
            } else {
                currentField += char; // 普通字符
            }
        }
        i++;
    }

    // 处理文件末尾最后一条记录（如果文件不是以换行符结尾）
    if (currentField || currentRecord.length > 0) {
        currentRecord.push(currentField);
        records.push(currentRecord);
    }
    // 移除由于文件末尾可能有空行而产生的空记录
    if (records.length > 0 && records[records.length - 1].length === 1 && records[records.length - 1][0] === '') {
       records.pop();
    }


    return records;
}

/**
 * 构建 ItemID -> Name 的查找映射
 * @param {string} csvText - CSV 文件内容
 * @param {number} idIndex - ID 列索引
 * @param {number} nameIndex - 名称列索引
 * @param {number} skipLines - 跳过的行数
 * @returns {Map<string, string>} ID到名称的映射
 */
function buildNameMap(csvText, idIndex, nameIndex, skipLines) {
    const nameMap = new Map();
    // 使用新的解析器
    const records = parseCsvTextRobust(csvText);
    // 跳过标题行来处理数据
    for (let i = skipLines; i < records.length; i++) {
        const columns = records[i];
        if (columns.length > Math.max(idIndex, nameIndex) && columns[idIndex] && columns[idIndex].trim()) {
            const id = columns[idIndex].trim();
            const name = columns[nameIndex] ? columns[nameIndex].trim() : 'N/A';
            nameMap.set(id, name);
        }
    }
    return nameMap;
}

/**
 * 格式化CSV单元格，处理包含逗号的情况
 * @param {string} cellData
 * @returns {string}
 */
function formatCsvCell(cellData) {
    const strData = String(cellData); // 确保是字符串
    if (strData.includes(',') || strData.includes('"') || strData.includes('\n')) {
        // 如果包含逗号、引号或换行符，用双引号包围，并将内部双引号转义为两个双引号
        return `"${strData.replace(/"/g, '""')}"`;
    }
    return strData;
}

// --- 主逻辑 ---

console.log('开始处理...');

// 1. 读取文件
let itemCnText, itemEnText;
try {
    const cnFilePath = path.join(__dirname, ITEM_CN_FILE);
    const enFilePath = path.join(__dirname, ITEM_EN_FILE);
    console.log(`正在读取中文文件: ${cnFilePath}`);
    itemCnText = fs.readFileSync(cnFilePath, 'utf8');
    console.log(`正在读取英文文件: ${enFilePath}`);
    itemEnText = fs.readFileSync(enFilePath, 'utf8');
    console.log('文件读取完成。');
} catch (error) {
    console.error('错误：无法读取所需的CSV文件。', error.message);
    console.error(`请确保 ${ITEM_CN_FILE} 和 ${ITEM_EN_FILE} 文件存在于脚本同目录下。`);
    process.exit(1);
}

// 2. 构建英文名称查找表
console.log('正在构建英文名称查找表...');
const englishNameMap = buildNameMap(itemEnText, ITEM_ID_INDEX, NAME_EN_INDEX, SKIP_LINES);
console.log(`英文名称查找表构建完成，共 ${englishNameMap.size} 个条目。`);

// 3. 处理中文数据并筛选
console.log('正在处理中文数据并筛选家具...');
const results = [];
// 使用新的解析器解析中文文件
const cnRecords = parseCsvTextRobust(itemCnText);

for (let i = SKIP_LINES; i < cnRecords.length; i++) {
    const columns = cnRecords[i];

    if (columns.length > Math.max(ITEM_ID_INDEX, NAME_CN_INDEX, TYPE_ID_INDEX)) {
        const itemType = columns[TYPE_ID_INDEX] ? columns[TYPE_ID_INDEX].trim() : null;

        // 检查是否是目标类型
        if (itemType && TARGET_TYPE_IDS.has(itemType)) {
            const itemId = columns[ITEM_ID_INDEX] ? columns[ITEM_ID_INDEX].trim() : null;
            const chineseName = columns[NAME_CN_INDEX] ? columns[NAME_CN_INDEX].trim() : 'N/A';

            if (itemId) {
                const englishName = englishNameMap.get(itemId) || 'N/A';
                const itemTypeDesc = itemTypeMapping.get(itemType) || '未知类型 (Unknown Type)';

                results.push({
                    id: itemId,
                    cnName: chineseName,
                    enName: englishName,
                    type: itemTypeDesc
                });
            }
        }
    }
}
console.log(`筛选完成，找到 ${results.length} 个符合条件的物品。`);

// 4. 生成 CSV 结果
console.log('正在生成输出 CSV 文件...');
const outputHeader = 'ItemID,ChineseName,EnglishName,ItemType';
const outputRows = results.map(item => [
    formatCsvCell(item.id),
    formatCsvCell(item.cnName),
    formatCsvCell(item.enName),
    formatCsvCell(item.type)
].join(','));

const outputCsv = [outputHeader, ...outputRows].join('\n');

// 5. 保存到文件
try {
    const outputFilePath = path.join(__dirname, OUTPUT_FILE);
    fs.writeFileSync(outputFilePath, outputCsv, 'utf8');
    console.log(`处理完成！结果已保存到: ${outputFilePath}`);
} catch (error) {
    console.error(`错误：无法写入输出文件 ${OUTPUT_FILE}。`, error.message);
    process.exit(1);
}

console.log('脚本执行结束。'); 